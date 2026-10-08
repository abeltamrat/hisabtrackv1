const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let serial = 0;
const memory = new Map();
const storage = { getItem: async k => memory.get(k) ?? null, setItem: async (k,v) => { memory.set(k,v); }, removeItem: async k => {memory.delete(k);}, getAllKeys: async () => [...memory.keys()], multiRemove: async keys => keys.forEach(k => memory.delete(k)), multiGet: async keys => keys.map(k => [k,memory.get(k)??null]), multiSet: async rows => rows.forEach(([k,v]) => memory.set(k,v)) };
const mocks = {
  '@/utils/uuid': { generateUUID: () => `id-${++serial}` },
  '@/services/LocalChangeEmitter': { default: { emit() {}, subscribe() { return () => {}; } } },
  '../LocalChangeEmitter': { default: { emit() {}, subscribe() { return () => {}; } } },
  '@react-native-async-storage/async-storage': { default: storage },
  '@/utils/fileHelper': { saveJSON: async () => {} },
  'expo-file-system/legacy': {},
};
const cache = new Map();
function load(name, parent = root) {
  if (!name.startsWith('.') && !name.startsWith('@/') && !mocks[name]) return require(name);
  if (mocks[name]) return { __esModule: true, ...mocks[name] };
  let file = name.startsWith('@/') ? path.join(root,name.slice(2)) : path.resolve(parent,name);
  if (!path.extname(file)) file += '.ts';
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} }; cache.set(file,mod);
  const js = ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions: { module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true } }).outputText;
  new Function('require','module','exports',js)(n => load(n,path.dirname(file)),mod,mod.exports);
  return mod.exports;
}
const finance = load('./utils/finance.ts');
const { LedgerDatabase } = load('./services/database/ledger.ts');
const { ForecastService } = load('./services/ForecastService.ts');
const { BudgetService } = load('./services/BudgetService.ts');
const { SafeToSpendService } = load('./services/SafeToSpendService.ts');
const { ReconciliationService } = load('./services/ReconciliationService.ts');
const { rankTagSuggestions } = load('./utils/tagSuggestions.ts');
const { BackupService } = load('./services/BackupService.ts');
const { findSelfTransferPairs, findTransferCandidates } = load('./utils/transferPairing.ts');
const { EnhancedSMSParser } = load('./utils/enhancedSMSParser.ts');
const { DraftTransactionService } = load('./services/DraftTransactionService.ts');
const { detectRecurringPattern } = load('./utils/recurringDetection.ts');
const { SMSLearningService } = load('./services/SMSLearningService.ts');
class Adapter {
  rows = { accounts: new Map(), transactions: new Map(), budgets: new Map(), loans: new Map() };
  meta = {}; fail = false;
  async init() {}
  async getAccounts() { return structuredClone([...this.rows.accounts.values()]); }
  async getTransactions(f) { return structuredClone([...this.rows.transactions.values()].filter(t => !f?.account_id || t.account_id===f.account_id || t.to_account_id===f.account_id)); }
  async getBudgets() { return structuredClone([...this.rows.budgets.values()]); }
  async getLoans() { return structuredClone([...this.rows.loans.values()]); }
  async readMeta(k) { return structuredClone(this.meta[k]); }
  async commitRows(rows, meta={}) {
    if(this.fail) throw Error('disk failure');
    for(const row of rows) { if(row.value === undefined) this.rows[row.table].delete(row.id); else this.rows[row.table].set(row.id,structuredClone(row.value)); }
    Object.assign(this.meta,structuredClone(meta));
  }
}
const account = (name,balance=0) => ({name,balance,type:'BANK',currency:'ETB',is_locked:false,locked_amount:0});
const transaction = (id,amount,type='EXPENSE') => ({account_id:id,amount,type,category:'Food',description:'Meal',date:Date.now()});
const make = () => {const raw=new Adapter();return {raw,db:new LedgerDatabase(raw,'alice')};};
test('zero-interest and rounded flat schedule conserve principal and row totals',()=>{
 assert.equal(finance.periodicPayment(1200,0,12,12),100);
 for(const row of finance.flatLoanSchedule(1200,10,12)) assert.equal(finance.minor(row.payment),finance.minor(row.principal)+finance.minor(row.interest));
 const rows=finance.flatLoanSchedule(1234.57,7.25,11);
 assert.equal(finance.sumMoney(rows.map(r=>r.principal)),1234.57);
 assert.equal(rows.at(-1).balance,0);
 assert.throws(()=>finance.periodicPayment(Infinity,10,12,12));
});
test('recurrence retains Jan 31 anchor through February and March',()=>{
 const jan=new Date(2026,0,31,9).getTime();
 const feb=finance.advanceDate('MONTHLY',jan,jan);
 const mar=finance.advanceDate('MONTHLY',feb,jan);
 assert.equal(new Date(feb).getMonth(),1); assert.equal(new Date(feb).getDate(),28);
 assert.equal(new Date(mar).getDate(),31);
});
test('opening balances are atomic and excluded from operating income',async()=>{
 const {raw,db}=make(); const a=await db.createAccount(account('A',100));
 assert.equal((await db.getTransactions()).length,1);
 assert.equal(finance.sumMoney((await db.getTransactions()).map(finance.operatingIncome)),0);
 await db.recalculateAccountBalance(a.id); assert.equal((await db.getAccounts())[0].balance,100);
 raw.fail=true; await assert.rejects(db.createAccount(account('B',200)));
 assert.equal((await db.getAccounts()).length,1);
});
test('transfer fees reconcile cash and operating expense; retry is idempotent',async()=>{
 const {db}=make(); const a=await db.createAccount(account('A',2000)),b=await db.createAccount(account('B'));
 const input={...transaction(a.id,1006,'TRANSFER'),to_account_id:b.id,fees:6,operation_id:'transfer-1'};
 await db.createTransaction(input);await db.createTransaction(input);
 const accounts=await db.getAccounts();assert.equal(accounts.find(x=>x.id===a.id).balance,994);assert.equal(accounts.find(x=>x.id===b.id).balance,1000);
 assert.equal(finance.sumMoney((await db.getTransactions()).map(finance.operatingExpense)),6);
 await assert.rejects(db.createTransaction({...input,amount:1007}));
});

