export function parseRunOptions(args) {
  let command,mintScope,check=false;
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--once'||arg==='--loop'){
      if(command)throw new Error('Choose exactly one of --once or --loop');
      command=arg==='--once'?'once':'watch';
    }else if(arg==='--mint-scope'){
      if(mintScope!==undefined)throw new Error('Choose only one mint scope');
      mintScope=args[++i];
      if(!['free','all'].includes(mintScope))throw new Error('--mint-scope must be free or all');
    }else if(arg==='--check')check=true;
    else throw new Error('Unknown sniper option: '+arg);
  }
  if(!command)throw new Error('Use --once or --loop');
  return {command:check?'doctor':command,mintScope};
}

export function applyMintScope(config,mintScope) {
  if(mintScope===undefined)return {...config,mintScope:config.paidEnabled?'all':'free'};
  if(!['free','all'].includes(mintScope))throw new Error('Mint scope must be free or all');
  return {...config,mintScope,paidEnabled:mintScope==='all',maxMint:true};
}
