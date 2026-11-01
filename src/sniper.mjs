import {main} from './cli.mjs';
import {safeError} from './engine.mjs';
const command=process.argv.includes('--once')?'once':process.argv.includes('--loop')?'watch':null;
try{if(!command)throw new Error('Use --once or --loop');await main([command]);}catch(e){console.error('STOP: '+safeError(e));process.exitCode=1;}
