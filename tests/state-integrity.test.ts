import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {candidateSchema,publicUrl,safeKey,settingsSchema,snapshotSchema,stateSchema,validateSnapshot} from '../shared/validation';
import {migrateState,Store} from '../server/store';
import {initialState} from '../shared/seeds';
import {validateCuration} from '../shared/integrity';
import {EDITORIAL_FIXTURES,fixturePost,fixtureRaw} from './fixtures/editorial';

const seedPath=fileURLToPath(new URL('./fixtures/seeds.json',import.meta.url));
const seedData=JSON.parse(readFileSync(seedPath,'utf8'));
const state=()=>initialState(seedData);
test('prototype-reserved identifiers and record keys reject before persistent map assignments',()=>{
  for(const key of ['__proto__','constructor','prototype']) {
    assert.equal(safeKey().safeParse(key).success,false);
    assert.equal(candidateSchema.safeParse(fixturePost({id:key})).success,false);
    const raw=state();Object.defineProperty(raw.readPositions,key,{value:100,enumerable:true,configurable:true});
    assert.equal(stateSchema.safeParse(raw).success,false);
    const settings=structuredClone(raw.settings);Object.defineProperty(settings.topicWeights,key,{value:2,enumerable:true});assert.equal(settingsSchema.safeParse(settings).success,false);
  }
  assert.equal(Object.getPrototypeOf(state().candidates),Object.prototype);
});
test('source URL checks reject local services, canonical IP encodings, credentials and executable schemes',()=>{
  for(const url of ['http://127.0.0.1:47831/api/export','http://localhost.','http://2130706433/','http://0x7f000001/','http://169.254.169.254/','http://10.1.2.3/','http://192.168.1.1/','http://[::1]/','http://office.internal/','http://printer/','javascript:alert(1)','data:text/html,hello','https://secret@example.org/'])assert.equal(publicUrl.safeParse(url).success,false,url);
  for(const url of ['https://www.reddit.com/r/test/comments/abc/title/','https://i.redd.it/example.png','https://example.org/article'])assert.equal(publicUrl.safeParse(url).success,true,url);
});
test('snapshot rejects duplicate IDs, cyclic parents and fabricated coverage counts',()=>{
  const good=structuredClone(EDITORIAL_FIXTURES[0].snapshot);assert.doesNotThrow(()=>validateSnapshot(good));
  const duplicate=structuredClone(good);duplicate.comments.push({...duplicate.comments[0]});duplicate.coverage.retrieved++;assert.equal(snapshotSchema.safeParse(duplicate).success,false);
  const cycle=structuredClone(good);cycle.comments[0].parentId=cycle.comments[1].id;assert.equal(snapshotSchema.safeParse(cycle).success,false);
  const self=structuredClone(good);self.comments[0].parentId=self.comments[0].id;assert.equal(snapshotSchema.safeParse(self).success,false);
  const count=structuredClone(good);count.coverage.analyzed=900;assert.equal(snapshotSchema.safeParse(count).success,false);
  assert.doesNotThrow(()=>validateSnapshot(EDITORIAL_FIXTURES[5].snapshot),'missing parents stay honest unknowns, not malformed cycles');
});
test('backup migration preserves preferences, saves, quoted sources and reading position without secrets',()=>{
  const original=state();const snapshot=structuredClone(EDITORIAL_FIXTURES[1].snapshot);original.candidates[snapshot.post.id]=snapshot.post;original.snapshots[snapshot.id]=snapshot;
  original.curations[snapshot.id]=validateCuration(fixtureRaw(snapshot,['story']),snapshot,{model:'synthetic-test-no-inference',analyzedIds:snapshot.comments.map(c=>c.id)});
  snapshot.coverage.analyzed=snapshot.comments.length;
  original.saved=[{id:'saved-quote',candidateId:snapshot.post.id,snapshotId:snapshot.id,commentId:'story',collection:'Quiet stories',savedAt:new Date().toISOString()}];original.readPositions[`thread:${snapshot.id}`]=812;original.settings.depth=.72;
  const exported=JSON.parse(JSON.stringify(original));assert.deepEqual(migrateState(exported),original);assert(!JSON.stringify(exported).includes('openaiKey'));
  const versionOne={...exported,schemaVersion:1};delete versionOne.sourceCursor;delete versionOne.readPositions;const migrated=migrateState(versionOne);assert.equal(migrated.schemaVersion,2);assert.equal(migrated.sourceCursor,0);assert.equal(migrated.saved[0].collection,'Quiet stories');assert.equal(migrated.settings.depth,.72);
});
test('backup rejects candidate identity mismatches, dangling saves, wrong curation context and invalid references',()=>{
  const badKey=state();badKey.candidates.wrong=fixturePost();assert.throws(()=>migrateState(badKey),/Candidate identity/);
  const badSave=state();badSave.candidates.post=fixturePost({id:'post'});badSave.saved=[{id:'saved',candidateId:'post',commentId:'invented',collection:'X',savedAt:new Date().toISOString()}];assert.throws(()=>migrateState(badSave),/Saved quote/);
  const snapshot=structuredClone(EDITORIAL_FIXTURES[2].snapshot);const corrupted=state();corrupted.candidates[snapshot.post.id]=snapshot.post;corrupted.snapshots[snapshot.id]=snapshot;const curation=validateCuration(fixtureRaw(snapshot,['punchline']),snapshot,{model:'synthetic-test-no-inference',analyzedIds:snapshot.comments.map(c=>c.id)});snapshot.coverage.analyzed=snapshot.comments.length;curation.voices[0].contextIds=[];corrupted.curations[snapshot.id]=curation;assert.throws(()=>migrateState(corrupted),/missing parent context/);
  const duplicate=state();duplicate.sources.push({...duplicate.sources[0],name:duplicate.sources[0].name.toUpperCase()});assert.throws(()=>migrateState(duplicate),/Duplicate community/);
});
test('SQLite restore is validated before replacement and survives a close/reopen with rollback backup',()=>{
  const directory=mkdtempSync(join(tmpdir(),'rekindle-store-test-'));let store:Store|undefined;
  try {
    store=new Store(directory,seedPath);store.state.settings.depth=.81;store.save();
    const next=state();next.settings.depth=.23;store.replace(next);assert.equal(store.state.settings.depth,.23);
    const backup=store.db.prepare("SELECT body FROM document WHERE key='before-restore'").get() as {body:string};assert.equal(JSON.parse(backup.body).settings.depth,.81);
    const invalid=state();invalid.candidates.bad=fixturePost();assert.throws(()=>store!.replace(invalid));assert.equal(store.state.settings.depth,.23);
    store.close();store=undefined;store=new Store(directory,seedPath);assert.equal(store.state.settings.depth,.23);assert.equal(store.state.sources.length,24);
  }finally{store?.close();assert(resolve(directory).startsWith(resolve(tmpdir())+sep)&&basename(directory).startsWith('rekindle-store-test-'));rmSync(directory,{recursive:true,force:true});}
});
