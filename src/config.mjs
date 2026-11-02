import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {applyMintScope} from './run-options.mjs';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function loadConfig({mintScope,root=ROOT}={}) {
  try { process.loadEnvFile(path.join(root,'.env')); } catch(e) { if(e.code!=='ENOENT') throw e; }
  const raw=JSON.parse(await fs.readFile(path.join(root,'config.json'),'utf8'));
  const c={chainId:56,sourceUrl:'https://agenticmint.ai/',dailyLimit:5,maxGasWei:'100000000000000',gasPaddingPercent:20,previewTtlSeconds:120,intervalSeconds:120,mode:'preview',paidEnabled:false,paidMintUsdLimit:5,usdSafetyMarginPercent:10,maxBatchQuantity:1000,...raw};
  c.mode=process.env.SNIPER_MODE || c.mode;
  c.maxMint=raw.maxMint??false;c.degenMode=raw.degenMode??false;c.maxMintCallsPerCollection=raw.maxMintCallsPerCollection??100;
  c.pendingPollSeconds=raw.pendingPollSeconds??10;
  if(!Number.isInteger(c.pendingPollSeconds)||c.pendingPollSeconds<5||c.pendingPollSeconds>60)throw new Error('pendingPollSeconds must be 5..60');
  if(typeof c.maxMint!=='boolean'||typeof c.degenMode!=='boolean'||!Number.isInteger(c.maxMintCallsPerCollection)||c.maxMintCallsPerCollection<1||c.maxMintCallsPerCollection>1000)throw new Error('Invalid max mint/degen settings');
  c.intervalSeconds=Number(process.env.SNIPER_INTERVAL_SECONDS || c.intervalSeconds);
  if(c.chainId!==56 || !['https://agenticmint.ai/','https://agenticmint.ai/?f=bedava'].includes(c.sourceUrl)) throw new Error('Only BSC and the official radar are supported');
  if(typeof c.paidEnabled!=='boolean'||!Number.isFinite(c.paidMintUsdLimit)||c.paidMintUsdLimit<=0||c.paidMintUsdLimit>5)throw new Error('Paid mint limit must be <= $5');
  if(!Number.isInteger(c.usdSafetyMarginPercent)||c.usdSafetyMarginPercent<10||c.usdSafetyMarginPercent>100)throw new Error('USD margin must be 10..100 percent');
  if(!Number.isInteger(c.maxBatchQuantity)||c.maxBatchQuantity<1||c.maxBatchQuantity>1000)throw new Error('Batch quantity must be 1..1000');
  if(!['preview','app','auto'].includes(c.mode)) throw new Error('SNIPER_MODE must be preview, app or auto');
  if(c.dailyLimit!==null&&(!Number.isSafeInteger(c.dailyLimit)||c.dailyLimit<1||c.dailyLimit>1000)) throw new Error('dailyLimit must be null or 1..1000');
  if(!/^\d+$/.test(c.maxGasWei)||BigInt(c.maxGasWei)<=0n) throw new Error('Invalid maxGasWei');
  if(!Number.isInteger(c.gasPaddingPercent)||c.gasPaddingPercent<0||c.gasPaddingPercent>100) throw new Error('Invalid gas padding');
  if(!Number.isInteger(c.previewTtlSeconds)||c.previewTtlSeconds<10||c.previewTtlSeconds>120) throw new Error('Preview TTL must be 10..120 seconds');
  if(!Number.isInteger(c.intervalSeconds)||c.intervalSeconds<90||c.intervalSeconds>3600) throw new Error('Polling interval must be 90..3600 seconds');
  if(c.mode!=='preview'&&(c.executionEnabled!==true||process.env.ENABLE_EXECUTE!=='YES_I_UNDERSTAND')) throw new Error('Execution needs config.executionEnabled=true and ENABLE_EXECUTE=YES_I_UNDERSTAND');
  return applyMintScope(c,mintScope);
}
