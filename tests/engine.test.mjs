import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Engine} from '../src/engine.mjs';
import {Store} from '../src/store.mjs';
import {mintPlans,classifySource,sourceInfo} from '../src/source.mjs';
import {expiryMs,validatePreview} from '../src/preview.mjs';
import {getWalletState} from '../src/baw.mjs';
import {quarantineUnknown} from '../src/recovery.mjs';
const A='0x1234567890123456789012345678901234567890';
const B='0x2234567890123456789012345678901234567890';
const C='0x3234567890123456789012345678901234567890';
const HASH='0x'+'a'.repeat(64);
const abi=[{type:'function',name:'mint',inputs:[],outputs:[],stateMutability:'payable'}];
const now=Date.parse('2026-11-01T20:00:00Z');
function raw(target){
 return {success:true,data:{requestId:'req1',expiresAt:now+60000,requireConfirmation:false,parsedTx:{from:A,to:target.contract,chainId:56,value:'0',inputData:target.inputData},simulationResult:{simulationCode:'000000000',allowanceChanges:[],authorityChanges:[],balanceChanges:[{tokenType:target.standard==='ERC-1155'?'Erc1155':'Erc721',contractAddress:target.contract,owner:A,tokenId:'0x01',change:1}]},risks:{riskDetails:[],riskBehaviors:[],addresses:{}}}};
}
async function fixture(t,mode='preview'){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sniper-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const store=new Store(dir,A),events=[];let submits=0;
 const c={mode,executionEnabled:mode!=='preview',dailyLimit:5,intervalSeconds:120,previewTtlSeconds:120};
 const deps={now:()=>now,expectedWallet:A,wallet:()=>({wallet:A,agentId:'another.ai'}),scan:()=>({totalTableRows:2,candidates:[B,C].map(address=>({address,standardOnSite:'ERC-721'}))}),standard:()=> 'ERC-721',source:()=>({abi,name:'Test'}),simulate:()=>({ok:true}),preview:raw,execute:()=>{submits++;return {data:{status:'BROADCASTED',txHash:HASH}};},executionOptIn:()=>true,receipt:()=>null,walletHistory:()=>[],log:(event,data)=>events.push({event,...data})};
 const engine=new Engine(c,store,deps);
 return {engine,store,deps,c,events,submits:()=>submits,dir};
}
test('source diagnostics distinguish bad key, rate limit and unverified',()=>{
 assert.throws(()=>classifySource({status:'0',result:'Invalid API Key (#err2)'}),/API_KEY_INVALID/);
 assert.throws(()=>classifySource({status:'0',result:'Max rate limit reached'}),/API_RATE_LIMIT/);
 assert.throws(()=>classifySource({status:'1',result:[{SourceCode:'',ABI:'Contract source code not verified'}]}),/SOURCE_UNVERIFIED/);
});
test('transient source errors retry, invalid keys do not',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return {ok:true,json:async()=>({status:'0',result:'Invalid API Key'})};};
 await assert.rejects(()=>sourceInfo(B,{fetcher,key:'test',wait:async()=>{},fallback:false}),/API_KEY_INVALID/);assert.equal(calls,1);
 calls=0;await assert.rejects(()=>sourceInfo(B,{fetcher:async()=>{calls++;return {ok:false,status:503};},key:'test',wait:async()=>{},fallback:false}),/API_TRANSIENT/);assert.equal(calls,3);
});
test('payable zero-value mint and known recipient/quantity arguments supported',()=>{
 assert.equal(mintPlans(abi,A)[0].signature,'mint()');
 const fn={...abi[0],inputs:[{type:'address',name:'recipient'},{type:'uint256',name:'quantity'}]};
 assert.equal(mintPlans([fn],A).length,1);
 assert.equal(mintPlans([{...abi[0],inputs:[{type:'uint256',name:'qty'}]}],A)[0].signature,'mint(uint256)');
 assert.equal(mintPlans([{...fn,inputs:[{type:'uint256',name:'tokenId'}]}],A).length,0);
 assert.equal(mintPlans([{...fn,name:'ownerMintDev'}],A).length,0);
});
test('expiry seconds, milliseconds and ISO are normalized, stale/invalid blocked',()=>{
 for(const x of [(now+60000)/1000,now+60000,new Date(now+60000).toISOString()])assert.equal(expiryMs(x,now,120),now+60000);
 assert.throws(()=>expiryMs('bad',now,120));
 assert.throws(()=>expiryMs(now-1,now,120));
});
test('preview sender, target, chain, calldata, native spend and balance changes checked',()=>{
 const target={wallet:A,contract:B,inputData:'0x1234'};
 for(const [key,value]of Object.entries({from:C,to:C,chainId:1,inputData:'0xabcd',value:'1'})){
  const r=raw(target);r.data.parsedTx[key]=value;assert.throws(()=>validatePreview(r,target,now));
 }
 const r=raw(target);r.data.simulationResult.balanceChanges=[{amount:'1'}];assert.throws(()=>validatePreview(r,target,now),/BALANCE/);
});
test('any claimed Agent ID can use its own connected BSC wallet',()=>{
 const call=args=>({data:({'wallet status':{status:'CONNECTED'},'wallet agent-id':{claimed:true,agentId:'someone-else.ai'},'wallet address':[{binanceChainId:'56',address:A}],'wallet settings':{devMode:{enabled:true}}})[args.join(' ')]});
 assert.equal(getWalletState({call}).agentId,'someone-else.ai');
});
test('state isolates wallets and preserves atomic runner locking',async t=>{
 const f=await fixture(t);await f.store.write('history',[{test:1}]);
 assert.deepEqual(await new Store(f.dir,B).read('history',[]),[]);
 await f.store.lock(async()=>assert.rejects(()=>f.store.lock(async()=>{}),/locked/));
});
test('preview scans all candidates and never submits',async t=>{
 const f=await fixture(t);await f.engine.cycle();
 assert.equal(f.events.filter(x=>x.event==='PREVIEW_READY').length,2);assert.equal(f.submits(),0);
});
test('auto reserves before execute, never duplicates pending submissions',async t=>{
 const f=await fixture(t,'auto');const original=f.deps.execute;
 f.deps.execute=async()=>{assert.equal((await f.store.read('history',[]))[0].status,'SUBMITTING');return original();};
 await f.engine.cycle();await f.engine.cycle();
 assert.equal(f.submits(),1);assert.equal((await f.store.read('history',[]))[0].status,'BROADCASTED');
});
test('ambiguous timeout persists across restart and blocks retry',async t=>{
 const f=await fixture(t,'auto');f.deps.execute=()=>{throw new Error('timeout');};
 await f.engine.cycle();assert.equal((await f.store.read('history',[]))[0].status,'UNKNOWN_SUBMISSION');
 f.deps.execute=()=>{throw new Error('must never reach');};await f.engine.cycle();
 assert.ok(f.events.some(x=>x.event==='PAUSED_UNRESOLVED_TX'));
});

