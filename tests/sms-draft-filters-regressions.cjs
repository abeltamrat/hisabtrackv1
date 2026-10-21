const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function load(file) {
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', js)(require, mod, mod.exports);
  return mod.exports;
}
const {
  EMPTY_SMS_DRAFT_FILTERS: EMPTY, matchesSmsDraftFilters: matches, countActiveSmsDraftFilters: count,
  smsDraftFilterOptions: options, parseFilterAmount,
} = load('utils/smsDraftFilters.ts');

const day = (d, h = 12) => new Date(2026, 9, d, h).getTime();
const draft = (over = {}) => ({
  id: 'd', account_id: 'cbe', type: 'EXPENSE', amount: 500, category: 'Food', description: 'Lunch',
  date: day(10), sms_id: 's', raw_sms: 'You have transferred ETB 500 to Abebe Kebede Ref FT123', status: 'PENDING',
  is_recorded: false, created_at: 1, sender_receiver: 'Abebe Kebede', reference_number: 'FT123', ...over,
});
const only = (filters, drafts) => drafts.filter(d => matches(d, { ...EMPTY, ...filters })).map(d => d.id);

test('no filters keep every draft', () => {
  assert.equal(matches(draft(), EMPTY), true);
  assert.equal(count(EMPTY), 0);
});

test('account filter matches the draft account or either transfer side', () => {
  const drafts = [draft({ id: 'a' }), draft({ id: 'b', account_id: 'boa' }), draft({ id: 'c', account_id: 'boa', is_transfer: true, transfer_to_account_id: 'cbe' })];
  assert.deepEqual(only({ accountIds: ['cbe'] }, drafts), ['a', 'c']);
  assert.deepEqual(only({ accountIds: ['boa'] }, drafts), ['b', 'c']);
});

test('receiver filter is case-insensitive, partial, and also checks the confirmed recipient and linked person', () => {
  const drafts = [
    draft({ id: 'a' }),
    draft({ id: 'b', sender_receiver: 'Ethio Telecom' }),
    draft({ id: 'c', sender_receiver: 'TELEBIRR 0911', person_name_snapshot: 'Abebe K.' }),
    draft({ id: 'd', sender_receiver: 'x', confirmation: { recorded_at: 1, type: 'EXPENSE', category: 'Food', description: 'd', recipient: 'Abebe Bekele', source_account_id: 'cbe' } }),
  ];
  assert.deepEqual(only({ recipient: 'abebe' }, drafts), ['a', 'c', 'd']);
  assert.deepEqual(only({ recipient: '  TELECOM ' }, drafts), ['b']);
});

test('date range is inclusive at both ends', () => {
  const drafts = [draft({ id: 'early', date: day(1) }), draft({ id: 'start', date: day(5, 0) }), draft({ id: 'end', date: day(7, 23) }), draft({ id: 'late', date: day(8) })];
  const from = new Date(2026, 9, 5).getTime();
  const to = new Date(2026, 9, 7, 23, 59, 59, 999).getTime();
  assert.deepEqual(only({ dateFrom: from, dateTo: to }, drafts), ['start', 'end']);
  assert.deepEqual(only({ dateFrom: from }, drafts), ['start', 'end', 'late']);
  assert.deepEqual(only({ dateTo: to }, drafts), ['early', 'start', 'end']);
});

test('amount range is inclusive, and equal bounds give an exact amount', () => {
  const drafts = [100, 250, 250.5, 1000].map(amount => draft({ id: String(amount), amount }));
  assert.deepEqual(only({ amountMin: 250, amountMax: 1000 }, drafts), ['250', '250.5', '1000']);
  assert.deepEqual(only({ amountMin: 250, amountMax: 250 }, drafts), ['250']);
  assert.deepEqual(only({ amountMax: 250 }, drafts), ['100', '250']);
});

test('type filter separates transfers from plain income and expense', () => {
  const drafts = [draft({ id: 'e' }), draft({ id: 'i', type: 'INCOME' }), draft({ id: 't', is_transfer: true })];
  assert.deepEqual(only({ type: 'expense' }, drafts), ['e']);
  assert.deepEqual(only({ type: 'income' }, drafts), ['i']);
  assert.deepEqual(only({ type: 'transfer' }, drafts), ['t']);
});

test('category filter uses the confirmed category of recorded drafts', () => {
  const drafts = [
    draft({ id: 'a' }),
    draft({ id: 'b', category: 'Food', confirmation: { recorded_at: 1, type: 'EXPENSE', category: 'Transport', description: 'x', source_account_id: 'cbe' } }),
  ];
  assert.deepEqual(only({ categories: ['Food'] }, drafts), ['a']);
  assert.deepEqual(only({ categories: ['Transport', 'Rent'] }, drafts), ['b']);
});

test('search needs every word, across description, reference, SMS text and amount', () => {
  const drafts = [draft({ id: 'a' }), draft({ id: 'b', description: 'Fuel', sender_receiver: 'Total Station', reference_number: 'FT999', raw_sms: 'Paid ETB 500 at Total' })];
  assert.deepEqual(only({ search: 'ft123' }, drafts), ['a']);
  assert.deepEqual(only({ search: 'fuel total' }, drafts), ['b']);
  assert.deepEqual(only({ search: 'fuel abebe' }, drafts), []);
  assert.deepEqual(only({ search: '500' }, drafts), ['a', 'b']);
});

test('filters combine with AND and are counted once per kind', () => {
  const filters = { ...EMPTY, accountIds: ['cbe'], amountMin: 100, amountMax: 900, recipient: 'abebe', type: 'expense' };
  assert.equal(count(filters), 4);
  assert.equal(matches(draft(), filters), true);
  assert.equal(matches(draft({ amount: 901 }), filters), false);
});

test('filter options list frequent receivers and categories first', () => {
  const drafts = [draft({ id: '1' }), draft({ id: '2', sender_receiver: 'abebe kebede' }), draft({ id: '3', sender_receiver: 'Shop', category: 'Rent' })];
  const result = options(drafts);
  assert.deepEqual(result.recipients, ['Abebe Kebede', 'Shop']);
  assert.deepEqual(result.categories, ['Food', 'Rent']);
  assert.deepEqual(result.accountIds, ['cbe']);
});

test('typed amounts accept separators and reject junk', () => {
  assert.equal(parseFilterAmount('1,250.50'), 1250.5);
  assert.equal(parseFilterAmount('  '), undefined);
  assert.equal(parseFilterAmount('abc'), undefined);
  assert.equal(parseFilterAmount('-5'), undefined);
});
