const USER_AGENT='Rekindle/0.1 (Windows; personal read-only reader)';
let nextRequestAt=0;
let cooldownUntil=0;
let queue:Promise<unknown>=Promise.resolve();
export class SourceRateLimit extends Error {}
export function rateLimitRemaining(){return Math.max(0,cooldownUntil-Date.now());}
async function pause(ms:number,signal?:AbortSignal){if(ms<=0)return;await new Promise<void>((resolve,reject)=>{const finish=()=>{signal?.removeEventListener('abort',abort);resolve();};const timer=setTimeout(finish,ms);const abort=()=>{clearTimeout(timer);reject(new Error('Cancelled'));};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});}
export async function redditFetch(path:string,options:{token?:string;signal?:AbortSignal}={}):Promise<string>{
  const run=queue.then(()=>fetchNow(path,options));queue=run.catch(()=>{});return run;
}
async function fetchNow(path:string,options:{token?:string;signal?:AbortSignal}={}):Promise<string>{
  if(cooldownUntil>Date.now())throw new SourceRateLimit(`Reddit requested a pause. Try again in ${Math.ceil((cooldownUntil-Date.now())/1000)} seconds.`);
  await pause(Math.max(0,nextRequestAt-Date.now()),options.signal);options.signal?.throwIfAborted();nextRequestAt=Date.now()+3000;
  if(!path.startsWith('/r/')||!/^\/r\/[A-Za-z0-9_]+\/(?:new|top|comments\/)[A-Za-z0-9_/.?=&%-]*$/.test(path))throw new Error('Unsupported Reddit resource');
  const origin=options.token?'https://oauth.reddit.com':'https://www.reddit.com';
  const headers:Record<string,string>={'User-Agent':USER_AGENT,'Accept':options.token?'application/json':'application/atom+xml'};
  if(options.token)headers.Authorization=`Bearer ${options.token}`;
  const response=await fetch(origin+path,{headers,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(15000),...(options.signal?[options.signal]:[])])});
  if(!response.ok){const retry=response.headers.get('retry-after');if(response.status===429){const wait=retry?Math.max(60000,Number(retry)*1000||Date.parse(retry)-Date.now()):120000;cooldownUntil=Date.now()+Math.min(Math.max(wait,60000),3600000);throw new SourceRateLimit(`Reddit HTTP 429. Collection paused for ${Math.ceil((cooldownUntil-Date.now())/1000)} seconds; remaining requests were not sent.`);}throw new Error(`Reddit HTTP ${response.status}${retry?`; retry after ${retry} seconds`:''}. ${response.status===403?'Access denied; capture an accessible Firefox page or configure approved Reddit API access.':'Source unavailable.'}`);}
  const reader=response.body?.getReader();if(!reader)throw new Error('Source returned no content');let total=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>5_000_000){await reader.cancel();throw new Error('Source exceeded 5 MB response limit');}chunks.push(value);}
  const body=Buffer.concat(chunks).toString('utf8');if(!body.trim())throw new Error('Source returned an empty response');return body;
}
