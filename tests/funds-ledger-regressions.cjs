const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Same TypeScript loader as audit-regressions.cjs, with the platform database
// replaced by an in-memory adapter behind the real LedgerDatabase.
const root = path.resolve(__dirname, '..');
let serial = 0;
let currentDb = null;
const memory = new Map();
const storage = { getItem: async k => memory.get(k) ?? null, setItem: async (k, v) => { memory.set(k, v); }, removeItem: async k => { memory.delete(k); }, getAllKeys: async () => [...memory.keys()], multiRemove: async keys => keys.forEach(k => memory.delete(k)), multiGet: async keys => keys.map(k => [k, memory.get(k) ?? null]), multiSet: async rows => rows.forEach(([k, v]) => memory.set(k, v)) };
const mocks = {
  '@/utils/uuid': { generateUUID: () => `id-${++serial}` },
  '@/services/LocalChangeEmitter': { default: { emit() {}, subscribe() { return () => {}; } } },
  '../LocalChangeEmitter': { default: { emit() {}, subscribe() { return () => {}; } } },
  '@react-native-async-storage/async-storage': { default: storage },
  '@/utils/fileHelper': { saveJSON: async () => {} },
  'expo-file-system/legacy': {},
  './database': { getDatabase: async () => currentDb },
};
const cache = new Map();
function load(name, parent = root) {
  if (!name.startsWith('.') && !name.startsWith('@/') && !mocks[name]) return require(name);
  if (mocks[name]) return { __esModule: true, ...mocks[name] };
  let file = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(parent, name);
  if (!path.extname(file)) file += '.ts';
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} }; cache.set(file, mod);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)(n => load(n, path.dirname(file)), mod, mod.exports);
  return mod.exports;
}
const finance = load('./utils/finance.ts');
const { LedgerDatabase } = load('./services/database/ledger.ts');
const { planFundMirror, mirrorTransactionId } = load('./utils/fundLedger.ts');
const FundLedgerService = load('./services/FundLedgerService.ts').default;
const { BackupService } = load('./services/BackupService.ts');

class Adapter {
  rows = { accounts: new Map(), transactions: new Map(), budgets: new Map(), loans: new Map() };
  meta = {};
  async init() {}
  async getAccounts() { return structuredClone([...this.rows.accounts.values()]); }
  async getTransactions(f) { return structuredClone([...this.rows.transactions.values()].filter(t => !f?.account_id || t.account_id === f.account_id || t.to_account_id === f.account_id)); }
  async getBudgets() { return structuredClone([...this.rows.budgets.values()]); }
  async getLoans() { return structuredClone([...this.rows.loans.values()]); }
  async readMeta(k) { return structuredClone(this.meta[k]); }
  async commitRows(rows, meta = {}) {
    for (const row of rows) { if (row.value === undefined) this.rows[row.table].delete(row.id); else this.rows[row.table].set(row.id, structuredClone(row.value)); }
    Object.assign(this.meta, structuredClone(meta));
  }
}
const make = uid => { const db = new LedgerDatabase(new Adapter(), uid); currentDb = db; return db; };
const bank = name => ({ name, balance: 0, type: 'BANK', currency: 'ETB', is_locked: false, locked_amount: 0 });
const day = Date.UTC(2026, 9, 1);

const fund = (extra = {}) => ({
  id: 'f1', ownerUid: 'alice', ownerName: 'Alice', custodianUid: 'bob', custodianName: 'Abebe', members: ['alice', 'bob'],
  invitedUid: null, inviteEmailHint: null, inviteCode: null, name: 'Office petty cash', fundType: 'PETTY_CASH', currency: 'ETB',
  floatTarget: 5000, lowBalancePct: 20, linkStatus: 'ACCEPTED', status: 'ACTIVE', balance: 0, totalIn: 0, totalSpent: 0,
  totalReturned: 0, pendingIn: 0, entryVersion: 1, categories: [], createdAt: day, updatedAt: day, ...extra,
});
const entry = (id, extra) => ({ id, amount: 100, date: day, description: '', recordedByUid: 'bob', recordedByRole: 'CUSTODIAN', createdAt: day, status: 'ACTIVE', ownerCategory: null, ownerPurpose: null, ownerSplits: null, ownerAccountId: null, ...extra });