test('explicit quarantine skips only its collection and allows unrelated mints across restarts',async t=>{
 const f=await fixture(t,'auto');f.c.maxMint=true;f.c.dailyLimit=null;
 const unknown={id:'unknown',wallet:A,contract:B,requestId:'old',expiresAt:now-1,status:'UNKNOWN_SUBMISSION',day:'2026-11-01',valueWei:'100',budget:{upperEstimateWei:'10'}};
 const q=quarantineUnknown(unknown,{wallet:A,accepted:true,pendingTransactions:[],latestNonce:1,pendingNonce:1,now});
 await f.store.write('history',[q]);await f.engine.cycle();
 let h=await f.store.read('history',[]);assert.equal(h[0].status,'UNKNOWN_SUBMISSION');assert.equal(h[1].contract,C);assert.equal(f.submits(),1);
 f.deps.receipt=()=>({confirmed:true,actualGasWei:'10'});f.deps.preparePlan=async p=>({...p,quantity:'1',valueWei:'0',budget:{upperEstimateWei:'10'}});
 const restarted=new Engine(f.c,f.store,f.deps);await restarted.cycle();
 h=await f.store.read('history',[]);assert.equal(h.filter(x=>x.contract===B).length,1);assert.equal(f.submits(),2);
});

test('quarantined collection stays blocked after a later receipt and other uncertainty still pauses',async t=>{
 const f=await fixture(t,'auto');f.c.maxMint=true;
 const q=quarantineUnknown({id:'unknown',wallet:A,contract:B,requestId:'old',expiresAt:now-1,status:'UNKNOWN_SUBMISSION'}, {wallet:A,accepted:true,pendingTransactions:[],latestNonce:1,pendingNonce:1,now});
 q.txHash=HASH;f.deps.receipt=()=>({confirmed:true});await f.store.write('history',[q]);await f.engine.cycle();
 const h=await f.store.read('history',[]);assert.equal(h[0].status,'CONFIRMED');assert.equal(h[1].contract,C);assert.equal(f.submits(),1);
 const g=await fixture(t,'auto');await g.store.write('history',[q,{id:'other',wallet:A,contract:C,status:'UNKNOWN_SUBMISSION'}]);await g.engine.cycle();assert.equal(g.submits(),0);assert.ok(g.events.some(x=>x.event==='PAUSED_UNRESOLVED_TX'));
 const k=await fixture(t,'auto');await k.store.write('history',[{...q,status:'NEEDS_REVIEW',txHash:HASH}]);k.deps.receipt=()=>({confirmed:false,failed:false});await k.engine.cycle();assert.equal(k.submits(),0);assert.ok(k.events.some(x=>x.event==='PAUSED_UNRESOLVED_TX'));
});
test('confirmed receipt unblocks next collection without reminting first',async t=>{
 const f=await fixture(t,'auto');await f.engine.cycle();
 f.deps.receipt=()=>({confirmed:true});await f.store.write('seen',{});
 await f.engine.cycle();assert.equal(f.submits(),2);
 const h=await f.store.read('history',[]);assert.equal(h[0].status,'CONFIRMED');assert.equal(h[1].contract,C);
});
test('app mode skips direct broadcast, auto requires opt-in, preview never executes',async t=>{
 const f=await fixture(t,'app');await f.engine.cycle();assert.equal(f.submits(),0);
 f.c.mode='auto';f.deps.executionOptIn=()=>false;await f.store.write('seen',{});await f.engine.cycle();assert.equal(f.submits(),0);
});
test('wallet switch before send, expired preview and daily cap block execution',async t=>{
 const f=await fixture(t,'auto');let calls=0;
 f.deps.wallet=()=>({wallet:++calls===1?A:C,agentId:'another.ai'});await f.engine.cycle();assert.equal(f.submits(),0);
 const g=await fixture(t,'auto');g.deps.preview=x=>{const r=raw(x);r.data.expiresAt=now-1;return r;};await g.engine.cycle();assert.equal(g.submits(),0);
 const h=await fixture(t,'auto');h.c.dailyLimit=1;await h.store.write('history',[{day:'2026-11-01',status:'FAILED',contract:B}]);await h.engine.cycle();assert.equal(h.submits(),0);
});
test('multiple simulating methods never guessed and simulation failure never submits',async t=>{
 const f=await fixture(t,'auto');f.deps.source=()=>({abi:[...abi,{...abi[0],name:'freeMint'}]});await f.engine.cycle();assert.equal(f.submits(),0);assert.ok(f.events.some(x=>x.reason==='AMBIGUOUS_MINT_METHODS'));
 const g=await fixture(t,'auto');g.deps.simulate=()=>{throw new Error('sold out');};await g.engine.cycle();assert.equal(g.submits(),0);
});
test('history association requires exact order ID',async t=>{
 const f=await fixture(t);await f.store.write('history',[{id:'pending',status:'PENDING_CONFIRMATION',orderId:'ours'}]);
 f.deps.walletHistory=()=>[{orderId:'other',txHash:HASH}];await f.engine.cycle();assert.equal((await f.store.read('history',[]))[0].txHash,undefined);
});
test('paid plan persists exact value and quantity before wallet execution',async t=>{
 const f=await fixture(t,'auto');
 f.deps.preparePlan=async p=>({...p,quantity:'1',valueWei:'1000',budget:{upperEstimateWei:'100'},pricing:{usdLimit:5}});
 f.deps.preview=target=>{
  const r=raw(target);r.data.parsedTx.value=target.valueWei;
  r.data.simulationResult.balanceChanges.push({contractAddress:'0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',owner:A,tokenType:'Native',change:'-1000',tokenId:null});
  return r;
 };
 f.deps.recheckPlan=async()=>({upperEstimateWei:'120'});
 await f.engine.cycle();
 const record=(await f.store.read('history',[]))[0];
 assert.equal(f.submits(),1);assert.equal(record.valueWei,'1000');assert.equal(record.quantity,'1');assert.equal(record.finalBudget.upperEstimateWei,'120');
});
test('paid price change before submission creates no reservation or spend',async t=>{
 const f=await fixture(t,'auto');
 f.deps.recheckPlan=async()=>{throw new Error('PAID_USD_BUDGET_CHANGED');};
 await f.engine.cycle();
 assert.equal(f.submits(),0);assert.deepEqual(await f.store.read('history',[]),[]);
});
test('max mode intentionally repeats fixed lots only after confirmation and tracks collection spend',async t=>{
 const f=await fixture(t,'auto');f.c.maxMint=true;f.c.dailyLimit=null;f.c.maxMintCallsPerCollection=3;
 const spent=[];f.deps.preparePlan=async(p,s,c,w,context)=>{spent.push(context.spentWei);return {...p,quantity:'1',valueWei:'0',budget:{upperEstimateWei:'100'}};};
 f.deps.receipt=()=>({confirmed:true,actualGasWei:'100',mintedAmount:'10'});
 for(let i=0;i<6;i++)await f.engine.cycle();
 const h=await f.store.read('history',[]);
 assert.equal(h.filter(r=>r.contract===B).length,3);assert.equal(h.filter(r=>r.contract===C).length,3);assert.equal(h[1].contract,C);assert.deepEqual(spent,['0','0','100','100','200','200']);
});
test('max mode chooses actual simulated token gain across supported methods',async t=>{
 const f=await fixture(t,'auto');f.c.maxMint=true;
 f.deps.source=()=>({abi:[...abi,{...abi[0],name:'freeMint'}]});
 f.deps.standard=()=> 'ERC-20';f.deps.scan=()=>({totalTableRows:1,candidates:[{address:B,standardOnSite:'ERC-20'}]});
 f.deps.preparePlan=async p=>({...p,quantity:'1',valueWei:'0',budget:{upperEstimateWei:'100'}});
 f.deps.preview=target=>{const r=raw(target);r.data.simulationResult.balanceChanges=[{tokenType:'Erc20',contractAddress:B,owner:A,change:target.inputData==='0x1249c58b'?10:6}];return r;};
 await f.engine.cycle();const r=(await f.store.read('history',[]))[0];assert.equal(r.method,'mint()');assert.equal(r.expectedGain,10);assert.equal(r.quantity,'1');
});
test('max mode still blocks uncertain submissions rather than retrying a fixed lot',async t=>{
 const f=await fixture(t,'auto');f.c.maxMint=true;f.c.dailyLimit=null;
 let calls=0;f.deps.execute=()=>{calls++;throw new Error('timeout');};
 await f.engine.cycle();await f.engine.cycle();assert.equal(calls,1);
});
test('stop requested during preparation prevents starting any wallet execution',async t=>{
 const f=await fixture(t,'auto');let stop=false;f.deps.shouldStop=()=>stop;
 f.deps.preparePlan=async p=>{stop=true;return {...p,quantity:'1',valueWei:'0',budget:{upperEstimateWei:'100'}};};
 await f.engine.cycle();assert.equal(f.submits(),0);assert.deepEqual(await f.store.read('history',[]),[]);
});
test('watcher lifetime lease blocks duplicate watchers but permits cycle locks',async t=>{
 const f=await fixture(t);await f.store.lock(async()=>{
  await assert.rejects(()=>f.store.lock(async()=>{},'watch'),/watch.lock/);
  await f.store.lock(async()=>{});
 },'watch');
});
