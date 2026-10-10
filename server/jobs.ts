import { randomUUID } from 'node:crypto';
import type { Batch, Candidate, Job, ThreadSnapshot } from '../shared/types.js';
import { planSources, selectBatch } from '../shared/ranking.js';
import { clusterFor } from '../shared/seeds.js';
import { parseFeed, parseRedditJson, parseThreadFeed, redditThreadUrl } from './sources.js';
import { redditFetch, SourceRateLimit, rateLimitRemaining } from './network.js';
import { validateSnapshot } from '../shared/validation.js';
import type { Store } from './store.js';
import type { SecretStore } from './secrets.js';
import { HostedInference } from './inference.js';
import { recordInferenceAttempt } from './inference-usage.js';
export class Jobs {
  jobs:Job[]=[];controllers=new Map<string,AbortController>();inference=new HostedInference();keys=new Map<string,Job>();
  constructor(public store:Store,public secrets:SecretStore){}
  start(kind:Job['kind'],key:string,work:(job:Job,signal:AbortSignal)=>Promise<void>):Job{
    const active=this.keys.get(key);if(active?.status==='running')return active;
    const job:Job={id:randomUUID(),kind,status:'running',message:'Starting…',startedAt:new Date().toISOString()};
    const controller=new AbortController();this.jobs.unshift(job);this.jobs=this.jobs.slice(0,50);this.controllers.set(job.id,controller);this.keys.set(key,job);
    void work(job,controller.signal).then(()=>{if(controller.signal.aborted){job.status='cancelled';job.message='Cancelled. Completed captures remain local.';}else{job.status='complete';if(job.message==='Starting…')job.message='Complete';}}).catch(e=>{job.status=controller.signal.aborted?'cancelled':'failed';job.error=e instanceof Error?e.message:'Operation failed';job.message=job.error;}).finally(()=>{job.finishedAt=new Date().toISOString();this.controllers.delete(job.id);this.store.save();});
    return job;
  }
  cancel(id:string){this.controllers.get(id)?.abort();}
  saveSnapshot(snapshot:ThreadSnapshot){snapshot=validateSnapshot(snapshot);const source=this.store.state.sources.find(s=>s.name.toLowerCase()===snapshot.post.subreddit.toLowerCase());snapshot.post.cluster=source?.cluster??clusterFor(snapshot.post.subreddit);snapshot.post.lane=source?.lane??'adjacent';this.store.state.snapshots[snapshot.id]=snapshot;this.store.state.candidates[snapshot.post.id]=snapshot.post;this.store.save();return snapshot;}
  async getThread(url:string,signal:AbortSignal,known?:Candidate):Promise<ThreadSnapshot>{
    const u=redditThreadUrl(url);const token=this.secrets.get('redditToken');const path=u.pathname.replace(/\/$/,'')+(token?'.json?limit=100&depth=8&sort=new':'.rss?limit=100');
    const body=await redditFetch(path,{token,signal});const snap=token?parseRedditJson(JSON.parse(body),u.href):parseThreadFeed(body,u.href,known);snap.imported=false;return snap;
  }
  capture(url:string){redditThreadUrl(url);return this.start('capture',`capture:${url}`,async(job,signal)=>{job.message='Reading available source content…';const snap=await this.getThread(url,signal);signal.throwIfAborted();this.saveSnapshot(snap);job.snapshotId=snap.id;job.message=`Captured ${snap.comments.length} comments. Acquisition limits are shown in the reader.`;});}
  open(candidateId:string){
    const candidate=this.store.state.candidates[candidateId];if(!candidate)throw new Error('Discovery is no longer in the local cache');
    const existing=Object.values(this.store.state.snapshots).filter(s=>s.post.id===candidateId).sort((a,b)=>b.coverage.obtainedAt.localeCompare(a.coverage.obtainedAt))[0];if(existing)return {snapshot:existing};
    const snapshot:ThreadSnapshot={id:randomUUID(),version:1,post:structuredClone(candidate),comments:[],coverage:{obtainedAt:candidate.capturedAt,method:`${candidate.method}-listing`,retrieved:0,analyzed:0,siteReported:candidate.numComments,limits:['Post captured from a listing. Comments have not been retrieved.',...(rateLimitRemaining()>0?[`Reddit access is cooling down for ${Math.ceil(rateLimitRemaining()/1000)} seconds. Use Refresh source later or Firefox capture.`]:[])]},imported:false,sourceLabel:candidate.permalink??'Captured discovery listing'};
    this.saveSnapshot(snapshot);
    if(!candidate.permalink||rateLimitRemaining()>0)return {snapshot};
    const job=this.start('capture',`capture:${candidate.permalink}`,async(job,signal)=>{job.snapshotId=snapshot.id;job.message='Post is ready. Inspecting available comments…';const deeper=await this.getThread(candidate.permalink!,signal,candidate);signal.throwIfAborted();deeper.id=snapshot.id;deeper.version=snapshot.version+1;this.saveSnapshot(deeper);job.message=`Retrieved ${deeper.comments.length} comments. The reader is ready.`;});job.snapshotId=snapshot.id;
    return {snapshot,job};
  }
  curate(id:string){return this.start('curation',`curation:${id}`,async(job,signal)=>{const snap=this.store.state.snapshots[id];if(!snap)throw new Error('Source snapshot not found');job.snapshotId=id;job.message='Selecting human voices. Original comments are ready to read.';const result=await this.inference.curate(snap,this.store.state.settings,this.secrets.get('openaiKey'),signal,attempt=>{job.inferenceAttempt=attempt;recordInferenceAttempt(this.store.directory,attempt);});signal.throwIfAborted();this.store.state.curations[id]=result;snap.coverage.analyzed=result.analyzedIds.length;job.message=`Curated ${result.voices.length} voices with source-validated quotations.`;});}
  discover(mode:'fresh'|'recurate'|'continue'){
    return this.start('discovery','discovery',async(job,signal)=>{
      const state=this.store.state;const settings=structuredClone(state.settings);const started=new Date().toISOString();const existing=new Set(Object.keys(state.candidates));
      const batch:Batch={id:randomUUID(),createdAt:started,kind:mode==='fresh'?'fresh':'recurated',candidateIds:[],reasons:{},coverage:{attempted:[],accessible:[],failures:[],freshCandidates:0,cachedCandidates:Object.keys(state.candidates).length,inspectedThreads:0,notes:[]},settings,cursor:0};
      const pool:Candidate[]=[];
      if(mode==='fresh'){
        const sources=planSources(state);if(!sources.length)throw new Error('Enable at least one source in Tune.');
        let index=0;let paused=false;
        const worker=async()=>{while(index<sources.length&&!signal.aborted&&!paused){const source=sources[index++];batch.coverage.attempted.push(source.name);source.lastAttempt=new Date().toISOString();job.message=`Collecting ${batch.coverage.attempted.length}/${sources.length}: r/${source.name}`;
          try{const token=this.secrets.get('redditToken');const archival=settings.archival>0&&index>sources.length-Math.round(sources.length*settings.archival);const listing=archival?'top':'new';const query=`limit=${settings.postsPerSource}${archival?'&t=year':''}`;const data=await redditFetch(`/r/${source.name}/${listing}${token?'':'.rss'}?${query}`,{token,signal});
            let candidates:Candidate[];
            if(token){const listing=JSON.parse(data);candidates=(listing.data?.children??[]).filter((x:any)=>x.kind==='t3').map((x:any)=>parseRedditJson([{data:{children:[x]}},{data:{children:[]}}]).post);for(const c of candidates){c.cluster=source.cluster;c.lane=source.lane;c.method='reddit-oauth';}}
            else candidates=parseFeed(data,source);
            for(const c of candidates){c.archival=!!(c.publishedAt&&Date.now()-Date.parse(c.publishedAt)>90*86400000);c.commentsInspected=Math.max(c.commentsInspected,...Object.values(state.snapshots).filter(s=>s.post.id===c.id).map(s=>s.comments.length));if(!existing.has(c.id)){batch.coverage.freshCandidates++;existing.add(c.id);}state.candidates[c.id]=c;pool.push(c);}
            source.access='accessible';source.lastSuccess=new Date().toISOString();source.lastError=undefined;if(candidates.length)source.activity='observed';batch.coverage.accessible.push(source.name);
          }catch(e){if(signal.aborted)break;const error=e instanceof Error?e.message:'Source unavailable';source.access='unavailable';source.lastError=error;batch.coverage.failures.push({source:source.name,error});if(e instanceof SourceRateLimit){paused=true;batch.coverage.notes.push(`Collection paused at a rate limit. Not requested: ${sources.slice(index).map(s=>`r/${s.name}`).join(', ')||'none'}.`);}}
        }};
        await worker();state.sourceCursor+=batch.coverage.attempted.length;this.store.save();signal.throwIfAborted();
        batch.coverage.notes.push('Public feed collection does not establish expertise or comment quality. Missing scores remain unknown. Sources are rotated across the source roster.');
        if(!pool.length)batch.coverage.notes.push('No candidates were fetched. Re-curate existing unread candidates to use your local cache.');
        if(pool.length&&!batch.coverage.freshCandidates)batch.coverage.notes.push('Sources responded, but none of the retrieved IDs were new to the local cache.');
      }else{pool.push(...Object.values(state.candidates));batch.coverage.notes.push('Existing local candidates only. This is not a fresh source fetch.');}
      const selection=selectBatch(pool,{...state,settings});batch.candidateIds=selection.candidates.map(c=>c.id);batch.reasons=selection.reasons;
      if(mode==='fresh'&&rateLimitRemaining()===0){
        // Bounded scouting: one selected discussion and one quiet/early candidate outside the first selection.
        const scout=[selection.candidates.find(c=>c.format==='discussion'),pool.find(c=>!batch.candidateIds.includes(c.id)&&c.permalink)].filter((c):c is Candidate=>!!c).slice(0,2);
        for(const candidate of scout){if(signal.aborted)break;if(!candidate.permalink)continue;job.message=`Inspecting a branch from r/${candidate.subreddit}…`;try{const snap=await this.getThread(candidate.permalink,signal,candidate);candidate.commentsInspected=snap.comments.length;this.saveSnapshot(snap);batch.coverage.inspectedThreads++;}catch(e){batch.coverage.notes.push(`Thread inspection unavailable for ${candidate.id}: ${e instanceof Error?e.message:'source error'}`);}}
        if(batch.coverage.inspectedThreads){const reranked=selectBatch(pool,{...state,settings});batch.candidateIds=reranked.candidates.map(c=>c.id);batch.reasons=reranked.reasons;}
      }
      signal.throwIfAborted();state.batches.unshift(batch);state.batches=state.batches.slice(0,200);state.seen=[...new Set([...state.seen,...batch.candidateIds])];job.batchId=batch.id;
      job.message=batch.candidateIds.length?`${batch.candidateIds.length} discoveries selected. ${batch.coverage.freshCandidates} newly retrieved candidates; ${batch.coverage.accessible.length} accessible sources.`:'No unseen discoveries selected. Source coverage explains what was available.';
      this.store.save();
    });
  }
}
