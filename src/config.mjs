import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function loadConfig() {
  try { process.loadEnvFile(path.join(ROOT,'.env')); } catch(e) { if(e.code!=='ENOENT') throw e; }
  const raw=JSON.parse(await fs.readFile(path.join(ROOT,'config.json'),'utf8'));
  const c={chainId:56,sourceUrl:'https://agenticmint.ai/?f=bedava',dailyLimit:5,maxGasWei:'100000000000000',gasPaddingPercent:20,previewTtlSeconds:120,intervalSeconds:120,mode:'preview',...raw};
  c.mode=process.env.SNIPER_MODE || c.mode;
  c.intervalSeconds=Number(process.env.SNIPER_INTERVAL_SECONDS || c.intervalSeconds);
  if(c.chainId!==56 || c.sourceUrl!=='https://agenticmint.ai/?f=bedava') throw new Error('Only BSC and the official radar are supported');
  if(!['preview','app','auto'].includes(c.mode)) throw new Error('SNIPER_MODE must be preview, app or auto');
  if(!Number.isSafeInteger(c.dailyLimit)||c.dailyLimit<1||c.dailyLimit>100) throw new Error('dailyLimit must be 1..100');
  if(!/^\d+$/.test(c.maxGasWei)||BigInt(c.maxGasWei)<=0n) throw new Error('Invalid maxGasWei');
  if(!Number.isInteger(c.gasPaddingPercent)||c.gasPaddingPercent<0||c.gasPaddingPercent>100) throw new Error('Invalid gas padding');
  if(!Number.isInteger(c.previewTtlSeconds)||c.previewTtlSeconds<10||c.previewTtlSeconds>120) throw new Error('Preview TTL must be 10..120 seconds');
  if(!Number.isInteger(c.intervalSeconds)||c.intervalSeconds<90||c.intervalSeconds>3600) throw new Error('Polling interval must be 90..3600 seconds');
  if(c.mode!=='preview'&&(c.executionEnabled!==true||process.env.ENABLE_EXECUTE!=='YES_I_UNDERSTAND')) throw new Error('Execution needs config.executionEnabled=true and ENABLE_EXECUTE=YES_I_UNDERSTAND');
  return c;
}
