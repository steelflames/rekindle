import test from 'node:test';
import assert from 'node:assert/strict';
import type {TestContext} from 'node:test';
import {Store} from '../server/store.js';
import {SecretStore} from '../server/secrets.js';
import {Jobs} from '../server/jobs.js';
import type {Job} from '../shared/types.js';
import {temporaryDirectory} from './fixtures/test-directory.js';
async function finished(job:Job){for(let i=0;i<4000&&job.status==='running';i++)await new Promise(r=>setTimeout(r,10));assert.notEqual(job.status,'running');}
function setup(t:TestContext){const dir=temporaryDirectory(t,'discovery');const store=new Store(dir,'tests/fixtures/seeds.json');store.state.sources=store.state.sources.filter(s=>['ExampleExpertiseA','ExampleStoriesA','ExampleScienceA'].includes(s.name));store.state.settings.sourceBudget=3;const secrets=new SecretStore(dir);secrets.get=()=>undefined;return {store,jobs:new Jobs(store,secrets)};}
test('fresh discovery retrieves several clusters, deduplicates clicks and handles repeated/new IDs honestly', {timeout:60000},async t=>{
  const {store,jobs}=setup(t);const originalFetch=globalThis.fetch;let generation=0;let requests=0;
  globalThis.fetch=async(input,init)=>{requests++;assert.equal(init?.redirect,'error');const url=new URL(String(input));assert.equal(url.hostname,'www.reddit.com');const name=url.pathname.split('/')[2];const code=store.state.sources.findIndex(s=>s.name===name);const entries=[0,1,...(generation?[2]:[])].map(n=>`<entry><id>t3_a${code}${n}</id><title>How a ${name} mechanism works ${n}</title><link href="https://www.reddit.com/r/${name}/comments/a${code}${n}/mechanism/"/><published>2026-10-09T12:00:00Z</published><content type="html">&lt;p&gt;I built and measured a small mechanism.&lt;/p&gt;</content></entry>`).join('');return new Response(`<feed>${entries}</feed>`,{headers:{'content-type':'application/atom+xml'}});};
  try{
    const first=jobs.discover('fresh');assert.equal(jobs.discover('fresh').id,first.id);await finished(first);assert.equal(first.status,'complete');const a=store.state.batches[0];assert.equal(a.coverage.accessible.length,3);assert.equal(a.coverage.freshCandidates,6);assert.ok(new Set(a.candidateIds.map(id=>store.state.candidates[id].cluster)).size>=3);
    const repeat=jobs.discover('fresh');await finished(repeat);const b=store.state.batches[0];assert.equal(b.coverage.freshCandidates,0);assert.equal(b.candidateIds.length,0);assert.equal(store.state.batches[1].id,a.id);
    generation=1;await finished(jobs.discover('fresh'));const c=store.state.batches[0];assert.equal(c.coverage.freshCandidates,3);assert.ok(c.candidateIds.every(id=>!a.candidateIds.includes(id)));assert.ok(requests>3);
  }finally{globalThis.fetch=originalFetch;store.close();}
});
test('cancellation never reports a completed batch, and a global 429 stops remaining sources', {timeout:15000},async t=>{
  const {store,jobs}=setup(t);const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=async(_input,init)=>new Promise((_resolve,reject)=>{const signal=init?.signal;signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});if(signal?.aborted)reject(new Error('aborted'));});
    const cancelled=jobs.discover('fresh');jobs.cancel(cancelled.id);await finished(cancelled);assert.equal(cancelled.status,'cancelled');assert.equal(store.state.batches.length,0);
    let count=0;globalThis.fetch=async()=>{count++;return new Response('',{status:429,headers:{'retry-after':'60'}});};
    const limited=jobs.discover('fresh');await finished(limited);assert.equal(limited.status,'complete');assert.equal(count,1);assert.equal(store.state.batches[0].coverage.accessible.length,0);assert.ok(store.state.batches[0].coverage.notes.some(n=>n.includes('Not requested:')));
  }finally{globalThis.fetch=originalFetch;store.close();}
});
