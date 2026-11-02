import {randomUUID} from 'node:crypto';
import {todayTR,committedToday} from './policy.mjs';
import {mintPlans} from './source.mjs';
import {validatePreview} from './preview.mjs';
import {collectionSpentWei} from './planner.mjs';
import {isQuarantined} from './recovery.mjs';
const unresolved=new Set(['SUBMITTING','PENDING_CONFIRMATION','BROADCASTED','UNKNOWN_SUBMISSION','NEEDS_REVIEW']);
export function safeError(e) {
  let s=String(e?.message||e).split('\n')[0];
  for(const k of ['ETHERSCAN_API_KEY','BSC_RPC_URL'])if(process.env[k])s=s.replaceAll(process.env[k],'[REDACTED]');
  return s.replace(/https?:\/\/[^\s]+/g,'[URL]').slice(0,250);
}
function listHistory(data){if(Array.isArray(data))return data;return data?.list??data?.rows??data?.transactions??[];}
export class Engine {
  constructor(config,store,deps){this.c=config;this.store=store;this.d=deps;this.now=deps.now||Date.now;this.log=deps.log||((event,fields={})=>console.log(JSON.stringify({at:new Date(this.now()).toISOString(),event,...fields})));}
  async reconcile(history) {
    for(const r of history.filter(x=>unresolved.has(x.status))){
      if(!r.txHash&&r.orderId){
        try{
          const items=listHistory(await this.d.walletHistory());
          const match=items.find(x=>String(x.orderId)===String(r.orderId));
          const hash=match?.txHash??match?.hash;
          if(/^0x[0-9a-fA-F]{64}$/.test(hash||''))r.txHash=hash;
          // Never match by time, amount or target: that can attach someone else's call.
        }catch(e){this.log('HISTORY_CHECK_FAILED',{reason:safeError(e)});}
      }
      if(!r.txHash)continue;
      try{
        const outcome=await this.d.receipt(r);
        if(outcome===null)continue;
        r.receipt=outcome;
        r.status=outcome.confirmed?'CONFIRMED':outcome.failed?'FAILED':'NEEDS_REVIEW';
        this.log('RECEIPT_CHECKED',{id:r.id,status:r.status,txHash:r.txHash,mintedUnits:outcome.mintedUnits,mintedAmount:outcome.mintedAmount});
        if(outcome.confirmed&&this.c.maxMint){const seen=await this.store.read('seen',{});delete seen[r.contract];await this.store.write('seen',seen);}
      }catch(e){this.log('RECEIPT_PENDING',{id:r.id,reason:safeError(e)});}
    }
    await this.store.write('history',history);
  }
  async cycle(){
    return this.store.lock(async()=>{
      if(this.d.shouldStop?.())return;
      const wallet=await this.d.wallet({requireDevMode:true});
      if(wallet.wallet.toLowerCase()!==this.d.expectedWallet.toLowerCase())throw new Error('Wallet changed; stop and restart for new account');
      const history=await this.store.read('history',[]);
      await this.reconcile(history);
      if(history.some(x=>unresolved.has(x.status)&&!(x.status==='UNKNOWN_SUBMISSION'&&isQuarantined(x)))){this.log('PAUSED_UNRESOLVED_TX');return {pending:true};}
      if(this.c.dailyLimit!==null&&committedToday(history,new Date(this.now()))>=this.c.dailyLimit){this.log('DAILY_LIMIT_REACHED');return;}
      const radar=await this.d.scan(this.c.sourceUrl);
      this.log('RADAR_SCANNED',{rows:radar.totalTableRows,candidates:radar.candidates.length});
      const seen=await this.store.read('seen',{});
      const count=address=>history.filter(r=>r.contract===address.toLowerCase()).length;
      for(const candidate of [...radar.candidates].sort((a,b)=>Number(b.listedFree===true)-Number(a.listedFree===true)||(this.c.maxMint?count(a.address)-count(b.address):0))){
        if(this.d.shouldStop?.())return;
        const contract=candidate.address.toLowerCase();
        const previous=history.filter(x=>x.contract===contract);
        if(previous.some(isQuarantined))continue; // Never retry this collection, even if its old receipt later confirms.
        if(previous.length&&(!this.c.maxMint||previous.some(r=>r.status!=='CONFIRMED')||previous.length>=(this.c.maxMintCallsPerCollection||100)))continue;
        const prev=seen[contract];
        if(prev&&this.now()-prev.at<this.c.intervalSeconds*1000)continue;
        seen[contract]={at:this.now()};await this.store.write('seen',seen);
        try{
          const standard=await this.d.standard(contract);
          if(standard!==candidate.standardOnSite)throw new Error('Token interface mismatch');
          const source=await this.d.source(contract);
          const spentWei=this.c.maxMint?collectionSpentWei(history,contract):'0';
          const plans=mintPlans(source.abi,wallet.wallet);
          if(!plans.length)throw new Error('NO_SUPPORTED_MINT_METHOD');
          const viable=[];
          for(const plan of plans){
            try{if(this.d.preparePlan)viable.push(await this.d.preparePlan(plan,source,contract,wallet.wallet,{standard,spentWei}));
            else{const budget=await this.d.simulate(wallet.wallet,contract,plan.inputData,this.c);viable.push({...plan,budget,quantity:'1',valueWei:'0'});}}catch(e){this.log('METHOD_UNAVAILABLE',{contract,method:plan.signature,reason:safeError(e)});}
          }
          if(!viable.length||(!this.c.maxMint&&viable.length!==1))throw new Error(viable.length?'AMBIGUOUS_MINT_METHODS':'NO_SUPPORTED_MINT_WITHIN_BUDGET');
          const checked=[];
          for(const plan of viable){
            if(this.d.shouldStop?.())return;
            const target={wallet:wallet.wallet,contract,inputData:plan.inputData,standard,valueWei:plan.valueWei,quantity:plan.quantity,quantityMode:plan.quantityIndex<0?'fixed-lot':'parameter'};
            try{const preview=validatePreview(await this.d.preview(target),target,this.now(),this.c.previewTtlSeconds);checked.push({plan,preview});}
            catch(e){this.log('METHOD_PREVIEW_REJECTED',{contract,method:plan.signature,reason:safeError(e)});}
          }
          if(!checked.length)throw new Error('NO_VALID_MINT_PREVIEW');
          checked.sort((a,b)=>b.preview.expectedGain-a.preview.expectedGain||(BigInt(a.plan.valueWei)<BigInt(b.plan.valueWei)?-1:BigInt(a.plan.valueWei)>BigInt(b.plan.valueWei)?1:0));
          const {plan,preview}=checked[0];
          const item={id:randomUUID(),at:new Date(this.now()).toISOString(),day:todayTR(new Date(this.now())),wallet:wallet.wallet,agentId:wallet.agentId,contract,standard,method:plan.signature,inputData:plan.inputData,valueWei:plan.valueWei,quantity:plan.quantity,expectedGain:preview.expectedGain,expectedMintUnits:preview.expectedMintUnits,pricing:plan.pricing,sourceName:source.name,sourceProvider:source.provider,sourceVerified:source.sourceVerified,sourceCodeHash:plan.codeHash,sourcePrimaryReason:source.primaryReason,budget:plan.budget,requestId:preview.requestId,expiresAt:preview.expiresAt,requireAppConfirmation:preview.requireAppConfirmation,status:'PREVIEWED'};
          await this.store.write('preview-'+item.id,item);
          this.log('PREVIEW_READY',{...item,simulation:{parsedTx:preview.parsedTx,balanceChanges:preview.balanceChanges}});
          if(this.c.mode==='preview')continue; // scan every eligible collection, not just the first
          if(this.c.executionEnabled!==true||!this.d.executionOptIn())throw new Error('Execution disabled');
          if(this.c.mode==='app'&&!preview.requireAppConfirmation){this.log('MANUAL_APPROVAL_REQUIRED',{id:item.id});continue;}
          if(this.d.shouldStop?.())return;
          const fresh=await this.d.wallet({requireDevMode:true});
          if(fresh.wallet.toLowerCase()!==wallet.wallet.toLowerCase()||fresh.agentId!==wallet.agentId)throw new Error('Wallet identity changed before submission');
          if(this.d.recheckPlan)item.finalBudget=await this.d.recheckPlan(plan,contract,wallet.wallet);
          else await this.d.simulate(wallet.wallet,contract,plan.inputData,this.c);
          if(this.d.shouldStop?.())return;
          if(this.now()>=preview.expiresAt)throw new Error('Preview expired before submission');
          item.status='SUBMITTING';history.push(item);
          await this.store.write('history',history); // durable reservation before touching wallet
          if(this.d.shouldStop?.()){history.pop();await this.store.write('history',history);return;}
          try{
            const result=(await this.d.execute(preview.requestId)).data;
            item.orderId=result.orderId??null;item.txHash=result.txHash??null;
            item.status=['PENDING_CONFIRMATION','BROADCASTED'].includes(result.status)?result.status:item.txHash?'BROADCASTED':'UNKNOWN_SUBMISSION';
            await this.store.write('history',history);
            this.log('SUBMITTED',{id:item.id,status:item.status,txHash:item.txHash});
          }catch(e){
            item.status='UNKNOWN_SUBMISSION';await this.store.write('history',history);
            this.log('SUBMISSION_UNCERTAIN',{id:item.id,reason:safeError(e)});
          }
          return {pending:true}; // reconcile before intentional additional mints
        }catch(e){this.log('CANDIDATE_SKIPPED',{contract,reason:safeError(e)});}
      }
    });
  }
}
