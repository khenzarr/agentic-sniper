import { execFileSync } from 'node:child_process';
import { isAddress } from './policy.mjs';
export function baw(args) {
  const argv=[...args,'--json'];
  if(argv.some(a=>typeof a!=='string'||! /^[a-zA-Z0-9_.:-]+$/.test(a)))throw new Error('Unsafe BAW argument blocked');
  let output;
  try{
    output=process.platform==='win32'
      ?execFileSync('cmd.exe',['/d','/s','/c','baw '+argv.join(' ')],{encoding:'utf8',timeout:60000,windowsHide:true,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']})
      :execFileSync('baw',argv,{encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});
  }catch(e){
    if(e.stdout){try{const x=JSON.parse(String(e.stdout));throw new Error('BAW '+(x.error?.name||'ERROR'));}catch(p){if(p.message.startsWith('BAW '))throw p;}}
    throw new Error(e.code==='ENOENT'?'BAW CLI not installed or not on PATH':'BAW command failed or timed out; submission may be uncertain');
  }
  let obj;try{obj=JSON.parse(output.trim());}catch{throw new Error('BAW returned invalid JSON');}
  if(obj.success!==true)throw new Error('BAW '+(obj.error?.name||'ERROR'));
  return obj;
}
export function getWalletState({requireDevMode=false,call=baw}={}) {
  if(call(['wallet','status']).data.status!=='CONNECTED')throw new Error('Wallet not connected; run npm run login');
  const agent=call(['wallet','agent-id']).data;
  if(agent.claimed!==true||typeof agent.agentId!=='string')throw new Error('Connected wallet needs a claimed Agent ID');
  const addresses=call(['wallet','address']).data;
  const entries=Array.isArray(addresses)?addresses:(addresses.addresses??addresses.list??[]);
  const bsc=entries.find(x=>String(x.binanceChainId)==='56');
  if(!bsc||!isAddress(bsc.address))throw new Error('No BSC wallet address');
  const settings=call(['wallet','settings']).data;
  if(requireDevMode){
    if(settings?.devMode?.enabled!==true)throw new Error('BAW Developer Mode is not active');
    if(settings.devMode.expiresAt&&new Date(settings.devMode.expiresAt).getTime()<=Date.now())throw new Error('BAW Developer Mode expired');
    if(call(['wallet','tx-lock','--binanceChainId','56']).data.status!=='UNLOCKED')throw new Error('BAW transaction lock active');
  }
  return {wallet:bsc.address.toLowerCase(),agentId:agent.agentId,devMode:settings?.devMode?.enabled===true};
}
export function previewMint({wallet,contract,inputData}) {
  return baw(['contract-call','preview','--binanceChainId','56','--from',wallet,'--to',contract,'--value','0','--inputData',inputData]);
}
export function executeMint(requestId){return baw(['contract-call','execute','--requestId',requestId]);}
export function walletHistory(){return baw(['wallet','tx-history','--binanceChainId','56','--size','100']).data;}
