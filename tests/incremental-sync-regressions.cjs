const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Runs the real SyncService and LedgerDatabase against an in-memory Firestore
// that records which rows each sync reads.
const root = path.resolve(__dirname, '..');
let serial = 0;
let currentDb = null;
const HOUR = 60 * 60 * 1000;
let clock = Date.UTC(2026, 0, 1);
const cloud = new Map(); // path -> Map(id -> data)
const reads = [];
const Timestamp = { fromMillis: ms => ({ ms, toMillis: () => ms }) };
const firestore = {
  getFirestore: () => ({}),
  collection: (_fs, p) => ({ path: p }),
  where: (field, op, value) => ({ field, op, value }),
  query: (ref, clause) => ({ path: ref.path, clause }),
  doc: (_fs, p) => ({ path: p }),
  serverTimestamp: () => 'server-ts',
  onSnapshot: () => () => {},
  Timestamp,
  // Minimal transaction: reads and writes rows of the in-memory cloud, stamping _syncedAt.
  runTransaction: async (_fs, fn) => fn({
    get: async ref => { const [p, id] = splitDoc(ref.path); const data = cloud.get(p)?.get(id); return { data: () => data && { ...data } }; },
    set: (ref, data) => { const [p, id] = splitDoc(ref.path); if (!cloud.has(p)) cloud.set(p, new Map()); cloud.get(p).set(id, { ...data, _syncedAt: Timestamp.fromMillis(clock += HOUR) }); },
  }),
  getDocs: async q => {
    const since = q.clause ? q.clause.value.toMillis() : null;
    const docs = [...(cloud.get(q.path) || new Map()).entries()]
      .filter(([, data]) => since === null || (data._syncedAt && data._syncedAt.toMillis() > since))
      .map(([id, data]) => ({ id, data: () => ({ ...data }) }));
    reads.push({ path: q.path, partial: since !== null, count: docs.length });
    return { docs };
  },
};
const splitDoc = p => [p.slice(0, p.lastIndexOf('/')), p.slice(p.lastIndexOf('/') + 1)];
// Rows are synced an hour apart, like real edits, so only the newest falls inside the re-read overlap.
const putCloud = (table, id, value, revision, { deleted = false, syncedAt = (clock += HOUR) } = {}) => {
  const p = `users/alice/${table}`;
  if (!cloud.has(p)) cloud.set(p, new Map());
  cloud.get(p).set(id, { ...value, id, _revision: revision, _deleted: deleted, _operation: `op-${id}-${revision}`, ...(syncedAt === null ? {} : { _syncedAt: Timestamp.fromMillis(syncedAt) }) });
};

const memory = new Map();
const storage = { getItem: async k => memory.get(k) ?? null, setItem: async (k, v) => { memory.set(k, v); }, removeItem: async k => { memory.delete(k); } };
const noopEmitter = { default: { emit() {}, subscribe() { return () => {}; }, subscribeImmediate() { return () => {}; } } };
const thunk = () => () => ({ unwrap: async () => undefined });
// dispatch(fetchX()) receives the action object; unwrap() resolves immediately.
const mocks = {
  'firebase/firestore': firestore,
  'firebase/auth': { getAuth: () => ({ currentUser: { uid: 'alice' } }) },
  '@/utils/uuid': { generateUUID: () => `id-${++serial}` },
  '@/services/LocalChangeEmitter': noopEmitter,
  '../LocalChangeEmitter': noopEmitter,
  './LocalChangeEmitter': noopEmitter,
  './NativeErrorReporter': { default: { reset() {} } },
  '@/store': { store: { dispatch: action => action } },
  '@/store/slices/accountsSlice': { fetchAccounts: thunk() },
  '@/store/slices/transactionsSlice': { fetchTransactions: thunk() },
  '@/store/slices/budgetsSlice': { fetchBudgets: thunk() },
  '@/store/slices/loansSlice': { fetchLoans: thunk() },
  '@/services/database': { getDatabase: async () => currentDb },
  '@/services/AuxiliarySyncService': { default: { sync: async () => {} } },
  '@/services/PrivateConfigurationService': { default: { sync: async () => {} } },
  '@/contexts/AppSettingsContext': { loadStoredAppSettings: async () => ({ cloudSyncEnabled: true, currency: 'ETB' }) },
  '@react-native-async-storage/async-storage': { default: storage },
};
const cache = new Map();
function load(name, parent = root) {
  if (mocks[name]) return { __esModule: true, ...mocks[name] };
  if (!name.startsWith('.') && !name.startsWith('@/')) return require(name);
  let file = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(parent, name);
  if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '/index.ts';
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} }; cache.set(file, mod);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)(n => load(n, path.dirname(file)), mod, mod.exports);
  return mod.exports;
}
const { LedgerDatabase } = load('./services/database/ledger.ts');
const { SyncService } = load('./services/SyncService.ts');

