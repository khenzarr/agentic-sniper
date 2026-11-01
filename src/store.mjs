import fs from 'node:fs/promises';
import path from 'node:path';
import { isAddress } from './policy.mjs';
export class Store {
  constructor(root,wallet) {
    if(!isAddress(wallet)) throw new Error('Invalid state wallet');
    this.dir=path.join(root,'state','56',wallet.toLowerCase());
  }
  async read(name,fallback) { try{return JSON.parse(await fs.readFile(path.join(this.dir,name+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;} }
  async write(name,value) {
    await fs.mkdir(this.dir,{recursive:true,mode:0o700});
    const f=path.join(this.dir,name+'.json'),tmp=f+'.'+process.pid+'.tmp';
    const handle=await fs.open(tmp,'w',0o600);
    try {await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}
    finally {await handle.close();}
    await fs.rename(tmp,f);
  }
  async lock(fn) {
    await fs.mkdir(this.dir,{recursive:true,mode:0o700});
    const f=path.join(this.dir,'execute.lock');
    let h;
    try {h=await fs.open(f,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new Error('Wallet runner already locked; inspect execute.lock before restarting');throw e;}
    try {await h.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));return await fn();}
    finally {await h.close();await fs.unlink(f);}
  }
}
