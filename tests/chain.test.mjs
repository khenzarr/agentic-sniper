import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeEventTopics,encodeAbiParameters,parseAbiItem,zeroAddress} from 'viem';
import {verifyMintReceipt,simulate} from '../src/chain.mjs';
const A='0x1234567890123456789012345678901234567890',B='0x2234567890123456789012345678901234567890';
const event=parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
const log={address:B,topics:encodeEventTopics({abi:[event],eventName:'Transfer',args:{from:zeroAddress,to:A,tokenId:1n}}),data:'0x'};
const receipt={to:B,status:'success',gasUsed:100000n,effectiveGasPrice:100000000n,logs:[log]};
const client={getTransactionReceipt:async()=>receipt};
test('receipt requires NFT minted by the target contract to our wallet',async()=>{
 const args={txHash:'0x'+'a'.repeat(64),contract:B,standard:'ERC-721',wallet:A};
 assert.equal((await verifyMintReceipt(client,args)).confirmed,true);
 assert.equal((await verifyMintReceipt({getTransactionReceipt:async()=>({...receipt,logs:[]})},args)).confirmed,false);
 assert.equal((await verifyMintReceipt({getTransactionReceipt:async()=>({...receipt,status:'reverted'})},args)).failed,true);
 assert.equal((await verifyMintReceipt(client,{...args,wallet:B})).confirmed,false);
});
test('ERC1155 receipt checks quantity and recipient',async()=>{
 const ev=parseAbiItem('event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)');
 const topics=encodeEventTopics({abi:[ev],eventName:'TransferSingle',args:{operator:A,from:zeroAddress,to:A}});
 const data=encodeAbiParameters([{type:'uint256'},{type:'uint256'}],[1n,1n]);
 const result=await verifyMintReceipt({getTransactionReceipt:async()=>({...receipt,logs:[{address:B,topics,data}]})},{txHash:'0x'+'a'.repeat(64),contract:B,standard:'ERC-1155',wallet:A});
 assert.equal(result.confirmed,true);
});
test('simulation sends zero value, validates chain, gas budget and balance',async()=>{
 let calls=0;
 const c={getChainId:async()=>56,call:async x=>{calls++;assert.equal(x.value,0n);},estimateGas:async()=>100000n,getGasPrice:async()=>100000000n,getBalance:async()=>10000000000000000n};
 const config={maxGasWei:'100000000000000',gasPaddingPercent:20};
 assert.equal((await simulate(c,A,B,'0x1234',config)).ok,true);
 await assert.rejects(()=>simulate({...c,getChainId:async()=>1},A,B,'0x',config),/wrong chain/);
 await assert.rejects(()=>simulate({...c,getBalance:async()=>0n},A,B,'0x',config),/balance/);
 await assert.rejects(()=>simulate({...c,getGasPrice:async()=>100000000000n},A,B,'0x',config),/budget/);
 assert.equal(calls,3);
});