test('recipient payment and bank charges remain separate operating expenses',()=>{
 const tx={...transaction('a',16200),id:'cbe-payment',description:'Equipment',sender_receiver:'Dawit Asfaw Tirfe',gross_amount:16203.60,fees:3.15,tax:0.45,service_charge:3,vat:0.45,disaster_recovery_fee:0.15};
 const rows=finance.operatingTransactions([tx]);
 assert.equal(rows.length,2);
 assert.equal(rows[0].amount,16200);
 assert.equal(rows[0].sender_receiver,'Dawit Asfaw Tirfe');
 assert.equal(rows[1].amount,3.60);
 assert.equal(rows[1].category,'Bank Fees');
 assert.equal(finance.sumMoney(rows.map(row=>row.amount)),16203.60);
 assert.equal(finance.cashDelta(tx),-16203.60);
});
test('historical SMS reconciliation rewinds later ledger activity and uses gross debit',()=>{
 const now=Date.now();
 const a={...account('CBE',700),id:'a',created_at:1};
 const later={...transaction('a',100,'EXPENSE'),id:'later',date:now};
 const draft={id:'draft',sms_id:'sms-1',account_id:'a',type:'EXPENSE',amount:200,gross_amount:203.6,category:'Transfer',description:'Payment',date:now-1000,suggested_balance:596.4,raw_sms:'x',status:'PENDING',is_recorded:false,created_at:now};
 const result=ReconciliationService.analyzeDraft(a,draft,[later]);
 assert.equal(result.expectedBalance,596.4);assert.equal(result.gap,0);assert.equal(result.transactionsAfter,1);
});
test('per-account forecast detects reserve crossing and safe-to-spend preserves the cushion',()=>{
 const now=new Date(2026,9,8,9).getTime();
 const a={...account('CBE',1000),id:'a',created_at:1,reserve_amount:300};
 const recurring={id:'rent',name:'Rent',amount:750,type:'EXPENSE',category:'Rent',frequency:'MONTHLY',startDate:now,nextDate:now,isActive:true,completedRepetitions:0,accountId:'a'};
 const forecast=ForecastService.generateForecast({accounts:[a],recurring:[recurring],loans:[],days:7,startDate:now});
 assert.equal(forecast.snapshots[0].accountBalances.a,250);
 assert.equal(forecast.lowBalanceWarnings[0].accountId,'a');
 const safe=SafeToSpendService.calculate([a],forecast);
 assert.equal(safe.total,0);assert.equal(safe.accounts[0].lowestProjectedBalance,250);
});
test('safe-to-spend deducts loan obligations that have no payment account',()=>{
 const now=new Date(2026,9,8,9).getTime();
 const a={...account('Cash',1000),id:'a',created_at:1};
 const loan={id:'loan',type:'BORROWED',principal_amount:400,interest_rate:0,start_date:now-1000,due_date:now,status:'ACTIVE',remaining_balance:400,lender_borrower_name:'Lender'};
 const forecast=ForecastService.generateForecast({accounts:[a],recurring:[],loans:[loan],days:7,startDate:now});
 const safe=SafeToSpendService.calculate([a],forecast);
 assert.equal(safe.unassignedCommitments,400);assert.equal(safe.total,600);
});
test('budget pace uses its actual period and suggestions use a three-period median',()=>{
 const start=new Date(2026,9,1).getTime(),end=new Date(2026,9,31,23,59,59,999).getTime();
 const budget={id:'b',category:'Food',limit_amount:3100,period:'MONTHLY',start_date:start,end_date:end};
 const metrics=BudgetService.calculateBudgetMetrics(budget,[budget],[{...transaction('a',1000),id:'oct',date:new Date(2026,9,7).getTime()}]);
 const pace=BudgetService.calculatePace(metrics,new Date(2026,9,10,12).getTime());
 assert.equal(pace.totalDays,31);assert.equal(pace.elapsedDays,10);assert.equal(pace.projectedSpend,3100);
 const txs=[
  {...transaction('a',50),id:'tracking-anchor',category:'Other',date:new Date(2026,6,31).getTime()},
  ...[7,8,9].map((month,index)=>({...transaction('a',[100,300,200][index]),id:`m${month}`,category:'Food',date:new Date(2026,month,15).getTime()})),
 ];
 const suggestions=BudgetService.suggestLimits(txs,['Food'],'MONTHLY',new Date(2026,10,2).getTime());
 assert.equal(suggestions[0].suggestedLimit,200);
});
test('tag ranking uses split category context and counts a repeated tag once per transaction',()=>{
 const now=Date.now();
 const rows=[
  {...transaction('a',10),id:'one',date:now,category:'Food',tags:['home'],splits:[{id:'s1',amount:5,category:'Transport',tags:['work']},{id:'s2',amount:5,category:'Transport',tags:['work']}]},
  {...transaction('a',10),id:'two',date:now-1000,category:'Transport',tags:['work']},
  {...transaction('a',10),id:'three',date:now-2000,category:'Food',tags:['home']},
 ];
 assert.equal(rankTagSuggestions(rows,{category:'Transport'})[0],'work');
});
test('split purchases allocate reports without changing the cash movement',()=>{
 const tx={...transaction('a',2000),id:'split-purchase',gross_amount:2003.60,splits:[
  {id:'food',category:'Groceries',amount:1300,description:'Family groceries',tags:['household','weekly']},
  {id:'clothes',category:'Clothing',amount:500},
  {id:'delivery',category:'Transport',amount:200},
 ]};
 finance.validateTransaction(tx);
 const rows=finance.operatingTransactions([tx]);
 assert.deepEqual(rows.map(row=>[row.category,row.amount]),[['Groceries',1300],['Clothing',500],['Transport',200],['Bank Fees',3.60]]);
 assert.equal(rows[0].description,'Family groceries');assert.deepEqual(rows[0].tags,['household','weekly']);
 assert.equal(finance.sumMoney(rows.map(row=>row.amount)),2003.60);
 assert.equal(finance.cashDelta(tx),-2003.60);
 assert.throws(()=>finance.validateTransaction({...tx,splits:tx.splits.slice(0,2)}),/Split amounts/);
});
test('ledger persists split allocations while debiting the account once',async()=>{
 const {db}=make();const a=await db.createAccount(account('Cash',2500));
 const saved=await db.createTransaction({...transaction(a.id,2000),splits:[{id:'g',category:'Groceries',amount:1300,description:'Weekly food',tags:[' Home ','weekly','home']},{id:'c',category:'Clothing',amount:500},{id:'d',category:'Delivery',amount:200}]});
 assert.equal((await db.getAccounts())[0].balance,500);
 assert.equal(saved.splits.length,3);
 assert.equal(finance.sumMoney(saved.splits.map(item=>item.amount)),2000);
 assert.equal(saved.splits[0].description,'Weekly food');assert.deepEqual(saved.splits[0].tags,['Home','weekly']);
});

