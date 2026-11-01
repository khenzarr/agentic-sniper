import {randomUUID} from 'node:crypto';
import {todayTR,committedToday} from './policy.mjs';
import {mintPlans} from './source.mjs';
import {validatePreview} from './preview.mjs';
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
        this.log('RECEIPT_CHECKED',{id:r.id,status:r.status,txHash:r.txHash});
      }catch(e){this.log('RECEIPT_PENDING',{id:r.id,reason:safeError(e)});}
    }
    await this.store.write('history',history);
  }
  async cycle(){
    return this.store.lock(async()=>{
      const wallet=await this.d.wallet({requireDevMode:true});
      if(wallet.wallet.toLowerCase()!==this.d.expectedWallet.toLowerCase())throw new Error('Wallet changed; stop and restart for new account');
      const history=await this.store.read('history',[]);
      await this.reconcile(history);
      if(history.some(x=>unresolved.has(x.status))){this.log('PAUSED_UNRESOLVED_TX');return;}
      if(committedToday(history,new Date(this.now()))>=this.c.dailyLimit){this.log('DAILY_LIMIT_REACHED');return;}
      const radar=await this.d.scan(this.c.sourceUrl);
      this.log('RADAR_SCANNED',{rows:radar.totalTableRows,candidates:radar.candidates.length});
      const seen=await this.store.read('seen',{});
      for(const candidate of radar.candidates){
        const contract=candidate.address.toLowerCase();
        if(history.some(x=>x.contract===contract))continue;
        const prev=seen[contract];
        if(prev&&this.now()-prev.at<this.c.intervalSeconds*1000)continue;
        seen[contract]={at:this.now()};await this.store.write('seen',seen);
        try{
          const standard=await this.d.standard(contract);
          if(standard!==candidate.standardOnSite)throw new Error('NFT interface mismatch');
          const source=await this.d.source(contract);
          const plans=mintPlans(source.abi,wallet.wallet);
          if(!plans.length)throw new Error('NO_SUPPORTED_MINT_METHOD');
          const viable=[];
          for(const plan of plans){
            try{const budget=await this.d.simulate(wallet.wallet,contract,plan.inputData,this.c);viable.push({...plan,budget});}catch(e){this.log('METHOD_UNAVAILABLE',{contract,method:plan.signature,reason:safeError(e)});}
          }
          if(viable.length!==1)throw new Error(viable.length?'AMBIGUOUS_MINT_METHODS':'NO_SIMULATED_FREE_MINT');
          const plan=viable[0],target={wallet:wallet.wallet,contract,inputData:plan.inputData,standard};
          const raw=await this.d.preview(target);
          const preview=validatePreview(raw,target,this.now(),this.c.previewTtlSeconds);
          const item={id:randomUUID(),at:new Date(this.now()).toISOString(),day:todayTR(new Date(this.now())),wallet:wallet.wallet,agentId:wallet.agentId,contract,standard,method:plan.signature,inputData:plan.inputData,sourceName:source.name,budget:plan.budget,requestId:preview.requestId,expiresAt:preview.expiresAt,requireAppConfirmation:preview.requireAppConfirmation,status:'PREVIEWED'};
          await this.store.write('preview-'+item.id,item);
          this.log('PREVIEW_READY',{...item,simulation:{parsedTx:preview.parsedTx,balanceChanges:preview.balanceChanges}});
          if(this.c.mode==='preview')continue; // scan every eligible collection, not just the first
          if(this.c.executionEnabled!==true||!this.d.executionOptIn())throw new Error('Execution disabled');
          if(this.c.mode==='app'&&!preview.requireAppConfirmation){this.log('MANUAL_APPROVAL_REQUIRED',{id:item.id});continue;}
          const fresh=await this.d.wallet({requireDevMode:true});
          if(fresh.wallet.toLowerCase()!==wallet.wallet.toLowerCase()||fresh.agentId!==wallet.agentId)throw new Error('Wallet identity changed before submission');
          await this.d.simulate(wallet.wallet,contract,plan.inputData,this.c);
          if(this.now()>=preview.expiresAt)throw new Error('Preview expired before submission');
          item.status='SUBMITTING';history.push(item);
          await this.store.write('history',history); // durable reservation before touching wallet
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
          return; // wait for reconciliation before sending another
        }catch(e){this.log('CANDIDATE_SKIPPED',{contract,reason:safeError(e)});}
      }
    });
  }
}
