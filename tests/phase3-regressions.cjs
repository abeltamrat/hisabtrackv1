const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
const mocks = {
  '@/services/database': { getDatabase: async () => ({}) },
  './database': { getDatabase: async () => ({}) },
  './SessionStorage': {},
  './RecurringTransactionService': { RecurringTransactionService: {} },
};
function load(name, parent = root) {
  if (mocks[name]) return mocks[name];
  if (!name.startsWith('.') && !name.startsWith('@/')) return require(name);
  let file = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(parent, name);
  if (!path.extname(file)) file += '.ts';
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} }; cache.set(file, mod);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)(n => load(n, path.dirname(file)), mod, mod.exports);
  return mod.exports;
}
const { parseLocaleAmount, parseQuickAdd } = load('./utils/quickAddParser.ts');
const { parseReceiptText, receiptSplits, matchReceipt } = load('./utils/receiptParser.ts');
const { AssistantActionService } = load('./services/AssistantActionService.ts');
const { createPeriodDigest, formatPeriodDigest } = load('./services/PeriodDigestService.ts');
const { forecastGoal } = load('./services/GoalForecastService.ts');
const account = { id: 'cash', name: 'Cash', type: 'CASH', balance: 5000, currency: 'ETB', is_locked: false, locked_amount: 0, created_at: 1 };
const categories = [{ name: 'Food & Drink', type: 'EXPENSE' }, { name: 'Transport', type: 'EXPENSE' }, { name: 'Salary', type: 'INCOME' }];
const tx = (id, overrides = {}) => ({ id, account_id: 'cash', amount: 100, type: 'EXPENSE', category: 'Food & Drink', description: 'Lunch', date: Date.UTC(2026, 7, 1), ...overrides });

test('quick add handles locale amounts, examples, splits, account and tags', () => {
  assert.equal(parseLocaleAmount('1,250.50'), 1250.5);
  assert.equal(parseLocaleAmount('1.250,50'), 1250.5);
  assert.equal(parseLocaleAmount('1 250,50 ETB'), 1250.5);
  const one = parseQuickAdd('lunch 250 cash #work', [account], categories, [], new Date(2026, 9, 8));
  assert.equal(one.amount, 250); assert.equal(one.accountId, 'cash'); assert.equal(one.category, 'Food & Drink'); assert.deepEqual(one.tags, ['work']);
  const split = parseQuickAdd('450 lunch and 150 taxi from cash', [account], categories);
  assert.equal(split.amount, 600); assert.deepEqual(split.splits.map(row => [row.amount, row.category, row.description]), [[450, 'Food & Drink', 'lunch'], [150, 'Transport', 'taxi']]);
});

test('quick add flags ambiguous accounts and creates stable duplicate fingerprint', () => {
  const accounts = [account, { ...account, id: 'cash2', name: 'Cash wallet' }];
  const first = parseQuickAdd('lunch 250 cash', accounts, categories, [], new Date(2026, 9, 8));
  const second = parseQuickAdd('lunch 250 cash', accounts, categories, [], new Date(2026, 9, 8));
  assert.ok(first.issues.some(issue => /more than one account/i.test(issue))); assert.equal(first.fingerprint, second.fingerprint);
});

test('receipt parser preserves separate taxes and fees and reconciles splits to total', () => {
  const receipt = parseReceiptText('Cafe Addis\n2026-10-07\nLunch 200.00\nJuice 50.00\nDiscount 10.00\nVAT 36.00\nService fee 4.00\nTotal 280.00');
  assert.equal(receipt.total, 280); assert.equal(receipt.taxes, 36); assert.equal(receipt.fees, 4); assert.equal(receipt.discounts, 10);
  const splits = receiptSplits(receipt, 'Food & Drink');
  assert.equal(Math.round(splits.reduce((sum, row) => sum + row.amount, 0) * 100), 28000);
  assert.ok(splits.every(row => row.description));
});