test('CBE transfer SMS keeps recipient amount, named recipient, receipt, and itemized charges',()=>{
 const sms='Dear Abel Tamirat Mengistu You have successfully transferred ETB16200.00 from account 1****4191 to account 1****2073 (Dawit Asfaw Tirfe). Service charge of ETB 3.00 and VAT(15%) of ETB0.45 and Disaster Recovery(5%) of 0.15 with total of ETB16203.60 .Your current balance is ETB1,413,826.20. Thanks for Banking with CBE. https://mbreciept.cbe.com.et/v2-hfHCxHyYgQRclLg2fdZ7 for feedback: https://forms.gle/kGNGQpG3mQCCk3iD6';
 const parsed=EnhancedSMSParser.parseTransaction(sms,'CBE','sms-cbe-1',Date.now());
 assert.ok(parsed);
 assert.equal(parsed.type,'EXPENSE');
 assert.equal(parsed.amount,16200);
 assert.equal(parsed.grossAmount,16203.60);
 assert.equal(parsed.accountNumber,'4191');
 assert.equal(parsed.merchant,'Dawit Asfaw Tirfe');
 assert.equal(parsed.serviceCharge,3);
 assert.equal(parsed.vat,0.45);
 assert.equal(parsed.disasterRecoveryFee,0.15);
 assert.equal(parsed.fees,3.15);
 assert.equal(parsed.tax,0.45);
 assert.equal(parsed.receiptUrl,'https://mbreciept.cbe.com.et/v2-hfHCxHyYgQRclLg2fdZ7');
});

