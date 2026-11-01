import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySource,classifySourcify,createSourceProvider} from '../src/source.mjs';
const A='0x1234567890123456789012345678901234567890',B='0x2234567890123456789012345678901234567890';
const abi=[{type:'function',name:'mint',stateMutability:'nonpayable',inputs:[],outputs:[]}];
function exact(address=A){return {chainId:'56',address,match:'exact_match',runtimeMatch:'exact_match',abi,proxyResolution:{isProxy:false,implementations:[]},sources:{'A.sol':{content:'contract A {}'}},compilation:{name:'A'}};}
const ok=json=>({ok:true,status:200,json:async()=>json});
test('invalid-key IP lockout has a distinct classification',()=>{
 assert.throws(()=>classifySource({status:'0',result:'Too many invalid api key attempts, please try again later'}),/API_IP_THROTTLED/);
 assert.throws(()=>classifySource({status:'0',result:'Invalid API Key (#err2)'}),/API_KEY_INVALID/);
});
test('Sourcify requires exact BSC identity, runtime, source, ABI and non-proxy status',()=>{
 assert.equal(classifySourcify(exact(),A).provider,'sourcify');
 for(const patch of [{chainId:'1'},{address:B},{match:'match'},{runtimeMatch:'match'},{abi:[]},{sources:{}},{proxyResolution:null},{proxyResolution:{isProxy:true,implementations:[]}}])assert.throws(()=>classifySourcify({...exact(),...patch},A));
});
test('fallback needs no API key and never sends the Etherscan secret to Sourcify',async()=>{
 const urls=[],key='local-secret-test';
 const provider=createSourceProvider({key,fetcher:async input=>{
  const u=new URL(input);urls.push(u);
  if(u.hostname==='api.etherscan.io')return ok({status:'0',result:'Too many invalid api key attempts, please try again later'});
  assert.equal(u.hostname,'sourcify.dev');assert.equal(u.href.includes(key),false);return ok(exact());
 }});
 const result=await provider(A);
 assert.equal(result.provider,'sourcify');assert.equal(result.primaryReason,'API_IP_THROTTLED');assert.equal(urls.length,2);
 const noKey=createSourceProvider({key:'',fetcher:async url=>{assert.equal(new URL(url).hostname,'sourcify.dev');return ok(exact());}});
 assert.equal((await noKey(A)).provider,'sourcify');
});
test('IP cooldown is shared across contracts and expires without perpetual extension',async()=>{
 let clock=1000,ethCalls=0;
 const provider=createSourceProvider({key:'test',now:()=>clock,wait:async ms=>{clock+=ms;},fetcher:async input=>{
  const url=new URL(input);
  if(url.hostname==='api.etherscan.io'){ethCalls++;return ok({status:'0',result:'Too many invalid api key attempts, please try again later'});}
  return ok(exact(url.pathname.split('/').at(-1)));
 }});
 await provider(A);clock+=10000;await provider(B);assert.equal(ethCalls,1);
 clock=37000;await provider(A);assert.equal(ethCalls,2);
});
test('primary source success wins; rejected proxy is never bypassed',async()=>{
 const response={status:'1',result:[{SourceCode:'contract A {}',ABI:JSON.stringify(abi),Proxy:'0',ContractName:'A'}]};
 const provider=createSourceProvider({key:'test',fetcher:async url=>{assert.equal(new URL(url).hostname,'api.etherscan.io');return ok(response);}});
 assert.equal((await provider(A)).provider,'etherscan');
 let calls=0;
 const proxy=createSourceProvider({key:'test',fetcher:async()=>{calls++;return ok({...response,result:[{...response.result[0],Proxy:'1'}]});}});
 await assert.rejects(()=>proxy(A),/PROXY_REQUIRES_REVIEW/);assert.equal(calls,1);
});
test('both providers missing source stays blocked and preserves diagnostic reason',async()=>{
 const p=createSourceProvider({key:'test',fetcher:async url=>new URL(url).hostname==='api.etherscan.io'?ok({status:'0',result:'Too many invalid api key attempts, please try again later'}):{ok:false,status:404}});
 await assert.rejects(()=>p(A),/API_IP_THROTTLED; SOURCIFY_SOURCE_UNVERIFIED/);
});
test('concurrent calls are paced without exposing keys or forwarding headers',async()=>{
 let clock=1000;const at=[];
 const p=createSourceProvider({key:'test',now:()=>clock,wait:async ms=>{clock+=ms;},fetcher:async()=>{at.push(clock);return ok({status:'1',result:[{SourceCode:'contract A {}',ABI:JSON.stringify(abi),Proxy:'0'}]});}});
 await Promise.all([p(A),p(B)]);
 assert.ok(at[1]-at[0]>=1200);
});
