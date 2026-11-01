import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAbi,decodeFunctionData,encodeAbiParameters,encodeEventTopics,parseAbiItem,zeroAddress} from 'viem';
import {validatePrice,usdBudgetWei,costUsdMicros,nativeUnitPrice} from '../src/pricing.mjs';
import {choosePlan,recheckPlan} from '../src/planner.mjs';
import {mintPlans} from '../src/source.mjs';
import {validatePreview} from '../src/preview.mjs';
import {nftStandard,verifyMintReceipt} from '../src/chain.mjs';
const A='0x1234567890123456789012345678901234567890',B='0x2234567890123456789012345678901234567890';
const quote={answer:'50000000000',decimals:8,updatedAt:'1793567345'}; // $500/BNB
const config={paidEnabled:true,paidMintUsdLimit:5,usdSafetyMarginPercent:10,maxBatchQuantity:1000};
const abi=parseAbi(['function mint(uint256 qty) payable']);
const plan=mintPlans(abi,A)[0],gas='100000000000000';
const quantity=data=>decodeFunctionData({abi,data}).args[0];
test('USD math uses bigint and reserves 10% headroom including gas',()=>{
 const cap=usdBudgetWei(quote,5,10);assert.equal(cap,9090909090909090n);
 assert.equal(costUsdMicros(cap,quote),'4545455');
 assert.throws(()=>usdBudgetWei(quote,5.01,10));
});
test('oracle rejects stale, future, negative, incomplete and wrong feed data',()=>{
 const now=1793567345000;
 const obj={description:'BNB / USD',decimals:8,round:[2n,50000000000n,1793567345n,1793567345n,2n]};
 assert.equal(validatePrice(obj,now).answer,'50000000000');
 for(const round of [[2n,-1n,0n,1793567345n,2n],[2n,1n,0n,1n,2n],[2n,1n,0n,1793567445n,2n],[2n,1n,0n,1793567345n,1n]])assert.throws(()=>validatePrice({...obj,round},now));
 assert.throws(()=>validatePrice({...obj,description:'ETH / USD'},now));
});
test('unit price requires one unambiguous native price',async()=>{
 const abi=parseAbi(['function price() view returns (uint256)','function mintPrice() view returns (uint256)']);
 assert.equal(await nativeUnitPrice({readContract:async()=>100n},B,abi),100n);
 await assert.rejects(()=>nativeUnitPrice({readContract:async x=>x.functionName==='price'?100n:200n},B,abi),/AMBIGUOUS/);
});
function opts(simulate){return {simulate,unitPrice:async()=>1000000000000000n,price:async()=>quote,config};}
test('free ERC20/NFT plan never needs price oracle and stays value zero',async()=>{
 const result=await choosePlan(plan,{...opts(async(data,value)=>{assert.equal(value,'0');return {upperEstimateWei:gas};}),price:()=>{throw new Error('not called');}});
 assert.equal(result.valueWei,'0');assert.equal(result.quantity,'1');
});
test('paid quantity maximizes affordable batch under $5 including gas',async()=>{
 const result=await choosePlan(plan,opts(async(data,value)=>{
  if(value==='0')throw new Error('payment needed');
  assert.equal(BigInt(value),quantity(data)*1000000000000000n);
  return {upperEstimateWei:gas};
 }));
 assert.equal(result.quantity,'8');assert.equal(result.valueWei,'8000000000000000');
 assert.ok(BigInt(result.pricing.estimatedTotalUsdMicros)<5000000n);
});
test('remaining wallet, per-tx and supply limit enforced by simulation',async()=>{
 const result=await choosePlan(plan,opts(async(data,value)=>{
  if(value==='0'||quantity(data)>3n)throw new Error('wallet limit');
  return {upperEstimateWei:gas};
 }));
 assert.equal(result.quantity,'3');
});
test('paid disabled, nonpayable, overbudget, and no single mint all fail closed',async()=>{
 const simulate=async()=>{throw new Error('revert');};
 await assert.rejects(()=>choosePlan(plan,{...opts(simulate),config:{...config,paidEnabled:false}}),/NO_SIMULATED/);
 await assert.rejects(()=>choosePlan({...plan,mutability:'nonpayable'},opts(simulate)),/NO_SIMULATED/);
 await assert.rejects(()=>choosePlan(plan,{...opts(async(d,v)=>{if(v==='0')throw new Error('paid');return {upperEstimateWei:gas};}),unitPrice:async()=>10000000000000000n}),/BUDGET/);
});
test('oracle is refreshed immediately before sending a paid preview',async()=>{
 const paid={...plan,valueWei:'8000000000000000'};
 await assert.rejects(()=>recheckPlan(paid,{config,simulate:async()=>({upperEstimateWei:gas}),price:async()=>({...quote,answer:'100000000000'})}),/BUDGET_CHANGED/);
});
function preview(changes,value='0'){
 return {success:true,data:{requestId:'p',expiresAt:Date.now()+60000,requireConfirmation:false,parsedTx:{contractAddress:B,value},simulationResult:{simulationCode:'000000000',allowanceChanges:[],authorityChanges:[],balanceChanges:changes},risks:{riskDetails:[],riskBehaviors:[],addresses:{}}}};
}
const gain={contractAddress:B,owner:A,tokenType:'Erc20',change:'1000000000000000000',tokenId:null};
test('free token preview accepts gain but blocks drains or extra collections',()=>{
 const t={wallet:A,contract:B,standard:'ERC-20',inputData:'0x1234',valueWei:'0'};
 validatePreview(preview([gain]),t);
 assert.throws(()=>validatePreview(preview([{...gain,change:'-1'}]),t));
 assert.throws(()=>validatePreview(preview([{...gain,contractAddress:A}]),t));
 assert.throws(()=>validatePreview(preview([gain,{...gain,tokenType:'Native',change:-1}]),t));
});
test('paid preview requires exactly the reserved BNB debit and expected quantity',()=>{
 const native={contractAddress:'0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',owner:A,tokenType:'Native',change:'-1000',tokenId:null};
 const t={wallet:A,contract:B,standard:'ERC-721',inputData:'0x1234',valueWei:'1000',quantity:'2'};
 const n1={...gain,tokenType:'Erc721',change:1,tokenId:'0x1'},n2={...n1,tokenId:'0x2'};
 validatePreview(preview([n1,n2,native],'1000'),t);
 assert.throws(()=>validatePreview(preview([n1,native],'1000'),t),/QUANTITY/);
 assert.throws(()=>validatePreview(preview([n1,n2,{...native,change:-1001}],'1000'),t),/PAYMENT/);
 assert.throws(()=>validatePreview(preview([n1,n2,native],'1001'),t),/value mismatch/);
});
test('ERC20 on-chain interface recognition and mint receipt work',async()=>{
 const c={getBytecode:async()=>'0x1234',readContract:async x=>x.functionName==='supportsInterface'?false:x.functionName==='decimals'?18:100n};
 assert.equal(await nftStandard(c,B),'ERC-20');
 const event=parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
 const log={address:B,topics:encodeEventTopics({abi:[event],eventName:'Transfer',args:{from:zeroAddress,to:A}}),data:encodeAbiParameters([{type:'uint256'}],[10n**18n])};
 const result=await verifyMintReceipt({getTransactionReceipt:async()=>({status:'success',to:B,gasUsed:100000n,effectiveGasPrice:1n,logs:[log]})},{contract:B,wallet:A,standard:'ERC-20'});
 assert.equal(result.confirmed,true);assert.equal(result.mintedUnits,'1000000000000000000');
});