test('recipient amount and gross SMS debit reconcile without changing legacy expense semantics',async()=>{
 const {db}=make();
 const a=await db.createAccount(account('CBE',20000));
 await db.createTransaction({...transaction(a.id,16200),gross_amount:16203.60,fees:3.15,tax:0.45,service_charge:3,vat:0.45,disaster_recovery_fee:0.15,sender_receiver:'Dawit Asfaw Tirfe',receipt_url:'https://mbreciept.cbe.com.et/test'});
 assert.equal((await db.getAccounts()).find(x=>x.id===a.id).balance,3796.40);
 const saved=(await db.getTransactions()).find(x=>x.sms_id===undefined && x.category==='Food');
 assert.equal(saved.amount,16200);
 assert.equal(saved.gross_amount,16203.60);
 assert.equal(saved.disaster_recovery_fee,0.15);
});
test('payment failure leaves both loan and cash unchanged',async()=>{
 const {raw,db}=make();const a=await db.createAccount(account('A',500));
 const loan=await db.createLoan({type:'BORROWED',principal_amount:100,interest_rate:0,start_date:1,due_date:2,lender_borrower_name:'B',status:'ACTIVE',remaining_balance:100});
 raw.fail=true;await assert.rejects(db.recordLoanPayment(loan.id,a.id,25,'p1'));
 assert.equal((await db.getLoans())[0].remaining_balance,100);assert.equal((await db.getAccounts())[0].balance,500);
 raw.fail=false;await db.recordLoanPayment(loan.id,a.id,25,'p1');await db.recordLoanPayment(loan.id,a.id,25,'p1');
 assert.equal((await db.getLoans())[0].remaining_balance,75);assert.equal((await db.getAccounts())[0].balance,475);
 await assert.rejects(db.recordLoanPayment(loan.id,a.id,76,'p2'));
});
test('final-record deletion remains in durable outbox and stale acknowledgements preserve newer writes',async()=>{
 const {db}=make(); const a=await db.createAccount(account('A'));const t=await db.createTransaction(transaction(a.id,5));
 const initial=await db.readMeta('outbox');const old=initial[`transactions/${t.id}`];
 await db.deleteTransaction(t.id);await db.acknowledge([old],{[`transactions/${t.id}`]:1});
 const pending=(await db.readMeta('outbox'))[`transactions/${t.id}`];assert.ok(pending);assert.equal(pending.value,undefined);assert.equal(pending.base,1);
 assert.equal((await db.getAccounts())[0].balance,0);
});
test('stale session rejects writes and malformed transactions cannot enter ledger',async()=>{
 const {db}=make();const a=await db.createAccount(account('A'));
 await assert.rejects(db.createTransaction(transaction(a.id,NaN)));
 await assert.rejects(db.createTransaction({...transaction(a.id,1,'TRANSFER'),to_account_id:a.id}));
 db.deactivate();await assert.rejects(db.createTransaction(transaction(a.id,1)));
});
test('account deletion preserves ledger history and permits only unused accounts',async()=>{
 const {db}=make();const historical=await db.createAccount(account('Historical',100));
 await assert.rejects(db.deleteAccount(historical.id),/ledger history/);
 assert.ok((await db.getAccounts()).some(item=>item.id===historical.id));
 const unused=await db.createAccount(account('Unused'));
 await db.deleteAccount(unused.id);
 assert.equal((await db.getAccounts()).some(item=>item.id===unused.id),false);
});
test('unrelated equal-value SMS are not paired',()=>{
 const drafts=[{id:'e',account_id:'a',type:'EXPENSE',status:'PENDING',amount:500,date:100000},{id:'i',account_id:'b',type:'INCOME',status:'PENDING',amount:500,date:100001}];
 assert.equal(findSelfTransferPairs(drafts).length,0);
 drafts[0].transfer_to_account_id='b';assert.equal(findSelfTransferPairs(drafts).length,1);
});
test('same-day opposite SMS are suggested for review without being silently merged',()=>{
 const drafts=[
  {id:'sent',account_id:'cbe',type:'EXPENSE',status:'PENDING',amount:16200,gross_amount:16203.60,fees:3.15,tax:0.45,date:100000},
  {id:'received',account_id:'telebirr',type:'INCOME',status:'PENDING',amount:16200,date:100000+3600000},
 ];
 assert.equal(findSelfTransferPairs(drafts).length,0);
 const candidates=findTransferCandidates(drafts[0],drafts);
 assert.equal(candidates.length,1);
 assert.equal(candidates[0].expenseAccountId,'cbe');
 assert.equal(candidates[0].incomeAccountId,'telebirr');
 assert.equal(candidates[0].confidence,'MEDIUM');
 assert.equal(candidates[0].score,60);
 assert.deepEqual(candidates[0].reasons,['Same amount','Same date']);
});
test('undo reopens only SMS drafts linked to the deleted transaction',async()=>{
 await DraftTransactionService.clearAll();
 const draft=await DraftTransactionService.add({account_id:'a',type:'EXPENSE',amount:10,category:'Food',description:'Meal',date:1,sms_id:'sms-undo',raw_sms:'bank message',status:'PENDING',is_recorded:false});
 await DraftTransactionService.markAsRecorded(draft.id,'tx-undo',{recorded_at:2,type:'EXPENSE',category:'Food',description:'Dinner',source_account_id:'a'});
 await DraftTransactionService.reopenRecorded([draft.id],'different-tx');
 assert.equal((await DraftTransactionService.getAll())[0].status,'RECORDED');
 await DraftTransactionService.reopenRecorded([draft.id],'tx-undo');
 const reopened=(await DraftTransactionService.getAll())[0];
 assert.equal(reopened.status,'PENDING');assert.equal(reopened.is_recorded,false);assert.equal(reopened.matched_transaction_id,undefined);assert.equal(reopened.confirmation,undefined);
});
test('recurring suggestions require three consistent similar transactions',()=>{
 const base={id:'now',account_id:'a',type:'EXPENSE',amount:100,category:'Rent',description:'Rent',sender_receiver:'Landlord',date:new Date(2026,9,1).getTime()};
 const history=[1,2].map((months,index)=>({...base,id:`old-${index}`,date:new Date(2026,9-months,1).getTime()}));
 const suggestion=detectRecurringPattern(base,history);
 assert.equal(suggestion.frequency,'MONTHLY');assert.equal(suggestion.confidence,100);assert.equal(suggestion.occurrences,3);
 assert.equal(detectRecurringPattern(base,history.slice(0,1)),null);
});
test('SMS learning preserves split ratios and owned transfer routing',async()=>{
 await SMSLearningService.clearAllRules();
 await SMSLearningService.learn({accountId:'bank',sender:'CBE',rawMerchant:'My Wallet',correctedDescription:'Transfer',correctedCategory:'Transfer',transactionType:'EXPENSE',transferFromAccountId:'bank',transferToAccountId:'wallet',splits:[{category:'Food',amount:75,description:'Lunch',tags:['work']},{category:'Transport',amount:25,description:'Taxi',tags:['travel']}]});
 const rule=await SMSLearningService.getRule({accountId:'bank',sender:'CBE',rawMerchant:'My Wallet'});
 assert.equal(rule.transferFromAccountId,'bank');assert.equal(rule.transferToAccountId,'wallet');
 assert.deepEqual(rule.splitRatios.map(item=>[item.category,item.ratio]),[['Food',0.75],['Transport',0.25]]);
 assert.equal(rule.splitRatios[0].description,'Lunch');assert.deepEqual(rule.splitRatios[0].tags,['work']);
});
test('backups reject invalid records and strip all configured provider keys',()=>{
 assert.equal(BackupService.validateBackup({version:'garbage',timestamp:1,accounts:[{}],transactions:[{amount:-999}],budgets:[],loans:[]}),false);
 const backup=BackupService.createBackup([],[],[],[],[],[],{geminiApiKey:'secret',groqApiKey:'secret',openRouterApiKey:'secret',currency:'ETB'});
 assert.equal(JSON.stringify(backup).includes('secret'),false);assert.equal(backup.settings.aiSharingEnabled,false);
});
test('zero-budget spending is displayed as exceeded, and forecast account totals reconcile',()=>{
 const metrics=BudgetService.calculateBudgetMetrics({id:'b',category:'Food',limit_amount:0,period:'MONTHLY',start_date:0,end_date:100},[],[{...transaction('a',10),id:'t',date:50}]);
 assert.equal(metrics.progress,100);assert.equal(metrics.remaining,-10);
 const result=ForecastService.generateForecast({accounts:[{...account('A',100),id:'a',created_at:1,locked_amount:20}],recurring:[],loans:[],days:7});
 assert.equal(result.startingBalance,80);assert.equal(result.projectedBalance,finance.sumMoney(result.accountProjections.map(a=>a.projectedBalance)));
});
test('recurring transfer forecasts debit fees and tax from net worth',()=>{
 const start=new Date(2026,9,7).setHours(0,0,0,0);
 const result=ForecastService.generateForecast({
  accounts:[{...account('Source',1000),id:'a',created_at:1},{...account('Destination',0),id:'b',created_at:1}],
  recurring:[{id:'r',name:'Transfer',amount:106,type:'TRANSFER',category:'Transfer',frequency:'MONTHLY',startDate:start-86400000,nextDate:start,isActive:true,accountId:'a',toAccountId:'b',fees:5,tax:1,completedRepetitions:0,totalRepetitions:1,reminderEnabled:false,reminderDaysBefore:0}],
  loans:[],days:1,startDate:start,
 });
 const projections=Object.fromEntries(result.accountProjections.map(row=>[row.accountId,row.projectedBalance]));
 assert.equal(projections.a,894);assert.equal(projections.b,100);assert.equal(result.projectedBalance,994);
 assert.equal(result.projectedBalance,finance.sumMoney(result.accountProjections.map(row=>row.projectedBalance)));
});
test('local settings and SMS data are isolated by user',async()=>{
 const session=load('./services/SessionStorage.ts');
 await session.setSessionScope('alice');await session.default.setItem('draft_transactions','private');
 await session.setSessionScope('bob');assert.equal(await session.default.getItem('draft_transactions'),null);
 await session.setSessionScope('alice');assert.equal(await session.default.getItem('draft_transactions'),'private');
});
test('large custom logos migrate out of credential storage',async()=>{
 const session=load('./services/SessionStorage.ts');await session.setSessionScope('asset-test');
 await session.default.removeItem('local_bank_logos');
 let savedSecureData;
 mocks['./SecureStorageService']={SecureStorageService:{
  getUserData:async()=>({appSettings:{geminiApiKey:'kept-secret'},local_bank_logos:{Custom:'data:image/png;base64,large'}}),
  saveUserData:async value=>{savedSecureData=value;},
 }};
 cache.delete(path.join(root,'services/LocalAssetService.ts'));
 try {
  const LocalAssetService=load('./services/LocalAssetService.ts').default;
  assert.deepEqual(await LocalAssetService.getUserAssets(),{Custom:'data:image/png;base64,large'});
  assert.deepEqual(JSON.parse(await session.default.getItem('local_bank_logos')),{Custom:'data:image/png;base64,large'});
  assert.equal(savedSecureData.local_bank_logos,undefined);
  assert.equal(savedSecureData.appSettings.geminiApiKey,'kept-secret');
 } finally {
  delete mocks['./SecureStorageService'];cache.delete(path.join(root,'services/LocalAssetService.ts'));
 }
});