test('the owner mirror maps each entry to one row and asks instead of guessing', () => {
  const plan = planFundMirror(fund(), [
    entry('sent', { kind: 'DEPOSIT', source: 'OWNER', amount: 5000, recordedByUid: 'alice', recordedByRole: 'OWNER', ownerAccountId: 'cbe' }),
    entry('claimed', { kind: 'DEPOSIT', source: 'OWNER_UNRECORDED', amount: 700 }),
    entry('mrx', { kind: 'DEPOSIT', source: 'THIRD_PARTY', payerName: 'Mr X', amount: 10000 }),
    entry('sales', { kind: 'DEPOSIT', source: 'THIRD_PARTY', payerName: 'Mr Y', amount: 300, ownerCategory: 'Sales', ownerPurpose: 'OPERATING' }),
    entry('rent', { kind: 'SPEND', amount: 3000, category: 'Rent', recipient: 'Landlord', receipt_url: 'https://bank/r', reference_number: 'FT1', splits: [{ id: 'a', amount: 2000, category: 'Rent' }, { id: 'b', amount: 1000, category: 'Utilities' }] }),
    entry('recat', { kind: 'SPEND', amount: 50, category: 'Food', ownerCategory: 'Client meals', splits: [{ id: 'a', amount: 25, category: 'Food' }, { id: 'b', amount: 25, category: 'Taxi' }] }),
    entry('back', { kind: 'RETURN', amount: 200 }),
    entry('gone', { kind: 'SPEND', amount: 9, status: 'VOIDED' }),
    entry('later', { kind: 'DEPOSIT', source: 'THIRD_PARTY', payerName: 'Mr Z', status: 'PENDING' }),
  ], { fundAccountId: 'fund-acct', accountIds: new Set(['cbe', 'fund-acct']) });

  const byEntry = Object.fromEntries(plan.rows.map(row => [row.entryId, row.input]));
  assert.deepEqual(Object.keys(byEntry).sort(), ['mrx', 'recat', 'rent', 'sales', 'sent']);
  assert.equal(byEntry.sent.type, 'TRANSFER');
  assert.equal(byEntry.sent.account_id, 'cbe');
  assert.equal(byEntry.sent.to_account_id, 'fund-acct');
  // Unclassified money from a third party moves cash but is not income.
  assert.equal(byEntry.mrx.type, 'INCOME');
  assert.equal(byEntry.mrx.purpose, 'FINANCING');
  assert.equal(byEntry.sales.purpose, 'OPERATING');
  assert.equal(byEntry.sales.category, 'Sales');
  assert.equal(byEntry.rent.type, 'EXPENSE');
  assert.equal(byEntry.rent.purpose, 'OPERATING');
  assert.equal(byEntry.rent.sender_receiver, 'Landlord');
  assert.equal(byEntry.rent.receipt_url, 'https://bank/r');
  assert.equal(byEntry.rent.splits.length, 2);
  // The owner's own category replaces the custodian's split as a whole.
  assert.equal(byEntry.recat.category, 'Client meals');
  assert.equal(byEntry.recat.splits, undefined);
  for (const row of plan.rows) {
    assert.equal(row.input.fund_mirror, true);
    assert.equal(row.input.operation_id, `fund-mirror-${row.entryId}`);
  }
  assert.deepEqual(plan.actions.map(action => [action.entryId, action.kind]).sort(), [
    ['back', 'RETURN_ACCOUNT'], ['claimed', 'SOURCE_ACCOUNT'], ['mrx', 'CLASSIFY_DEPOSIT'],
  ]);
});

test('reconciling builds the owner books once, matches the fund balance and counts only real spending', async () => {
  const db = make('alice');
  const cbe = await db.createAccount({ ...bank('CBE'), balance: 20000 });
  const entries = [
    entry('sent', { kind: 'DEPOSIT', source: 'OWNER', amount: 5000, recordedByUid: 'alice', recordedByRole: 'OWNER', ownerAccountId: cbe.id }),
    entry('mrx', { kind: 'DEPOSIT', source: 'THIRD_PARTY', payerName: 'Mr X', amount: 10000 }),
    entry('rent', { kind: 'SPEND', amount: 3000, category: 'Rent', recipient: 'Landlord' }),
    entry('taxi', { kind: 'SPEND', amount: 120.55, category: 'Transport' }),
  ];
  const first = await FundLedgerService.reconcile(fund(), entries, 'alice');
  assert.equal(first.error, undefined);
  assert.equal(first.changed, true);
  const fundAccount = (await db.getAccounts()).find(account => account.fund_id === 'f1');
  assert.ok(fundAccount, 'the owner gets a cash account for the fund');
  assert.equal(fundAccount.name, 'Fund – Abebe');
  assert.equal(fundAccount.type, 'CASH');
  assert.equal(fundAccount.balance, 11879.45);
  assert.equal((await db.getAccounts()).find(account => account.id === cbe.id).balance, 15000);

  const rows = await db.getTransactions();
  assert.equal(finance.sumMoney(rows.map(finance.operatingExpense)), 3120.55);
  assert.equal(finance.sumMoney(rows.map(finance.operatingIncome)), 0, 'unclassified deposits are not income');

  const again = await FundLedgerService.reconcile(fund(), entries, 'alice');
  assert.equal(again.changed, false);
  assert.equal((await db.getTransactions()).length, rows.length);
  assert.ok(rows.some(row => row.id === mirrorTransactionId('rent')));
});

