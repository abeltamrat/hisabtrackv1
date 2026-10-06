const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
class HttpsError extends Error { constructor(code,message) {super(message);this.code=code;} }
function environment() {
 const rows=new Map();let chain=Promise.resolve();
 const snapshot=ref=>({exists:rows.has(ref.path),data:()=>structuredClone(rows.get(ref.path)),ref,id:ref.path.split('/').at(-1)});
 const collection=p=>({path:p,query:true,doc:id=>doc(p+'/'+id),get:async()=>({docs:[...rows.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).map(k=>snapshot(doc(k)))})});
 const doc=p=>({path:p,collection:n=>collection(p+'/'+n),get:async()=>snapshot(doc(p)),set:async value=>rows.set(p,value)});
 const db={doc,collection,runTransaction:fn=>{
   const next=chain.then(async()=>{
    const writes=[];
    const tx={get:async ref=>ref.query?ref.get():snapshot(ref),set:(ref,v)=>writes.push(()=>rows.set(ref.path,structuredClone(v))),update:(ref,v)=>writes.push(()=>rows.set(ref.path,{...rows.get(ref.path),...structuredClone(v)})),create:(ref,v)=>{if(rows.has(ref.path))throw Error('exists');writes.push(()=>rows.set(ref.path,structuredClone(v)));}};
    const result=await fn(tx);writes.forEach(write=>write());return result;
   });chain=next.catch(()=>{});return next;
 }};
 const wrap=(_,fn)=>fn;
 const mocks={'firebase-admin':{initializeApp(){},firestore:()=>db,auth:()=>({getUser:async uid=>({uid,displayName:'Alice',phoneNumber:'+251911111111'})})},'expo-server-sdk':{Expo:class{}},'firebase-functions':{logger:{info(){},debug(){},error(){}}},'firebase-functions/v2/firestore':{onDocumentCreated:wrap},'firebase-functions/v2/scheduler':{onSchedule:wrap},'firebase-functions/v2/https':{onCall:wrap,HttpsError}};
 const exports={};new Function('require','exports',fs.readFileSync(path.join(__dirname,'../functions/index.js'),'utf8'))(name=>mocks[name],exports);
 rows.set('sharedLoans/loan',{borrowerUid:'alice',lenderUid:'bob',linkStatus:'ACCEPTED',amount:100,interestRate:0,startDate:Date.UTC(2026,0,1),dueDate:Date.UTC(2027,0,1)});
 const request=(uid,data)=>({auth:{uid},data:{sharedLoanId:'loan',...data}});
 return {rows,exports,request};
}
test('server rejects outsiders, self-confirmation and overpayment including pending reservations',async()=>{
 const {exports:api,rows,request}=environment();
 await assert.rejects(api.mutateLinkedRepayment(request('mallory',{action:'record',repaymentId:'x',amount:20,date:1})),{code:'permission-denied'});
 await api.mutateLinkedRepayment(request('alice',{action:'record',repaymentId:'p1',amount:60,date:1}));
 await assert.rejects(api.mutateLinkedRepayment(request('alice',{action:'confirm',repaymentId:'p1'})),{code:'permission-denied'});
 await assert.rejects(api.mutateLinkedRepayment(request('bob',{action:'record',repaymentId:'p2',amount:50,date:1})),{code:'failed-precondition'});
 await api.mutateLinkedRepayment(request('bob',{action:'confirm',repaymentId:'p1'}));
 assert.equal(rows.get('sharedLoans/loan/repayments/p1').status,'CONFIRMED');
});
test('server repayment retries do not duplicate payment or audit and rejected payments free reservations',async()=>{
 const {exports:api,rows,request}=environment();
 const input=request('alice',{action:'record',repaymentId:'p1',amount:100,date:1});
 await api.mutateLinkedRepayment(input);await api.mutateLinkedRepayment(input);
 assert.equal([...rows.keys()].filter(k=>k.includes('/changelog/')).length,1);
 await api.mutateLinkedRepayment(request('bob',{action:'reject',repaymentId:'p1'}));
 await api.mutateLinkedRepayment(request('bob',{action:'reject',repaymentId:'p1'}));
 await assert.rejects(api.mutateLinkedRepayment(request('bob',{action:'confirm',repaymentId:'p1'})),{code:'failed-precondition'});
 await api.mutateLinkedRepayment(request('alice',{action:'record',repaymentId:'p2',amount:100,date:2}));
 assert.equal(rows.get('sharedLoans/loan').repaymentVersion,3);
});
test('phone lookup is authenticated, rate limited and does not return email',async()=>{
 const {exports:api,rows}=environment();rows.set('phoneIndex/+251911111111',{uid:'alice',email:'private@example.com'});
 await assert.rejects(api.lookupLinkedUser({data:{phone:'+251911111111'}}),{code:'unauthenticated'});
 const request={auth:{uid:'bob'},data:{phone:'+251911111111'}};
 for(let i=0;i<20;i++){const result=await api.lookupLinkedUser(request);assert.equal(result.uid,'alice');assert.equal(result.email,undefined);}
 await assert.rejects(api.lookupLinkedUser(request),{code:'resource-exhausted'});
});

test('confirmed interest is capped across payments and persisted for both participants',async()=>{
 const {exports:api,rows,request}=environment();rows.get('sharedLoans/loan').interestRate=12;
 for(const [id,amount] of [['p1',10],['p2',20]]){
  await api.mutateLinkedRepayment(request('alice',{action:'record',repaymentId:id,amount,date:1}));
  await api.mutateLinkedRepayment(request('bob',{action:'confirm',repaymentId:id}));
 }
 assert.equal(rows.get('sharedLoans/loan/repayments/p1').interestAmount,10);
 assert.equal(rows.get('sharedLoans/loan/repayments/p2').interestAmount,2);
});
