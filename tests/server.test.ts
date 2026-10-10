import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFeed, importSnapshot, redditThreadUrl } from '../server/sources.js';
import { DEFAULT_SETTINGS, initialState } from '../shared/seeds.js';
import { analysisSample } from '../server/inference.js';
import { temporaryDirectory } from './fixtures/test-directory.js';

const seedData=JSON.parse(readFileSync(new URL('./fixtures/seeds.json',import.meta.url),'utf8'));

test('source import excludes sidebar, preserves captured claims, and does not invent URLs or nesting',()=>{
  const snap=importSnapshot(readFileSync('resources/sample-thread.txt','utf8'),'synthetic-sample.txt');
  assert.equal(snap.post.title,'SYNTHETIC: The clock in the workshop');assert.equal(snap.comments.length,7);assert.ok(snap.comments.every(c=>c.permalink===null&&c.parentId===null));assert.ok(!snap.comments.some(c=>c.body.includes('Community Bookmarks')));
  assert.ok(snap.comments.some(c=>c.body.includes('thin spacer')));assert.equal(snap.coverage.analyzed,0);assert.equal(snap.imported,true);
});
test('source fetch allows only explicit Reddit discussion URLs',()=>{
  for(const url of ['file:///etc/passwd','http://127.0.0.1/','https://reddit.com.evil.test/r/x/comments/abc/a/','https://www.reddit.com:4433/r/x/comments/abc/a/','https://foo@www.reddit.com/r/x/comments/abc/a/'])assert.throws(()=>redditThreadUrl(url));
  assert.equal(redditThreadUrl('https://old.reddit.com/r/askscience/comments/abc/hello/?x=y').hostname,'www.reddit.com');
});
test('feed parser rejects entities and preserves unknown signals',()=>{
  const source=initialState(seedData).sources[0];
  assert.throws(()=>parseFeed('<!DOCTYPE a [<!ENTITY file SYSTEM "file:///x">]><feed/>',source));
  const posts=parseFeed('<feed><entry><id>t3_abc</id><title>Original title</title><link href="https://www.reddit.com/r/test/comments/abc/title/"/><content type="html">&lt;p&gt;A human story.&lt;/p&gt;</content></entry></feed>',source);
  assert.equal(posts[0].title,'Original title');assert.equal(posts[0].score,null);assert.equal(posts[0].numComments,null);assert.equal(posts[0].commentsInspected,0);
});
test('analysis sample attaches captured parents inside character budget',()=>{
  const snap=importSnapshot('A source story','plain.txt');snap.comments=[{id:'a',parentId:null,author:'person',body:'Question?',permalink:null,score:100,publishedAt:null,flair:null,depth:0},{id:'b',parentId:'a',author:'reply',body:'Actually, the missing factor is two.',permalink:null,score:1,publishedAt:null,flair:null,depth:1}];
  const sample=analysisSample(snap,1000);assert.deepEqual(new Set(sample.map(c=>c.id)),new Set(['a','b']));
});

