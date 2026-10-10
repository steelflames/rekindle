import { z } from 'zod';
import type {ThreadSnapshot} from './types.js';
const text=(n=100000)=>z.string().max(n);
const nullable=text(2000).nullable();
export const safeKey=(max=200)=>z.string().min(1).max(max).refine(s=>!['__proto__','prototype','constructor'].includes(s),'Reserved object key is not an identifier');
const id=safeKey();
const timestamp=text(80).refine(s=>Number.isFinite(Date.parse(s)),'Invalid timestamp');
const record=<T extends z.ZodType>(value:T,max:number,key=safeKey())=>z.unknown().superRefine((input,ctx)=>{
  if(input&&typeof input==='object')for(const name of Object.keys(input))if(['__proto__','prototype','constructor'].includes(name))ctx.addIssue({code:'custom',message:'Reserved object key is not an identifier',path:[name]});
}).pipe(z.record(key,value).refine(v=>Object.keys(v).length<=max,`Object exceeds ${max} entries`));
export const publicUrl=z.string().max(4000).refine(s=>{
  try {
    const u=new URL(s);const hostname=u.hostname.toLowerCase().replace(/\.$/,'');
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!hostname.includes('.')||/\.(?:local|localhost|internal|lan|home)$/.test(hostname)||hostname.startsWith('['))return false;
    if(/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      const [a,b]=hostname.split('.').map(Number);
      if([0,10,127].includes(a)||a>=224||(a===169&&b===254)||(a===192&&b===168)||(a===172&&b>=16&&b<=31)||(a===100&&b>=64&&b<=127)||(a===198&&[18,19].includes(b)))return false;
    }
    return true;
  }catch{return false;}
},'Only public HTTP(S) source links are supported');
export const sourceSchema=z.object({name:z.string().regex(/^[A-Za-z0-9_]{2,50}$/),title:text(500),description:text(20000),cluster:text(100),enabled:z.boolean(),lane:z.enum(['familiar','adjacent','wildcard']),provenance:text(2000),access:z.enum(['unchecked','accessible','unavailable']),activity:z.enum(['unknown','observed']),lastAttempt:timestamp.optional(),lastSuccess:timestamp.optional(),lastError:text(2000).optional()});
export const candidateSchema=z.object({id,title:text(10000),body:text(200000),subreddit:text(100),author:nullable,permalink:publicUrl.nullable(),url:publicUrl.nullable(),publishedAt:timestamp.nullable(),capturedAt:timestamp,score:z.number().finite().nullable(),numComments:z.number().int().nonnegative().nullable(),flair:nullable,media:z.array(z.object({type:z.enum(['image','video','link']),url:publicUrl,caption:text(2000),preview:publicUrl.optional()})).max(30),cluster:text(100),lane:z.enum(['familiar','adjacent','wildcard']),format:z.enum(['discussion','story','visual','humor','link']),method:text(200),commentsInspected:z.number().int().nonnegative(),spoiler:z.boolean(),nsfw:z.boolean(),crosspostId:id.optional(),archival:z.boolean().optional()});
export const commentSchema=z.object({id,parentId:id.nullable(),author:nullable,body:text(200000),permalink:publicUrl.nullable(),score:z.number().finite().nullable(),publishedAt:timestamp.nullable(),flair:nullable,depth:z.number().int().min(0).max(500),locator:text(2000).optional()});
export const snapshotSchema=z.object({id,version:z.number().int().positive(),post:candidateSchema,comments:z.array(commentSchema).max(2000),coverage:z.object({obtainedAt:timestamp,method:text(200),retrieved:z.number().int().nonnegative(),analyzed:z.number().int().nonnegative(),siteReported:z.number().int().nonnegative().nullable(),limits:z.array(text(2000)).max(50)}),imported:z.boolean(),sourceLabel:text(2000)}).superRefine((snapshot,ctx)=>{
  const comments=new Map(snapshot.comments.map(c=>[c.id,c]));
  if(comments.size!==snapshot.comments.length)ctx.addIssue({code:'custom',message:'Duplicate comment identifiers',path:['comments']});
  if(comments.has(snapshot.post.id))ctx.addIssue({code:'custom',message:'Post and comment identifiers must be distinct',path:['comments']});
  const completed=new Set<string>();
  for(const comment of snapshot.comments) {
    const visiting=new Set<string>();let current=comment;
    while(!completed.has(current.id)) {
      if(visiting.has(current.id)){ctx.addIssue({code:'custom',message:'Cyclic comment parents',path:['comments']});break;}
      visiting.add(current.id);const parent=current.parentId?comments.get(current.parentId):undefined;if(!parent)break;current=parent;
    }
    for(const key of visiting)completed.add(key);
  }
  if(snapshot.coverage.retrieved<snapshot.comments.length)ctx.addIssue({code:'custom',message:'Retrieved count is smaller than captured comments',path:['coverage','retrieved']});
  if(snapshot.coverage.analyzed>snapshot.comments.length)ctx.addIssue({code:'custom',message:'Analyzed count exceeds captured comments',path:['coverage','analyzed']});
});
export function validateSnapshot(snapshot:unknown):ThreadSnapshot{return snapshotSchema.parse(snapshot);}
const knob=z.number().finite().min(0).max(1);
export const settingsSchema=z.object({theme:z.enum(['light','dark','system']),exploration:knob,depth:knob,archival:knob,contention:knob,batchSize:z.number().int().min(3).max(30),sourceBudget:z.number().int().min(1).max(16),postsPerSource:z.number().int().min(3).max(25),communityCap:z.number().int().min(1).max(10),clusterCap:z.number().int().min(1).max(20),topicWeights:record(z.number().min(0).max(3),1000,safeKey(100)),mutedTerms:z.array(text(100)).max(100),boostedTerms:z.array(text(100)).max(100),commentPrompt:text(20000),curatorPrompt:text(10000),ai:z.object({enabled:z.boolean(),provider:z.enum(['openai','compatible']),model:text(120),baseUrl:text(300),maxCallsPerRun:z.number().int().min(0).max(5),maxInputCharacters:z.number().int().min(1000).max(120000),maxOutputTokens:z.number().int().min(500).max(12000)})});
export const feedbackSchema=z.object({id,candidateId:id,action:z.enum(['magic','less','seen','not-today','misrepresented']),scope:z.enum(['topic','source','treatment','repetition','timing']),reason:text(2000),createdAt:timestamp,commentId:id.optional()});
const curationSchema=z.object({id,snapshotId:id,createdAt:timestamp,model:text(120),promptVersion:text(120),orientation:text(3500),voices:z.array(z.object({commentId:id,excerpts:z.array(z.object({start:z.number().int().nonnegative(),end:z.number().int().positive()})).min(1).max(6),contextIds:z.array(id).max(24),reason:text(2500),commentary:text(5000),kind:z.enum(['insight','story','humor','dissent','correction'])})).max(18),closing:text(3500),realityCheck:text(3500),analyzedIds:z.array(id).max(2000),usage:z.object({inputTokens:z.number().finite().nonnegative().nullable(),outputTokens:z.number().finite().nonnegative().nullable()}),warnings:z.array(text(5000)).max(100),mode:z.literal('ai')});
const reasonSchema=z.object({score:z.number().finite(),inputs:record(z.number().finite().nullable(),100),reasons:z.array(text(5000)).max(100),policy:text(200),lane:z.enum(['familiar','adjacent','wildcard'])});
export const stateSchema=z.object({schemaVersion:z.number().int().min(1).max(2),sources:z.array(sourceSchema).max(3000),profiles:z.array(z.object({name:text(100),provenance:text(2000)})).max(1000),settings:settingsSchema,candidates:record(candidateSchema,100000),snapshots:record(snapshotSchema,50000),curations:record(curationSchema,50000),batches:z.array(z.object({id,createdAt:timestamp,kind:z.enum(['fresh','recurated']),candidateIds:z.array(id).max(100),reasons:record(reasonSchema,100),coverage:z.object({attempted:z.array(text(100)).max(3000),accessible:z.array(text(100)).max(3000),failures:z.array(z.object({source:text(100),error:text(2000)})).max(3000),freshCandidates:z.number().int().nonnegative(),cachedCandidates:z.number().int().nonnegative(),inspectedThreads:z.number().int().nonnegative(),notes:z.array(text(5000)).max(100)}),settings:settingsSchema,cursor:z.number().int().nonnegative()})).max(1000),saved:z.array(z.object({id,candidateId:id,snapshotId:id.optional(),commentId:id.optional(),collection:text(200),savedAt:timestamp})).max(10000),feedback:z.array(feedbackSchema).max(30000),readPositions:record(z.number().finite().min(0).max(10000000),100000,safeKey(300)),seen:z.array(id).max(100000),sourceCursor:z.number().int().nonnegative()});
