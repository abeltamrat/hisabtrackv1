const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const cache = new Map();
function load(name, parent = root) {
  if (!name.startsWith('.') && !name.startsWith('@/')) return require(name);
  let file = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(parent, name);
  if (!path.extname(file)) file += '.ts';
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', js)(dep => load(dep, path.dirname(file)), mod, mod.exports);
  return mod.exports;
}

const items = load('./utils/itemFinance.ts');
const { projectEntries, projectTotals, projectKey } = load('./utils/projectFinance.ts');
const { validateTransaction } = load('./utils/finance.ts');
const { runAgentTool } = load('./services/FinancialAgent.ts');

const DAY = 86400000;
const now = Date.UTC(2026, 9, 11);
const villa = { source: 'mela', id: 7, title: 'Bole villa' };
const office = { source: 'mela', id: 9, title: 'Office fit-out' };
const cement = items.localItem('Cement 50kg', { kind: 'MATERIAL', category: 'Materials' });
const drill = items.localItem('Drill', { kind: 'TOOL' });
const oranges = items.localItem('Oranges');
const line = (id, item, quantity, unit_price, extra = {}) => ({ id, item, quantity, unit_price, amount: Math.round(quantity * unit_price * 100) / 100, ...extra });
const tx = (id, daysAgo, supplier, lines, extra = {}) => ({ id, type: 'EXPENSE', account_id: 'cbe', category: 'Purchases', description: id, date: now - daysAgo * DAY, sender_receiver: supplier, amount: lines.reduce((s, l) => s + l.amount, 0), lines, ...extra });

const ledger = [
  tx('t1', 60, 'Abebe Hardware', [line('l1', cement, 20, 1100, { unit: 'bag' })], { project: villa }),
  tx('t2', 40, 'Merkato Supply', [line('l2', cement, 10, 1050, { unit: 'bag' })], { project: villa }),
  tx('t3', 10, 'Abebe Hardware', [line('l3', cement, 30, 1150, { unit: 'bag' }), line('l4', drill, 1, 4500, { project: office })], { project: villa }),
  tx('t4', 2, 'Shola market', [line('l5', oranges, 3, 60, { unit: 'kg' })], { amount: 200 }),
];

test('catalog is rebuilt from purchase lines with totals and the latest purchase', () => {
  const catalog = items.buildCatalog(items.purchaseRecords(ledger));
  const c = catalog.find(e => e.item.name === 'Cement 50kg');
  assert.equal(c.purchases, 3);
  assert.equal(c.totalQuantity, 60);
  assert.equal(c.totalSpent, 22000 + 10500 + 34500);
  assert.equal(c.last.supplier, 'Abebe Hardware');
  assert.equal(items.localItem('  cement   50KG ').id, 'cement 50kg', 'same item regardless of spacing/case');
});

test('price insight gives last, cheapest-in-window and usual price, and flags overpaying', () => {
  const records = items.purchaseRecords(ledger);
  const key = items.itemKey(cement);
  const insight = items.priceInsight(records, key, now);
  assert.equal(insight.last.unitPrice, 1150);
  assert.equal(insight.best.unitPrice, 1050);
  assert.equal(insight.best.supplier, 'Merkato Supply');
  assert.equal(insight.typical, 1100);
  assert.equal(items.isUnusualPrice(1300, insight), true);
  assert.equal(items.isUnusualPrice(1120, insight), false);
  assert.equal(items.isUnusualPrice(9999, items.priceInsight(records, items.itemKey(drill), now)), false, 'no alarm without enough history');
});

test('suppliers rank by average price per unit', () => {
  const stats = items.supplierStats(items.purchaseRecords(ledger), items.itemKey(cement));
  assert.deepEqual(stats.map(s => s.supplier), ['Merkato Supply', 'Abebe Hardware']);
  assert.equal(stats[1].averagePrice, 1130); // (22000 + 34500) / 50
});

test('a line\'s own project wins; remainder stays with the transaction\'s project', () => {
  const entries = projectEntries(ledger);
  assert.equal(projectTotals(entries.get(projectKey(villa))).paid, 22000 + 10500 + 34500);
  assert.equal(projectTotals(entries.get(projectKey(office))).paid, 4500);
  const villaItems = items.itemBreakdown(items.purchaseRecords(ledger).filter(r => r.project && projectKey(r.project) === projectKey(villa)));
  assert.deepEqual(villaItems.rows.map(r => [r.item.name, r.quantity]), [['Cement 50kg', 60]]);
  assert.equal(villaItems.byKind.MATERIAL, 67000);
  assert.equal(villaItems.byKind.TOOL, 0);
});

test('validation enforces quantity × price and never more than the amount', () => {
  const base = { type: 'EXPENSE', account_id: 'cbe', amount: 500, date: 1, category: 'X', description: 'x' };
  assert.doesNotThrow(() => validateTransaction({ ...base, lines: [line('a', oranges, 3, 60)] }), 'lines may cover part of the amount');
  assert.throws(() => validateTransaction({ ...base, lines: [{ ...line('a', oranges, 3, 60), amount: 999 }] }), /quantity × unit price/);
  assert.throws(() => validateTransaction({ ...base, lines: [line('a', oranges, 10, 60)] }), /exceed/);
  assert.throws(() => validateTransaction({ ...base, lines: [line('a', { source: 'local', id: '', name: '' }, 1, 1)] }), /Invalid line item/);
  assert.throws(() => validateTransaction({ ...base, type: 'TRANSFER', to_account_id: 'x', lines: [line('a', oranges, 1, 1)] }), /income and expenses only/);
});

test('the assistant can answer "where is cement cheapest" from item lines', () => {
  const state = { evidence: new Set() };
  const result = runAgentTool('item_prices', { item: 'cement' }, { transactions: ledger, accounts: [], budgets: [], loans: [], recurring: [], goals: [], categories: [], currency: 'ETB' }, state);
  const cementResult = result.items[0];
  assert.equal(cementResult.last.supplier, 'Abebe Hardware');
  assert.equal(cementResult.suppliers[0].supplier, 'Merkato Supply');
  assert.equal(cementResult.total_quantity, 60);
  assert.ok(state.evidence.has('t3'));
});

test('only Mela-item prices are shared with assistants, and big lists are chunked', () => {
  const { sharedPrices, chunk } = load('./services/CatalogShareService.ts');
  const melaCement = { source: 'mela', id: '5', name: 'Cement', kind: 'MATERIAL' };
  const shared = sharedPrices([
    tx('m1', 5, 'Abebe Hardware', [line('a', melaCement, 2, 1100, { unit: 'bag' })]),
    tx('m2', 3, 'Merkato Supply', [line('b', melaCement, 1, 1050, { unit: 'bag' })]),
    tx('g1', 1, 'Shola market', [line('c', oranges, 3, 60)]),
  ], now);
  assert.deepEqual(Object.keys(shared), ['mela:5'], 'personal items like oranges are never shared');
  assert.equal(shared['mela:5'].last.price, 1050);
  assert.equal(shared['mela:5'].best.supplier, 'Merkato Supply');
  assert.equal(shared['mela:5'].unit, 'bag');
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(chunk(Array.from({ length: 1001 }, (_, i) => i)).length, 3);
});
