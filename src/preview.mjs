import {checkPreview,isAddress} from './policy.mjs';
export function expiryMs(value,now,ttl) {
  if(value===null||value===undefined)return now+ttl*1000;
  const n=typeof value==='number'?value:(/^\d+$/.test(value)?Number(value):Date.parse(value));
  const ms=n<1e12?n*1000:n;
  if(!Number.isFinite(ms)||ms<=now)throw new Error('BAW preview expired or invalid expiry');
  return Math.min(now+ttl*1000,ms);
}
export function validatePreview(response,target,now=Date.now(),ttl=120){
  const p=checkPreview(response);
  const tx=p.parsedTx;
  if(!tx||typeof tx!=='object')throw new Error('Missing parsed transaction');
  // Reject every supplied conflicting field. CLI versions vary; preview request itself
  // is built only by previewMint from the locally encoded exact target.
  for(const k of ['to','contractAddress','recipient'])if(tx[k]!==undefined&&(!isAddress(tx[k])||tx[k].toLowerCase()!==target.contract.toLowerCase()))throw new Error('Preview target mismatch');
  if(tx.from!==undefined&&String(tx.from).toLowerCase()!==target.wallet.toLowerCase())throw new Error('Preview sender mismatch');
  for(const k of ['chainId','binanceChainId'])if(tx[k]!==undefined&&Number(tx[k])!==56)throw new Error('Preview chain mismatch');
  for(const k of ['amount','value'])if(tx[k]!==undefined&&!/^(0|0x0+)$/.test(String(tx[k])))throw new Error('Preview native value nonzero');
  for(const k of ['data','inputData'])if(tx[k]!==undefined&&String(tx[k]).toLowerCase()!==target.inputData.toLowerCase())throw new Error('Preview calldata mismatch');
  if(typeof tx.action==='string'&&/^0x[0-9a-fA-F]{8}$/.test(tx.action)&&tx.action.toLowerCase()!==target.inputData.slice(0,10).toLowerCase())throw new Error('Preview selector mismatch');
  // Official BAW EVM simulation shape, checked against a live read-only preview.
  // Only one incoming NFT from the exact collection to the connected wallet.
  if(p.balanceChanges.length!==1)throw new Error('EXPECTED_ONE_NFT_CHANGE');
  const change=p.balanceChanges[0];
  const type=target.standard==='ERC-1155'?'Erc1155':'Erc721';
  if(change.tokenType!==type||String(change.change)!=='1'||String(change.contractAddress).toLowerCase()!==target.contract.toLowerCase()||String(change.owner).toLowerCase()!==target.wallet.toLowerCase()||typeof change.tokenId!=='string'||! /^(0x[0-9a-fA-F]{1,64}|[0-9]+)$/.test(change.tokenId))throw new Error('BALANCE_CHANGES_REQUIRE_REVIEW');
  return {...p,expiresAt:expiryMs(p.expiresAt,now,ttl)};
}
