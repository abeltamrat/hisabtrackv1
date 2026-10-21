const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
let rows = [];
let reads = 0;
const pendingReads = [];
const fakeDb = {
  getTransactions: filters => {
    reads++;
    const snapshot = filters ? rows.filter(t => t.account_id === filters.account_id) : [...rows];
    return new Promise(resolve => pendingReads.push(() => resolve(snapshot)));
  },
};
const mocks = { '@/services/database': { getDatabase: async () => fakeDb } };
function load(name, parent = root) {
  if (mocks[name]) return { __esModule: true, ...mocks[name] };
  if (!name.startsWith('.') && !name.startsWith('@/')) return require(name);
  let file = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(parent, name);
  if (!path.extname(file)) file += '.ts';
  const mod = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)(n => load(n, path.dirname(file)), mod, mod.exports);
  return mod.exports;
}
const { configureStore } = require('@reduxjs/toolkit');
const slice = load('./store/slices/transactionsSlice.ts');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function settle() { while (pendingReads.length) { pendingReads.shift()(); await tick(); await tick(); } }

test('concurrent full fetches share reads and every caller ends with data newer than its request', async () => {
  const store = configureStore({ reducer: { transactions: slice.default }, middleware: m => m({ serializableCheck: false, immutableCheck: false }) });
  rows = [{ id: 'a' }]; reads = 0;
  const first = store.dispatch(slice.fetchTransactions());
  const second = store.dispatch(slice.fetchTransactions());
  await tick(); await tick();
  assert.equal(reads, 1, 'the second request waits for a follow-up read instead of starting its own');

  rows = [{ id: 'a' }, { id: 'b' }]; // a write lands while the first read is running
  const third = store.dispatch(slice.fetchTransactions());
  const fourth = store.dispatch(slice.fetchTransactions());
  await settle();
  await Promise.all([first, second, third, fourth]);
  assert.equal(reads, 2, 'four requests cost two reads');
  assert.deepEqual(store.getState().transactions.items.map(t => t.id), ['a', 'b'], 'the store holds the post-write data');
  assert.deepEqual((await third).payload.map(t => t.id), ['a', 'b'], 'a request made after the write never gets the pre-write read');
});

test('a filtered fetch is never shared with a full fetch', async () => {
  rows = [{ id: 'x', account_id: 'acc1' }, { id: 'y', account_id: 'acc2' }]; reads = 0;
  const full = slice.fetchTransactions()(() => {}, () => ({}), undefined);
  const filtered = slice.fetchTransactions({ account_id: 'acc1' })(() => {}, () => ({}), undefined);
  await tick(); await tick();
  assert.equal(reads, 2);
  await settle();
  assert.equal((await filtered).payload.length, 1);
  assert.equal((await full).payload.length, 2);
});
