import {main} from './cli.mjs';
import {safeError} from './engine.mjs';
import {parseRunOptions} from './run-options.mjs';
try{const {command,mintScope}=parseRunOptions(process.argv.slice(2));await main([command],{mintScope});}catch(e){console.error('STOP: '+safeError(e));process.exitCode=1;}
