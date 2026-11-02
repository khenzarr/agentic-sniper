import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
test('install has no wallet or automatic lifecycle hooks',()=>{
  for(const k of ['preinstall','install','postinstall','prepare','prepublish','prepack','postpack'])assert.equal(pkg.scripts[k],undefined);
});
test('tests are portable and old execution entry is removed',()=>{
  assert.equal(pkg.scripts.test,'node --test');
  assert.equal(pkg.scripts.execute,undefined);
});

test('free and all commands select process-local scopes without shell-specific environment syntax',()=>{
  assert.equal(pkg.scripts['sniper:free'],'node src/sniper.mjs --loop --mint-scope free');
  assert.equal(pkg.scripts['sniper:all'],'node src/sniper.mjs --loop --mint-scope all');
});
