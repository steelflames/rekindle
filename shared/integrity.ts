import type {Curation,ThreadSnapshot,Voice} from './types';

const textSchema={type:'string'};
export const CURATION_JSON_SCHEMA={
  type:'object',additionalProperties:false,required:['orientation','voices','closing','realityCheck'],
  properties:{orientation:textSchema,closing:textSchema,realityCheck:textSchema,voices:{type:'array',items:{type:'object',additionalProperties:false,required:['commentId','excerpts','contextIds','reason','commentary','kind'],properties:{commentId:textSchema,excerpts:{type:'array',items:{type:'object',additionalProperties:false,required:['text'],properties:{text:textSchema}}},contextIds:{type:'array',items:textSchema},reason:textSchema,commentary:textSchema,kind:{type:'string',enum:['insight','story','humor','dissent','correction']}}}}}
} as const;

export interface CurationMetadata {id?:string;model:string;promptVersion?:string;createdAt?:string;usage?:Curation['usage'];analyzedIds:string[]}
const allowedKinds=new Set(['insight','story','humor','dissent','correction']);
export const CORRECTION_CUE=/\b(correction|actually|not quite|that(?:'s| is) incorrect|this(?:'s| is) incorrect|does not follow|missing a factor|wrong units|retract|retracted)\b/i;
const CONSENSUS=/\b(everyone agrees|everybody agrees|all (?:the )?commenters agree|unanimous(?:ly)?|the thread (?:agrees|proves)|(?:clear|broad|overwhelming) consensus|consensus is|universally accepted)\b/i;
function claimsConsensus(text:string):boolean {
  // Explicitly negated claims are useful reality checks, not assertions of unanimity.
  const pattern=new RegExp(CONSENSUS.source,'gi');
  for(const match of text.matchAll(pattern)) {
    const before=text.slice(Math.max(0,match.index!-90),match.index);
    const explicitlyNegated=/\b(?:not|no|isn't|wasn't|without)\s+(?:a\s+)?$/i.test(before)||/\b(?:cannot|can't|does not|do not|did not)\s+(?:infer|establish|claim|demonstrate|show|prove|assume|conclude)\s+(?:(?:a|that)\s+)?$/i.test(before);
    if(!explicitlyNegated)return true;
  }
  return false;
}
function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(`Curation integrity: ${message}`);}
function object(value:unknown,label:string):Record<string,unknown>{assert(value!==null&&typeof value==='object'&&!Array.isArray(value),`${label} must be an object.`);return value as Record<string,unknown>;}
function keys(value:Record<string,unknown>,allowed:string[],label:string){assert(Object.keys(value).every(k=>allowed.includes(k)),`${label} contains an unsupported field. Model-provided quotes, authors and URLs are never displayed.`);}
function string(value:unknown,label:string,max=6000):string{assert(typeof value==='string'&&value.length<=max,`${label} must be text of at most ${max} characters.`);return value;}
function list(value:unknown,label:string,max=40):unknown[]{assert(Array.isArray(value)&&value.length<=max,`${label} must be a bounded array.`);return value;}

