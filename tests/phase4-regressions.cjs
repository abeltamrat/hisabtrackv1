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
let loanRows = [];
const delta = tx => tx.type === 'INCOME' ? tx.amount : -(tx.gross_amount ?? tx.amount);
const fakeDb = {
  async createTransaction(input) { const id = input.operation_id ? `op-${input.operation_id}` : String(transactions.size + 1); if (transactions.has(id)) return transactions.get(id); const tx = { ...input, id }; transactions.set(id, tx); balance += delta(tx); return tx; },
  async getTransactions() { return [...transactions.values()]; },
  async deleteTransaction(id) { const tx = transactions.get(id); if (tx) { balance -= delta(tx); transactions.delete(id); } },
  async getTransactionById(id) { return transactions.get(id); },
  async getLoans() { return loanRows; },
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
const { createEqubCyclePlan, validateEqubCyclePlan } = load('./utils/equbModel.ts');
const { CommunityGroupService } = load('./services/CommunityGroupService.ts');
const PeopleFinancialService = load('./services/PeopleFinancialService.ts').default;
const RecipientIdentityService = load('./services/RecipientIdentityService.ts').default;

test('people require a unique normalized phone or email', async () => {
  storage.clear();
  await assert.rejects(() => RecipientIdentityService.create({ displayName: 'No Contact' }), /phone number or email/i);
  const phone = await RecipientIdentityService.create({ displayName: 'Abebe', phone: '0911 111 111' });
  assert.equal(phone.phone, '+251911111111');
  const email = await RecipientIdentityService.create({ displayName: 'Almaz', email: ' Almaz@Example.COM ' });
  assert.equal(email.email, 'almaz@example.com');
  await assert.rejects(() => RecipientIdentityService.create({ displayName: 'Duplicate phone', phone: '+251-911-111-111' }), /already belongs to Abebe/);
  await assert.rejects(() => RecipientIdentityService.create({ displayName: 'Duplicate email', email: 'ALMAZ@example.com' }), /already belongs to Almaz/);
  const linked = await RecipientIdentityService.update(phone.id, { linkedUid: 'user-one', linkedDisplayName: 'Abebe User', linkCheckedAt: 1 });
  assert.equal(linked.linkedUid, 'user-one');
  const changed = await RecipientIdentityService.update(phone.id, { phone: '0922 222 222' });
  assert.equal(changed.phone, '+251922222222');
  assert.equal(changed.linkedUid, undefined);
});

test('Equb V2 separates five people from six shares and reconciles the full cycle', () => {
  const cycle = createEqubCyclePlan({
    id: 'office-cycle-1',
    baseContributionAmount: 10000,
    members: [
      { id: 'a', name: 'Member A', shareCount: 2 },
      { id: 'b', name: 'Member B', shareCount: 1 },
      { id: 'c', name: 'Member C', shareCount: 1 },
      { id: 'd', name: 'Member D', shareCount: 1 },
      { id: 'e', name: 'Member E', shareCount: 1 },
    ],
  });
  assert.equal(cycle.memberCount, 5);
  assert.equal(cycle.totalShares, 6);
  assert.equal(cycle.roundCount, 6);
  assert.equal(cycle.potPerRound, 60000);
  assert.equal(cycle.fullCycleValue, 360000);
  assert.equal(cycle.shares.filter(share => share.memberId === 'a').length, 2);
  assert.equal(cycle.payoutEntitlements.filter(item => item.memberId === 'a').length, 2);
  assert.equal(cycle.members.find(member => member.id === 'a').shareCount * cycle.baseContributionAmount, 20000);
  assert.ok(validateEqubCyclePlan(cycle));
});

test('legacy Equbs receive stable V2 personal-tracker metadata without changing money or schedules', async () => {
  storage.clear();
  const future = Date.now() + 86400000;
  const legacy = {
    id: 'legacy-equb', kind: 'EQUB', name: 'Legacy', currency: 'ETB', accountId: 'bank', contributionAmount: 10000,
    frequency: 'MONTHLY', startDate: future, rounds: 5, myTurn: 2, payoutAmount: 50000, recoverable: true,
    calendarSystem: 'GREGORIAN', reminderEnabled: false, reminderDaysBefore: 0, members: [],
    schedule: Array.from({ length: 5 }, (_, index) => ({ id: `s-${index}`, dueDate: future + index * 86400000, amountDue: 10000, amountPaid: 0, status: 'DUE', transactionIds: [] })),
    payouts: [], audit: [], status: 'ACTIVE', createdAt: Date.now(), updatedAt: Date.now(),
  };
  storage.set('community_groups_v1', JSON.stringify([legacy]));
  const [migrated] = await CommunityGroupService.getAll();
  assert.deepEqual(migrated.schedule, legacy.schedule);
  assert.equal(migrated.contributionAmount, 10000);
  assert.equal(migrated.payoutAmount, 50000);
  assert.deepEqual(migrated.equb, {
    schemaVersion: 2, mode: 'PERSONAL_TRACKER', cycleId: 'legacy-cycle-legacy-equb', baseContributionAmount: 10000,
    memberCount: 5, totalShares: 5, myShares: 1, allocationMethod: 'FIXED_ORDER', migrationStatus: 'MIGRATED',
  });
  const [reread] = await CommunityGroupService.getAll();
  assert.deepEqual(reread.equb, migrated.equb);
});

test('new personal Equb supports two shares with one contribution schedule and two payout entitlements', async () => {
  storage.clear();
  const group = await CommunityGroupService.create({
    kind: 'EQUB', name: 'Six Share Equb', currency: 'ETB', accountId: 'bank', contributionAmount: 10000,
    baseContributionAmount: 10000, myShares: 2, totalShares: 6, frequency: 'MONTHLY', startDate: Date.now(), rounds: 6,
  });
  assert.equal(group.rounds, 6);
  assert.equal(group.contributionAmount, 20000);
  assert.equal(group.schedule[0].amountDue, 20000);
  assert.equal(group.payoutAmount, 120000);
  assert.equal(group.equb.myShares, 2);
  assert.equal(group.equb.totalShares, 6);
});

test('managed Equb persists normalized members, shares, rounds and payout entitlements', async () => {
  storage.clear();
  const group = await CommunityGroupService.create({
    kind: 'EQUB', equbMode: 'GROUP_MANAGED', name: 'Managed Office Equb', currency: 'ETB', accountId: 'bank',
    contributionAmount: 10000, frequency: 'MONTHLY', startDate: Date.now() + 86400000, rounds: 1,
    members: [
      { name: 'Member A', turn: 1, shareCount: 2 },
      { name: 'Member B', turn: 2, shareCount: 1 },
      { name: 'Member C', turn: 3, shareCount: 1 },
      { name: 'Member D', turn: 4, shareCount: 1 },
      { name: 'Member E', turn: 5, shareCount: 1 },
    ],
  });
  assert.equal(group.equb.mode, 'GROUP_MANAGED');
  assert.equal(group.equb.totalShares, 6);
  assert.equal(group.equbCycle.memberCount, 5);
  assert.equal(group.equbCycle.totalShares, 6);
  assert.equal(group.equbCycle.rounds.length, 6);
  assert.equal(group.equbCycle.obligations.length, 36);
  assert.equal(group.equbCycle.payoutEntitlements.length, 6);
  assert.equal(group.equbCycle.potPerRound, 60000);
  assert.equal(group.equbCycle.members.find(member => member.name === 'Member A').shareCount, 2);
  const [reread] = await CommunityGroupService.getAll();
  assert.deepEqual(reread.equbCycle, group.equbCycle);
  CommunityGroupService.validate(reread);
});

test('managed member payments allocate partial and advance money without debiting the organizer', async () => {
  storage.clear(); transactions.clear(); balance = 1000;
  const group = await CommunityGroupService.create({
    kind: 'EQUB', equbMode: 'GROUP_MANAGED', name: 'Collections', currency: 'ETB', accountId: 'bank', contributionAmount: 100,
    frequency: 'MONTHLY', startDate: Date.now() + 86400000, rounds: 1,
    members: [{ name: 'Double', turn: 1, shareCount: 2, personId: 'person-double' }, { name: 'Single', turn: 2, shareCount: 1 }],
  });
  const member = group.equbCycle.members[0], first = group.equbCycle.rounds[0];
  assert.equal(member.personId, 'person-double');
  let current = await CommunityGroupService.recordManagedContribution(group.id, member.id, 50, { roundId: first.id, method: 'CASH', payerName: 'Representative', payerPersonId: 'person-representative' });
  let obligations = current.equbCycle.obligations.filter(item => item.memberId === member.id);
  const byRound = value => current.equbCycle.rounds.map(round => value.filter(item => item.roundId === round.id).reduce((sum, item) => sum + item.amountPaid, 0));
  assert.deepEqual(byRound(obligations), [50, 0, 0]);
  current = await CommunityGroupService.recordManagedContribution(group.id, member.id, 350, { roundId: first.id, method: 'BANK', reference: 'TX-1' });
  obligations = current.equbCycle.obligations.filter(item => item.memberId === member.id);
  assert.deepEqual(byRound(obligations), [200, 200, 0]);
  assert.equal(current.equbCycle.contributionPayments.length, 2);
  assert.equal(current.equbCycle.contributionPayments[0].payerPersonId, 'person-representative');
  const relationshipMovements = await PeopleFinancialService.getAllMovements();
  assert.ok(relationshipMovements.some(item => item.people_source === 'MANAGED_EQUB' && item.person_id === 'person-representative' && item.amount === 50));
  assert.match(current.equbCycle.contributionPayments[1].receiptNumber, /^EQB-.+-0002$/);
  assert.equal(balance, 1000);
  assert.equal(transactions.size, 0);
  current = await CommunityGroupService.linkManagedMemberPerson(group.id, current.equbCycle.members[1].id, { id: 'person-single', displayName: 'Single Member', phone: '0911000000' });
  assert.deepEqual([current.equbCycle.members[1].personId, current.equbCycle.members[1].name], ['person-single', 'Single Member']);
  const undone = await CommunityGroupService.undoLast(group.id);
  assert.deepEqual(undone.equbCycle.rounds.map(round => undone.equbCycle.obligations.filter(item => item.memberId === member.id && item.roundId === round.id).reduce((sum, item) => sum + item.amountPaid, 0)), [50, 0, 0]);
  assert.equal(undone.equbCycle.contributionPayments.length, 1);
});

test('person dossier combines loans, funds, recurring items and Equb membership', async () => {
  storage.clear(); transactions.clear(); loanRows = [{
    id: 'loan-person', type: 'LENT', lender_borrower_name: 'Abebe', person_id: 'person-abebe',
    principal_amount: 500, remaining_balance: 300, status: 'ACTIVE', due_date: Date.now() + 86400000,
  }];
  await CommunityGroupService.create({
    kind: 'EQUB', equbMode: 'GROUP_MANAGED', name: 'Family Equb', currency: 'ETB', accountId: 'bank',
    contributionAmount: 100, frequency: 'MONTHLY', startDate: Date.now(), rounds: 1,
    members: [{ name: 'Abebe', turn: 1, personId: 'person-abebe' }, { name: 'Almaz', turn: 2 }],
  });
  const profile = { id: 'person-abebe', displayName: 'Abebe', aliases: ['Abebe'], verifiedHints: [], createdAt: 1, updatedAt: 1 };
  const movement = { id: 'fund-payment', account_id: 'bank', type: 'EXPENSE', amount: 75, category: 'Fund payment', description: 'Petty cash contribution', date: Date.now(), person_id: profile.id, fund_id: 'fund-one' };
  const recurring = { id: 'salary-rule', name: 'Monthly salary', type: 'EXPENSE', amount: 200, category: 'Salary', accountId: 'bank', frequency: 'MONTHLY', startDate: Date.now(), nextDate: Date.now(), isActive: true, reminderEnabled: false, reminderDaysBefore: 0, reminderHour: 9, reminderMinute: 0, person_id: profile.id };
  const dossier = await PeopleFinancialService.getDossier(profile, [profile], [movement], [{ id: 'fund-one', name: 'Office petty cash', fundType: 'PETTY_CASH' }], [recurring]);
  assert.deepEqual(dossier.loans.map(item => item.id), ['loan-person']);
  assert.deepEqual(dossier.funds.map(item => [item.name, item.sent, item.received]), [['Office petty cash', 75, 0]]);
  assert.deepEqual(dossier.recurring.map(item => item.id), ['salary-rule']);
  assert.deepEqual(dossier.communities.map(item => [item.name, item.memberName]), [['Family Equb', 'Abebe']]);
  loanRows = [];
});

test('managed Equb keeps overpayment as refundable credit and marks overdue explicitly', async () => {
  storage.clear();
  const group = await CommunityGroupService.create({
    kind: 'EQUB', equbMode: 'GROUP_MANAGED', name: 'Credit Equb', currency: 'ETB', accountId: 'bank', contributionAmount: 100,
    frequency: 'MONTHLY', startDate: Date.now() - 70 * 86400000, rounds: 1,
    penaltyRule: { graceDays: 5, type: 'FIXED', value: 10 },
    members: [{ name: 'A', turn: 1 }, { name: 'B', turn: 2 }],
  });
  const member = group.equbCycle.members[0];
  let current = await CommunityGroupService.recordManagedContribution(group.id, member.id, 225, { method: 'BANK', reference: 'OVER-1', payerName: 'Member A representative' });
  const payment = current.equbCycle.contributionPayments[0];
  assert.equal(payment.unappliedAmount, 25);
  assert.equal(payment.late, true);
  assert.equal(payment.payerName, 'Member A representative');
  assert.equal(current.equbCycle.memberCredits.find(item => item.memberId === member.id).balance, 25);
  current = await CommunityGroupService.refundManagedCredit(group.id, member.id, 10, { method: 'CASH' });
  assert.equal(current.equbCycle.memberCredits.find(item => item.memberId === member.id).balance, 15);
  assert.equal(current.equbCycle.creditRefunds[0].amount, 10);
  const other = current.equbCycle.members[1];
  current = await CommunityGroupService.evaluateManagedOverdue(group.id, Date.now());
  assert.ok(current.equbCycle.obligations.filter(item => item.memberId === other.id).every(item => item.status === 'MISSED'));
  assert.equal(current.equbCycle.obligations.filter(item => item.memberId === other.id).reduce((sum,item)=>sum+item.penaltyDue,0), 20);
  assert.ok(current.audit.some(item => item.action === 'MANAGED_OVERDUE'));
  current = await CommunityGroupService.recordManagedContribution(group.id, other.id, 0, { penaltyAmount: 10, method: 'CASH' });
  assert.equal(current.equbCycle.contributionPayments.at(-1).penaltyAmount, 10);
  current = await CommunityGroupService.waiveManagedPenalty(group.id, other.id, 10, 'Approved hardship');
  assert.equal(current.equbCycle.obligations.filter(item => item.memberId === other.id).reduce((sum,item)=>sum+item.penaltyDue-item.penaltyPaid-item.penaltyWaived,0), 0);
});

test('managed Equb records guarantors and shortage treatments with audit history', async () => {
  storage.clear();
  const group = await CommunityGroupService.create({ kind:'EQUB', equbMode:'GROUP_MANAGED', name:'Risk records', currency:'ETB', accountId:'bank', contributionAmount:100, frequency:'MONTHLY', startDate:Date.now(), rounds:1, members:[{name:'A',turn:1},{name:'B',turn:2}] });
  const member = group.equbCycle.members[0], round = group.equbCycle.rounds[0];
  let current = await CommunityGroupService.addManagedGuarantor(group.id, member.id, { name:'Guarantor One', phone:'0911000000', guaranteedAmount:200, acknowledged:true });
  assert.equal(current.equbCycle.guarantors[0].status, 'ACTIVE');
  assert.ok(current.equbCycle.guarantors[0].acknowledgedAt);
  current = await CommunityGroupService.recordManagedFundingAdjustment(group.id, round.id, 'ORGANIZER_ADVANCE', 50, 'Cover current shortage');
  current = await CommunityGroupService.recordManagedFundingAdjustment(group.id, round.id, 'REDUCED_POT', 25, 'Members approved');
  assert.deepEqual(current.equbCycle.fundingAdjustments.map(item => item.type), ['ORGANIZER_ADVANCE','REDUCED_POT']);
  assert.ok(current.audit.some(item => item.description.includes('Cover current shortage')));
});

test('managed payout requires allocation and funded reconciliation, then closes the round', async () => {
  storage.clear(); transactions.clear(); balance=1000;
  const group=await CommunityGroupService.create({kind:'EQUB',equbMode:'GROUP_MANAGED',name:'Payout flow',currency:'ETB',accountId:'bank',contributionAmount:100,frequency:'MONTHLY',startDate:Date.now(),rounds:1,members:[{name:'A',turn:1},{name:'B',turn:2}]});
  const cycle=group.equbCycle, round=cycle.rounds[0], entitlement=cycle.payoutEntitlements[0];
  let current=await CommunityGroupService.allocateManagedEntitlement(group.id,round.id,entitlement.id);
  await CommunityGroupService.recordManagedContribution(group.id,cycle.members[0].id,100,{roundId:round.id});
  await assert.rejects(()=>CommunityGroupService.recordManagedPayout(group.id,round.id,{}),/short by ETB 100.00/);
  await CommunityGroupService.recordManagedContribution(group.id,cycle.members[1].id,100,{roundId:round.id});
  current=await CommunityGroupService.recordManagedPayout(group.id,round.id,{bidDiscount:10,fees:2,deductions:3,method:'BANK',reference:'PAY-1'});
  const payout=current.equbCycle.managedPayouts[0];
  assert.deepEqual([payout.grossAmount,payout.bidDiscount,payout.fees,payout.deductions,payout.netAmount],[200,10,2,3,185]);
  assert.equal(current.equbCycle.rounds[0].status,'CLOSED');
  assert.equal(current.equbCycle.payoutEntitlements[0].status,'PAID');
  current=await CommunityGroupService.acknowledgeManagedPayout(group.id,payout.id);
  assert.equal(current.equbCycle.managedPayouts[0].status,'ACKNOWLEDGED');
  assert.equal(balance,1000); assert.equal(transactions.size,0);
});

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
  assert.match(read('app/community.tsx'), /Round \{currentRound\.number\} collections/);
  assert.match(read('app/community.tsx'), /recordManagedContribution/);
  assert.match(read('utils/communityCopy.ts'), /ዕቁብን ዕድርን/);
});
