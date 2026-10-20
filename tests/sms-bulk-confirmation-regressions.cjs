const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'utils', 'smsBulkConfirmation.ts');
const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = { exports: {} };
new Function('require', 'module', 'exports', js)(require, mod, mod.exports);
const { getBulkEditEligibility, resolveBulkConfirmationFields } = mod.exports;

const expense = (amount, extra = {}) => ({
  id: `sms-${amount}`,
  type: 'EXPENSE',
  amount,
  account_id: `account-${amount}`,
  date: 1700000000000 + amount,
  sms_id: `raw-${amount}`,
  reference_number: `ref-${amount}`,
  category: 'Other',
  description: `Detected ${amount}`,
  ...extra,
});

test('50, 30 and 20 ETB expenses can receive one shared parking classification', () => {
  const drafts = [expense(50), expense(30), expense(20)];
  const eligibility = getBulkEditEligibility(drafts);
  assert.deepEqual(eligibility, { canEditTogether: true, type: 'EXPENSE' });

  const recorded = drafts.map(draft => ({
    ...draft,
    ...resolveBulkConfirmationFields(draft, {
      applyCategory: true,
      category: 'Parking',
      description: 'Parking fees',
      tags: ['parking'],
    }, eligibility.canEditTogether),
  }));

  assert.deepEqual(recorded.map(item => item.amount), [50, 30, 20]);
  assert.deepEqual(recorded.map(item => item.category), ['Parking', 'Parking', 'Parking']);
  assert.deepEqual(recorded.map(item => item.description), ['Parking fees', 'Parking fees', 'Parking fees']);
  assert.equal(recorded.length, 3, 'the batch remains three separate ledger records');
});

test('shared classification never changes each SMS account, time, reference or identity', () => {
  const drafts = [expense(50), expense(30), expense(20)];
  const eligibility = getBulkEditEligibility(drafts);
  const recorded = drafts.map(draft => ({
    ...draft,
    ...resolveBulkConfirmationFields(draft, {
      applyCategory: true,
      category: 'Parking',
      description: 'Parking fees',
    }, eligibility.canEditTogether),
  }));

  for (let index = 0; index < drafts.length; index += 1) {
    assert.equal(recorded[index].account_id, drafts[index].account_id);
    assert.equal(recorded[index].date, drafts[index].date);
    assert.equal(recorded[index].sms_id, drafts[index].sms_id);
    assert.equal(recorded[index].reference_number, drafts[index].reference_number);
  }
});

test('blank shared fields preserve each parsed description and category', () => {
  const first = expense(50, { category: 'Transport', description: 'Lot A' });
  const second = expense(30, { category: 'Other', description: 'Lot B' });
  const eligibility = getBulkEditEligibility([first, second]);
  assert.deepEqual(
    [first, second].map(draft => resolveBulkConfirmationFields(draft, {
      applyCategory: false,
      description: '   ',
    }, eligibility.canEditTogether)),
    [
      { category: 'Transport', description: 'Lot A', tags: [], isCorrection: false },
      { category: 'Other', description: 'Lot B', tags: [], isCorrection: false },
    ],
  );
});

test('transfers and mixed directions cannot be reclassified as one batch', () => {
  const transfer = expense(50, { is_transfer: true, category: 'Transfer' });
  const mixed = [expense(30), expense(20, { type: 'INCOME' })];
  assert.equal(getBulkEditEligibility([transfer]).canEditTogether, false);
  assert.equal(getBulkEditEligibility(mixed).canEditTogether, false);

  const resolved = resolveBulkConfirmationFields(transfer, {
    applyCategory: true,
    category: 'Parking',
    description: 'Parking fees',
    tags: ['parking'],
  }, false);
  assert.deepEqual(resolved, {
    category: 'Transfer',
    description: 'Detected 50',
    tags: [],
    isCorrection: false,
  });
});
