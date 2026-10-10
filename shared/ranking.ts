import {POLICY_VERSION, type AppState, type Candidate, type Lane, type SelectionReason, type Settings, type Source} from './types';

const clamp=(n:number,min=0,max=1)=>Math.max(min,Math.min(max,n));
// Match conflict treatment, not a political identity or ordinary disagreement.
const CONTENTION=/\b(culture[ -]war|(?:performative|manufactured|faux)[ -]outrage|(?:outrage|rage)[ -]bait|road[ -]rage|dogpil(?:e|es|ing)|pile[ -]on|tribal (?:warfare|dunking)|(?:leftists?|right[ -]wingers?|liberals?|conservatives?) (?:destroyed|owned)|(?:destroys?|owned|humiliates?) (?:the )?(?:leftists?|right[ -]wingers?|liberals?|conservatives?))\b/i;
const HYPE=/\b(you won't believe|changes everything|destroys? the competition|everyone must|shocking truth|mind[ -]blowing breakthrough)\b/i;
const SPECIFIC=/\b(because|measured|mechanism|experiment|method|tested|diagram|how|why|built|restored|excavated)\b/i;
const FIRSTHAND=/\b(I (?:worked|built|spent|grew|remember|made|found|saw|tried|lived|was)|my (?:grand|father|mother|family|first|work|childhood))\b/i;
const textOf=(c:Candidate)=>`${c.title}\n${c.body}`;
const archive=(c:Candidate)=>Boolean(c.archival)||(c.publishedAt!==null&&Number.isFinite(Date.parse(c.publishedAt))&&Date.now()-Date.parse(c.publishedAt)>90*86400000);
function termsMatch(terms:string[],text:string){return terms.filter(t=>t.trim()&&text.toLocaleLowerCase().includes(t.trim().toLocaleLowerCase())).length;}

/** A round-robin permutation visits every enabled historical source before repeating. */
export function planSources(state:AppState): Source[] {
  const groups=new Map<string,Source[]>();
  for(const source of state.sources.filter(s=>s.enabled)) {
    const group=groups.get(source.cluster)||[];group.push(source);groups.set(source.cluster,group);
  }
  const ordered:Source[]=[];const queues=[...groups.values()];
  for(let row=0;queues.some(q=>q.length>row);row++)for(const group of queues)if(group[row])ordered.push(group[row]);
  if(!ordered.length)return [];
  const cursor=Math.max(0,state.sourceCursor)%ordered.length;
  const count=Math.min(ordered.length,Math.max(1,Math.floor(state.settings.sourceBudget)));
  return Array.from({length:count},(_,i)=>ordered[(cursor+i)%ordered.length]);
}
function learned(c:Candidate,state:AppState):{value:number;treatment:number;trace:string[]} {
  let value=0;let treatment=0;const matches=new Map<string,number>();const currentText=textOf(c);
  for(const f of state.feedback) {
    if(!['magic','less'].includes(f.action))continue;
    const original=state.candidates[f.candidateId];if(!original)continue;
    const delta=f.action==='magic'?.28:-.48;
    if(f.scope==='source'&&original.subreddit.toLowerCase()===c.subreddit.toLowerCase())value+=delta;
    if(f.scope==='topic'&&original.cluster===c.cluster)value+=delta;
    if(f.scope==='treatment') {
      const originalText=textOf(original);const features:{label:string;weight:number}[]=[];
      if(original.format===c.format)features.push({label:`${c.format} format`,weight:.08});
      if(FIRSTHAND.test(originalText)&&FIRSTHAND.test(currentText))features.push({label:'firsthand phrasing',weight:.1});
      if(SPECIFIC.test(originalText)&&SPECIFIC.test(currentText))features.push({label:'specificity phrasing',weight:.06});
      if(CONTENTION.test(originalText)&&CONTENTION.test(currentText))features.push({label:'conflict treatment phrasing',weight:.12});
      const magnitude=Math.min(f.action==='magic'?.18:.24,features.reduce((sum,feature)=>sum+feature.weight,0));
      treatment+=(f.action==='magic'?1:-1)*magnitude;
      for(const feature of features)matches.set(feature.label,(matches.get(feature.label)??0)+1);
    }
    if(f.scope==='repetition'&&original.id!==c.id&&duplicate(original,c))value+=delta;
    if(original.id===c.id)value+=delta;
  }
  const boundedTreatment=clamp(treatment,-.6,.6);
  const trace=matches.size?[`Treatment feedback matched ${[...matches].map(([feature,count])=>`${feature} (${count})`).join(', ')}. Treatment adjustment ${boundedTreatment.toFixed(2)} is capped at ±0.60; no topic or source preference was inferred.`]:[];
  return {value:clamp(value+boundedTreatment,-1.5,1.5),treatment:boundedTreatment,trace};
}
function score(c:Candidate,state:AppState,pool:Candidate[]):SelectionReason {
  const s=state.settings;const body=textOf(c);const age=c.publishedAt?Date.now()-Date.parse(c.publishedAt):NaN;
  const depth=c.format==='discussion'||c.format==='story';
  const topicWeight=Object.hasOwn(s.topicWeights,c.cluster)?s.topicWeights[c.cluster]:1;
  const relevance=clamp(topicWeight,0,3)*1.1;
  const formatFit=(depth?s.depth:1-s.depth)*1.5;
  const specificity=SPECIFIC.test(body)?.45:0;const firsthand=FIRSTHAND.test(body)?.45:0;
  const delight=c.format==='humor'?.45:c.format==='visual'?.5:0;
  const recent=Number.isFinite(age)?Math.exp(-Math.max(0,age)/(10*86400000))*(1-s.archival)*.45:null;
  const archivalFit=archive(c)?s.archival*1.5:0;
  const contention=CONTENTION.test(body)||c.cluster==='Current affairs'?-(1-s.contention)*1.8:0;
  const hype=HYPE.test(body)?-.65:0;
  const boosted=Math.min(3,termsMatch(s.boostedTerms,body))*.7;
  const muted=Math.min(3,termsMatch(s.mutedTerms,body))*-1.8;
  const feedback=learned(c,state);
  const captured=Object.values(state.snapshots).filter(snapshot=>snapshot.post.id===c.id).sort((a,b)=>(Date.parse(b.coverage.obtainedAt)||0)-(Date.parse(a.coverage.obtainedAt)||0))[0];
  const inspected=captured?.comments.slice(0,60)??[];
  const specificComments=inspected.filter(comment=>SPECIFIC.test(comment.body)).length;
  const firsthandComments=inspected.filter(comment=>FIRSTHAND.test(comment.body)).length;
  const correctionComments=inspected.filter(comment=>/\b(correction|not quite|wrong units|retracted)\b/i.test(comment.body)).length;
  const commentScouting=Math.min(.75,specificComments*.12+firsthandComments*.15+correctionComments*.2);
  const peers=pool.filter(p=>p.subreddit.toLowerCase()===c.subreddit.toLowerCase()&&p.score!==null);
  const popularity=c.score===null?null:peers.length>1?peers.filter(p=>p.score!<c.score!).length/peers.length*.12:.06;
  const inputs={relevance,formatFit,specificity,firsthand,delight,freshness:recent,archivalFit,contention,hype,boosted,muted,explicitFeedback:feedback.value,treatmentFeedbackWithinTotal:feedback.treatment,commentScouting,popularity,sourceScore:c.score,commentsActuallyInspected:inspected.length,factualConfidence:null};
  const total=2+Object.entries(inputs).filter(([key])=>!['sourceScore','commentsActuallyInspected','factualConfidence','treatmentFeedbackWithinTotal'].includes(key)).reduce((sum,[,v])=>sum+(v??0),0);
  const reasons=[`${c.cluster}: topic weight ${topicWeight}.`,`${c.format} format fits the ${depth?'depth':'lighter reading'} setting.`];
  if(specificity)reasons.push('Specificity words in captured title/body are a scouting signal, not verified expertise.');
  if(firsthand)reasons.push('Captured text uses firsthand language; the claim has not been independently verified.');
  if(!inspected.length)reasons.push('Comments have not been inspected; selection makes no claim about their quality.');
  else reasons.push(`Scouted ${inspected.length} captured comments: ${specificComments} specificity, ${firsthandComments} firsthand and ${correctionComments} correction phrase matches. These are fallible lexical signals, not verified quality or truth.`);
  if(c.score===null)reasons.push('Vote count unknown; no vote-quality penalty.');
  if(archive(c))reasons.push('Older than 90 days or explicitly marked archival.');
  if(feedback.value)reasons.push(`Explicit feedback adjustment ${feedback.value.toFixed(2)}; saving and skipping are not learned preferences.`,...feedback.trace);
  if(contention)reasons.push(`${c.cluster==='Current affairs'?'Current affairs topic':'Contention phrase matched'}; appetite setting reduced its score.`);
  if(muted)reasons.push('A visible muted phrase reduced its score.');
  if(boosted)reasons.push('A visible boosted phrase increased its score.');
  return {score:total,inputs,reasons,policy:POLICY_VERSION,lane:c.lane};
}
const words=(s:string)=>new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(w=>w.length>1||/^\d+$/.test(w)));
function similarity(a:string,b:string):number {const aa=words(a),bb=words(b);if(!aa.size||!bb.size)return 0;return [...aa].filter(x=>bb.has(x)).length/new Set([...aa,...bb]).size;}
function canonicalLink(c:Candidate):string|null {
  if(!c.url)return null;try{const url=new URL(c.url);if(/(^|\.)reddit\.com$/.test(url.hostname)||url.hostname==='redd.it')return null;url.hash='';for(const p of [...url.searchParams.keys()])if(p.startsWith('utm_')||['ref','source','fbclid'].includes(p))url.searchParams.delete(p);return url.href;}catch{return null;}
}
function duplicate(a:Candidate,b:Candidate):boolean {
  if(a.id===b.id)return true;
  const sameCrosspost=Boolean((a.crosspostId&&b.crosspostId&&a.crosspostId===b.crosspostId)||a.crosspostId===b.id||b.crosspostId===a.id);
  const link=canonicalLink(a);const sameLink=Boolean(link&&link===canonicalLink(b));
  const closeTitle=similarity(a.title,b.title)>.86;
  if(!sameCrosspost&&!sameLink&&!closeTitle)return false;
  // A substantial distinct first-person body can add new evidence to the same link/event.
  const independent=a.body.length>180&&b.body.length>180&&similarity(a.body,b.body)<.4&&(FIRSTHAND.test(a.body)||FIRSTHAND.test(b.body));
  if(independent)return false;
  if(sameCrosspost||sameLink)return true;
  return closeTitle&&(!a.body||!b.body||similarity(a.body,b.body)>.65);
}
export function selectBatch(candidates:Candidate[],state:AppState,limit=state.settings.batchSize):{candidates:Candidate[];reasons:Record<string,SelectionReason>} {
  const requested=Math.max(1,Math.min(50,Math.floor(limit)));const s=state.settings;
  const excluded=new Set([...state.seen,...state.feedback.filter(f=>f.action==='seen'||(f.action==='not-today'&&Date.now()-Date.parse(f.createdAt)<86400000)).map(f=>f.candidateId)]);
  const disabled=new Set(state.sources.filter(x=>!x.enabled).map(x=>x.name.toLowerCase()));
  const previouslySeen=state.seen.map(id=>state.candidates[id]).filter((c):c is Candidate=>Boolean(c));
  const unique=new Map<string,Candidate>();for(const c of candidates)if(!excluded.has(c.id)&&!disabled.has(c.subreddit.toLowerCase())&&!previouslySeen.some(old=>duplicate(old,c)))unique.set(c.id,c);
  const pool=[...unique.values()]; const scores=new Map(pool.map(c=>[c.id,score(c,state,pool)]));
  const selected:Candidate[]=[];const reasons:Record<string,SelectionReason>={};
  const communities=new Map<string,number>(),clusters=new Map<string,number>(),formats=new Map<string,number>();
  const lanes:Record<Lane,number>={familiar:0,adjacent:0,wildcard:0};
  const targets:Record<Lane,number>={familiar:1-s.exploration,adjacent:s.exploration*.625,wildcard:s.exploration*.375};
  const archiveCap=Math.round(requested*s.archival);let archivalCount=0;
  while(selected.length<requested) {
    let best:Candidate|undefined;let bestValue=-Infinity;let bestDiversity=0;let bestLane=0;
    for(const c of pool) {
      if(selected.some(x=>duplicate(x,c)))continue;
      if((communities.get(c.subreddit.toLowerCase())??0)>=s.communityCap||(clusters.get(c.cluster)??0)>=s.clusterCap)continue;
      if(archive(c)&&archivalCount>=archiveCap)continue;
      const base=scores.get(c.id)!;
      if(base.score<1.2)continue; // Do not fill a batch with strongly disfavored material.
      const diversity=-(clusters.get(c.cluster)??0)*.45-(formats.get(c.format)??0)*.2;
      const lane=targets[c.lane]>0?Math.max(0,targets[c.lane]*(selected.length+1)-lanes[c.lane])*2.3:-1;
      const value=base.score+diversity+lane;
      if(value>bestValue||(value===bestValue&&c.id.localeCompare(best?.id??'')<0)){best=c;bestValue=value;bestDiversity=diversity;bestLane=lane;}
    }
    if(!best)break;
    selected.push(best);communities.set(best.subreddit.toLowerCase(),(communities.get(best.subreddit.toLowerCase())??0)+1);clusters.set(best.cluster,(clusters.get(best.cluster)??0)+1);formats.set(best.format,(formats.get(best.format)??0)+1);lanes[best.lane]++;if(archive(best))archivalCount++;
    const base=scores.get(best.id)!;
    reasons[best.id]={...base,score:bestValue,inputs:{...base.inputs,diversityAdjustment:bestDiversity,explorationAdjustment:bestLane},reasons:[...base.reasons,`${best.lane} lane; target mix ${Math.round(targets.familiar*100)}/${Math.round(targets.adjacent*100)}/${Math.round(targets.wildcard*100)} when available.`,`Batch caps: ${s.communityCap} per community, ${s.clusterCap} per cluster; variety adjustment ${bestDiversity.toFixed(2)}.`]};
  }
  return {candidates:selected,reasons};
}