/** The model supplies exact text, never the displayed quote, author or source URL. */
export function validateCuration(raw:unknown,snapshot:ThreadSnapshot,metadata:CurationMetadata):Curation {
  const parsed=object(raw,'result');keys(parsed,['orientation','voices','closing','realityCheck'],'result');
  const captured=new Map(snapshot.comments.map(c=>[c.id,c]));
  assert(captured.size===snapshot.comments.length,'snapshot contains duplicate comment IDs.');
  const analyzedIds=[...new Set(metadata.analyzedIds)];assert(analyzedIds.every(id=>captured.has(id)),'analyzed IDs contain an unknown source.');
  const analyzed=new Set(analyzedIds);const warnings:string[]=[];
  const orientation=string(parsed.orientation,'orientation',3500),closing=string(parsed.closing,'closing',3500),realityCheck=string(parsed.realityCheck,'realityCheck',3500);
  assert(!claimsConsensus(`${orientation}\n${closing}\n${realityCheck}`),'unsupported thread-wide consensus or unanimity claim. Describe the inspected voices and material disagreements.');
  const voices:Voice[]=list(parsed.voices,'voices',18).map((value,i)=>{
    const v=object(value,`voice ${i+1}`);keys(v,['commentId','excerpts','contextIds','reason','commentary','kind'],`voice ${i+1}`);
    const commentId=string(v.commentId,'commentId',256);const source=captured.get(commentId);
    assert(source&&analyzed.has(commentId),`voice ${commentId} was not in the analyzed source pool.`);
    assert(allowedKinds.has(string(v.kind,'kind',30)),'unknown voice kind.');
    const excerpts=list(v.excerpts,'excerpts',6).map((input,j)=>{
      const e=object(input,'excerpt');keys(e,['text','start','end'],'excerpt');
      let start:number,end:number;
      if(typeof e.text==='string') {
        const text=string(e.text,'excerpt text',16000);assert(text.length>0,'empty excerpt.');
        if(e.start!==undefined||e.end!==undefined){assert(Number.isInteger(e.start)&&Number.isInteger(e.end),'excerpt offsets must be integers.');start=e.start as number;end=e.end as number;assert(start>=0&&end>start&&end<=source.body.length,'excerpt offsets are outside source bounds.');assert(source.body.slice(start,end)===text,'excerpt anchor does not exactly match captured text.');}
        else {start=source.body.indexOf(text);assert(start>=0,'invented or altered quote: excerpt does not exactly match captured text.');assert(source.body.indexOf(text,start+1)<0,'excerpt text occurs more than once. Include an unambiguous longer excerpt.');end=start+text.length;}
      } else {
        assert(Number.isInteger(e.start)&&Number.isInteger(e.end),'excerpt needs exact text or integer source offsets.');start=e.start as number;end=e.end as number;
        assert(start>=0&&end>start&&end<=source.body.length,'excerpt offsets are outside source bounds.');
      }
      assert(!(start>0&&/[\uD800-\uDBFF]/.test(source.body[start-1])&&/[\uDC00-\uDFFF]/.test(source.body[start])),'excerpt splits a Unicode character.');
      assert(!(end<source.body.length&&/[\uD800-\uDBFF]/.test(source.body[end-1])&&/[\uDC00-\uDFFF]/.test(source.body[end])),'excerpt splits a Unicode character.');
      return {start,end};
    });
    assert(excerpts.length>0,`voice ${commentId} has no quotation.`);
    for(let j=1;j<excerpts.length;j++)assert(excerpts[j].start>=excerpts[j-1].end,'excerpts overlap or reorder the original source.');
    const contextIds=list(v.contextIds,'contextIds',24).map(id=>string(id,'contextId',256));
    assert(new Set(contextIds).size===contextIds.length,'duplicate context source.');
    assert(contextIds.every(id=>captured.has(id)&&analyzed.has(id)&&id!==commentId),'context includes an unknown, unanalyzed or self source.');
    const ancestors=new Set<string>();let parent=source.parentId;
    while(parent&&captured.has(parent)&&ancestors.size<64){assert(!ancestors.has(parent)&&parent!==source.id,'cyclic source parent relationship.');ancestors.add(parent);parent=captured.get(parent)!.parentId;}
    for(const ancestor of ancestors)assert(contextIds.includes(ancestor),`missing parent context ${ancestor} for ${commentId}. Include the setup/question.`);
    if(parent&&parent!==snapshot.post.id&&parent!==`t3_${snapshot.post.id}`)warnings.push(`Parent ${parent} of ${commentId} was not captured; the exchange is incomplete.`);
    // Context can be ancestors or direct replies; unrelated voices must be separate selections.
    assert(contextIds.every(id=>ancestors.has(id)||captured.get(id)!.parentId===commentId),'unrelated comment presented as exchange context.');
    const reason=string(v.reason,'reason',2500),commentary=string(v.commentary,'commentary',5000);
    assert(!claimsConsensus(`${reason}\n${commentary}`),'unsupported consensus claim in a selected voice.');
    return {commentId,excerpts,contextIds,reason,commentary,kind:v.kind as Voice['kind']};
  });
  assert(new Set(voices.map(v=>v.commentId)).size===voices.length,'the same comment appears as multiple selected voices.');
  const presented=new Set(voices.flatMap(v=>[v.commentId,...v.contextIds]));
  for(const voice of voices)for(const comment of snapshot.comments) {
    if(comment.parentId===voice.commentId&&analyzed.has(comment.id)&&CORRECTION_CUE.test(comment.body))assert(presented.has(comment.id),`overlooked possible correction ${comment.id} to selected source ${voice.commentId}. Include it with attribution; its truth is not established by the cue.`);
  }
  if(snapshot.coverage.limits.length)warnings.push('The captured source has acquisition limits. See source coverage; uninspected branches may change the interpretation.');
  if(analyzedIds.length<snapshot.comments.length)warnings.push(`Analyzed ${analyzedIds.length} of ${snapshot.comments.length} captured comments.`);
  return {id:metadata.id??`curation-${Date.now()}-${snapshot.id}`,snapshotId:snapshot.id,createdAt:metadata.createdAt??new Date().toISOString(),model:metadata.model,promptVersion:metadata.promptVersion??'comment-mode-1.0',orientation,voices,closing,realityCheck,analyzedIds,usage:metadata.usage??{inputTokens:null,outputTokens:null},warnings:[...new Set(warnings)],mode:'ai'};
}

/** Quotes are always rehydrated from stored sources, including attribution and source locator. */
export function rehydrateVoice(voice:Voice,snapshot:ThreadSnapshot) {
  const source=snapshot.comments.find(c=>c.id===voice.commentId);
  assert(source,`source ${voice.commentId} is unavailable. Do not display stale generated attribution.`);
  const excerpts=voice.excerpts.map(({start,end})=>{assert(Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>start&&end<=source.body.length,'stored excerpt is outside source bounds.');return source.body.slice(start,end);});
  const leading=voice.excerpts[0]?.start>0?'… ':'';
  const trailing=(voice.excerpts.at(-1)?.end??0)<source.body.length?' …':'';
  return {source,quote:leading+excerpts.join(' … ')+trailing,excerpts,author:source.author,permalink:source.permalink,locator:source.locator??`${snapshot.sourceLabel} · comment ${source.id}`,context:voice.contextIds.map(id=>snapshot.comments.find(c=>c.id===id)).filter((c):c is NonNullable<typeof c>=>Boolean(c))};
}
