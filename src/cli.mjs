import {setTimeout as sleep} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {ROOT,loadConfig} from './config.mjs';
import {Store} from './store.mjs';
import {Engine,safeError} from './engine.mjs';
import {baw,getWalletState,previewMint,executeMint,walletHistory} from './baw.mjs';
import {scrapeRadar} from './radar.mjs';
import {newClient,nftStandard,simulate,verifyMintReceipt} from './chain.mjs';
import {sourceInfo,mintPlans} from './source.mjs';
import {bnbUsd,nativeUnitPrice} from './pricing.mjs';
import {choosePlan,recheckPlan,collectionSpentWei} from './planner.mjs';
import {resolveMintSource,quantityCeiling} from './degen.mjs';
import {keccak256} from 'viem';
import {quarantineUnknown} from './recovery.mjs';
export async function main(args=process.argv.slice(2)){
  const c=await loadConfig(),command=args[0]||'help';
  if(command==='help'){console.log('Commands: login [--qr ID] | doctor | scan | audit | once | watch | stop [--wallet ADDRESS] | history | reconcile | attach --id ID --tx HASH | quarantine --id ID --accept-unknown-outcome');return;}
  if(command==='login'){
    // The CLI owns its OS-local credentials. Login data is shown only in this terminal.
    const i=args.indexOf('--qr');
    const result=i>=0?baw(['auth','verify','--qrCodeId',args[i+1]]):baw(['auth','signin']);
    console.log(JSON.stringify(result,null,2));return;
  }
  if(command==='scan'){
    const radar=await scrapeRadar(c.sourceUrl);
    console.log(JSON.stringify(radar,null,2));return;
  }
  if(command==='stop'){
    const i=args.indexOf('--wallet'),address=i>=0?args[i+1]:getWalletState().wallet;
    const store=new Store(ROOT,address),session=await store.read('watch-session',null);
    if(!session||session.status!=='running')throw new Error('No active watcher recorded for this wallet');
    await store.write('stop-request',{id:session.id,at:new Date().toISOString()});
    console.log(JSON.stringify({event:'STOP_REQUESTED',pid:session.pid}));return;
  }
  const wallet=getWalletState(),client=newClient(),store=new Store(ROOT,wallet.wallet);
  if(await client.getChainId()!==56)throw new Error('RPC is not BSC');
  if(command==='doctor'){
    console.log(JSON.stringify({...wallet,chainId:56,mode:c.mode,executionEnabled:c.executionEnabled===true&&process.env.ENABLE_EXECUTE==='YES_I_UNDERSTAND'&&c.mode!=='preview',dailyLimit:c.dailyLimit,maxMint:c.maxMint,degenMode:c.degenMode,maxMintCallsPerCollection:c.maxMintCallsPerCollection,maxGasWei:c.maxGasWei,paidEnabled:c.paidEnabled,paidMintUsdLimit:c.paidMintUsdLimit,usdSafetyMarginPercent:c.usdSafetyMarginPercent,maxBatchQuantity:c.maxBatchQuantity,sourceApiConfigured:Boolean(process.env.ETHERSCAN_API_KEY),stateDirectory:store.dir},null,2));return;
  }
  if(command==='history'){console.log(JSON.stringify(await store.read('history',[]),null,2));return;}
  const deps={
    expectedWallet:wallet.wallet,wallet:getWalletState,scan:scrapeRadar,
    standard:address=>nftStandard(client,address),source:address=>resolveMintSource(client,address,c,wallet.wallet),
    simulate:(from,to,data,config,value='0')=>simulate(client,from,to,data,config,value),
    preparePlan:async(plan,source,contract,from,context={})=>{
      const limits=await quantityCeiling(client,contract,source,plan,context.standard||await nftStandard(client,contract),c);
      return {...await choosePlan({...plan,tokenDecimals:limits.tokenDecimals},{config:c,maxQuantity:limits.cap,spentWei:context.spentWei||'0',simulate:(data,value)=>simulate(client,from,contract,data,c,value),unitPrice:()=>nativeUnitPrice(client,contract,source.abi),price:()=>bnbUsd(client)}),codeHash:source.codeHash};
    },
    recheckPlan:async(plan,contract,from)=>{
      if(plan.codeHash&&keccak256(await client.getBytecode({address:contract}))!==plan.codeHash)throw new Error('RUNTIME_BYTECODE_CHANGED');
      return recheckPlan(plan,{config:c,simulate:(data,value)=>simulate(client,from,contract,data,c,value),price:()=>bnbUsd(client)});
    },
    preview:previewMint,execute:executeMint,walletHistory,
    executionOptIn:()=>process.env.ENABLE_EXECUTE==='YES_I_UNDERSTAND',
    receipt:async r=>{
      try{
        const receipt=await client.getTransactionReceipt({hash:r.txHash});
        const height=await client.getBlockNumber();
        if(height-receipt.blockNumber<2n)return null; // three confirmations
        const tx=await client.getTransaction({hash:r.txHash});
        if(tx.from.toLowerCase()!==r.wallet.toLowerCase()||tx.to?.toLowerCase()!==r.contract||tx.value!==BigInt(r.valueWei||'0')||tx.input.toLowerCase()!==r.inputData.toLowerCase())throw new Error('Transaction does not match reserved mint');
        return verifyMintReceipt(client,{txHash:r.txHash,contract:r.contract,standard:r.standard,wallet:r.wallet,quantity:r.expectedMintUnits||r.quantity||'1'});
      }catch(e){if(e.name==='TransactionReceiptNotFoundError')return null;throw e;}
    }
  };
  const engine=new Engine(c,store,deps);
  if(command==='quarantine'){
    const index=args.indexOf('--id'),id=index>=0?args[index+1]:null;
    if(!id||!args.includes('--accept-unknown-outcome'))throw new Error('quarantine requires --id ID --accept-unknown-outcome; the outcome stays unknown and this collection stays blocked');
    // Holding both leases prevents a running or newly started watcher from racing this manual recovery.
    await store.lock(()=>store.lock(async()=>{
      const history=await store.read('history',[]);
      await engine.reconcile(history);
      const position=history.findIndex(r=>r.id===id),record=history[position];
      const pending=baw(['wallet','tx-history','--binanceChainId','56','--type','pending','--size','100']).data;
      if(pending?.hasMore!==false)throw new Error('Wallet pending history is incomplete');
      const [latestNonce,pendingNonce]=await Promise.all([client.getTransactionCount({address:wallet.wallet,blockTag:'latest'}),client.getTransactionCount({address:wallet.wallet,blockTag:'pending'})]);
      const updated=quarantineUnknown(record,{wallet:wallet.wallet,accepted:true,pendingTransactions:pending.transactions,latestNonce,pendingNonce});
      const backup='history-backup-quarantine-'+randomUUID();
      await store.write(backup,history);
      history[position]=updated;await store.write('history',history);
      console.log(JSON.stringify({event:'COLLECTION_QUARANTINED',id,contract:record.contract,status:updated.status,backup,warning:'Outcome remains unknown; do not retry this collection'}));
    }),'watch');return;
  }
  if(command==='audit'){
    const radar=await scrapeRadar(c.sourceUrl);
    for(const x of radar.candidates){
      try{const standard=await deps.standard(x.address);const s=await deps.source(x.address);const plans=mintPlans(s.abi,wallet.wallet);
        const spentWei=c.maxMint?collectionSpentWei(await store.read('history',[]),x.address):'0';
        const methods=[];for(const p of plans){try{const result=await deps.preparePlan(p,s,x.address,wallet.wallet,{standard,spentWei});methods.push({method:p.signature,valueWei:result.valueWei,requestedQuantity:result.quantity,budget:result.budget,pricing:result.pricing});}catch(e){methods.push({method:p.signature,error:safeError(e)});}}
        console.log(JSON.stringify({contract:x.address,standard,sourceName:s.name,sourceProvider:s.provider,sourceVerified:s.sourceVerified,sourcePrimaryReason:s.primaryReason,methods}));
      }catch(e){console.log(JSON.stringify({contract:x.address,error:safeError(e)}));}
    }return;
  }
  if(command==='reconcile'){await store.lock(async()=>engine.reconcile(await store.read('history',[])));return;}
  if(command==='attach'){
    const id=args[args.indexOf('--id')+1],tx=args[args.indexOf('--tx')+1];
    if(!args.includes('--id')||!args.includes('--tx')||!/^0x[0-9a-fA-F]{64}$/.test(tx||''))throw new Error('attach requires --id ID --tx HASH');
    await store.lock(async()=>{
      const history=await store.read('history',[]),r=history.find(x=>x.id===id);
      if(!r||!['SUBMITTING','UNKNOWN_SUBMISSION','PENDING_CONFIRMATION'].includes(r.status))throw new Error('Record cannot be attached');
      const actual=await client.getTransaction({hash:tx});
      if(actual.from.toLowerCase()!==wallet.wallet||actual.to?.toLowerCase()!==r.contract||actual.value!==BigInt(r.valueWei||'0')||actual.input.toLowerCase()!==r.inputData.toLowerCase())throw new Error('Hash is not the reserved mint');
      r.txHash=tx;r.status='BROADCASTED';await store.write('history',history);
    });return;
  }
  if(command==='once'){await engine.cycle();return;}
  if(command==='watch'){
    return store.lock(async()=>{
    let stop=false;const controller=new AbortController();
    const halt=()=>{stop=true;controller.abort();};
    deps.shouldStop=()=>stop;
    const session={id:randomUUID(),pid:process.pid,status:'running',at:new Date().toISOString()};
    await store.write('watch-session',session);
    const controls=setInterval(()=>{store.read('stop-request',null).then(r=>{if(r?.id===session.id)halt();}).catch(()=>{});},1000);
    controls.unref();
    process.once('SIGINT',halt);process.once('SIGTERM',halt);
    const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
    console.log(JSON.stringify({event:'STARTED',version,...wallet,mode:c.mode,maxMint:c.maxMint,degenMode:c.degenMode,dailyLimit:c.dailyLimit,intervalSeconds:c.intervalSeconds}));
    try{while(!stop){let result;try{result=await engine.cycle();}catch(e){console.error(safeError(e));}if(!stop)await sleep((result?.pending?c.pendingPollSeconds:c.intervalSeconds)*1000,undefined,{signal:controller.signal}).catch(()=>{});}}
    finally{clearInterval(controls);await store.write('watch-session',{...session,status:'stopped',stoppedAt:new Date().toISOString()});process.removeListener('SIGINT',halt);process.removeListener('SIGTERM',halt);}
    return;
    },'watch');
  }
  throw new Error('Unknown command: '+command);
}
