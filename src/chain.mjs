import { createPublicClient, http } from 'viem';
import { bsc } from 'viem/chains';
import { isAddress, gasBudget } from './policy.mjs';

const ERC165 = [{ type:'function', name:'supportsInterface', stateMutability:'view', inputs:[{name:'interfaceId',type:'bytes4'}], outputs:[{type:'bool'}] }];

export function newClient() {
  return createPublicClient({ chain: bsc, transport: http(process.env.BSC_RPC_URL || 'https://bsc-dataseed.bnbchain.org', { timeout: 20000 }) });
}
export async function nftStandard(client, contract) {
  if (!isAddress(contract)) throw new Error('Invalid contract address');
  const code = await client.getBytecode({ address: contract });
  if (!code || code === '0x') throw new Error('Contract has no bytecode');
  const [erc721, erc1155] = await Promise.all([
    client.readContract({ address: contract, abi: ERC165, functionName:'supportsInterface', args:['0x80ac58cd'] }).catch(() => false),
    client.readContract({ address: contract, abi: ERC165, functionName:'supportsInterface', args:['0xd9b67a26'] }).catch(() => false)
  ]);
  if(!erc721&&!erc1155){
    const abi=[{type:'function',name:'totalSupply',stateMutability:'view',inputs:[],outputs:[{type:'uint256'}]},{type:'function',name:'balanceOf',stateMutability:'view',inputs:[{type:'address'}],outputs:[{type:'uint256'}]},{type:'function',name:'decimals',stateMutability:'view',inputs:[],outputs:[{type:'uint8'}]}];
    const [supply,balance,decimals]=await Promise.all([client.readContract({address:contract,abi,functionName:'totalSupply'}),client.readContract({address:contract,abi,functionName:'balanceOf',args:['0x0000000000000000000000000000000000000000']}),client.readContract({address:contract,abi,functionName:'decimals'})]);
    if(typeof supply==='bigint'&&typeof balance==='bigint'&&Number.isInteger(decimals)&&decimals>=0&&decimals<=36)return 'ERC-20';
  }
  if (erc721 === erc1155) throw new Error('Token standard not identified unambiguously');
  return erc721 ? 'ERC-721' : 'ERC-1155';
}

export async function simulate(client, wallet, contract, inputData, config, valueWei='0') {
  const chainId = await client.getChainId();
  if (chainId !== 56) throw new Error(`RPC wrong chain: ${chainId}`);
  const value=BigInt(valueWei);if(value<0n)throw new Error('Negative native value');
  await client.call({ account: wallet, to: contract, data: inputData, value });
  const gas = await client.estimateGas({ account: wallet, to: contract, data: inputData, value });
  const gasPrice = await client.getGasPrice();
  const budget = gasBudget(gas, gasPrice, config.maxGasWei, config.gasPaddingPercent);
  if (!budget.ok) throw new Error(`Gas budget exceeded: buffered ${budget.upperEstimateWei} wei > ${budget.maxWei} wei`);
  const balance = await client.getBalance({ address: wallet });
  if (balance < BigInt(budget.upperEstimateWei)+value) throw new Error('Wallet BNB balance cannot cover mint plus padded gas');
  return budget;
}

export async function verifyMintReceipt(client, { txHash, contract, standard, wallet, quantity='1' }) {
  const { decodeEventLog, parseAbiItem, zeroAddress,formatUnits } = await import('viem');
  const receipt=await client.getTransactionReceipt({ hash:txHash });
  if (receipt.status !== 'success') return { confirmed:false, failed:true, reason:'On-chain transaction reverted', gasUsed:receipt.gasUsed.toString(), effectiveGasPrice:receipt.effectiveGasPrice?.toString() ?? null };
  if (receipt.to?.toLowerCase() !== contract.toLowerCase()) throw new Error('Receipt recipient differs from expected mint contract');
  const eventAbi = standard === 'ERC-20'
    ? [parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')]
    : standard === 'ERC-721'
    ? [parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)')]
    : [parseAbiItem('event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)'), parseAbiItem('event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)')];
  let units=0n;const ids=new Set();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contract.toLowerCase()) continue;
    try {
      const decoded=decodeEventLog({ abi:eventAbi, data:log.data, topics:log.topics, strict:true });
      if (decoded.args.from?.toLowerCase() !== zeroAddress.toLowerCase() || decoded.args.to?.toLowerCase() !== wallet.toLowerCase()) continue;
      if(standard==='ERC-20'&&decoded.args.value>0n)units+=decoded.args.value;
      if(standard==='ERC-721'&&!ids.has(String(decoded.args.tokenId))){ids.add(String(decoded.args.tokenId));units++;}
      if(standard==='ERC-1155'&&decoded.eventName==='TransferSingle')units+=decoded.args.value;
      if(standard==='ERC-1155'&&decoded.eventName==='TransferBatch')units+=decoded.args.values.reduce((a,b)=>a+b,0n);
    } catch { /* Other unrelated events cannot prove NFT mint. */ }
  }
  const minted=standard==='ERC-20'?units>0n:units===BigInt(quantity);
  let mintedAmount=standard==='ERC-20'?undefined:units.toString();
  if(standard==='ERC-20'&&client.readContract){try{const decimals=await client.readContract({address:contract,abi:[parseAbiItem('function decimals() view returns (uint8)')],functionName:'decimals'});if(Number.isInteger(decimals)&&decimals>=0&&decimals<=36)mintedAmount=formatUnits(units,decimals);}catch{}}
  return { confirmed:minted, failed:false, mintedUnits:units.toString(),mintedAmount,reason:minted?'Verified mint Transfer event':'Missing or mismatched mint amount; manual inspection required', gasUsed:receipt.gasUsed.toString(), effectiveGasPrice:receipt.effectiveGasPrice?.toString() ?? null, actualGasWei:receipt.effectiveGasPrice ? (receipt.gasUsed*receipt.effectiveGasPrice).toString() : null };
}