test('legacy balance migration is durable, idempotent and excluded from earnings', async () => {
 const {raw,db}=make(); raw.rows.accounts.set('old',{...account('Old',123),id:'old',created_at:1});
 await db.init();await db.init();
 assert.equal((await db.getTransactions()).length,1);
 await db.recalculateAccountBalance('old');assert.equal((await db.getAccounts())[0].balance,123);
 assert.equal(finance.operatingIncome((await db.getTransactions())[0]),0);
});
test('legacy backup preserves its opening balance on repeated restore',async()=>{
 const {db}=make();await db.init();
 const data={accounts:[{...account('Old',200),id:'old',created_at:1}],transactions:[],budgets:[],loans:[]};
 await db.restore(data);await db.restore(data);
 assert.equal((await db.getAccounts())[0].balance,200);assert.equal((await db.getTransactions()).length,1);
});
test('loan interest is validated and split from principal, and payment ids cannot be reused',async()=>{
 const {db}=make();const a=await db.createAccount(account('A'));
 const input={type:'BORROWED',principal_amount:1200,interest_rate:10,start_date:new Date(2026,0,1).getTime(),due_date:new Date(2027,0,1).getTime(),lender_borrower_name:'B',status:'ACTIVE',remaining_balance:1270};
 const loan=await db.createLoanWithCash(input,a.id,50);assert.equal(loan.remaining_interest,70);
 const payment=await db.recordLoanPayment(loan.id,a.id,100,'loan-pay');assert.equal(finance.operatingExpense(payment),70);
 await assert.rejects(db.recordLoanPayment(loan.id,a.id,99,'loan-pay'));
 await assert.rejects(db.createLoanWithCash({...input,remaining_balance:9999},a.id,50));
});
test('persisted loan money is normalized to cents',async()=>{
 const {db}=make();await db.createAccount(account('A'));
 const loan=await db.createLoan({
  type:'BORROWED',principal_amount:100.129,interest_rate:0,start_date:1,due_date:2,
  lender_borrower_name:'B',status:'ACTIVE',remaining_balance:100.129,
  total_interest:0.005,remaining_interest:0.005,
 });
 assert.equal(loan.principal_amount,100.13);assert.equal(loan.remaining_balance,100.13);
 assert.equal(loan.total_interest,0.01);assert.equal(loan.remaining_interest,0.01);
 await db.updateLoan({...loan,reminderEnabled:true});
 const stored=(await db.getLoans())[0];assert.equal(stored.remaining_balance,100.13);
});
test('loan deletion preserves cash and repayment history',async()=>{
 const {db}=make();const a=await db.createAccount(account('A'));
 const historical=await db.createLoanWithCash({
  type:'BORROWED',principal_amount:100,interest_rate:0,start_date:1,due_date:2,
  lender_borrower_name:'B',status:'ACTIVE',remaining_balance:100,
 },a.id,0);
 await assert.rejects(db.deleteLoan(historical.id),/cash ledger/);
 assert.ok((await db.getLoans()).some(item=>item.id===historical.id));
 const unused=await db.createLoan({
  type:'BORROWED',principal_amount:50,interest_rate:0,start_date:1,due_date:2,
  lender_borrower_name:'C',status:'ACTIVE',remaining_balance:50,
 });
 await db.deleteLoan(unused.id);
 assert.equal((await db.getLoans()).some(item=>item.id===unused.id),false);
});
test('calendar periods include today and exclude future postings without 30-day approximations',()=>{
 const now=new Date(2026,1,15,10).getTime();const period=finance.reportPeriod('month',now);
 assert.equal(period.start,new Date(2026,1,1).getTime());assert.equal(period.days,15);
 assert.equal(period.previousStart,new Date(2026,0,1).getTime());
});
test('IndexedDB commits ledger and metadata atomically and indexes transfer destinations',async()=>{
 require('fake-indexeddb/auto');
 const {WebDatabase}=load('./services/database/web.ts');const raw=new WebDatabase('regression-browser');
 const db=new LedgerDatabase(raw,'alice');await db.init();
 const a=await db.createAccount(account('A',200)),b=await db.createAccount(account('B'));
 await db.createTransaction({...transaction(a.id,21,'TRANSFER'),to_account_id:b.id,fees:1});
 assert.equal((await db.getTransactions({account_id:b.id})).length,1);
 assert.equal((await db.getAccounts()).find(x=>x.id===b.id).balance,20);
 await assert.rejects(raw.commitRows([{table:'accounts',id:'bad',value:{id:'bad',name:'would persist'}},{table:'transactions',id:'invalid',value:{amount:1}}],{bad:true}));
 assert.equal((await db.getAccounts()).some(x=>x.id==='bad'),false);assert.equal(await raw.readMeta('bad'),undefined);
 await db.writeSyncedMeta('categories',[{id:'food',name:'Food'}]);
 assert.equal((await db.readMeta('synced_meta')).categories.items[0].name,'Food');
});
test('database balance mutations stay exact to the cent',async()=>{
 require('fake-indexeddb/auto');
 cache.delete(path.join(root,'services/database/web.ts'));
 const {WebDatabase}=load('./services/database/web.ts');const db=new WebDatabase(`cent-balance-${Date.now()}`);
 await db.init();
 const a=await db.createAccount(account('Cash'));
 for(let i=0;i<10;i++) await db.createTransaction({...transaction(a.id,0.1),description:`Decimal ${i}`});
 assert.equal((await db.getAccounts())[0].balance,-1,'incremental writes must not accumulate binary float drift');
 await db.recalculateAccountBalance(a.id);
 assert.equal((await db.getAccounts())[0].balance,-1,'full repair must produce the same cent-exact balance');
});
test('Redux ignores completed writes from a reset session and deduplicates retries',()=>{
 mocks['@/services/database']={getDatabase:async()=>{throw Error('not called');}};
 const slice=load('./store/slices/transactionsSlice.ts');const reducer=slice.default;
 const tx={...transaction('a',10),id:'tx'};
 let state=reducer(undefined,{type:'init'});
 state=reducer(state,slice.addTransaction.pending('old',tx));state=reducer(state,slice.resetTransactions());
 state=reducer(state,slice.addTransaction.fulfilled(tx,'old',tx));assert.equal(state.items.length,0);
 for(const request of ['one','two']) {state=reducer(state,slice.addTransaction.pending(request,tx));state=reducer(state,slice.addTransaction.fulfilled(tx,request,tx));}
 assert.equal(state.items.length,1);
});

