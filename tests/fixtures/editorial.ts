import type {Candidate,Comment,ThreadSnapshot} from '../../shared/types';

// SYNTHETIC, invented specifically for reproducible editorial checks. Never startup/discovery data.
const capturedAt='2026-10-09T20:00:00.000Z';
export function fixturePost(overrides:Partial<Candidate>={}):Candidate {
  return {id:'fixture-post',title:'SYNTHETIC evaluation post',body:'Explicitly invented test material.',subreddit:'SyntheticEvaluation',author:'synthetic-poster',permalink:null,url:null,publishedAt:capturedAt,capturedAt,score:null,numComments:null,flair:'SYNTHETIC FIXTURE',media:[],cluster:'Expertise & explanation',lane:'familiar',format:'discussion',method:'synthetic automated test fixture',commentsInspected:0,spoiler:false,nsfw:false,...overrides};
}
function comment(id:string,body:string,score:number,parentId:string|null=null):Comment{return {id,parentId,body,score,author:`synthetic-${id}`,permalink:null,publishedAt:capturedAt,flair:null,depth:parentId?1:0,locator:`SYNTHETIC fixture · ${id}`};}
function snapshot(id:string,comments:Comment[],options:Partial<ThreadSnapshot>={}):ThreadSnapshot{return {id,version:1,post:fixturePost({id:`${id}-post`,title:`SYNTHETIC: ${id}`,commentsInspected:comments.length}),comments,coverage:{obtainedAt:capturedAt,method:'synthetic evaluation fixture',retrieved:comments.length,analyzed:0,siteReported:comments.length,limits:[]},imported:true,sourceLabel:`SYNTHETIC: ${id}`,...options};}
export const EDITORIAL_FIXTURES = [
  {name:'technical-correction',snapshot:snapshot('technical-correction',[
    comment('claim','The wheel travels 20 meters each second, so it must have a radius of 20 meters.',900),
    comment('correction','Correction: speed and radius have different units. You also need the angular velocity to infer radius.',2,'claim'),
    comment('slogan','This changes everything!',800),
  ]),expected:['correction'],note:'Low-vote dimensional correction stays attached to the high-vote claim. No authority inferred from confidence.'},
  {name:'personal-story',snapshot:snapshot('personal-story',[
    comment('agreement','Same here.',400),
    comment('story','My father repaired clocks. After he died I found a paper shim inside his favorite one. It was cut from the birthday card I made him when I was eight.',4),
  ]),expected:['story'],note:'Firsthand claim is attributed; preserve progression instead of revealing the shim in the orientation.'},
  {name:'joke-setup',snapshot:snapshot('joke-setup',[
    comment('setup','Why does the museum have an entire room of blank labels?',3),
    comment('punchline','It is their collection of missing contexts.',300,'setup'),
  ]),expected:['punchline'],note:'The punchline needs its captured question. A standalone highest-vote quote fails context.'},
  {name:'visual-first',snapshot:snapshot('visual-first',[
    comment('nice','Nice.',800),comment('mechanism','The triangular shadows come from the gaps between the leaves acting like tiny apertures.',5),
  ],{post:fixturePost({id:'visual-first-post',title:'SYNTHETIC visual-first test (image intentionally absent)',format:'visual',body:'The synthetic fixture references leaf shadows; no image is supplied or claimed to have been viewed.'})}),expected:['mechanism'],note:'Original media absence must remain explicit; a useful explanation is optional and cannot prove an unseen image.'},
  {name:'tribal-thread',snapshot:snapshot('tribal-thread',[
    comment('dogpile1','Only idiots disagree with us.',900),comment('dogpile2','The other team ruins everything.',850),
    comment('nuance','I worked on the small pilot. The failure rate fell, but we excluded older equipment, so I would not generalize that result yet.',2),
  ]),expected:['nuance'],note:'One worthwhile firsthand claim does not establish thoughtful consensus in the inspected thread.'},
  {name:'incomplete-thread',snapshot:snapshot('incomplete-thread',[
    comment('reply','That was true for the first version. The update reversed it.',4,'missing-parent'),
  ],{coverage:{obtainedAt:capturedAt,method:'synthetic incomplete capture',retrieved:1,analyzed:0,siteReported:120,limits:['Parent and other branches not captured.']}}),expected:['reply'],note:'Missing parent remains missing. Coverage and context warning are mandatory; no invented setup.'},
] as const;

export function fixtureRaw(snapshot:ThreadSnapshot,selectedIds:string[]) {
  const voices=selectedIds.map(id=>{
    const comment=snapshot.comments.find(c=>c.id===id)!;const contextIds:string[]=[];
    let parent=comment.parentId;
    while(parent){const ancestor=snapshot.comments.find(c=>c.id===parent);if(!ancestor)break;contextIds.push(ancestor.id);parent=ancestor.parentId;}
    return {commentId:id,excerpts:[{text:comment.body}],contextIds,reason:'SYNTHETIC expected selection for a reproducible test.',commentary:'This is an attributed source claim, not independent verification.',kind:id==='correction'?'correction':'insight'};
  });
  return {orientation:'Synthetic evaluation only.',voices,closing:'',realityCheck:''};
}
