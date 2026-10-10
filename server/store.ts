import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppState } from '../shared/types.js';
import { stateSchema, validateSnapshot } from '../shared/validation.js';
import { initialState } from '../shared/seeds.js';
import { validateCuration } from '../shared/integrity.js';

export function migrateState(raw: unknown): AppState {
  const s = raw as Record<string,unknown>;
  if (!s || typeof s !== 'object') throw new Error('Invalid backup. Your current library has not changed.');
  if (s.schemaVersion === 1) raw = {...s, schemaVersion:2,readPositions:s.readPositions??{},sourceCursor:s.sourceCursor??0};
  const state = stateSchema.parse(raw);
  const ids=new Set<string>();
  for(const source of state.sources){const key=source.name.toLowerCase();if(ids.has(key))throw new Error('Duplicate community in backup');ids.add(key);}
  const profileIds=new Set<string>();for(const profile of state.profiles){const key=profile.name.toLowerCase();if(profileIds.has(key))throw new Error('Duplicate followed profile in backup');profileIds.add(key);}
  for(const [id,candidate] of Object.entries(state.candidates))if(id!==candidate.id)throw new Error('Candidate identity mismatch');
  for(const [id,snapshot] of Object.entries(state.snapshots)){
    if(id!==snapshot.id)throw new Error('Snapshot identity mismatch');
    validateSnapshot(snapshot);
    if(!Object.hasOwn(state.candidates,snapshot.post.id))throw new Error('Snapshot missing its candidate');
  }
  for(const [key,c] of Object.entries(state.curations)){
    if(key!==c.snapshotId)throw new Error('Curation must be keyed by its source snapshot');
    const snap=state.snapshots[c.snapshotId];if(!snap)throw new Error('Curation missing its source snapshot');
    if(new Set(c.analyzedIds).size!==c.analyzedIds.length)throw new Error('Duplicate analyzed source identifiers');
    if(snap.coverage.analyzed!==c.analyzedIds.length)throw new Error('Analyzed coverage does not match curation sources');
    for(const voice of c.voices){const comment=snap.comments.find(x=>x.id===voice.commentId);if(!comment)throw new Error('Curation references missing source');for(const span of voice.excerpts)if(span.end<=span.start||span.end>comment.body.length)throw new Error('Quote range outside source');}
    validateCuration({orientation:c.orientation,voices:c.voices,closing:c.closing,realityCheck:c.realityCheck},snap,{id:c.id,model:c.model,promptVersion:c.promptVersion,createdAt:c.createdAt,usage:c.usage,analyzedIds:c.analyzedIds});
  }
  const savedIds=new Set<string>();for(const saved of state.saved){if(savedIds.has(saved.id))throw new Error('Duplicate saved item identifiers');savedIds.add(saved.id);}
  for(const s of state.saved){if(!state.candidates[s.candidateId])throw new Error('Saved item missing candidate');if(s.snapshotId&&!state.snapshots[s.snapshotId])throw new Error('Saved item missing snapshot');if(s.snapshotId&&state.snapshots[s.snapshotId].post.id!==s.candidateId)throw new Error('Saved item source mismatch');if(s.commentId&&(!s.snapshotId||!state.snapshots[s.snapshotId].comments.some(c=>c.id===s.commentId)))throw new Error('Saved quote missing its comment source');}
  const batchIds=new Set<string>();for(const batch of state.batches){if(batchIds.has(batch.id))throw new Error('Duplicate batch identifiers');batchIds.add(batch.id);if(new Set(batch.candidateIds).size!==batch.candidateIds.length)throw new Error('Duplicate candidate in batch');for(const candidateId of batch.candidateIds)if(!Object.hasOwn(state.candidates,candidateId))throw new Error('Batch references unavailable candidate');for(const reasonId of Object.keys(batch.reasons))if(!batch.candidateIds.includes(reasonId))throw new Error('Batch reason references an unselected candidate');if(batch.cursor>batch.candidateIds.length)throw new Error('Batch cursor outside available items');}
  const feedbackIds=new Set<string>();for(const feedback of state.feedback){if(feedbackIds.has(feedback.id))throw new Error('Duplicate feedback identifiers');feedbackIds.add(feedback.id);if(!Object.hasOwn(state.candidates,feedback.candidateId))throw new Error('Feedback missing candidate');}
  return state;
}
export class Store {
  db: DatabaseSync;
  state: AppState;
  constructor(public directory: string, seedPath: string) {
    mkdirSync(directory,{recursive:true});
    this.db=new DatabaseSync(join(directory,'rekindle.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS document (key TEXT PRIMARY KEY, body TEXT NOT NULL);');
    const row=this.db.prepare("SELECT body FROM document WHERE key='state'").get() as {body:string}|undefined;
    this.state=row?migrateState(JSON.parse(row.body)):initialState(JSON.parse(readFileSync(seedPath,'utf8')));
    this.save();
  }
  save(){this.db.prepare("INSERT INTO document(key,body) VALUES('state',?) ON CONFLICT(key) DO UPDATE SET body=excluded.body").run(JSON.stringify(this.state));}
  replace(raw:unknown){
    const next=migrateState(raw);const serialized=JSON.stringify(next);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("INSERT INTO document(key,body) VALUES('before-restore',?) ON CONFLICT(key) DO UPDATE SET body=excluded.body").run(JSON.stringify(this.state));
      this.db.prepare("INSERT INTO document(key,body) VALUES('state',?) ON CONFLICT(key) DO UPDATE SET body=excluded.body").run(serialized);
      this.db.exec('COMMIT');this.state=next;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  close(){this.db.close();}
}
