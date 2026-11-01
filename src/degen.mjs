import {parseAbi,toFunctionSelector,keccak256} from 'viem';
import {sourceInfo,mintPlans} from './source.mjs';
const mints=[
 'function mint() payable','function mint(uint256 qty) payable','function mint(address recipient) payable','function mint(address recipient,uint256 qty) payable',
 'function publicMint() payable','function publicMint(uint256 qty) payable','function freeMint() payable','function freeMint(uint256 qty) payable',
 'function claim() payable','function claim(uint256 qty) payable','function claim(address recipient) payable','function safeMint(address recipient) payable'
];
const getters=['price','mintPrice','MINT_PRICE','mintCost','cost','publicMintPrice','PRICE','maxMintPerWallet','maxPerWallet','maxMintPerTx','maxMintAmount','MAX_MINT_PER_WALLET','mintLimit'];
const catalog=[...parseAbi(mints),...getters.map(name=>({type:'function',name,stateMutability:'view',inputs:[],outputs:[{type:'uint256'}]}))];
export function selectorsIn(code){
  if(!/^0x(?:[0-9a-fA-F]{2})+$/.test(code||''))throw new Error('INVALID_RUNTIME_BYTECODE');
  const b=Buffer.from(code.slice(2),'hex'),selectors=new Set();
  for(let i=0;i<b.length;i++){
    const op=b[i];
    if(op>=0x60&&op<=0x7f){const n=op-0x5f;if(op===0x63&&i+n<b.length)selectors.add('0x'+b.subarray(i+1,i+5).toString('hex'));i+=n;}
  }
  return selectors;
}
export function inferredAbi(code){
  const selectors=selectorsIn(code),abi=catalog.filter(f=>selectors.has(toFunctionSelector(f)));
  if(!abi.some(f=>mints.some(s=>parseAbi([s])[0].name===f.name)))throw new Error('NO_RECOGNIZED_MINT_SELECTOR');
  return abi;
}
export async function resolveMintSource(client,address,config,wallet,{verified=sourceInfo}={}){
  let info,reason;
  try{
    info=await verified(address);
    if(mintPlans(info.abi,wallet).length)return {...info,sourceVerified:true};
    reason='ABI_METHOD_UNSUPPORTED';
  }catch(e){reason=e.message;}
  if(!config.degenMode)throw new Error(reason);
  const code=await client.getBytecode({address});
  return {abi:inferredAbi(code),name:info?.name||'Unverified contract',provider:'bytecode-selector',sourceVerified:false,primaryReason:reason,codeHash:keccak256(code)};
}
export async function quantityCeiling(client,address,source,plan,standard,config){
  if(plan.quantityIndex<0)return {cap:'1',tokenDecimals:0};
  let tokenDecimals=0,cap=BigInt(config.maxBatchQuantity);
  if(standard==='ERC-20'){
    tokenDecimals=await client.readContract({address,abi:parseAbi(['function decimals() view returns (uint8)']),functionName:'decimals'});
    if(!Number.isInteger(tokenDecimals)||tokenDecimals<0||tokenDecimals>36)throw new Error('TOKEN_DECIMALS_UNKNOWN');
    // Unknown ERC20 quantity units may be raw amounts or lots. Expand the raw
    // search ceiling, but use simulations (not a guessed decimal conversion).
    cap*=10n**BigInt(tokenDecimals);
  }
  return {cap:cap.toString(),tokenDecimals};
}