test('sync retries a lost acknowledgement and surfaces stale-device edits without overwriting cloud',async()=>{
 const {db}=make();await db.init();const a=await db.createAccount(account('A',100));
 let loseReply=true;const remote=new Map();
 mocks['@/services/database']={getDatabase:async()=>db};
 mocks['@/store']={store:{dispatch:()=>({unwrap:async()=>undefined})}};
 for(const [name,action] of [['accounts','fetchAccounts'],['transactions','fetchTransactions'],['budgets','fetchBudgets'],['loans','fetchLoans']])mocks[`@/store/slices/${name}Slice`]={[action]:()=>({})};
 mocks['@/contexts/AppSettingsContext']={loadStoredAppSettings:async()=>({cloudSyncEnabled:true})};
 mocks['./NativeErrorReporter']={default:{reset(){}}};
 mocks['firebase/auth']={getAuth:()=>({currentUser:{uid:'alice'}})};
 mocks['firebase/firestore']={getFirestore:()=>({}),doc:(_,path)=>({path}),collection:(_,path)=>({path}),serverTimestamp:()=>1,onSnapshot:()=>()=>{},getDocs:async ref=>({docs:[...remote.entries()].filter(([path])=>path.startsWith(ref.path+'/')).map(([path,value])=>({id:path.split('/').at(-1),data:()=>structuredClone(value)}))}),runTransaction:async(_,fn)=>{
   const writes=[];await fn({get:async ref=>({data:()=>structuredClone(remote.get(ref.path))}),set:(ref,value)=>writes.push([ref.path,value])});
   writes.forEach(([path,value])=>remote.set(path,structuredClone(value)));
   if(loseReply){loseReply=false;throw Error('reply lost');}
 }};
 const {SyncService}=load('./services/SyncService.ts');
 await assert.rejects(SyncService.syncNow('alice'),/reply lost/);
 assert.ok(Object.keys(await db.readMeta('outbox')).length>0);
 await SyncService.syncNow('alice');assert.equal(Object.keys(await db.readMeta('outbox')).length,0);
 const path=`users/alice/accounts/${a.id}`, first=remote.get(path);
 remote.set(path,{...first,name:'Changed on another device',_revision:first._revision+1,_operation:'other-device'});
 await db.updateAccount({...a,name:'Local edit'});
 await assert.rejects(SyncService.syncNow('alice'),/conflict/);
 assert.equal(remote.get(path).name,'Changed on another device');
 const conflict=(await db.readMeta('sync_conflicts'))[0];await db.resolveConflict(conflict,'local');
 await SyncService.syncNow('alice');assert.equal(remote.get(path).name,'Local edit');
 assert.equal((await db.getAccounts())[0].balance,100);
});

