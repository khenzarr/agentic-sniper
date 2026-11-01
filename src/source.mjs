import { encodeFunctionData } from 'viem';
import { isAddress } from './policy.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function classifySource(json) {
  if(json?.status!=='1'||!Array.isArray(json.result)||json.result.length!==1) {
    const msg=typeof json?.result==='string'?json.result:'Unexpected source API response';
    const code=/invalid.*key|missing.*key/i.test(msg)?'API_KEY_INVALID':/limit|busy|temporar/i.test(msg)?'API_RATE_LIMIT':'API_ERROR';
    throw Object.assign(new Error(code),{code});
  }
  const s=json.result[0];
  if(!s.SourceCode?.trim()||!s.ABI?.startsWith('['))throw Object.assign(new Error('SOURCE_UNVERIFIED'),{code:'SOURCE_UNVERIFIED'});
  if(s.Proxy==='1'||isAddress(s.Implementation)&&!/^0x0{40}$/i.test(s.Implementation))throw new Error('PROXY_REQUIRES_REVIEW');
  let abi;try{abi=JSON.parse(s.ABI);}catch{throw new Error('ABI_INVALID');}
  if(!Array.isArray(abi))throw new Error('ABI_INVALID');
  return {abi,name:s.ContractName||null};
}
export async function sourceInfo(address,{fetcher=fetch,key=process.env.ETHERSCAN_API_KEY,wait=sleep}={}) {
  if(!isAddress(address))throw new Error('Invalid contract');
  if(!key)throw new Error('ETHERSCAN_API_KEY_MISSING');
  const url=new URL('https://api.etherscan.io/v2/api');
  for(const [k,v]of Object.entries({chainid:'56',module:'contract',action:'getsourcecode',address,apikey:key}))url.searchParams.set(k,v);
  for(let attempt=0;attempt<3;attempt++){
    try{
      const res=await fetcher(url,{signal:AbortSignal.timeout(12000)});
      if(!res.ok)throw Object.assign(new Error(res.status===429||res.status>=500?'API_TRANSIENT':'API_HTTP_ERROR'),{code:res.status===429||res.status>=500?'API_TRANSIENT':'API_HTTP_ERROR'});
      return classifySource(await res.json());
    }catch(e){
      if(['API_KEY_INVALID','SOURCE_UNVERIFIED','API_ERROR','API_HTTP_ERROR'].includes(e.code)||/PROXY|ABI_INVALID/.test(e.message))throw e;
      if(attempt===2)throw new Error(e.code||'SOURCE_NETWORK_ERROR');
      await wait(500*2**attempt);
    }
  }
}
const names=new Set(['mint','publicMint','freeMint','claim']);
export function mintPlans(abi,wallet) {
  if(!isAddress(wallet))throw new Error('Invalid mint wallet');
  const plans=[];
  for(const f of abi){
    if(f.type!=='function'||!names.has(f.name)||!['payable','nonpayable'].includes(f.stateMutability)||!Array.isArray(f.inputs))continue;
    const args=[];let valid=true,quantityIndex=-1;
    for(const a of f.inputs){
      if(a.type==='address'&&/^(to|recipient|receiver|account|_to|_recipient|_receiver)$/i.test(a.name||''))args.push(wallet);
      else if(/^uint(256|32|64|128)?$/.test(a.type)&&/^_?(quantity|qty|amount|count|numTokens|numberOfTokens)$/i.test(a.name||'')){if(quantityIndex!==-1){valid=false;break;}quantityIndex=args.length;args.push(1n);}
      else{valid=false;break;}
    }
    if(!valid||f.inputs.length>2)continue;
    const signature=f.name+'('+f.inputs.map(a=>a.type).join(',')+')';
    const encode=quantity=>{const values=[...args];if(quantityIndex>=0)values[quantityIndex]=BigInt(quantity);return encodeFunctionData({abi:[f],functionName:f.name,args:values});};
    plans.push({signature,inputData:encode(1n),mutability:f.stateMutability,quantityIndex,encode});
  }
  return plans;
}
