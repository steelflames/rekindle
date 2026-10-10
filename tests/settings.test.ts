import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS} from '../shared/seeds.js';
import {mergeSettings} from '../server/settings.js';
test('two windows merge independent appearance and inference changes without clobbering either',()=>{
  const base=structuredClone(DEFAULT_SETTINGS);const current=structuredClone(base);current.ai.model='a-configured-model';current.ai.enabled=true;
  const requested=structuredClone(base);requested.theme='light';const next=mergeSettings(current,base,requested);
  assert.equal(next.theme,'light');assert.equal(next.ai.model,'a-configured-model');assert.equal(next.ai.enabled,true);
});
test('same-field concurrent edits fail visibly instead of overwriting newer preferences',()=>{
  const base=structuredClone(DEFAULT_SETTINGS);assert.throws(()=>mergeSettings({...base,depth:.2},base,{...base,depth:.9}),/another window/);
});
