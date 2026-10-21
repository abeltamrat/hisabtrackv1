const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const file = path.join(__dirname, '..', 'utils', 'transactionMelaFilters.ts');
const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} }; new Function('require', 'module', 'exports', js)(require, mod, mod.exports);
const { collectMelaFilterOptions, matchesMelaFilters } = mod.exports;
const base = { id: 't1', type: 'EXPENSE', account_id: 'a', amount: 100, category: 'Work', description: 'materials', date: 1 };
const tx = { ...base, project: { source: 'mela', id: 7, code: 'P7', title: 'Office' }, supplier: { source: 'mela', id: 3, name: 'ABC Supply' }, lines: [{ id: 'l1', item: { source: 'mela', id: '11', name: 'Gypsum', kind: 'MATERIAL' }, quantity: 2, unit_price: 50, amount: 100 }] };

test('filters by saved Mela project, item, supplier and kind', () => {
  assert.equal(matchesMelaFilters(tx, { projectKeys: ['mela:7'], itemKeys: ['mela:11'], supplierKeys: ['mela:3'], itemKinds: ['MATERIAL'] }), true);
  assert.equal(matchesMelaFilters(tx, { projectKeys: ['mela:8'], itemKeys: [], supplierKeys: [], itemKinds: [] }), false);
  assert.equal(matchesMelaFilters(tx, { projectKeys: [], itemKeys: ['mela:12'], supplierKeys: [], itemKinds: [] }), false);
});

test('finds projects saved on splits and item lines without duplicates', () => {
  const splitProject = { source: 'mela', id: 9, title: 'Warehouse' };
  const second = { ...base, id: 't2', splits: [{ id: 's', amount: 100, category: 'Work', project: splitProject }], lines: [{ id: 'l', item: { source: 'local', id: 'paint', name: 'Paint', kind: 'MATERIAL' }, quantity: 1, unit_price: 100, amount: 100, project: splitProject }] };
  const options = collectMelaFilterOptions([tx, second]);
  assert.deepEqual(options.projects.map(item => item.title), ['Office', 'Warehouse']);
  assert.deepEqual(options.items.map(item => item.name), ['Gypsum', 'Paint']);
  assert.equal(matchesMelaFilters(second, { projectKeys: ['mela:9'], itemKeys: [], supplierKeys: [], itemKinds: [] }), true);
});
