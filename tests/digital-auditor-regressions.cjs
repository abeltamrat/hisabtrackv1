const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const mocks = {
  '@/services/SessionStorage': { default: { getItem: async () => null, setItem: async () => {} } },
  '@/services/database': { getDatabase: async () => { throw Error('not used by rule tests'); } },
  '@/services/RecurringTransactionService': { RecurringTransactionService: { getAll: async () => [] } },
  '@/services/CommunityGroupService': { CommunityGroupService: { getAll: async () => [] } },
};
const cache = new Map();
function load(name, parent = root) {
  if (mocks[name]) return { __esModule: true, ...mocks[name] };
  if (!name.startsWith('.') && !name.startsWith('@/')) return require(name);
  let file = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(parent, name);
  if (!path.extname(file)) file += '.ts';
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} }; cache.set(file, mod);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)(dependency => load(dependency, path.dirname(file)), mod, mod.exports);
  return mod.exports;
}

const { runDigitalAudit } = load('./services/DigitalAuditorService.ts');

test('digital auditor ties duplicate and overdue findings to evidence without changing records', () => {
  const now = new Date('2026-10-17T12:00:00Z').getTime();
  const first = { id:'t1', account_id:'a', type:'EXPENSE', amount:500, category:'Food', description:'Market', reference_number:'CBE-7788', date:now-60_000 };
  const second = { ...first, id:'t2', date:now-30_000 };
  const input = {
    accounts:[{ id:'a', name:'CBE', type:'BANK', currency:'ETB', balance:-1000, is_locked:false, locked_amount:0, created_at:1 }],
    transactions:[first, second],
    loans:[{ id:'l1', type:'BORROWED', principal_amount:300, interest_rate:0, start_date:now-100000, due_date:now-86400000, lender_borrower_name:'Abel', status:'ACTIVE', remaining_balance:200 }],
    recurring:[{ id:'r1', name:'Rent', amount:100, type:'EXPENSE', category:'Rent', frequency:'MONTHLY', startDate:1, nextDate:now-86400000, isActive:true, accountId:'a', completedRepetitions:0, reminderEnabled:false, reminderDaysBefore:0 }],
    communities:[{ id:'g1', kind:'EQUB', name:'Family Equb', currency:'ETB', accountId:'a', contributionAmount:100, frequency:'MONTHLY', startDate:1, rounds:2, recoverable:true, calendarSystem:'GREGORIAN', reminderEnabled:false, reminderDaysBefore:0, members:[], schedule:[{ id:'s1', dueDate:now-86400000, amountDue:100, amountPaid:20, status:'MISSED', transactionIds:[] }], payouts:[], audit:[], status:'ACTIVE', createdAt:1, updatedAt:1 }],
    now,
  };
  const before = structuredClone(input);
  const result = runDigitalAudit(input);
  assert.equal(result.findings.filter(item => item.area === 'DUPLICATES').length, 1);
  assert.deepEqual(result.findings.find(item => item.area === 'DUPLICATES').evidenceIds, ['t1','t2']);
  assert.equal(result.findings.filter(item => item.area === 'OBLIGATIONS').length, 3);
  assert.equal(result.findings.some(item => item.area === 'BALANCES'), false);
  assert.deepEqual(input, before, 'the audit remains read-only');
});

test('digital auditor catches transfer and balance integrity failures', () => {
  const result = runDigitalAudit({
    accounts:[{ id:'a', name:'Cash', type:'CASH', currency:'ETB', balance:0, is_locked:false, locked_amount:0, created_at:1 }],
    transactions:[{ id:'bad-transfer', account_id:'a', to_account_id:'missing', type:'TRANSFER', amount:100, category:'Transfer', description:'Move', date:1 }],
    loans:[], recurring:[], communities:[], now:2,
  });
  assert.equal(result.findings.some(item => item.area === 'TRANSFERS' && item.evidenceIds.includes('bad-transfer')), true);
  assert.equal(result.findings.some(item => item.area === 'BALANCES'), true);
  assert.ok(result.score < 100);
});

test('digital auditor is reachable from the app tools menu', () => {
  const drawer = fs.readFileSync(path.join(root, 'components/DrawerMenu.tsx'), 'utf8');
  const layout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
  assert.match(drawer, /AI Digital Auditor[\s\S]*\/digital-auditor/);
  assert.match(layout, /name="digital-auditor"/);
});
