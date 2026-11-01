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
  if (erc721 === erc1155) throw new Error('Neither or both NFT standards identified unambiguously');
  return erc721 ? 'ERC-721' : 'ERC-1155';
}

export async function simulate(client, wallet, contract, inputData, config) {
  const chainId = await client.getChainId();
  if (chainId !== 56) throw new Error(`RPC wrong chain: ${chainId}`);
  await client.call({ account: wallet, to: contract, data: inputData, value: 0n });
  const gas = await client.estimateGas({ account: wallet, to: contract, data: inputData, value: 0n });
  const gasPrice = await client.getGasPrice();
  const budget = gasBudget(gas, gasPrice, config.maxGasWei, config.gasPaddingPercent);
  if (!budget.ok) throw new Error(`Gas budget exceeded: buffered ${budget.upperEstimateWei} wei > ${budget.maxWei} wei`);
  const balance = await client.getBalance({ address: wallet });
  if (balance < BigInt(budget.upperEstimateWei)) throw new Error('Wallet BNB balance cannot cover padded gas');
  return budget;
}

export async function verifyMintReceipt(client, { txHash, contract, standard, wallet }) {
  const { decodeEventLog, parseAbiItem, zeroAddress } = await import('viem');
  const receipt=await client.getTransactionReceipt({ hash:txHash });
  if (receipt.status !== 'success') return { confirmed:false, failed:true, reason:'On-chain transaction reverted', gasUsed:receipt.gasUsed.toString(), effectiveGasPrice:receipt.effectiveGasPrice?.toString() ?? null };
  if (receipt.to?.toLowerCase() !== contract.toLowerCase()) throw new Error('Receipt recipient differs from expected mint contract');
  const eventAbi = standard === 'ERC-721'
    ? [parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)')]
    : [parseAbiItem('event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)'), parseAbiItem('event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)')];
  let minted = false;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contract.toLowerCase()) continue;
    try {
      const decoded=decodeEventLog({ abi:eventAbi, data:log.data, topics:log.topics, strict:true });
      if (decoded.args.from?.toLowerCase() !== zeroAddress.toLowerCase() || decoded.args.to?.toLowerCase() !== wallet.toLowerCase()) continue;
      if (standard === 'ERC-721') minted = true;
      if (standard === 'ERC-1155' && decoded.eventName === 'TransferSingle' && decoded.args.value > 0n) minted=true;
      if (standard === 'ERC-1155' && decoded.eventName === 'TransferBatch' && decoded.args.values?.some(v=>v>0n)) minted=true;
    } catch { /* Other unrelated events cannot prove NFT mint. */ }
  }
  return { confirmed:minted, failed:false, reason:minted?'Verified NFT mint Transfer event':'No matching NFT mint event; manual inspection required', gasUsed:receipt.gasUsed.toString(), effectiveGasPrice:receipt.effectiveGasPrice?.toString() ?? null, actualGasWei:receipt.effectiveGasPrice ? (receipt.gasUsed*receipt.effectiveGasPrice).toString() : null };
}
