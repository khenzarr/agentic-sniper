import {setTimeout as sleep} from 'node:timers/promises';
import {ROOT,loadConfig} from './config.mjs';
import {Store} from './store.mjs';
import {Engine,safeError} from './engine.mjs';
import {baw,getWalletState,previewMint,executeMint,walletHistory} from './baw.mjs';
import {scrapeRadar} from './radar.mjs';
import {newClient,nftStandard,simulate,verifyMintReceipt} from './chain.mjs';
import {sourceInfo,mintPlans} from './source.mjs';
export async function main(args=process.argv.slice(2)){
  const c=await loadConfig(),command=args[0]||'help';
  if(command==='help'){console.log('Commands: login [--qr ID] | doctor | scan | audit | once | watch | history | reconcile | attach --id ID --tx HASH');return;}
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
  const wallet=getWalletState(),client=newClient(),store=new Store(ROOT,wallet.wallet);
  if(await client.getChainId()!==56)throw new Error('RPC is not BSC');
  if(command==='doctor'){
    console.log(JSON.stringify({...wallet,chainId:56,mode:c.mode,executionEnabled:c.executionEnabled===true&&process.env.ENABLE_EXECUTE==='YES_I_UNDERSTAND'&&c.mode!=='preview',dailyLimit:c.dailyLimit,maxGasWei:c.maxGasWei,sourceApiConfigured:Boolean(process.env.ETHERSCAN_API_KEY),stateDirectory:store.dir},null,2));return;
  }
  if(command==='history'){console.log(JSON.stringify(await store.read('history',[]),null,2));return;}
  const deps={
    expectedWallet:wallet.wallet,wallet:getWalletState,scan:scrapeRadar,
    standard:address=>nftStandard(client,address),source:sourceInfo,
    simulate:(from,to,data,config)=>simulate(client,from,to,data,config),
    preview:previewMint,execute:executeMint,walletHistory,
    executionOptIn:()=>process.env.ENABLE_EXECUTE==='YES_I_UNDERSTAND',
    receipt:async r=>{
      try{
        const receipt=await client.getTransactionReceipt({hash:r.txHash});
        const height=await client.getBlockNumber();
        if(height-receipt.blockNumber<2n)return null; // three confirmations
        const tx=await client.getTransaction({hash:r.txHash});
        if(tx.from.toLowerCase()!==r.wallet.toLowerCase()||tx.to?.toLowerCase()!==r.contract||tx.value!==0n||tx.input.toLowerCase()!==r.inputData.toLowerCase())throw new Error('Transaction does not match reserved mint');
        return verifyMintReceipt(client,{txHash:r.txHash,contract:r.contract,standard:r.standard,wallet:r.wallet});
      }catch(e){if(e.name==='TransactionReceiptNotFoundError')return null;throw e;}
    }
  };
  const engine=new Engine(c,store,deps);
  if(command==='audit'){
    const radar=await scrapeRadar(c.sourceUrl);
    for(const x of radar.candidates){
      try{const standard=await deps.standard(x.address);const s=await sourceInfo(x.address);const plans=mintPlans(s.abi,wallet.wallet);
        const methods=[];for(const p of plans){try{methods.push({method:p.signature,valueWei:'0',budget:await deps.simulate(wallet.wallet,x.address,p.inputData,c)});}catch(e){methods.push({method:p.signature,error:safeError(e)});}}
        console.log(JSON.stringify({contract:x.address,standard,sourceName:s.name,methods}));
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
      if(actual.from.toLowerCase()!==wallet.wallet||actual.to?.toLowerCase()!==r.contract||actual.value!==0n||actual.input.toLowerCase()!==r.inputData.toLowerCase())throw new Error('Hash is not the reserved mint');
      r.txHash=tx;r.status='BROADCASTED';await store.write('history',history);
    });return;
  }
  if(command==='once'){await engine.cycle();return;}
  if(command==='watch'){
    let stop=false;const controller=new AbortController();
    const halt=()=>{stop=true;controller.abort();};
    process.once('SIGINT',halt);process.once('SIGTERM',halt);
    console.log(JSON.stringify({event:'STARTED',...wallet,mode:c.mode,intervalSeconds:c.intervalSeconds}));
    try{while(!stop){try{await engine.cycle();}catch(e){console.error(safeError(e));}if(!stop)await sleep(c.intervalSeconds*1000,undefined,{signal:controller.signal}).catch(()=>{});}}
    finally{process.removeListener('SIGINT',halt);process.removeListener('SIGTERM',halt);}
    return;
  }
  throw new Error('Unknown command: '+command);
}