test('legacy loans allocate remaining interest without treating it as principal',async()=>{
 const {db}=make(),a=await db.createAccount(account('A',1000));
 const loan=await db.createLoan({type:'BORROWED',principal_amount:100,interest_rate:12,start_date:new Date(2026,0,1).getTime(),due_date:new Date(2027,0,1).getTime(),lender_borrower_name:'Lender',status:'ACTIVE',remaining_balance:107});
 const tx=await db.recordLoanPayment(loan.id,a.id,20,'legacy-payment');assert.equal(tx.interest_amount,7);
 assert.equal((await db.getLoans())[0].remaining_interest,0);
});
test('confirmed shared interest changes earnings without moving cash again',async()=>{
 const {db}=make(),a=await db.createAccount(account('A',200));
 await db.createTransaction({...transaction(a.id,30),purpose:'FINANCING',operation_id:'repayment-record-r1'});
 await db.allocateLinkedInterest('shared',[{id:'r1',status:'CONFIRMED',interestAmount:7}]);
 await db.allocateLinkedInterest('shared',[{id:'r1',status:'CONFIRMED',interestAmount:7}]);
 assert.equal((await db.getAccounts())[0].balance,170);
 assert.equal(finance.sumMoney((await db.getTransactions()).map(finance.operatingExpense)),7);
});

