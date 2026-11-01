import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateFromRow,gasBudget,committedToday,checkPreview,getListedStandard} from '../src/policy.mjs';
const A='0x1234567890123456789012345678901234567890';
test('ERC20 free mint included',()=>assert.equal(candidateFromRow({text:'PEPE 20 FREE+ gas',hrefs:[`https://bscscan.com/address/${A}`]}).standardOnSite,'ERC-20'));
test('NFT row accepted',()=>{
 const x=candidateFromRow({text:'Agentlings AGLING 721 FREE+ gas $0.0054',hrefs:[`https://bscscan.com/address/${A}`]});
 assert.equal(x.standardOnSite,'ERC-721'); assert.equal(x.address,A.toLowerCase());
});
test('unknown contract excluded',()=>assert.equal(candidateFromRow({text:'Sample 1155 FREE+ gas',hrefs:[]}),null));
test('gas budget safe limit',()=>{assert.equal(gasBudget(100000n,500000000n,100000000000000n,20).ok,true);assert.equal(gasBudget(200000n,1000000000n,100000000000000n,20).ok,false);});
test('daily limit respects Istanbul day and reservations',()=>{const day='2026-11-01';assert.equal(committedToday([{day,status:'SUBMITTING'},{day,status:'PREVIEWED'}],new Date('2026-11-01T12:00:00Z')),1);});
test('BAW risky preview blocked',()=>{const base={success:true,data:{requestId:'abc',requireConfirmation:false,simulationResult:{simulationCode:'000000000',allowanceChanges:[],authorityChanges:[],balanceChanges:[]},risks:{riskDetails:[],riskBehaviors:[],addresses:{}}}};assert.equal(checkPreview(base).requestId,'abc');base.data.simulationResult.allowanceChanges=[{}];assert.throws(()=>checkPreview(base));});
test('unclassified row excluded',()=>assert.equal(getListedStandard('UNKNOWN contract FREE+ gas'),null));
test('paid NFT included for on-chain price planning',()=>assert.equal(candidateFromRow({text:'Example 721 0.001 BNB',hrefs:[`https://bscscan.com/address/${A}`]}).listedFree,false));
