// Compatibility entry: current radar, no fixed contract addresses.
import {main} from './src/cli.mjs';
import {safeError} from './src/engine.mjs';
try{await main(['audit']);}catch(e){console.error(safeError(e));process.exitCode=1;}
