const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
class HttpsError extends Error { constructor(code,message) {super(message);this.code=code;} }
function environment(options={}) {
 const sent=[];
 const rows=new Map();let chain=Promise.resolve();
 const snapshot=ref=>({exists:rows.has(ref.path),data:()=>structuredClone(rows.get(ref.path)),ref,id:ref.path.split('/').at(-1)});
 const collection=p=>({path:p,query:true,doc:id=>doc(p+'/'+id),get:async()=>({docs:[...rows.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).map(k=>snapshot(doc(k)))}),get parent(){return p.includes('/')?doc(p.slice(0,p.lastIndexOf('/'))):null;}});
 const doc=p=>({path:p,id:p.split('/').at(-1),collection:n=>collection(p+'/'+n),get:async()=>snapshot(doc(p)),set:async value=>rows.set(p,value),create:async value=>{if(rows.has(p))throw Error('exists');rows.set(p,structuredClone(value));},update:async value=>rows.set(p,{...rows.get(p),...structuredClone(value)}),delete:async()=>rows.delete(p),get parent(){return p.includes('/')?collection(p.slice(0,p.lastIndexOf('/'))):null;}});
 // Collection-group query over the last path segment, with chainable where/orderBy/limit.
 const collectionGroup=name=>{const filters=[];let cap=Infinity;const q={query:true,where(field,op,value){filters.push({field,op,value});return q;},orderBy(){return q;},limit(n){cap=n;return q;},get:async()=>{
   const keys=[...rows.keys()].filter(k=>{const parts=k.split('/');return parts.length>=2&&parts.at(-2)===name;})
     .filter(k=>filters.every(({field,op,value})=>{const actual=rows.get(k)[field];
       return op==='=='?actual===value:op==='>='?actual>=value:op==='<='?actual<=value:false;}));
   return {empty:keys.length===0,docs:keys.slice(0,cap).map(k=>snapshot(doc(k)))};
 }};return q;};
 const db={doc,collection,collectionGroup,recursiveDelete:async ref=>{for(const k of [...rows.keys()])if(k===ref.path||k.startsWith(ref.path+'/'))rows.delete(k);},runTransaction:fn=>{
   const next=chain.then(async()=>{
    const writes=[];
    const tx={get:async ref=>ref.query?ref.get():snapshot(ref),set:(ref,v)=>writes.push(()=>rows.set(ref.path,structuredClone(v))),update:(ref,v)=>writes.push(()=>rows.set(ref.path,{...rows.get(ref.path),...structuredClone(v)})),create:(ref,v)=>{if(rows.has(ref.path))throw Error('exists');writes.push(()=>rows.set(ref.path,structuredClone(v)));}};
    const result=await fn(tx);writes.forEach(write=>write());return result;
   });chain=next.catch(()=>{});return next;
 }};
 const wrap=(_,fn)=>fn;
 const mocks={'firebase-admin':{initializeApp(){},firestore:()=>db,auth:()=>({getUser:async uid=>({uid,displayName:'Alice',phoneNumber:'+251911111111'})})},'expo-server-sdk':{Expo:class{static isExpoPushToken(t){return typeof t==='string'&&/^Expo(nent)?PushToken\[.+\]$/.test(t);}chunkPushNotifications(m){return m.length?[m]:[];}chunkPushNotificationReceiptIds(ids){return ids.length?[ids]:[];}async sendPushNotificationsAsync(chunk){sent.push(...chunk);return chunk.map((_,i)=>({status:'ok',id:'ticket-'+i}));}async getPushNotificationReceiptsAsync(){return {};}}},'firebase-functions':{logger:{info(){},debug(){},warn(){},error(){}}},'firebase-functions/v2/firestore':{onDocumentCreated:wrap},'firebase-functions/v2/scheduler':{onSchedule:wrap},'firebase-functions/v2/https':{onCall:wrap,HttpsError}};
 const exports={};new Function('require','exports',fs.readFileSync(path.join(__dirname,'../functions/index.js'),'utf8'))(name=>mocks[name],exports);
 rows.set('sharedLoans/loan',{borrowerUid:'alice',lenderUid:'bob',linkStatus:'ACCEPTED',amount:100,interestRate:0,startDate:Date.UTC(2026,0,1),dueDate:Date.UTC(2027,0,1)});
 const request=(uid,data)=>({auth:{uid},data:{sharedLoanId:'loan',...data}});
 return {rows,exports,request,sent};
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

test('test-push content is server-generated and rate limited, never client-supplied',async()=>{
 const {exports:api,rows}=environment();
 const jobOf=()=>[...rows.keys()].find(k=>k.includes('/push_jobs/'));

 await assert.rejects(api.sendTestPush({data:{}}),{code:'unauthenticated'});

 // A client cannot choose the notification text: whatever it sends is ignored.
 await api.sendTestPush({auth:{uid:'alice'},data:{title:'Your account is compromised',body:'Call +251900000000'}});
 const job=rows.get(jobOf());
 assert.equal(job.title,'HisabTrack test push');
 assert.ok(!/compromised|\+251900000000/.test(JSON.stringify(job)),'client text must not reach the push payload');
 assert.equal(job.status,'queued');
 assert.equal(job.source,'test_callable');
 assert.ok(jobOf().startsWith('users/alice/push_jobs/'),'the job lands under the caller, not an arbitrary uid');

 // The endpoint must not be usable as a notification relay.
 await assert.rejects(api.sendTestPush({auth:{uid:'alice'},data:{}}),{code:'resource-exhausted'});

 rows.set('deletedAccounts/mallory',{deletedAt:1});
 await assert.rejects(api.sendTestPush({auth:{uid:'mallory'},data:{}}),{code:'permission-denied'});
});

test('a push token claimed by two accounts is never delivered to',async()=>{
 const token='ExponentPushToken[victimdevice]';
 const device=()=>({installationId:'i',expoPushToken:token,notificationsEnabled:true,isActive:true});
 const deliver=async(rows,api,uid)=>{
  const jobPath=`users/${uid}/push_jobs/j1`;
  rows.set(jobPath,{title:'t',body:'b',status:'queued'});
  const ref={path:jobPath,get:async()=>({data:()=>rows.get(jobPath)}),
   set:async(v)=>rows.set(jobPath,{...rows.get(jobPath),...v}),
   update:async(v)=>rows.set(jobPath,{...rows.get(jobPath),...v})};
  await api.sendQueuedPushNotification({data:{ref},params:{userId:uid,jobId:'j1'}});
  return rows.get(jobPath);
 };

 // Baseline: a token only its owner claims is delivered to.
 const clean=environment();
 clean.rows.set('users/victim/devices/d1',device());
 let job=await deliver(clean.rows,clean.exports,'victim');
 assert.equal(clean.sent.length,1,'an uncontested token still receives pushes');
 assert.equal(clean.sent[0].to,token);
 assert.equal(job.status,'sent');

 // The attacker plants the victim's token in their own devices collection.
 const contested=environment();
 // More than ten same-owner duplicates ensure an ownership query cannot cap
 // results before it reaches the real owner's claim.
 for(let i=0;i<12;i++) contested.rows.set(`users/mallory/devices/d${i}`,device());
 contested.rows.set('users/victim/devices/d1',device());
 job=await deliver(contested.rows,contested.exports,'mallory');
 assert.deepEqual(contested.sent,[],'a token claimed by two accounts must not be delivered to');
 assert.equal(job.status,'no_devices');
 assert.equal(job.targetedDeviceCount,0);
});