test('old cloud accounts retain unposted balances and mixed-currency restore is rejected',async()=>{
 const {db}=make();await db.init();
 await db.applyRemote([{table:'accounts',id:'legacy-cloud',value:{...account('Remote',42),id:'legacy-cloud',created_at:1},revision:0}]);
 assert.equal((await db.getAccounts())[0].balance,42);
 assert.equal((await db.getTransactions())[0].purpose,'ADJUSTMENT');
 await db.applyRemote([{table:'accounts',id:'legacy-cloud',value:{...account('Remote',42),id:'legacy-cloud',created_at:1},revision:0}]);
 assert.equal((await db.getTransactions()).length,1);
 await assert.rejects(db.restore({accounts:[{...account('Other'),id:'usd',currency:'USD',created_at:1}],transactions:[],loans:[],budgets:[]}),/currency/);
});

test('legacy cloud loans gain an indexed reminder timestamp and an outbox write',async()=>{
 const {raw,db}=make();await db.init();
 const due=new Date(2026,10,20,12).getTime();
 await db.applyRemote([{table:'loans',id:'legacy-loan',revision:3,value:{
  id:'legacy-loan',type:'BORROWED',status:'ACTIVE',principal_amount:1000,
  remaining_balance:1000,interest_rate:0,start_date:new Date(2026,9,1).getTime(),
  due_date:due,reminderEnabled:true,reminderDaysBefore:2,
 }}]);
 const [loan]=await db.getLoans();
 assert.ok(Number.isFinite(loan.reminder_at));
 assert.equal(new Date(loan.reminder_at).getDate(),18);
 const pending=await raw.readMeta('outbox');
 assert.equal(pending['loans/legacy-loan'].base,3);
 assert.equal(pending['loans/legacy-loan'].value.reminder_at,loan.reminder_at);
});
