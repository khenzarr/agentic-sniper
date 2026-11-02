import test from 'node:test';
import assert from 'node:assert/strict';
import {quarantineUnknown,isQuarantined} from '../src/recovery.mjs';
import {committedToday,todayTR} from '../src/policy.mjs';
import {collectionSpentWei} from '../src/planner.mjs';
const wallet='0x1234567890123456789012345678901234567890',contract='0x2234567890123456789012345678901234567890',now=Date.parse('2026-11-02T09:00:00Z');
const record=()=>({id:'unknown',wallet,contract,requestId:'request',expiresAt:now-1000,status:'UNKNOWN_SUBMISSION',day:todayTR(new Date(now)),valueWei:'220',budget:{upperEstimateWei:'10'}});
const options=()=>({wallet,accepted:true,pendingTransactions:[],latestNonce:463,pendingNonce:463,now});
test('manual quarantine preserves the unknown outcome, record identity and reserved spend',()=>{
  const original=record(),q=quarantineUnknown(original,options());
  assert.equal(original.quarantine,undefined);assert.equal(q.status,'UNKNOWN_SUBMISSION');assert.equal(q.requestId,original.requestId);assert.equal(isQuarantined(q),true);
  assert.equal(committedToday([q],new Date(now)),1);assert.equal(collectionSpentWei([q],contract),'230');
  assert.equal(q.quarantine.checks.latestNonce,463);
});
test('quarantine fails closed without acceptance, expiry, ownership and an empty pending state',()=>{
  for(const change of [{accepted:false},{pendingTransactions:null},{pendingTransactions:[{txHash:'pending'}]},{pendingNonce:464},{latestNonce:NaN},{wallet:contract}])assert.throws(()=>quarantineUnknown(record(),{...options(),...change}));
  for(const change of [{status:'BROADCASTED'},{txHash:'0xabc'},{orderId:'123'},{expiresAt:now},{expiresAt:null},{requestId:null}])assert.throws(()=>quarantineUnknown({...record(),...change},options()));
  assert.throws(()=>quarantineUnknown(undefined,options()));
});
test('quarantine cannot be copied to a different wallet, contract or request',()=>{
  const q=quarantineUnknown(record(),options());
  for(const change of [{wallet:contract},{contract:wallet},{requestId:'different'}])assert.equal(isQuarantined({...q,...change}),false);
  assert.throws(()=>quarantineUnknown(q,options()),/already quarantined/);
});
