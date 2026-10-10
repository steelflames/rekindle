import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, migrateState } from './store.js';
import { SecretStore } from './secrets.js';
import { Jobs } from './jobs.js';
import { clearInferenceAttempts } from './inference-usage.js';
import { importSnapshot } from './sources.js';
import { initialState, normalizeSeeds } from '../shared/seeds.js';
import { applyNaturalTuning } from '../shared/ranking.js';
import { snapshotSchema, settingsSchema, sourceSchema, feedbackSchema } from '../shared/validation.js';
import type { AppState } from '../shared/types.js';
import { mergeSettings } from './settings.js';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),process.argv[1]?.includes('dist')?'../..':'..');
const PORT=Number(process.env.REKINDLE_PORT||47831);
const ORIGIN=`http://127.0.0.1:${PORT}`;
const DATA=resolve(process.env.REKINDLE_DATA_DIR||join(ROOT,'data'));
const SEEDS=join(ROOT,'resources/rekindle-seeds.json');
const SAMPLE=join(ROOT,'resources/sample-thread.txt');
mkdirSync(DATA,{recursive:true});
const store=new Store(DATA,SEEDS);const secrets=new SecretStore(DATA);let credentialLoadError='';try{await secrets.load();}catch{credentialLoadError='Saved credentials could not be unlocked by this Windows user. The encrypted file is preserved. Source-only reading remains available.';console.warn(credentialLoadError);}const jobs=new Jobs(store,secrets);
const portalSessions=new Map<string,number>();const readerSessions=new Map<string,{snapshotId:string;expires:number}>();
const token=()=>randomBytes(32).toString('hex');
const equal=(a:string|undefined,b:string|undefined)=>!!a&&!!b&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function json(res:ServerResponse,value:unknown,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req:IncomingMessage){if(!req.headers['content-type']?.startsWith('application/json'))throw new Error('JSON content type required');let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>25_000_000)throw new Error('Request exceeds 25 MB');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw new Error('Invalid JSON request');}}
function auth(req:IncomingMessage):{kind:'portal'|'extension'|'reader';snapshotId?:string}|null{
  const bearer=req.headers.authorization?.replace(/^Bearer /,'');
  if(bearer){if(equal(bearer,secrets.get('pairToken')))return {kind:'extension'};const reader=readerSessions.get(bearer);if(reader&&reader.expires>Date.now())return {kind:'reader',snapshotId:reader.snapshotId};return null;}
  const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('rekindle_session='))?.slice(17);
  if(cookie&&(portalSessions.get(cookie)??0)>Date.now())return {kind:'portal'};return null;
}
function stateForReader(id:string):AppState{const snap=store.state.snapshots[id];return {...store.state,sources:[],profiles:[],candidates:snap?{[snap.post.id]:snap.post}:{},snapshots:snap?{[id]:snap}:{},curations:store.state.curations[id]?{[id]:store.state.curations[id]}:{},batches:[],saved:store.state.saved.filter(x=>x.snapshotId===id),feedback:store.state.feedback.filter(x=>x.candidateId===snap?.post.id),seen:[],readPositions:{[`thread:${id}`]:store.state.readPositions[`thread:${id}`]??0}};}
function credentialsConfigured(){const s=store.state.settings;return Boolean(secrets.get('openaiKey')||(s.ai.provider==='compatible'&&/^http:\/\/127\.0\.0\.1:(11434|1234)\/v1\/?$/.test(s.ai.baseUrl)));}
function csp(embed:boolean){return `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://i.redd.it https://preview.redd.it https://external-preview.redd.it https://*.thumbs.redditmedia.com; media-src https://v.redd.it https://i.redd.it; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'${embed?' moz-extension: https://www.reddit.com https://old.reddit.com https://new.reddit.com https://reddit.com':''}`;}
const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  try{
    if(req.headers.host!==`127.0.0.1:${PORT}`){json(res,{error:'Invalid local host'},403);return;}
    const url=new URL(req.url||'/',ORIGIN);const path=url.pathname;const origin=req.headers.origin;
    const extensionOrigin=!!origin&&/^moz-extension:\/\/[a-zA-Z0-9-]+$/.test(origin);
    if(origin&&origin!==ORIGIN&&!extensionOrigin){json(res,{error:'Untrusted origin'},403);return;}
    if(extensionOrigin){res.setHeader('Access-Control-Allow-Origin',origin!);res.setHeader('Vary','Origin');}
    if(req.method==='OPTIONS'){if(!extensionOrigin&&origin!==ORIGIN){json(res,{error:'Origin required'},403);return;}res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, X-Rekindle-Request, X-Rekindle-Session');res.setHeader('Access-Control-Allow-Methods','GET, POST, DELETE');res.writeHead(204);res.end();return;}
    if(path==='/api/health'&&req.method==='GET'){json(res,{ok:true,version:'0.1.0'});return;}
    if(path==='/api/session'&&req.method==='POST'){
      if(req.headers['x-rekindle-request']!=='1'){json(res,{error:'Local session header required'},403);return;}
      const grant=String(req.headers['x-rekindle-session']||'');
      if(grant){const item=readerSessions.get(grant);if(!item||item.expires<Date.now()){json(res,{error:'Reader session expired; capture again from Firefox.'},401);return;}json(res,{token:grant});return;}
      if(extensionOrigin||req.headers['sec-fetch-site']==='cross-site'){json(res,{error:'Open Rekindle directly to begin a local session'},403);return;}
      const session=token();portalSessions.set(session,Date.now()+7*86400000);res.setHeader('Set-Cookie',`rekindle_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);json(res,{ok:true});return;
    }
    if(path.startsWith('/api/')){
      const identity=auth(req);if(!identity){json(res,{error:'Open Rekindle directly or pair the Firefox extension.'},401);return;}
      if(!['GET','HEAD'].includes(req.method||'')&&req.headers['x-rekindle-request']!=='1'){json(res,{error:'Local request header required'},403);return;}
      if(identity.kind==='extension'&&!['/api/extension/status','/api/extension/capture'].includes(path)){json(res,{error:'Extension token limited to capture'},403);return;}
      if(identity.kind==='reader'&&!['/api/state','/api/jobs','/api/curate','/api/save','/api/feedback','/api/position'].includes(path)&&!/^\/api\/jobs\/[^/]+\/cancel$/.test(path)){json(res,{error:'Reader capability limited to this source'},403);return;}
      if(path==='/api/state'&&req.method==='GET'){json(res,{state:identity.kind==='reader'?stateForReader(identity.snapshotId!):store.state,jobs:identity.kind==='reader'?jobs.jobs.filter(j=>j.snapshotId===identity.snapshotId):jobs.jobs,runtime:{inferenceConfigured:credentialsConfigured(),redditConfigured:!!secrets.get('redditToken'),version:'0.1.0',retention:credentialLoadError||'Captured content stays locally until you delete it. Discovery history keeps the latest 200 batches. Source refresh creates a new snapshot; saved captures are retained. Use Clear cache to remove unretained content. Back up with Export.'}});return;}
      if(path==='/api/jobs'&&req.method==='GET'){json(res,{jobs:identity.kind==='reader'?jobs.jobs.filter(j=>j.snapshotId===identity.snapshotId):jobs.jobs});return;}
      if(path==='/api/extension/status'&&req.method==='GET'){json(res,{ok:true,version:'0.1.0'});return;}
      if(path==='/api/export'&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="rekindle-backup.json"');json(res,store.state);return;}
      if(path==='/api/secrets'&&req.method==='DELETE'){secrets.clear();json(res,{ok:true});return;}
      if(req.method!=='POST'){json(res,{error:'Method not allowed'},405);return;}
      const input=await body(req);
      if(identity.kind==='reader'){
        const snap=store.state.snapshots[identity.snapshotId!];if(!snap)throw new Error('Source was deleted');
        if(path==='/api/curate'&&input.snapshotId!==snap.id||['/api/save','/api/feedback'].includes(path)&&input.candidateId!==snap.post.id||path==='/api/position'&&input.key!==`thread:${snap.id}`){json(res,{error:'Reader capability does not cover this source'},403);return;}
      }
      if(path==='/api/settings'){store.state.settings=input.baseSettings?mergeSettings(store.state.settings,input.baseSettings,input.settings):settingsSchema.parse(input.settings);store.save();json(res,{ok:true});return;}
      if(path==='/api/sources'){const next=sourceSchema.array().max(3000).parse(input.sources);const keys=next.map(s=>s.name.toLowerCase());if(new Set(keys).size!==keys.length)throw new Error('Duplicate source names');store.state.sources=next;store.save();json(res,{ok:true});return;}
      if(path==='/api/sources/import'){const normalized=normalizeSeeds(input.data);const next=structuredClone(store.state);const current=new Set(next.sources.map(s=>s.name.toLowerCase()));for(const s of normalized.sources)if(!current.has(s.name.toLowerCase()))next.sources.push(s);const profiles=new Set(next.profiles.map(p=>p.name.toLowerCase()));for(const p of normalized.profiles)if(!profiles.has(p.name.toLowerCase()))next.profiles.push(p);store.state=migrateState(next);store.save();json(res,{report:normalized.report});return;}
      if(path==='/api/discover'){if(!['fresh','recurate','continue'].includes(input.mode))throw new Error('Unknown discovery mode');json(res,{job:jobs.discover(input.mode)});return;}
      const cancel=path.match(/^\/api\/jobs\/([^/]+)\/cancel$/);if(cancel){const target=jobs.jobs.find(j=>j.id===cancel[1]);if(identity.kind==='reader'&&target?.snapshotId!==identity.snapshotId)throw new Error('Reader cannot cancel another job');jobs.cancel(cancel[1]);json(res,{ok:true});return;}
      if(path==='/api/capture'){json(res,{job:jobs.capture(String(input.url))});return;}
      if(path==='/api/open'){json(res,jobs.open(String(input.candidateId)));return;}
      if(path==='/api/refresh'){const snap=store.state.snapshots[input.snapshotId];if(!snap?.post.permalink)throw new Error('This import has no captured thread URL');json(res,{job:jobs.capture(snap.post.permalink)});return;}
      if(path==='/api/import'||path==='/api/sample'){const snapshot=importSnapshot(path==='/api/sample'?readFileSync(SAMPLE,'utf8'):String(input.text),path==='/api/sample'?'Synthetic sample-thread.txt (fictional test input)':String(input.filename??'Imported text'));jobs.saveSnapshot(snapshot);json(res,{snapshot});return;}
      if(path==='/api/extension/capture'){
        const snapshot=snapshotSchema.parse(input.snapshot);snapshot.id=randomUUID();snapshot.coverage.analyzed=0;snapshot.coverage.retrieved=snapshot.comments.length;snapshot.imported=false;
        if(!snapshot.post.permalink||!/^https:\/\/(?:www\.|old\.|new\.)?reddit\.com\/r\/[A-Za-z0-9_]+\/comments\//.test(snapshot.post.permalink))throw new Error('Captured source must be a Reddit discussion');
        jobs.saveSnapshot(snapshot);const readerToken=token();readerSessions.set(readerToken,{snapshotId:snapshot.id,expires:Date.now()+86400000});json(res,{snapshotId:snapshot.id,readerToken});return;
      }
      if(path==='/api/curate'){const job=jobs.curate(String(input.snapshotId));job.snapshotId=String(input.snapshotId);json(res,{job});return;}
      if(path==='/api/save'){
        const c=store.state.candidates[input.candidateId];if(!c)throw new Error('Candidate no longer available');
        if(input.snapshotId&&!store.state.snapshots[input.snapshotId])throw new Error('Snapshot unavailable');if(input.snapshotId&&store.state.snapshots[input.snapshotId].post.id!==c.id)throw new Error('Snapshot does not belong to this discovery');if(identity.kind==='reader'&&input.snapshotId!==identity.snapshotId)throw new Error('Reader may only save its own snapshot');if(input.commentId&&!store.state.snapshots[input.snapshotId]?.comments.some(c=>c.id===input.commentId))throw new Error('Quote source unavailable');
        const index=store.state.saved.findIndex(x=>x.candidateId===c.id&&x.snapshotId===input.snapshotId&&x.commentId===input.commentId);
        if(index>=0)store.state.saved.splice(index,1);else store.state.saved.push({id:randomUUID(),candidateId:c.id,...(input.snapshotId?{snapshotId:String(input.snapshotId)}:{}),...(input.commentId?{commentId:String(input.commentId)}:{}),collection:String(input.collection??'Keepsakes').slice(0,200),savedAt:new Date().toISOString()});store.save();json(res,{ok:true});return;
      }
      if(path==='/api/feedback'){const feedback=feedbackSchema.parse({...input,id:randomUUID(),createdAt:new Date().toISOString()});if(!Object.hasOwn(store.state.candidates,feedback.candidateId))throw new Error('Feedback source not found');if(feedback.commentId){const snapshots=identity.kind==='reader'?[store.state.snapshots[identity.snapshotId!]]:Object.values(store.state.snapshots);if(!snapshots.some(s=>s?.post.id===feedback.candidateId&&s.comments.some(c=>c.id===feedback.commentId)))throw new Error('Feedback comment source not found');}store.state.feedback.push(feedback);if(feedback.action==='seen')store.state.seen=[...new Set([...store.state.seen,feedback.candidateId])];store.save();json(res,{ok:true});return;}
      if(path==='/api/position'){if(typeof input.key!=='string'||! /^(thread|batch):[A-Za-z0-9_-]{1,200}$/.test(input.key)||!Number.isFinite(input.position)||input.position<0||input.position>10_000_000)throw new Error('Invalid reading position');store.state.readPositions[input.key]=input.position;store.save();json(res,{ok:true});return;}
      if(path==='/api/tune'){json(res,applyNaturalTuning(store.state.settings,String(input.text).slice(0,2000)));return;}
      if(path==='/api/collection'){const saved=store.state.saved.find(s=>s.id===input.savedId);if(!saved)throw new Error('Saved item not found');saved.collection=String(input.collection).trim().slice(0,200)||'Keepsakes';store.save();json(res,{ok:true});return;}
      if(path==='/api/restore'){if(jobs.jobs.some(j=>j.status==='running'))throw new Error('Wait for or cancel the active job before restoring');store.replace(input.data);json(res,{ok:true});return;}
      if(path==='/api/pair'){const value=token();await secrets.set({pairToken:value});json(res,{token:value});return;}
      if(path==='/api/secrets'){const values:Record<string,string>={};for(const k of ['openaiKey','redditToken'])if(typeof input[k]==='string'&&input[k].length<=20000)values[k]=input[k].trim();await secrets.set(values);credentialLoadError='';json(res,{ok:true});return;}
      if(path==='/api/learning/reset'){store.state.feedback=store.state.feedback.filter(f=>!['magic','less','not-today'].includes(f.action));store.save();json(res,{ok:true});return;}
      if(path==='/api/cache/clear'){
        if(jobs.jobs.some(j=>j.status==='running'))throw new Error('Wait for or cancel active jobs first');const keep=new Set(store.state.saved.map(s=>s.candidateId));for(const b of store.state.batches)for(const id of b.candidateIds)keep.add(id);for(const f of store.state.feedback)keep.add(f.candidateId);
        const keepSnapshots=new Set(store.state.saved.map(s=>s.snapshotId).filter(Boolean));const savedCandidates=new Set(store.state.saved.map(s=>s.candidateId));for(const [id,snap] of Object.entries(store.state.snapshots))if(!keepSnapshots.has(id)&&!savedCandidates.has(snap.post.id)){delete store.state.snapshots[id];delete store.state.curations[id];delete store.state.readPositions[`thread:${id}`];}for(const id of Object.keys(store.state.candidates))if(!keep.has(id))delete store.state.candidates[id];store.save();json(res,{ok:true});return;
      }
      const del=path.match(/^\/api\/snapshot\/([^/]+)\/delete$/);if(del){if(jobs.jobs.some(j=>j.status==='running'))throw new Error('Wait for or cancel active jobs first');delete store.state.snapshots[del[1]];delete store.state.curations[del[1]];store.state.saved=store.state.saved.filter(s=>s.snapshotId!==del[1]);delete store.state.readPositions[`thread:${del[1]}`];store.save();json(res,{ok:true});return;}
      if(path==='/api/delete'){if(input.confirmation!=='DELETE')throw new Error('Type DELETE to confirm');if(jobs.jobs.some(j=>j.status==='running'))throw new Error('Wait for or cancel active jobs first');const next=initialState(JSON.parse(readFileSync(SEEDS,'utf8')));if(input.target==='library'){next.sources=store.state.sources;next.profiles=store.state.profiles;next.settings=store.state.settings;}else if(input.target==='all'){clearInferenceAttempts(DATA);jobs.jobs=[];jobs.keys.clear();next.sources=[];next.profiles=[];}else throw new Error('Unknown deletion target');store.state=next;store.save();store.db.prepare("DELETE FROM document WHERE key='before-restore'").run();readerSessions.clear();json(res,{ok:true});return;}
      json(res,{error:'Unknown action'},404);return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){json(res,{error:'Method not allowed'},405);return;}
    const filename=path==='/'?'index.html':path.slice(1);if(!/^(index\.html|app\.js|app\.css|favicon\.svg)$/.test(filename)){json(res,{error:'Not found'},404);return;}
    const file=join(ROOT,'dist/public',filename);if(!existsSync(file)){json(res,{error:'Portal build missing. Run npm run build.'},503);return;}
    const type=filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.svg')?'image/svg+xml':'text/html';res.setHeader('Content-Security-Policy',csp(url.searchParams.get('embed')==='1'));res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:readFileSync(file));
  }catch(e){if(!res.headersSent)json(res,{error:e instanceof Error?e.message:'Request failed'},400);else res.end();}
});
server.on('error',error=>{console.error(`Rekindle could not start: ${error.message}`);store.close();process.exitCode=1;});
server.listen(PORT,'127.0.0.1',()=>console.log(`Rekindle ready: ${ORIGIN}\nLocal data: ${DATA}`));
for(const event of ['SIGINT','SIGTERM'] as const)process.on(event,()=>{for(const c of jobs.controllers.values())c.abort();server.close(()=>{store.close();process.exit(0);});});
