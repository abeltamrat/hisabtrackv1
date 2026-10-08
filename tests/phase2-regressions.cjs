const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
const mocks = {
  '@/services/SessionStorage': { __esModule: true, default: {}, sessionLocalStorage: {} },
  '@/utils/fileHelper': { saveJSON: async () => {} },
  'expo-file-system/legacy': {},
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
const { analyzeSmsIntelligence, analyzeRecurringExpectations, extractIdentityHints, recipientSimilarity, selectRecipientProfile } = load('./utils/phase2Intelligence.ts');
const { EnhancedSMSParser } = load('./utils/enhancedSMSParser.ts');
const { BackupService } = load('./services/BackupService.ts');
const day = 86400000;
const draft = (id, overrides = {}) => ({ id, account_id: 'cbe', type: 'EXPENSE', amount: 1000, category: 'Transfer', description: 'Transfer', date: Date.UTC(2026, 8, 1), sms_id: id, sms_sender: 'CBE', sender_receiver: 'Abebe Kebede', raw_sms: 'account 1***4191', status: 'RECORDED', is_recorded: true, created_at: Date.now(), service_charge: 3, vat: .45, disaster_recovery_fee: .15, ...overrides });
const recurring = (overrides = {}) => ({ id: 'salary', name: 'Salary ACME', amount: 10000, type: 'INCOME', category: 'Salary', frequency: 'MONTHLY', startDate: Date.UTC(2026, 0, 5), nextDate: Date.UTC(2026, 8, 5), isActive: true, accountId: 'cbe', completedRepetitions: 7, reminderEnabled: true, reminderDaysBefore: 1, ...overrides });
const tx = (id, overrides = {}) => ({ id, account_id: 'cbe', amount: 10000, type: 'INCOME', category: 'Salary', description: 'Salary ACME', sender_receiver: 'ACME', date: Date.UTC(2026, 8, 5), ...overrides });

test('fee changes require a robust baseline and show the supporting range', () => {
  const history = [3, 3, 3, 3.1].map((fee, index) => draft(`h${index}`, { service_charge: fee, amount: 16000 }));
  const current = draft('current', { status: 'PENDING', is_recorded: false, service_charge: 8, amount: 16000 });
  const alerts = analyzeSmsIntelligence([...history, current]);
  const fee = alerts.find(item => item.kind === 'FEE_CHANGE');
  assert.equal(fee.baseline.samples, 4);
  assert.match(fee.explanation, /median/i);
  assert.equal(analyzeSmsIntelligence([...history.slice(0, 3), current]).some(item => item.kind === 'FEE_CHANGE'), false);
});

test('scaled fees use transaction size bands and refunds do not pollute baselines', () => {
  const history = [1, 2, 3, 4].map(index => draft(`h${index}`, { amount: 1000 + index, service_charge: 2 }));
  history.push(draft('large', { amount: 100000, service_charge: 100 }));
  history.push(draft('refund', { amount: 1000, service_charge: 90, description: 'Reversal', raw_sms: 'refund reversed ETB 1000' }));
  const current = draft('current', { status: 'PENDING', is_recorded: false, amount: 1002, service_charge: 2.1 });
  assert.equal(analyzeSmsIntelligence([...history, current]).some(item => item.kind === 'FEE_CHANGE'), false);
});

test('same reference is a repeated notification while separate evidence stays a possible double debit', () => {
  const first = draft('a', { status: 'PENDING', is_recorded: false, reference_number: 'FT123456' });
  const repeat = draft('b', { status: 'PENDING', is_recorded: false, date: first.date + 60000, reference_number: 'FT123456' });
  assert.ok(analyzeSmsIntelligence([first, repeat]).some(item => item.kind === 'REPEATED_NOTIFICATION'));
  const other = draft('c', { status: 'PENDING', is_recorded: false, date: first.date + 120000, reference_number: 'FT999999' });
  assert.ok(analyzeSmsIntelligence([first, other]).some(item => item.kind === 'POSSIBLE_DOUBLE_DEBIT'));
});

test('Expected and dismiss feedback hide alerts without mutating evidence', () => {
  const a = draft('a', { status: 'PENDING', is_recorded: false, reference_number: 'ONE' });
  const b = draft('b', { status: 'PENDING', is_recorded: false, date: a.date + 1, reference_number: 'TWO' });
  const alert = analyzeSmsIntelligence([a, b])[0];
  assert.equal(analyzeSmsIntelligence([a, b], [{ alertId: alert.id, decision: 'EXPECTED', at: Date.now() }]).length, 0);
  assert.equal(a.status, 'PENDING'); assert.equal(b.status, 'PENDING');
});

test('recurring matching accepts evidence in grace window and never fabricates a posting', () => {
  assert.deepEqual(analyzeRecurringExpectations([recurring()], [tx('paid')], Date.UTC(2026, 8, 10)), []);
  const source = fs.readFileSync(path.join(root, 'app/recurring.tsx'), 'utf8');
  const processor = source.slice(source.indexOf('const processOverdueRecurring'), source.indexOf('const handleSave'));
  assert.doesNotMatch(processor, /addTransaction/);
});

test('changed recurring amounts and unrecorded events state only what evidence proves', () => {
  const changed = analyzeRecurringExpectations([recurring()], [tx('changed', { amount: 11500 })], Date.UTC(2026, 8, 10))[0];
  assert.equal(changed.kind, 'CHANGED_AMOUNT');
  assert.equal(changed.observedAmount, 11500);
  const missing = analyzeRecurringExpectations([recurring()], [], Date.UTC(2026, 8, 11))[0];
  assert.equal(missing.kind, 'NOT_RECORDED');
  assert.match(missing.explanation, /does not prove/i);
});

test('weekends extend recurring grace and operation IDs reconcile without identity text', () => {
  const saturday = recurring({ nextDate: Date.UTC(2026, 7, 1) });
  assert.deepEqual(analyzeRecurringExpectations([saturday], [tx('scheduled', { date: Date.UTC(2026, 7, 4), description: 'Other', sender_receiver: '', operation_id: `recurring-salary-${saturday.nextDate}` })], Date.UTC(2026, 7, 5)), []);
});

test('recipient suggestions have strong name and masked identifier evidence', () => {
  assert.ok(recipientSimilarity('ABEBE K', 'Abebe Kebede') >= .67);
  assert.deepEqual(extractIdentityHints('to account 1****2073 (Abebe) phone +2519*****456'), ['phone:9*****456', 'account:2073']);
});

test('shared names stay ambiguous unless a verified hint selects one person', () => {
  const profiles = [
    { aliases: ['Abebe Kebede'], verifiedHints: ['account:1111'] },
    { aliases: ['Abebe Kebede'], verifiedHints: ['account:2222'] },
  ];
  assert.equal(selectRecipientProfile(profiles, 'Abebe Kebede', 'payment received'), undefined);
  assert.equal(selectRecipientProfile(profiles, 'Abebe Kebede', 'to account ****2222'), profiles[1]);
  assert.equal(selectRecipientProfile([profiles[0]], 'Abebe Kebede', 'to account ****9999'), undefined);
});

test('coverage fixtures parse cash-out, reversal and configured institutions', () => {
  const now = Date.UTC(2026, 9, 8);
  const cashOut = EnhancedSMSParser.parseTransaction('You have withdrawn ETB 500.00 from your telebirr account. Balance is ETB 900.00. Transaction number is TB123456', 'telebirr', '1', now);
  assert.equal(cashOut.type, 'EXPENSE'); assert.equal(cashOut.amount, 500);
  const reversal = EnhancedSMSParser.parseTransaction('Transaction reversal: refunded ETB 250.00 to account 1****4191. Current balance is ETB 1200.00', 'CBE', '2', now);
  assert.equal(reversal.type, 'INCOME'); assert.equal(reversal.amount, 250); assert.equal(reversal.accountNumber, '4191');
  const boa = EnhancedSMSParser.parseTransaction('Your account 1*0049 was debited with ETB 1950.00 to Alem. Available Balance: ETB 5000.00 Ref: BOA12345', '8397', '3', now);
  assert.equal(boa.amount, 1950); assert.equal(boa.accountNumber, '0049');
  const awash = EnhancedSMSParser.parseTransaction('Your A/C 01320**3100 was credited with ETB 93000.00 from Abel. Your available balance is ETB 100000.00 Ref: 260619150657562', 'Awash', '4', now);
  assert.equal(awash.type, 'INCOME'); assert.equal(awash.accountNumber, '3100');
  const dashen = EnhancedSMSParser.parseTransaction('Your account 1234 was debited ETB 800.00. Current balance ETB 9000.00. Ref DS123456', 'Dashen', '5', now);
  assert.equal(dashen.type, 'EXPENSE'); assert.equal(dashen.amount, 800);
});

test('Phase 2 UI exposes every required review action', () => {
  const screen = fs.readFileSync(path.join(root, 'app/smart-review.tsx'), 'utf8');
  for (const label of ['Expected', 'Dismiss', 'Skip once', 'Pause', 'Move date', 'Use ETB', 'Merge as']) assert.match(screen, new RegExp(label));
  assert.match(screen, /Raw SMS evidence was not changed/);
});

test('recipient profiles survive validated backup without accepting malformed hints', () => {
  const backup = { version: '1.0.0', timestamp: Date.now(), accounts: [], transactions: [], budgets: [], loans: [], recipientProfiles: [{ id: 'p1', displayName: 'Abebe', aliases: ['Abebe K'], verifiedHints: ['account:2073'] }] };
  assert.equal(BackupService.validateBackup(backup), true);
  backup.recipientProfiles[0].verifiedHints = ['email:private@example.com'];
  assert.equal(BackupService.validateBackup(backup), false);
});
