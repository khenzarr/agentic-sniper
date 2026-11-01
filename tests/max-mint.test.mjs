import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAbi,toFunctionSelector,encodeFunctionData,decodeFunctionData} from 'viem';
import {inferredAbi,selectorsIn,resolveMintSource,quantityCeiling} from '../src/degen.mjs';
import {choosePlan,collectionSpentWei} from '../src/planner.mjs';
import {mintPlans} from '../src/source.mjs';
import {validatePreview} from '../src/preview.mjs';
const A='0x1234567890123456789012345678901234567890';
const abi=parseAbi(['function mint(uint256 qty) payable']),plan=mintPlans(abi,A)[0];
const quote={answer:'50000000000',decimals:8,updatedAt:'1793567345'};
const config={maxMint:true,paidEnabled:true,paidMintUsdLimit:5,usdSafetyMarginPercent:10,maxBatchQuantity:1000};
const opts=simulate=>({simulate,unitPrice:async()=>{throw new Error('price unknown');},price:async()=>quote,config});
const qty=data=>decodeFunctionData({abi,data}).args[0];
test('bytecode fallback only infers known PUSH4 signatures, not embedded PUSH32 data',()=>{
 const selector=toFunctionSelector(abi[0]).slice(2),code='0x63'+selector+'146100105700';
 assert.ok(inferredAbi(code).some(f=>f.name==='mint'));
 assert.equal(selectorsIn('0x7f'+selector+'00'.repeat(28)).size,0);
 assert.throws(()=>inferredAbi('0x60006000'),/NO_RECOGNIZED/);
 assert.throws(()=>inferredAbi('0xgg'),/INVALID/);
});
test('degen opt-in is required; inferred sources remain explicitly unverified',async()=>{
 const selector=toFunctionSelector(abi[0]).slice(2);
 const client={getBytecode:async()=>'0x63'+selector+'00'};
 const verified=async()=>{throw new Error('SOURCE_UNVERIFIED');};
 await assert.rejects(()=>resolveMintSource(client,A,{degenMode:false},A,{verified}),/SOURCE_UNVERIFIED/);
 const source=await resolveMintSource(client,A,{degenMode:true},A,{verified});
 assert.equal(source.sourceVerified,false);assert.equal(source.provider,'bytecode-selector');assert.match(source.codeHash,/^0x[0-9a-f]{64}$/);
});
test('ERC20 raw quantity ceiling includes decimals without changing encoded units',async()=>{
 const cap=await quantityCeiling({readContract:async()=>18},A,{},plan,'ERC-20',config);
 assert.equal(cap.cap,'1000000000000000000000');assert.equal(cap.tokenDecimals,18);
 assert.equal((await quantityCeiling({},A,{},plan,'ERC-721',config)).cap,'1000');
});
test('free mint maximizes remaining quantity rather than requesting one',async()=>{
 const r=await choosePlan(plan,opts(async(data,value)=>{if(value!=='0'||qty(data)>7n)throw new Error('wallet cap');return {upperEstimateWei:'100000'};}));
 assert.equal(r.quantity,'7');assert.equal(r.valueWei,'0');
});
test('ERC20 raw amounts and fixed lots both find wallet caps',async()=>{
 const rawCap=3n*10n**18n;
 const r=await choosePlan({...plan,tokenDecimals:18},{...opts(async(data,value)=>{if(value!=='0'||qty(data)>rawCap)throw new Error('wallet cap');return {upperEstimateWei:'100000'};}),maxQuantity:(1000n*10n**18n).toString()});
 assert.equal(r.quantity,rawCap.toString());
 const lots=await choosePlan({...plan,tokenDecimals:18},{...opts(async(data,value)=>{if(value!=='0'||qty(data)>5n)throw new Error('5 lots max');return {upperEstimateWei:'100000'};}),maxQuantity:(1000n*10n**18n).toString()});
 assert.equal(lots.quantity,'5');
});
test('flat batch fees are not multiplied unnecessarily',async()=>{
 const unit=1000000000000000n;
 const r=await choosePlan(plan,{...opts(async(data,value)=>{if(BigInt(value)<unit||qty(data)>5n)throw new Error('price/wallet cap');return {upperEstimateWei:'100000'};}),unitPrice:async()=>unit});
 assert.equal(r.quantity,'5');assert.equal(r.valueWei,unit.toString());assert.equal(r.pricing.priceModel,'per-call');
});
test('paid ERC20 decimals use simulated whole-token pricing rather than buying dust',async()=>{
 const unit=1000000000000000n,scale=10n**18n;
 const r=await choosePlan({...plan,tokenDecimals:18},{...opts(async(data,value)=>{
  const q=qty(data);if(q>5n*scale||BigInt(value)!==unit*q/scale)throw new Error('wrong price or wallet cap');
  return {upperEstimateWei:'100000'};
 }),unitPrice:async()=>unit,maxQuantity:(1000n*scale).toString()});
 assert.equal(r.quantity,(5n*scale).toString());assert.equal(r.valueWei,(5n*unit).toString());
});
test('a fixed-lot mint() cannot request a quantity but may be called again after confirmation',async()=>{
 const noarg=mintPlans(parseAbi(['function mint() payable']),A)[0];
 const r=await choosePlan(noarg,opts(async()=>({upperEstimateWei:'100000'})));
 assert.equal(r.quantity,'1');assert.equal(noarg.quantityIndex,-1);
});
test('spend is cumulative across prior free and paid calls, with old records supported',async()=>{
 const h=[{contract:A,valueWei:'1000',receipt:{actualGasWei:'100'}},{contract:A,receipt:{actualGasWei:'200'}},{contract:A,valueWei:'20',budget:{upperEstimateWei:'30'}}];
 assert.equal(collectionSpentWei(h,A),'1350');
 assert.throws(()=>collectionSpentWei([{contract:A}],A),/SPEND_UNKNOWN/);
 const spent=(9n*10n**15n).toString();
 await assert.rejects(()=>choosePlan(plan,{...opts(async()=>({upperEstimateWei:'1000000000000000'})),spentWei:spent}),/BUDGET_EXHAUSTED/);
});
test('fixed-lot NFT previews derive the actual count instead of assuming one NFT',()=>{
 const target={wallet:A,contract:A,standard:'ERC-721',inputData:'0x1234',quantity:'1',quantityMode:'fixed-lot'};
 const response={success:true,data:{requestId:'r',requireConfirmation:false,parsedTx:{contractAddress:A},simulationResult:{simulationCode:'000000000',allowanceChanges:[],authorityChanges:[],balanceChanges:[1,2,3].map(i=>({tokenType:'Erc721',contractAddress:A,owner:A,change:1,tokenId:String(i)}))},risks:{riskDetails:[],riskBehaviors:[],addresses:{}}}};
 assert.equal(validatePreview(response,target).expectedMintUnits,'3');
 assert.throws(()=>validatePreview(response,{...target,quantityMode:'parameter'}),/QUANTITY/);
});
