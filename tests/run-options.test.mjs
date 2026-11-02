import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseAbi,decodeFunctionData} from 'viem';
import {parseRunOptions,applyMintScope} from '../src/run-options.mjs';
import {loadConfig} from '../src/config.mjs';
import {choosePlan} from '../src/planner.mjs';
import {mintPlans} from '../src/source.mjs';

test('portable mode arguments reject ambiguous and misspelled selections before wallet access',()=>{
  assert.deepEqual(parseRunOptions(['--loop','--mint-scope','free']),{command:'watch',mintScope:'free'});
  assert.deepEqual(parseRunOptions(['--loop','--mint-scope','all','--check']),{command:'doctor',mintScope:'all'});
  assert.deepEqual(parseRunOptions(['--once']),{command:'once',mintScope:undefined});
  for(const args of [[],['--loop','--once'],['--loop','--mint-scope'],['--loop','--mint-scope','paid'],['--loop','--free'],['--loop','--mint-scope','free','--mint-scope','all']])assert.throws(()=>parseRunOptions(args));
});

test('mode selections preserve security and budget settings without mutating the saved configuration',()=>{
  const saved=Object.freeze({paidEnabled:true,maxMint:false,mode:'preview',executionEnabled:false,degenMode:false,paidMintUsdLimit:3,dailyLimit:5,maxGasWei:'100'});
  const free=applyMintScope(saved,'free'),all=applyMintScope(saved,'all');
  for(const selected of [free,all]){
    assert.equal(selected.maxMint,true);
    for(const key of ['mode','executionEnabled','degenMode','paidMintUsdLimit','dailyLimit','maxGasWei'])assert.equal(selected[key],saved[key]);
  }
  assert.equal(free.paidEnabled,false);assert.equal(all.paidEnabled,true);assert.equal(saved.maxMint,false);assert.equal(saved.paidEnabled,true);
  assert.equal(applyMintScope(saved).maxMint,false);assert.throws(()=>applyMintScope(saved,'invalid'));
});

async function fixture(t,raw={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sniper-modes-'));
  const keys=['SNIPER_MODE','SNIPER_INTERVAL_SECONDS','ENABLE_EXECUTE'],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  for(const k of keys)delete process.env[k];
  t.after(async()=>{for(const k of keys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}await fs.rm(root,{recursive:true,force:true});});
  const text=JSON.stringify({mode:'preview',executionEnabled:false,paidEnabled:true,maxMint:false,...raw},null,2)+'\n';
  await fs.writeFile(path.join(root,'config.json'),text);
  return {root,text};
}

test('loading free then all then saved mode leaves config and env files unchanged',async t=>{
  const {root,text}=await fixture(t),env='SNIPER_MODE=preview\nENABLE_EXECUTE=NO\n';
  await fs.writeFile(path.join(root,'.env'),env);
  const free=await loadConfig({root,mintScope:'free'}),all=await loadConfig({root,mintScope:'all'}),saved=await loadConfig({root});
  assert.equal(free.paidEnabled,false);assert.equal(free.maxMint,true);assert.equal(all.paidEnabled,true);assert.equal(all.maxMint,true);assert.equal(saved.maxMint,false);assert.equal(saved.paidEnabled,true);
  assert.equal(await fs.readFile(path.join(root,'config.json'),'utf8'),text);assert.equal(await fs.readFile(path.join(root,'.env'),'utf8'),env);
  assert.equal(free.mode,'preview');assert.equal(all.executionEnabled,false);
});

test('both selectors still require execution opt-in and reject an invalid USD budget',async t=>{
  const {root}=await fixture(t,{mode:'auto',paidMintUsdLimit:5});
  for(const mintScope of ['free','all'])await assert.rejects(()=>loadConfig({root,mintScope}),/Execution needs/);
  await fs.writeFile(path.join(root,'config.json'),JSON.stringify({mode:'preview',paidMintUsdLimit:6}));
  for(const mintScope of ['free','all'])await assert.rejects(()=>loadConfig({root,mintScope}),/Paid mint limit/);
});

test('free selector maximizes a free phase and never pays when the same contract changes to a paid phase',async()=>{
  const abi=parseAbi(['function mint(uint256 qty) payable']),plan=mintPlans(abi,'0x1234567890123456789012345678901234567890')[0];
  const config=applyMintScope({paidEnabled:true,maxMint:false,maxBatchQuantity:1000,paidMintUsdLimit:5,usdSafetyMarginPercent:10},'free');
  let paidPhase=false;const payments=[];
  const options={config,maxQuantity:1000n,price:async()=>({answer:'50000000000',decimals:8}),unitPrice:()=>{throw new Error('Paid price lookup must not be used');},simulate:async(data,value)=>{
    payments.push(value);assert.equal(value,'0');
    if(paidPhase||decodeFunctionData({abi,data}).args[0]>7n)throw new Error('payment or wallet limit');
    return {upperEstimateWei:'1000000000000'};
  }};
  const free=await choosePlan(plan,options);assert.equal(free.quantity,'7');assert.equal(free.valueWei,'0');
  paidPhase=true;await assert.rejects(()=>choosePlan(plan,options));assert.ok(payments.length>1);assert.ok(payments.every(v=>v==='0'));
});
