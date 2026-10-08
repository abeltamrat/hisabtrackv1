const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
const storage = new Map();
const transactions = new Map();
let balance = 1000;
let draftRows = [];
const delta = tx => tx.type === 'INCOME' ? tx.amount : -(tx.gross_amount ?? tx.amount);
const fakeDb = {
  async createTransaction(input) { const id = input.operation_id ? `op-${input.operation_id}` : String(transactions.size + 1); if (transactions.has(id)) return transactions.get(id); const tx = { ...input, id }; transactions.set(id, tx); balance += delta(tx); return tx; },
  async deleteTransaction(id) { const tx = transactions.get(id); if (tx) { balance -= delta(tx); transactions.delete(id); } },
  async getTransactionById(id) { return transactions.get(id); },
  async updateTransaction(id, patch) { const old = transactions.get(id); if (!old) throw new Error('missing'); const oldDelta = old.type === 'INCOME' ? old.amount : -(old.gross_amount ?? old.amount); const next = { ...old, ...patch, id }; const nextDelta = next.type === 'INCOME' ? next.amount : -(next.gross_amount ?? next.amount); balance += nextDelta - oldDelta; transactions.set(id, next); return next; },
};
const mocks = {
  '@/services/SessionStorage': { getItem: async key => storage.get(key) || null, setItem: async (key, value) => storage.set(key, value) },
  '@/services/database': { getDatabase: async () => fakeDb },
  '@/services/NotificationService': { NotificationService: { scheduleOneTimeReminder: async () => 'notice-1', cancelNotification: async () => {} } },
  '@/services/DraftTransactionService': {},
  './DraftTransactionService': { DraftTransactionService: { getAll: async () => draftRows } },
  '@/utils/uuid': { generateUUID: (() => { let id = 0; return () => `uuid-${++id}`; })() },
  '@/contexts/AppSettingsContext': { loadStoredAppSettings: async () => ({ language: 'en' }) },
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
const calendar = load('./utils/ethiopianCalendar.ts');
const { communityPosition, matchCommunitySms } = load('./utils/communityFinance.ts');
const { CommunityGroupService } = load('./services/CommunityGroupService.ts');

test('Ethiopian conversion covers New Year, Pagume leap day and round trips', () => {
  const newYear = calendar.ethiopianToGregorian({ year: 2016, month: 1, day: 1 });
  assert.deepEqual([newYear.getFullYear(), newYear.getMonth() + 1, newYear.getDate()], [2023, 9, 12]);
  assert.deepEqual(calendar.gregorianToEthiopian(newYear), { year: 2016, month: 1, day: 1 });
  assert.equal(calendar.daysInEthiopianMonth(2015, 13), 6);
  assert.equal(calendar.daysInEthiopianMonth(2016, 13), 5);
  assert.throws(() => calendar.ethiopianToGregorian({ year: 2016, month: 13, day: 6 }));
});

test('Ethiopian month bounds use local midnight and include every Pagume day', () => {
  const pagume = calendar.ethiopianToGregorian({ year: 2015, month: 13, day: 3 });
  const bounds = calendar.ethiopianMonthBounds(pagume.getTime());
  assert.deepEqual(calendar.gregorianToEthiopian(bounds.start), { year: 2015, month: 13, day: 1 });
  assert.deepEqual(calendar.gregorianToEthiopian(bounds.end), { year: 2015, month: 13, day: 6 });
  assert.equal(new Date(bounds.start).getHours(), 0);
  assert.equal(new Date(bounds.end).getHours(), 23);
});

test('Ethiopian recurring anchors clamp Pagume and preserve local clock', () => {
  const start = calendar.ethiopianToGregorian({ year: 2015, month: 13, day: 6 }); start.setHours(8, 45, 12, 3);
  const nextYear = new Date(calendar.advanceEthiopianDate('YEARLY', start.getTime(), start.getTime()));
  assert.deepEqual(calendar.gregorianToEthiopian(nextYear), { year: 2016, month: 13, day: 5 });
  assert.deepEqual([nextYear.getHours(), nextYear.getMinutes(), nextYear.getSeconds(), nextYear.getMilliseconds()], [8, 45, 12, 3]);
  const nextMonth = new Date(calendar.advanceEthiopianDate('MONTHLY', start.getTime(), start.getTime()));
  assert.deepEqual(calendar.gregorianToEthiopian(nextMonth), { year: 2016, month: 1, day: 6 });
});

test('Equb early payout reconciles cash, claim, remaining obligation and fees', async () => {
  storage.clear(); transactions.clear(); balance = 1000;
  const group = await CommunityGroupService.create({ kind: 'EQUB', name: 'Office Equb', currency: 'ETB', accountId: 'bank', contributionAmount: 100, frequency: 'MONTHLY', startDate: Date.now() + 86400000, rounds: 3, myTurn: 1, reminderEnabled: true });
  let current = await CommunityGroupService.recordContribution(group.id, group.schedule[0].id, 40, 2);
  assert.equal(current.schedule[0].status, 'PARTIAL');
  current = await CommunityGroupService.recordContribution(group.id, group.schedule[0].id, 60);
  assert.equal(current.schedule[0].status, 'PAID');
  current = await CommunityGroupService.recordPayout(group.id, 300, 5);
  assert.equal(balance, 1193);
  assert.deepEqual(communityPosition(current), { contributed: 100, payouts: 300, fees: 7, claim: -200, remainingScheduled: 200, outstandingObligation: 200, missed: 0 });
  current = await CommunityGroupService.recordContribution(group.id, group.schedule[1].id, 100);
  current = await CommunityGroupService.recordContribution(group.id, group.schedule[2].id, 100);
  assert.equal(balance, 993);
  assert.equal(communityPosition(current).claim, 0);
  assert.equal(communityPosition(current).outstandingObligation, 0);
  assert.equal(current.status, 'COMPLETED');
  const postings = [...transactions.values()];
  assert.equal(postings.filter(tx => tx.purpose === 'FINANCING').length, 5);
  assert.equal(postings.filter(tx => tx.category === 'Bank Fees' && tx.purpose === 'OPERATING').reduce((sum, tx) => sum + tx.amount, 0), 7);
});

test('undo reverses both workflow state and its exact cash postings', async () => {
  storage.clear(); transactions.clear(); balance = 1000;
  const group = await CommunityGroupService.create({ kind:'EQUB', name:'Undo Equb', currency:'ETB', accountId:'bank', contributionAmount:100, frequency:'MONTHLY', startDate:Date.now(), rounds:2 });
  const before = balance;
  const withPayment = await CommunityGroupService.recordContribution(group.id, group.schedule[0].id, 50, 1);
  assert.equal(balance, before - 51);
  const restored = await CommunityGroupService.undoLast(withPayment.id);
  assert.equal(balance, before);
  assert.equal(restored.schedule[0].amountPaid, 0);
  assert.ok(restored.audit.some(row => row.action === 'UNDO'));
});

test('Iddir defaults to operating spending unless explicitly recoverable', async () => {
  storage.clear(); transactions.clear(); balance = 1000;
  const ordinary = await CommunityGroupService.create({ kind: 'IDDIR', name: 'Neighbour Iddir', currency: 'ETB', accountId: 'bank', contributionAmount: 50, frequency: 'MONTHLY', startDate: Date.now(), rounds: 2 });
  await CommunityGroupService.recordContribution(ordinary.id, ordinary.schedule[0].id, 50);
  assert.equal([...transactions.values()][0].purpose, 'OPERATING');
  assert.equal(communityPosition((await CommunityGroupService.getAll())[0]).claim, 0);
  storage.clear(); transactions.clear(); balance = 1000;
  const recoverable = await CommunityGroupService.create({ kind: 'IDDIR', name: 'Recoverable fund', currency: 'ETB', accountId: 'bank', contributionAmount: 50, frequency: 'WEEKLY', startDate: Date.now(), rounds: 1, recoverable: true });
  await CommunityGroupService.recordContribution(recoverable.id, recoverable.schedule[0].id, 50);
  assert.equal([...transactions.values()][0].purpose, 'FINANCING');
});

test('SMS matching stays reviewable and uses account, direction, amount and date', () => {
  const group = { id:'g', kind:'EQUB', name:'Office Equb', accountId:'bank', contributionAmount:100, payoutAmount:300, status:'ACTIVE', schedule:[{ id:'s', dueDate:Date.now(), amountDue:100, amountPaid:0, status:'DUE' }] };
  const draft = { id:'d', account_id:'bank', type:'EXPENSE', amount:100, date:Date.now(), raw_sms:'Paid Office Equb contribution', description:'transfer', status:'PENDING' };
  const matches = matchCommunitySms(draft, [group]);
  assert.equal(matches[0].scheduleId, 's'); assert.equal(matches[0].kind, 'CONTRIBUTION'); assert.ok(matches[0].score >= 90);
  assert.equal(matchCommunitySms({ ...draft, account_id:'other' }, [group]).length, 0);
});

test('recorded SMS links preserve cash, classify principal, split fees, and undo cleanly', async () => {
  storage.clear(); transactions.clear(); balance = 1000;
  const group = await CommunityGroupService.create({ kind:'EQUB', name:'SMS Equb', currency:'ETB', accountId:'bank', contributionAmount:100, frequency:'MONTHLY', startDate:Date.now(), rounds:1 });
  const original = await fakeDb.createTransaction({ account_id:'bank', type:'EXPENSE', amount:100, gross_amount:102, category:'Transfer', description:'SMS', date:Date.now(), purpose:'OPERATING' });
  draftRows = [{ id:'draft-1', account_id:'bank', type:'EXPENSE', amount:100, status:'RECORDED', matched_transaction_id:original.id }];
  const cashAfterSms = balance;
  const linked = await CommunityGroupService.linkRecordedSms(group.id, group.schedule[0].id, 'draft-1', 'CONTRIBUTION');
  assert.equal(balance, cashAfterSms);
  assert.equal(transactions.get(original.id).purpose, 'FINANCING');
  assert.equal(communityPosition(linked).fees, 2);
  const restored = await CommunityGroupService.undoLast(group.id);
  assert.equal(balance, cashAfterSms);
  assert.equal(transactions.get(original.id).purpose, 'OPERATING');
  assert.equal(restored.schedule[0].amountPaid, 0);
});

test('Phase 4 routes, backup, export identification, and protected ledger rows are wired', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(read('components/DrawerMenu.tsx'), /Equb & Iddir/);
  assert.match(read('services/BackupService.ts'), /communityGroups/);
  assert.match(read('services/RestoreService.ts'), /CommunityGroupService/);
  assert.match(read('services/ExportService.ts'), /calendarSystem/);
  assert.match(read('services/database/ledger.ts'), /Equb and Iddir entries are changed/);
  assert.match(read('app/community.tsx'), /c\('reviewSms'\)/);
  assert.match(read('utils/communityCopy.ts'), /ዕቁብን ዕድርን/);
});