class Adapter {
  rows = { accounts: new Map(), transactions: new Map(), budgets: new Map(), loans: new Map() };
  meta = {};
  async init() {}
  async close() {}
  async getAccounts() { return structuredClone([...this.rows.accounts.values()]); }
  async getTransactions() { return structuredClone([...this.rows.transactions.values()]); }
  async getBudgets() { return structuredClone([...this.rows.budgets.values()]); }
  async getLoans() { return structuredClone([...this.rows.loans.values()]); }
  async readMeta(k) { return structuredClone(this.meta[k]); }
  async commitRows(rows, meta = {}) {
    for (const row of rows) { if (row.value === undefined) this.rows[row.table].delete(row.id); else this.rows[row.table].set(row.id, structuredClone(row.value)); }
    Object.assign(this.meta, structuredClone(meta));
  }
}
const acc = { name: 'CBE', balance: 0, type: 'BANK', currency: 'ETB', is_locked: false, locked_amount: 0, created_at: 1 };
const tx = (accountId, amount) => ({ account_id: accountId, amount, type: 'EXPENSE', category: 'Food', description: 'Meal', date: 5, created_at: 5, updated_at: 5 });

async function freshDevice() {
  cloud.clear(); reads.length = 0;
  const raw = new Adapter();
  currentDb = new LedgerDatabase(raw, 'alice');
  await currentDb.init();
  putCloud('accounts', 'a1', acc, 1);
  for (let i = 0; i < 20; i++) putCloud('transactions', `t${i}`, tx('a1', 1), 1);
  await SyncService.syncNow('alice'); // first sync: full
  reads.length = 0;
  return raw;
}
const autoSync = () => SyncService['execute']('alice');
const txReads = () => reads.filter(r => r.path === 'users/alice/transactions');

test('a routine sync after the first one reads only rows changed since the last pull', async () => {
  const raw = await freshDevice();
  assert.equal(raw.rows.transactions.size, 20);
  assert.equal(raw.rows.accounts.get('a1').balance, -20);
  putCloud('transactions', 't-new', tx('a1', 5), 1);
  await autoSync();
  const [read] = txReads();
  assert.equal(read.partial, true);
  assert.equal(read.count, 2, 'only the new row, plus the newest known row inside the overlap, is downloaded');
  assert.ok(raw.rows.transactions.has('t-new'));
  assert.equal(raw.rows.accounts.get('a1').balance, -25, 'balance rebuilt from the full local ledger');
});

test('edits and deletions from another device arrive through a partial pull', async () => {
  const raw = await freshDevice();
  putCloud('transactions', 't3', tx('a1', 7), 2);
  putCloud('transactions', 't4', {}, 2, { deleted: true });
  await autoSync();
  assert.equal(txReads()[0].partial, true);
  assert.equal(raw.rows.transactions.get('t3').amount, 7);
  assert.equal(raw.rows.transactions.has('t4'), false);
  assert.equal(raw.rows.accounts.get('a1').balance, -(18 + 7));
});

test('a row synced just before the cursor is still picked up by the overlap', async () => {
  const raw = await freshDevice();
  const cursor = raw.meta.pull_cursor;
  // Committed slightly earlier than the newest row seen, but became visible later.
  putCloud('transactions', 't-late', tx('a1', 3), 1, { syncedAt: cursor - 1000 });
  await autoSync();
  assert.ok(raw.rows.transactions.has('t-late'));
});

test('Sync now and the periodic safety net re-read everything, including rows without _syncedAt', async () => {
  const raw = await freshDevice();
  putCloud('transactions', 't-legacy', tx('a1', 2), 1, { syncedAt: null });
  await autoSync();
  assert.equal(raw.rows.transactions.has('t-legacy'), false, 'a partial pull cannot see it');
  reads.length = 0;
  await SyncService.syncNow('alice');
  assert.equal(txReads()[0].partial, false);
  assert.ok(raw.rows.transactions.has('t-legacy'), 'a manual sync brings it in');

  putCloud('transactions', 't-legacy2', tx('a1', 2), 1, { syncedAt: null });
  raw.meta.last_full_pull_at = Date.now() - 7 * 60 * 60 * 1000;
  reads.length = 0;
  await autoSync();
  assert.equal(txReads()[0].partial, false, 'full pull after the safety interval');
  assert.ok(raw.rows.transactions.has('t-legacy2'));
});

test('a partial pull bringing an account in another currency falls back to a full pull', async () => {
  const raw = await freshDevice();
  putCloud('accounts', 'a-usd', { ...acc, name: 'Dollar', currency: 'USD' }, 1);
  await autoSync();
  const accountReads = reads.filter(r => r.path === 'users/alice/accounts');
  // partial pull, then the full fallback (a follow-up sync uploads the relabel).
  assert.deepEqual(accountReads.slice(0, 2).map(r => r.partial), [true, false]);
  assert.equal(raw.rows.accounts.get('a-usd').currency, 'ETB', 'the existing mixed-currency protection still runs on the full set');
});