test('voids, reclassification and late answers flow into the owner books', async () => {
  const db = make('alice');
  const cbe = await db.createAccount({ ...bank('CBE'), balance: 1000 });
  let entries = [
    entry('mrx', { kind: 'DEPOSIT', source: 'THIRD_PARTY', payerName: 'Mr X', amount: 900 }),
    entry('lunch', { kind: 'SPEND', amount: 80, category: 'Food' }),
    entry('back', { kind: 'RETURN', amount: 300 }),
  ];
  const first = await FundLedgerService.reconcile(fund(), entries, 'alice');
  assert.deepEqual(first.actions.map(action => action.kind).sort(), ['CLASSIFY_DEPOSIT', 'RETURN_ACCOUNT']);
  let fundAccount = (await db.getAccounts()).find(account => account.fund_id === 'f1');
  assert.equal(fundAccount.balance, 820, 'the unanswered return waits instead of guessing an account');

  // The owner answers: Mr X paid for sales, the return landed in CBE, lunch was a client meal.
  entries = entries.map(item => item.id === 'mrx' ? { ...item, ownerCategory: 'Sales', ownerPurpose: 'OPERATING' }
    : item.id === 'lunch' ? { ...item, ownerCategory: 'Client meals' }
      : { ...item, ownerAccountId: cbe.id });
  const second = await FundLedgerService.reconcile(fund(), entries, 'alice');
  assert.deepEqual(second.actions, []);
  const rows = await db.getTransactions();
  assert.equal(finance.sumMoney(rows.map(finance.operatingIncome)), 900);
  assert.equal(rows.find(row => row.id === mirrorTransactionId('lunch')).category, 'Client meals');
  fundAccount = (await db.getAccounts()).find(account => account.fund_id === 'f1');
  assert.equal(fundAccount.balance, 520);
  assert.equal((await db.getAccounts()).find(account => account.id === cbe.id).balance, 1300);

  // Voiding removes the row from the books.
  entries = entries.map(item => item.id === 'lunch' ? { ...item, status: 'VOIDED' } : item);
  await FundLedgerService.reconcile(fund(), entries, 'alice');
  assert.equal((await db.getTransactions()).some(row => row.id === mirrorTransactionId('lunch')), false);
  fundAccount = (await db.getAccounts()).find(account => account.fund_id === 'f1');
  assert.equal(fundAccount.balance, 600);
});

test('only the owner device reconciles, and a currency clash is reported, not forced', async () => {
  const db = make('bob');
  await db.createAccount(bank('Mine'));
  const asCustodian = await FundLedgerService.reconcile(fund(), [entry('x', { kind: 'SPEND' })], 'bob');
  assert.equal(asCustodian.changed, false);
  assert.equal((await db.getAccounts()).length, 1);

  const owner = make('alice');
  await owner.createAccount(bank('CBE'));
  const clash = await FundLedgerService.reconcile(fund({ currency: 'USD' }), [entry('x', { kind: 'SPEND' })], 'alice');
  assert.match(clash.error, /USD/);
  assert.equal((await owner.getAccounts()).length, 1);
});

test('fund rows can only be changed through the fund, and custodian rows stay out of personal reports', async () => {
  const db = make('bob');
  const cash = await db.createAccount({ ...bank('Cash'), type: 'CASH', balance: 1000 });
  const { custodianFundFields } = load('./utils/fundLedger.ts');
  const row = await db.createTransaction({ type: 'EXPENSE', account_id: cash.id, amount: 250, category: 'Rent', description: 'Rent for Alice', date: day, ...custodianFundFields('f1', 'e1') });
  assert.equal(row.id, 'op-fund-e1');
  assert.equal(finance.operatingExpense(row), 0, 'it is the owner\'s money, not the custodian\'s spending');
  assert.equal((await db.getAccounts())[0].balance, 750, 'but it really left their account');
  // A retry of the same entry never posts twice.
  await db.createTransaction({ type: 'EXPENSE', account_id: cash.id, amount: 250, category: 'Rent', description: 'Rent for Alice', date: day, ...custodianFundFields('f1', 'e1') });
  assert.equal((await db.getTransactions()).length, 2, 'opening balance plus one fund row');

  await assert.rejects(db.updateTransaction(row.id, { amount: 10 }), /fund screen/);
  await assert.rejects(db.deleteTransaction(row.id), /fund screen/);
  await db.deleteTransaction(row.id, true);
  assert.equal((await db.getAccounts())[0].balance, 1000);
});

test('backups keep fund fields and still validate', async () => {
  const db = make('alice');
  const cbe = await db.createAccount({ ...bank('CBE'), balance: 500 });
  await FundLedgerService.reconcile(fund(), [entry('rent', { kind: 'SPEND', amount: 50, category: 'Rent' })], 'alice');
  const accounts = await db.getAccounts();
  const transactions = await db.getTransactions();
  const backup = BackupService.createBackup(accounts, transactions, [], [], [], [], { currency: 'ETB' });
  assert.equal(BackupService.validateBackup(backup), true);
  const mirrored = backup.transactions.find(row => row.fund_entry_id === 'rent');
  assert.equal(mirrored.fund_mirror, true);
  assert.equal(mirrored.fund_id, 'f1');
  assert.ok(backup.accounts.some(account => account.fund_id === 'f1'));
  assert.ok(backup.accounts.some(account => account.id === cbe.id));
});
