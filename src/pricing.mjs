import {parseAbi} from 'viem';
// Chainlink's BNB/USD feed on BSC. https://data.chain.link/feeds/bsc/mainnet/bnb-usd
export const BNB_USD_FEED='0x0567f2323251f0aab15c8dfb1967e4e8a7d42aee';
const abi=parseAbi(['function description() view returns (string)','function decimals() view returns (uint8)','function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']);
export function validatePrice({description,decimals,round},now=Date.now()){
  const [roundId,answer,,updatedAt,answeredInRound]=round;
  const age=BigInt(Math.floor(now/1000))-updatedAt;
  if(description!=='BNB / USD'||decimals!==8||answer<=0n||updatedAt<=0n||age<0n||age>3600n||answeredInRound<roundId)throw new Error('USD_PRICE_UNAVAILABLE_OR_STALE');
  return {answer:answer.toString(),decimals,updatedAt:updatedAt.toString(),feed:BNB_USD_FEED};
}
export async function bnbUsd(client){
  const [description,decimals,round]=await Promise.all(['description','decimals','latestRoundData'].map(functionName=>client.readContract({address:BNB_USD_FEED,abi,functionName})));
  return validatePrice({description,decimals,round});
}
export function usdBudgetWei(price,usd=5,marginPercent=10){
  if(!Number.isFinite(usd)||usd<=0||usd>5)throw new Error('Paid mint limit must be <= $5');
  const micros=BigInt(Math.floor(usd*1e6));
  return micros*10n**8n*10n**18n*100n/(1000000n*BigInt(price.answer)*BigInt(100+marginPercent));
}
export function costUsdMicros(wei,price){
  const num=BigInt(wei)*BigInt(price.answer)*1000000n;
  return ((num+10n**26n-1n)/10n**26n).toString();
}
const getterNames=new Set(['price','mintPrice','MINT_PRICE','mintCost','cost','publicMintPrice','PRICE']);
export async function nativeUnitPrice(client,contract,abi){
  const getters=abi.filter(f=>f.type==='function'&&getterNames.has(f.name)&&['view','pure'].includes(f.stateMutability)&&f.inputs?.length===0&&f.outputs?.length===1&&/^uint/.test(f.outputs[0].type));
  const values=[];
  for(const f of getters){try{const v=await client.readContract({address:contract,abi:[f],functionName:f.name});if(typeof v==='bigint'&&v>0n)values.push(v);}catch{}}
  if(!values.length||new Set(values.map(String)).size!==1)throw new Error('NATIVE_UNIT_PRICE_UNKNOWN_OR_AMBIGUOUS');
  return values[0];
}