test('local service authentication, persistence, quote saves, protected secrets and export integrity', {timeout:90000},async t=>{
  const directory=temporaryDirectory(t,'api');const port=47880+Math.floor(Math.random()*100);const origin=`http://127.0.0.1:${port}`;let child:ChildProcess|undefined;let cookie='';
  const childEnv={...process.env,REKINDLE_PORT:String(port),REKINDLE_DATA_DIR:directory};
  for(const key of ['REKINDLE_AI_KEY','OPENAI_API_KEY','REKINDLE_REDDIT_TOKEN'])delete (childEnv as NodeJS.ProcessEnv)[key];
  async function start(){child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:process.cwd(),env:childEnv,windowsHide:true,stdio:'pipe'});let logs='';child.stdout?.on('data',b=>logs+=b);child.stderr?.on('data',b=>logs+=b);for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('Service failed to start: '+logs);}
  async function stop(){if(!child)return;const c=child;child=undefined;c.kill();await new Promise<void>(r=>{if(c.exitCode!==null)r();else{c.once('exit',()=>r());setTimeout(r,2000);}});}
  async function call(path:string,input?:unknown,headers:Record<string,string>={}){const r=await fetch(origin+path,{method:input===undefined?'GET':'POST',headers:{Cookie:cookie,'X-Rekindle-Request':'1',...(input===undefined?{}:{'Content-Type':'application/json'}),...headers},body:input===undefined?undefined:JSON.stringify(input)});return {status:r.status,data:await r.json(),headers:r.headers};}
  async function login(){const r=await call('/api/session',{});assert.equal(r.status,200);cookie=r.headers.get('set-cookie')!.split(';')[0];}
  try{
    await start();assert.equal((await call('/api/state')).status,401);assert.equal((await call('/api/session',{}, {Origin:'https://hostile.example'})).status,403);await login();
    const boot=(await call('/api/state')).data;assert.equal(boot.state.sources.length,0);assert.equal(boot.state.profiles.length,0);assert.equal(boot.state.settings.ai.enabled,false);assert.deepEqual(boot.state.candidates,{});assert.deepEqual(boot.state.saved,[]);
    assert.equal((await call('/api/delete')).status,405);
    const source=initialState(seedData).sources[0];const duplicated=[source,source];assert.equal((await call('/api/sources',{sources:duplicated})).status,400);assert.equal((await call('/api/state')).data.state.sources.length,0);
    const imported=await call('/api/sample',{});assert.equal(imported.status,200);const snap=imported.data.snapshot;assert.equal(snap.comments.length,7);assert.match(snap.sourceLabel,/synthetic/i);
    assert.equal((await call('/api/save',{candidateId:snap.post.id,snapshotId:snap.id,commentId:snap.comments[0].id,collection:'Editorial test'})).status,200);
    assert.equal((await call('/api/position',{key:`thread:${snap.id}`,position:420})).status,200);
    assert.equal((await call('/api/position',{key:'__proto__',position:4})).status,400);
    const malformed=structuredClone(snap);malformed.post.id='__proto__';assert.equal((await call('/api/import',{text:JSON.stringify(malformed),filename:'bad.json'})).status,400);
    const snapshotWithCycle=structuredClone(snap);snapshotWithCycle.comments[0].parentId=snapshotWithCycle.comments[0].id;assert.equal((await call('/api/import',{text:JSON.stringify(snapshotWithCycle),filename:'cycle.json'})).status,400);
    if(process.platform==='win32'){
      assert.equal((await call('/api/secrets',{openaiKey:'SYNTHETIC-TEST-KEY-NOT-A-CREDENTIAL'})).status,200);
      assert.ok(!readFileSync(join(directory,'credentials.dpapi'),'utf8').includes('SYNTHETIC-TEST'));
      const pair=await call('/api/pair',{});assert.equal(pair.status,200);const pairing=pair.data.token;
      const capture=structuredClone(snap);capture.post.permalink='https://www.reddit.com/r/test/comments/abc/fixture/';capture.sourceLabel='Explicitly synthetic integration fixture';
      const captured=await call('/api/extension/capture',{snapshot:capture},{Authorization:`Bearer ${pairing}`,Origin:'moz-extension://fixture'});assert.equal(captured.status,200);
      const grant=captured.data.readerToken;const headers={Authorization:`Bearer ${grant}`};assert.equal((await call('/api/pair',{},headers)).status,403);
      assert.equal((await call('/api/save',{candidateId:snap.post.id,snapshotId:snap.id},headers)).status,400);
      assert.equal((await call('/api/state',undefined,headers)).data.state.profiles.length,0);
      assert.equal((await call('/api/extension/capture',{snapshot:capture},{Authorization:`Bearer ${grant}`})).status,403);
    }
    const backup=(await call('/api/export')).data;assert.ok(!JSON.stringify(backup).includes('SYNTHETIC-TEST-KEY'));assert.equal(backup.saved[0].collection,'Editorial test');
    const invalid=structuredClone(backup);invalid.saved[0].commentId='invented';assert.equal((await call('/api/restore',{data:invalid})).status,400);assert.equal((await call('/api/state')).data.state.saved.length,1);
    assert.equal((await call('/api/restore',{data:backup})).status,200);await stop();await start();cookie='';await login();const restored=(await call('/api/state')).data.state;assert.equal(restored.saved.length,1);assert.equal(restored.readPositions[`thread:${snap.id}`],420);
    assert.equal((await call('/api/settings',{settings:{...restored.settings,ai:{...DEFAULT_SETTINGS.ai,enabled:false}}})).status,200);const job=(await call('/api/curate',{snapshotId:snap.id})).data.job;assert.ok(job.id);await new Promise(r=>setTimeout(r,50));assert.equal((await call('/api/jobs')).data.jobs.find((j:any)=>j.id===job.id).status,'failed');
    writeFileSync(join(directory,'inference-usage.jsonl'),'SYNTHETIC USAGE JOURNAL');writeFileSync(join(directory,'inference-usage.jsonl.tmp'),'SYNTHETIC TEMP');
    assert.equal((await call('/api/delete',{confirmation:'DELETE',target:'all'})).status,200);
    assert.equal(existsSync(join(directory,'inference-usage.jsonl')),false);assert.equal(existsSync(join(directory,'inference-usage.jsonl.tmp')),false);assert.equal((await call('/api/jobs')).data.jobs.length,0);
  }finally{await stop();}
});
