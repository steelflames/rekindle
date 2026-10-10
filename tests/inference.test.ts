import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { HostedInference } from '../server/inference.js';
import { clearInferenceAttempts, MAX_USAGE_ATTEMPTS, recordInferenceAttempt } from '../server/inference-usage.js';
import { Jobs } from '../server/jobs.js';
import { Store } from '../server/store.js';
import { SecretStore } from '../server/secrets.js';
import { DEFAULT_SETTINGS } from '../shared/seeds.js';
import type { InferenceAttempt } from '../shared/types.js';
import { EDITORIAL_FIXTURES, fixtureRaw } from './fixtures/editorial.js';
import { temporaryDirectory } from './fixtures/test-directory.js';

function settings(){const s=structuredClone(DEFAULT_SETTINGS);s.ai.enabled=true;s.ai.model='synthetic-model-not-a-live-call';return s;}
function response(raw:unknown,usage:unknown){return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(raw)}]}],usage});}

test('mock provider usage survives strict unrelated-context rejection in the durable journal and scoped job',async t=>{
  const directory=temporaryDirectory(t,'inference');const store=new Store(directory,resolve('tests/fixtures/seeds.json'));
  const snapshot=structuredClone(EDITORIAL_FIXTURES[1].snapshot);const raw=fixtureRaw(snapshot,['story']);raw.voices[0].contextIds=['agreement'];
  let requests=0;let sentInstructions='';
  t.mock.method(globalThis,'fetch',async(_url:unknown,options:RequestInit)=>{requests++;sentInstructions=JSON.parse(String(options.body)).instructions;return response(raw,{input_tokens:333,output_tokens:44});});
  const secrets=new SecretStore(directory);secrets.value.openaiKey='SYNTHETIC-TEST-KEY';const jobs=new Jobs(store,secrets);store.state.settings=settings();jobs.saveSnapshot(snapshot);
  try{
    const job=jobs.curate(snapshot.id);
    for(let i=0;i<100&&job.status==='running';i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(job.status,'failed');assert.match(job.error!,/unrelated comment presented as exchange context/);
    assert.equal(job.snapshotId,snapshot.id,'failed jobs remain inside the reader source scope');
    assert.equal(job.inferenceAttempt?.code,'integrity_rejected');assert.equal(job.inferenceAttempt?.status,'rejected');
    assert.deepEqual(job.inferenceAttempt?.usage,{inputTokens:333,outputTokens:44});assert.equal(job.inferenceAttempt?.httpStatus,200);
    assert.equal(requests,1,'no automatic retry after a potentially billable response');
    assert.equal(store.state.curations[snapshot.id],undefined);assert.equal(snapshot.coverage.analyzed,0);
    assert.match(sentInstructions,/all parentId values are null, every contextIds array MUST be empty/);
    assert.match(sentInstructions,/NEVER infer a reply, exchange, setup, or conversation from semantic similarity/);
    const journal=readFileSync(join(directory,'inference-usage.jsonl'),'utf8');const records=journal.trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(records.length,1);assert.deepEqual(records[0],job.inferenceAttempt);
    for(const secretOrSource of ['SYNTHETIC-TEST-KEY',snapshot.comments[1].body,sentInstructions,'agreement'])assert.ok(!journal.includes(secretOrSource));
    assert.ok(!JSON.stringify(store.state).includes('inferenceAttempt'),'normal library export omits the separate attempt journal');
  }finally{store.close();}
});

test('mock accepted response records real zero separately from unavailable usage',async t=>{
  const snapshot=structuredClone(EDITORIAL_FIXTURES[1].snapshot);const attempts:InferenceAttempt[]=[];
  t.mock.method(globalThis,'fetch',async()=>response(fixtureRaw(snapshot,['story']),{input_tokens:0,output_tokens:'not a count'}));
  const curation=await new HostedInference().curate(snapshot,settings(),'SYNTHETIC-TEST-KEY',new AbortController().signal,attempt=>attempts.push(attempt));
  assert.deepEqual(curation.usage,{inputTokens:0,outputTokens:null});
  assert.deepEqual(attempts.map(a=>a.status),['started','received','accepted']);
  assert.deepEqual(attempts[0].usage,{inputTokens:null,outputTokens:null});
  assert.deepEqual(attempts[2].usage,curation.usage);
});

test('an unavailable usage journal blocks submission before any provider request',async t=>{
  let requests=0;t.mock.method(globalThis,'fetch',async()=>{requests++;throw new Error('must not request');});
  await assert.rejects(new HostedInference().curate(structuredClone(EDITORIAL_FIXTURES[1].snapshot),settings(),'SYNTHETIC-TEST-KEY',new AbortController().signal,()=>{throw new Error('disk unavailable');}),/usage could not be recorded/);
  assert.equal(requests,0);
});

test('usage journal is bounded, strips extra fields, and clears durable and temporary files',t=>{
  const directory=temporaryDirectory(t,'inference-usage');const now=new Date().toISOString();
  const base:InferenceAttempt={id:randomUUID(),startedAt:now,updatedAt:now,model:'synthetic-model',status:'rejected',code:'integrity_rejected',httpStatus:200,submittedComments:2000,usage:{inputTokens:8,outputTokens:3}};
  const existing=Array.from({length:MAX_USAGE_ATTEMPTS},()=>({...base,id:randomUUID()}));
  const file=join(directory,'inference-usage.jsonl');writeFileSync(file,existing.map(x=>JSON.stringify(x)).join('\n')+'\n');
  recordInferenceAttempt(directory,{...base,apiKey:'SYNTHETIC-SECRET',output:'PRIVATE-RESPONSE'} as InferenceAttempt);
  const text=readFileSync(file,'utf8');const records=text.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(records.length,MAX_USAGE_ATTEMPTS);assert.equal(records[0].id,existing[1].id);assert.equal(records.at(-1).id,base.id);
  assert.ok(!text.includes('SYNTHETIC-SECRET'));assert.ok(!text.includes('PRIVATE-RESPONSE'));
  assert.throws(()=>recordInferenceAttempt(directory,{...base,submittedComments:2001}));
  writeFileSync(join(directory,'inference-usage.jsonl.tmp'),'SYNTHETIC TEMP');clearInferenceAttempts(directory);
  assert.equal(existsSync(file),false);assert.equal(existsSync(join(directory,'inference-usage.jsonl.tmp')),false);
});