/** Deliberately bounded parser. It previews concrete settings and never pretends to understand arbitrary prose. */
export function applyNaturalTuning(settings:Settings,text:string):{settings:Settings;changes:string[]} {
  const next=structuredClone(settings);const changes:string[]=[];const lower=text.toLowerCase();
  const change=(key:'exploration'|'depth'|'archival'|'contention',value:number,label:string)=>{next[key]=clamp(value);changes.push(`${label}: ${Math.round(next[key]*100)}%.`);};
  const bump=(cluster:string,amount:number)=>{next.topicWeights[cluster]=clamp((next.topicWeights[cluster]??1)+amount,0,3);changes.push(`${cluster} weight: ${next.topicWeights[cluster].toFixed(2)}.`);};
  const terms=(key:'mutedTerms'|'boostedTerms',values:string[])=>{next[key]=[...new Set([...next[key],...values])];changes.push(`${key==='mutedTerms'?'Reduce':'Favor'} these phrases: ${values.join(', ')}.`);};
  const clauses=lower.split(/[,.!?;]|\bbut\b/).map(x=>x.trim()).filter(Boolean);
  for(const clause of clauses) {
    const less=/\b(less|fewer|reduce|avoid|no more)\b/.test(clause);const more=/\b(more|keep|favor|prefer|increase)\b/.test(clause);if(!less&&!more)continue;
    const dir=less?-1:1;
    if(/\b(explore|exploration|wildcards?|surprise|new interests)\b/.test(clause))change('exploration',next.exploration+dir*.2,'Exploration');
    if(/\b(familiar|established)\b/.test(clause))change('exploration',next.exploration-dir*.2,'Exploration');
    if(/\b(deep|depth|long reads?|expertise)\b/.test(clause))change('depth',next.depth+dir*.2,'Deep reading');
    if(/\b(light|visual|photos?|funny|humor)\b/.test(clause))change('depth',next.depth-dir*.2,'Deep reading');
    if(/\b(archive|archival|older|nostalgia)\b/.test(clause))change('archival',next.archival+dir*.2,'Archival discoveries');
    if(/\b(fresh|recent|new posts)\b/.test(clause))change('archival',next.archival-dir*.2,'Archival discoveries');
    if(/\b(contentious|current affairs|politics|culture[ -]war|outrage)\b/.test(clause))change('contention',next.contention+dir*.2,'Contention appetite');
    if(/\bhistory\b/.test(clause))bump('History & nostalgia',dir*.5);
    if(/\b(expertise|explanations?)\b/.test(clause))bump('Expertise & explanation',dir*.5);
    if(/\b(story|stories|human experiences)\b/.test(clause))bump('Human stories',dir*.5);
    if(/\b(nature|science)\b/.test(clause))bump('Science & nature',dir*.5);
    if(/\b(art|design|photography)\b/.test(clause))bump('Art & design',dir*.5);
    if(/\b(games?|gaming)\b/.test(clause))bump('Games & play',dir*.5);
    if(/\b(humor|animals|funny)\b/.test(clause))bump('Humor & animals',dir*.5);
    if(/\b(ai|technology|tech)\b/.test(clause)&&!/culture[ -]war|outrage/.test(clause))bump('Technology & AI',dir*.5);
    if(less&&/culture[ -]war/.test(clause))terms('mutedTerms',['culture war','culture-war']);
    if(more&&/breakthroughs?/.test(clause))terms('boostedTerms',['breakthrough','research','benchmark']);
  }
  if(!changes.length)changes.push('No supported tuning rule matched. Nothing changed. Use the visible controls or try “more history, less culture war.”');
  return {settings:next,changes};
}
