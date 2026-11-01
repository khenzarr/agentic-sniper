import { encodeFunctionData } from 'viem';
import { isAddress } from './policy.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export function classifySource(json) {
  if(json?.status!=='1'||!Array.isArray(json.result)||json.result.length!==1) {
    const msg=typeof json?.result==='string'?json.result:'Unexpected source API response';
    const code=/too many invalid api key attempts/i.test(msg)?'API_IP_THROTTLED':/invalid.*key|missing.*key/i.test(msg)?'API_KEY_INVALID':/limit|busy|temporar/i.test(msg)?'API_RATE_LIMIT':'API_ERROR';
    throw Object.assign(new Error(code),{code});
  }
  const s=json.result[0];
  if(!s.SourceCode?.trim()||!s.ABI?.startsWith('['))throw Object.assign(new Error('SOURCE_UNVERIFIED'),{code:'SOURCE_UNVERIFIED'});
  if(s.Proxy==='1'||isAddress(s.Implementation)&&!/^0x0{40}$/i.test(s.Implementation))throw new Error('PROXY_REQUIRES_REVIEW');
  let abi;try{abi=JSON.parse(s.ABI);}catch{throw new Error('ABI_INVALID');}
  if(!Array.isArray(abi))throw new Error('ABI_INVALID');
  return {abi,name:s.ContractName||null};
}
const failure=code=>Object.assign(new Error(code),{code});
export function classifySourcify(json,address){
  if(String(json?.chainId)!=='56'||String(json?.address).toLowerCase()!==address.toLowerCase()||json.match!=='exact_match'||json.runtimeMatch!=='exact_match')throw failure('SOURCIFY_SOURCE_UNVERIFIED');
  if(json.proxyResolution?.isProxy!==false||!Array.isArray(json.proxyResolution.implementations)||json.proxyResolution.implementations.length)throw failure('PROXY_REQUIRES_REVIEW');
  if(!Array.isArray(json.abi)||!json.abi.length||!json.sources||!Object.values(json.sources).some(s=>typeof s?.content==='string'&&s.content.trim()))throw failure('SOURCIFY_SOURCE_UNVERIFIED');
  return {abi:json.abi,name:json.compilation?.name||null,provider:'sourcify'};
}
export function createSourceProvider({fetcher=fetch,key=()=>process.env.ETHERSCAN_API_KEY,wait=sleep,now=Date.now,intervalMs=1200,fallback=true}={}){
  let blockedUntil=0,nextRequestAt=0,previousKey,blockReason='API_COOLDOWN',queue=Promise.resolve();
  const request=fn=>{const run=queue.then(fn);queue=run.catch(()=>{});return run;};
  return async function(address){
    if(!isAddress(address))throw new Error('Invalid contract');
    const apiKey=typeof key==='function'?key():key;
    if(previousKey!==apiKey){previousKey=apiKey;blockedUntil=0;}
    let primaryError;
    try{
      if(!apiKey)throw failure('ETHERSCAN_API_KEY_MISSING');
      for(let attempt=0;attempt<3;attempt++){
        try{
          const result=await request(async()=>{
            if(now()<blockedUntil)throw failure(blockReason);
            if(nextRequestAt>now())await wait(nextRequestAt-now());
            nextRequestAt=now()+intervalMs;
            const url=new URL('https://api.etherscan.io/v2/api');
            for(const [k,v]of Object.entries({chainid:'56',module:'contract',action:'getsourcecode',address,apikey:apiKey}))url.searchParams.set(k,v);
            const res=await fetcher(url,{signal:AbortSignal.timeout(12000)});
            if(!res.ok)throw failure(res.status===429?'API_RATE_LIMIT':res.status>=500?'API_TRANSIENT':'API_HTTP_ERROR');
            return classifySource(await res.json());
          });
          return {...result,provider:'etherscan'};
        }catch(e){
          const code=e.code||'SOURCE_NETWORK_ERROR';
          if(/PROXY|ABI_INVALID/.test(e.message))throw e;
          if(['API_IP_THROTTLED','API_KEY_INVALID','API_RATE_LIMIT'].includes(code)){
            if(now()>=blockedUntil){blockReason=code;blockedUntil=now()+(code==='API_RATE_LIMIT'?5000:35000);}throw e;
          }
          if(['SOURCE_UNVERIFIED','API_ERROR','API_HTTP_ERROR'].includes(code)||attempt===2)throw failure(code);
          await wait(500*2**attempt);
        }
      }
    }catch(e){
      if(/PROXY|ABI_INVALID/.test(e.message)||!fallback)throw e;
      primaryError=e.code||'SOURCE_NETWORK_ERROR';
    }
    // A different provider receives only chain and address, never the API key.
    try{
      const url='https://sourcify.dev/server/v2/contract/56/'+address+'?fields=abi,proxyResolution,compilation,sources';
      const res=await fetcher(url,{signal:AbortSignal.timeout(12000)});
      if(!res.ok)throw failure(res.status===404?'SOURCIFY_SOURCE_UNVERIFIED':'SOURCIFY_UNAVAILABLE');
      return {...classifySourcify(await res.json(),address),primaryReason:primaryError};
    }catch(e){
      if(/PROXY/.test(e.message))throw e;
      throw failure(primaryError+'; '+(e.code||'SOURCIFY_UNAVAILABLE'));
    }
  };
}
const defaultProvider=createSourceProvider();
export async function sourceInfo(address,options){return (options?createSourceProvider(options):defaultProvider)(address);}
const names=new Set(['mint','publicMint','freeMint','claim','safeMint']);
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