test('receipt matching only suggests an existing same-value payment in the date window', () => {
  const receipt = parseReceiptText('Cafe Addis\n2026-10-07\nMeal 280\nTotal 280');
  const matches = matchReceipt(receipt, [tx('near', { amount: 280, date: Date.UTC(2026, 9, 7), sender_receiver: 'Cafe Addis' }), tx('far', { amount: 280, date: Date.UTC(2026, 7, 7) })]);
  assert.deepEqual(matches.map(item => item.transaction.id), ['near']); assert.ok(matches[0].score > .7);
});

test('assistant answers category increase from records and actions require trusted user input', () => {
  const now = new Date(); const current = new Date(now.getFullYear(), now.getMonth(), 2).getTime(); const previous = new Date(now.getFullYear(), now.getMonth() - 1, 2).getTime();
  const scope = { transactions: [tx('current', { category: 'Transport', amount: 500, date: current }), tx('previous', { category: 'Transport', amount: 200, date: previous })], accounts: [account], budgets: [], categories: ['Transport'], recurring: [], currency: 'ETB' };
  const answer = AssistantActionService.analyze('Why did transport spending increase?', scope);
  assert.equal(answer.handled, true); assert.deepEqual(new Set(answer.evidenceIds), new Set(['current', 'previous'])); assert.match(answer.answer, /300/);
  assert.match(AssistantActionService.analyze('cap transport budget at ETB 3000', scope, 'SMS').error, /cannot authorize/i);
  assert.equal(AssistantActionService.analyze('cap transport budget at ETB 3000', scope).proposal.kind, 'BUDGET');
});

test('digest compares complete like-for-like periods and masks money when requested', () => {
  const now = new Date(2026, 9, 8); const digest = createPeriodDigest('MONTHLY', [tx('sept', { amount: 300, date: Date.UTC(2026, 8, 15) }), tx('aug', { amount: 100, date: Date.UTC(2026, 7, 15) })], [], { now, pendingDrafts: 2, discrepancies: 1 });
  assert.equal(digest.expense, 300); assert.equal(digest.categoryChanges[0].change, 200); assert.equal(digest.key, 'monthly:2026-09-01');
  const copy = formatPeriodDigest(digest, 'ETB', true); assert.doesNotMatch(copy.message, /300|200|100/); assert.match(copy.message, /••••/);
});

test('goal forecast excludes transfers, fund mirrors and Equb payouts and scenarios do not mutate input', () => {
  const now = new Date(2026, 9, 8); const rows = [];
  for (let month = 3; month <= 8; month++) {
    rows.push(tx(`salary-${month}`, { type: 'INCOME', amount: 1000, category: 'Salary', date: Date.UTC(2026, month, 5) }));
    rows.push(tx(`spend-${month}`, { amount: 400, date: Date.UTC(2026, month, 6) }));
    rows.push(tx(`equb-${month}`, { type: 'INCOME', amount: 5000, category: 'Equb payout', description: 'Equb payout', date: Date.UTC(2026, month, 7) }));
    rows.push(tx(`mirror-${month}`, { type: 'INCOME', amount: 9000, fund_mirror: true, date: Date.UTC(2026, month, 8) }));
  }
  const goal = { targetAmount: 6000, currentAmount: 0, hypotheticalMonthlyContribution: 1000 }; const before = JSON.stringify(goal);
  const result = forecastGoal(goal, rows, [], now);
  assert.equal(result.typicalMonthlySavings, 600); assert.equal(result.estimatedMonths, 6); assert.equal(JSON.stringify(goal), before); assert.match(result.assumptions.join(' '), /Equb/i);
});

test('receipt OCR and modal enforce explicit review boundaries in source', () => {
  const ocr = fs.readFileSync(path.join(root, 'services/ReceiptOCRService.ts'), 'utf8'); const modal = fs.readFileSync(path.join(root, 'app/modal.tsx'), 'utf8');
  assert.match(ocr, /explicitConsent/); assert.match(ocr, /aiSharingEnabled/); assert.match(modal, /InputDraftService\.get/); assert.match(modal, /markUsed/);
});
