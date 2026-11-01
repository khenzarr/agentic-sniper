import {main} from './cli.mjs';
import {safeError} from './engine.mjs';
try{await main();}catch(e){console.error('STOP: '+safeError(e));process.exitCode=1;}
