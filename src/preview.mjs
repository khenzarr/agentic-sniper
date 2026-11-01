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
  const value=BigInt(target.valueWei||'0');
  for(const k of ['amount','value'])if(tx[k]!==undefined){try{if(BigInt(tx[k])!==value)throw new Error();}catch{throw new Error('Preview native value mismatch');}}
  for(const k of ['data','inputData'])if(tx[k]!==undefined&&String(tx[k]).toLowerCase()!==target.inputData.toLowerCase())throw new Error('Preview calldata mismatch');
  if(typeof tx.action==='string'&&/^0x[0-9a-fA-F]{8}$/.test(tx.action)&&tx.action.toLowerCase()!==target.inputData.slice(0,10).toLowerCase())throw new Error('Preview selector mismatch');
  const native=p.balanceChanges.filter(x=>x.tokenType==='Native');
  if(native.length!==(value>0n?1:0))throw new Error('NATIVE_PAYMENT_MISMATCH');
  for(const x of native){
    if(typeof x.change==='number'&&!Number.isSafeInteger(x.change))throw new Error('NATIVE_PAYMENT_PRECISION_UNKNOWN');
    if(String(x.contractAddress).toLowerCase()!=='0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'||String(x.owner).toLowerCase()!==target.wallet.toLowerCase()||BigInt(x.change)!==-value)throw new Error('NATIVE_PAYMENT_MISMATCH');
  }
  const incoming=p.balanceChanges.filter(x=>x.tokenType!=='Native');
  const type=target.standard==='ERC-20'?'Erc20':target.standard==='ERC-1155'?'Erc1155':'Erc721';
  if(!incoming.length)throw new Error('EXPECTED_MINT_CHANGE');
  let units=0n;const ids=new Set();
  for(const x of incoming){
    if(x.tokenType!==type||String(x.contractAddress).toLowerCase()!==target.contract.toLowerCase()||String(x.owner).toLowerCase()!==target.wallet.toLowerCase())throw new Error('BALANCE_CHANGES_REQUIRE_REVIEW');
    if(type==='Erc20'){
      const positive=typeof x.change==='number'?Number.isFinite(x.change)&&x.change>0:/^[0-9]+(?:\.[0-9]+)?$/.test(String(x.change))&&/[1-9]/.test(String(x.change));
      if(!positive)throw new Error('TOKEN_GAIN_NOT_POSITIVE');
    }else{
      if(typeof x.change==='number'&&!Number.isSafeInteger(x.change))throw new Error('NFT_CHANGE_INVALID');
      if(!/^[0-9]+$/.test(String(x.change))||BigInt(x.change)<=0n||typeof x.tokenId!=='string'||! /^(0x[0-9a-fA-F]{1,64}|[0-9]+)$/.test(x.tokenId))throw new Error('NFT_CHANGE_INVALID');
      if(type==='Erc721'&&(BigInt(x.change)!==1n||ids.has(BigInt(x.tokenId).toString())))throw new Error('NFT_CHANGE_INVALID');
      ids.add(BigInt(x.tokenId).toString());units+=BigInt(x.change);
    }
  }
  if(type!=='Erc20'&&units!==BigInt(target.quantity||'1'))throw new Error('MINT_QUANTITY_MISMATCH');
  return {...p,expiresAt:expiryMs(p.expiresAt,now,ttl)};
}
