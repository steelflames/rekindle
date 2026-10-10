import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { randomUUID } from 'node:crypto';
import type { Candidate, Comment, Source, ThreadSnapshot } from '../shared/types.js';
import { decodeEntities, htmlToText } from '../shared/text.js';
import { publicUrl, snapshotSchema } from '../shared/validation.js';

export function safeUrl(value:unknown):string|null {if(typeof value!=='string')return null;const parsed=publicUrl.safeParse(decodeEntities(value));return parsed.success?parsed.data:null;}
export function redditThreadUrl(value:string):URL {
  const url=new URL(value);
  if(url.protocol!=='https:'||!['www.reddit.com','reddit.com','old.reddit.com','new.reddit.com'].includes(url.hostname)||url.port||url.username||url.password||!/^\/r\/[A-Za-z0-9_]+\/comments\/[a-z0-9]+(?:\/[^/?#]*)?\/?$/.test(url.pathname))throw new Error('Use a full HTTPS Reddit discussion URL, without a comment suffix.');
  url.hostname='www.reddit.com';url.search='';url.hash='';return url;
}
export function blankCandidate(partial:Partial<Candidate>):Candidate {
  return {id:randomUUID(),title:'Imported discussion',body:'',subreddit:'Imported',author:null,permalink:null,url:null,publishedAt:null,capturedAt:new Date().toISOString(),score:null,numComments:null,flair:null,media:[],cluster:'Unmapped curiosity',lane:'familiar',format:'discussion',method:'import',commentsInspected:0,spoiler:false,nsfw:false,...partial};
}
function array<T>(value:T|T[]|undefined):T[]{return value===undefined?[]:Array.isArray(value)?value:[value];}
function content(entry:any):string{return typeof entry.content==='string'?entry.content:String(entry.content?.['#text']??'');}
function link(entry:any):string|null{return safeUrl(array<any>(entry.link).find(x=>!x['@_rel']||x['@_rel']==='alternate')?.['@_href']);}
function mediaFromHtml(html:string):Candidate['media'] {
  const media:Candidate['media']=[];
  for(const match of html.matchAll(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi)){const url=safeUrl(match[1]);if(url&&!media.some(m=>m.url===url))media.push({type:'image',url,caption:'Source-provided image preview'});}
  return media.slice(0,12);
}
export function parseFeed(xml:string,source:Source,obtainedAt=new Date().toISOString()):Candidate[]{
  if(xml.length>5_000_000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Feed exceeded size or contains unsupported entities');
  if(XMLValidator.validate(xml)!==true)throw new Error('Source returned malformed XML');
  const feed=new XMLParser({ignoreAttributes:false,processEntities:true}).parse(xml).feed;
  if(!feed)throw new Error('Source did not return an Atom feed');
  return array<any>(feed.entry).filter(e=>/^t3_[a-z0-9]+$/.test(String(e.id))).map(e=>{
    const html=content(e);const raw=html.split(/<!-- SC_ON -->/)[0];
    const body=htmlToText(raw.includes('<!-- SC_OFF -->')?raw.split('<!-- SC_OFF -->')[1]:raw.split(/submitted by/)[0]).replace(/^\s*\(https?:\/\/[^\s]+\)\s*$/,'');
    const permalink=link(e);const external=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*\[link\]/gi)].map(x=>safeUrl(x[1])).find(Boolean);
    const thumbnail=safeUrl(e['media:thumbnail']?.['@_url']);const media=mediaFromHtml(html);if(thumbnail&&!media.length)media.push({type:'image',url:thumbnail,caption:'Source-provided thumbnail'});
    const title=String(e.title?.['#text']??e.title??'Untitled source post');
    return blankCandidate({id:String(e.id),title,body,subreddit:source.name,author:e.author?.name?String(e.author.name).replace(/^\/?u\//,''):null,permalink,url:external||permalink,publishedAt:e.published||e.updated||null,capturedAt:obtainedAt,media,cluster:source.cluster,lane:source.lane,format:media.length?'visual':/humor|absurd|animals/i.test(source.cluster)?'humor':'discussion',method:'public-rss',spoiler:/\bspoiler\b/i.test(title),archival:false});
  });
}
export function parseThreadFeed(xml:string,url:string,known?:Candidate):ThreadSnapshot {
  if(xml.length>5_000_000||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Unsupported thread XML');
  const parsed=new XMLParser({ignoreAttributes:false}).parse(xml).feed;if(!parsed)throw new Error('Thread returned no Atom feed');
  const entries=array<any>(parsed.entry);const postEntry=entries.find(e=>String(e.id).startsWith('t3_'));
  const source:Source={name:new URL(url).pathname.split('/')[2],title:'',description:'',cluster:known?.cluster??'Unmapped curiosity',lane:known?.lane??'familiar',enabled:true,provenance:'Thread URL',access:'accessible',activity:'observed'};
  const posts=parseFeed(xml,source);const post=posts[0]??known??blankCandidate({id:postEntry?.id??`t3_${new URL(url).pathname.split('/')[4]}`,title:String(parsed.title??'Reddit discussion'),subreddit:source.name,permalink:url,url,method:'public-rss'});
  const comments:Comment[]=entries.filter(e=>/^t1_[a-z0-9]+$/.test(String(e.id))).slice(0,200).map((e:any)=>{
    const html=content(e);const body=htmlToText(html.split('<!-- SC_ON -->')[0].replace('<!-- SC_OFF -->',''));
    const parentMatch=[...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*\[parent\]/gi)][0];
    const parentSuffix=parentMatch?new URL(decodeEntities(parentMatch[1])).pathname.split('/').filter(Boolean)[5]:null;
    return {id:String(e.id),parentId:parentSuffix?`t1_${parentSuffix}`:null,author:e.author?.name?String(e.author.name).replace(/^\/?u\//,''):null,body,permalink:link(e),score:null,publishedAt:e.published??e.updated??null,flair:null,depth:0};
  });
  post.commentsInspected=comments.length;
  return {id:randomUUID(),version:1,post,comments,coverage:{obtainedAt:new Date().toISOString(),method:'public-rss',retrieved:comments.length,analyzed:0,siteReported:post.numComments,limits:['Public RSS is a partial sample, not all comments.','Votes, flair, and some parent relationships are unavailable.','No claim that inaccessible media has been viewed.']},imported:false,sourceLabel:url};
}
export function parseRedditJson(raw:any,sourceLabel='Imported Reddit JSON'):ThreadSnapshot {
  if(!Array.isArray(raw)||!raw[0]?.data?.children)throw new Error('Expected Reddit thread JSON or a Rekindle snapshot');
  const p=raw[0].data.children.find((x:any)=>x.kind==='t3')?.data;if(!p)throw new Error('Missing original post');
  const canonical=(s:unknown)=>typeof s==='string'?safeUrl(s.startsWith('/')?`https://www.reddit.com${s}`:s):null;
  const post=blankCandidate({id:p.name??`t3_${p.id}`,title:p.title??'Untitled post',body:p.selftext??'',subreddit:p.subreddit??'Imported',author:p.author??null,permalink:canonical(p.permalink),url:canonical(p.url),publishedAt:typeof p.created_utc==='number'?new Date(p.created_utc*1000).toISOString():null,score:typeof p.score==='number'?p.score:null,numComments:typeof p.num_comments==='number'?p.num_comments:null,flair:p.link_flair_text??null,spoiler:!!p.spoiler,nsfw:!!p.over_18,method:'reddit-json'});
  for(const image of p.preview?.images??[]){const url=safeUrl(image.source?.url);if(url)post.media.push({type:'image',url,caption:'Image from source preview'});}
  if(p.is_video){const url=safeUrl(p.media?.reddit_video?.fallback_url);if(url)post.media.unshift({type:'video',url,caption:'Source video; audio may be separate'});}
  const comments:Comment[]=[];let omitted=0;
  function walk(children:any[],depth:number){if(depth>50)return;for(const x of children??[]){if(x.kind==='more'){omitted+=Number(x.data?.count)||0;continue;}if(x.kind!=='t1'||comments.length>=500)continue;const c=x.data;comments.push({id:c.name??`t1_${c.id}`,parentId:c.parent_id??null,author:c.author??null,body:c.body??'',permalink:canonical(c.permalink),score:typeof c.score==='number'?c.score:null,publishedAt:typeof c.created_utc==='number'?new Date(c.created_utc*1000).toISOString():null,flair:c.author_flair_text??null,depth});if(c.replies?.data)walk(c.replies.data.children,depth+1);}}
  walk(raw[1]?.data?.children,0);post.commentsInspected=comments.length;
  return {id:randomUUID(),version:1,post,comments,coverage:{obtainedAt:new Date().toISOString(),method:'reddit-json',retrieved:comments.length,analyzed:0,siteReported:post.numComments,limits:[`Bounded to 500 comments and depth 50; ${omitted} comments reported behind expansion placeholders.`]},imported:true,sourceLabel};
}
export function parseTextImport(text:string,filename='Imported text'):ThreadSnapshot {
  const lines=text.replace(/\r\n?/g,'\n').split('\n');const titleLine=lines.find(l=>/ : r\//.test(l));const title=titleLine?.split(' : r/')[0]??lines.find(l=>l.trim())??'Imported text';
  const subreddit=titleLine?.split(' : r/')[1]?.trim()??'Imported';const start=lines.findIndex(l=>l.trim()==='Comments Section');const comments:Comment[]=[];
  let uncertain=0;
  if(start>=0){
    let end=lines.findIndex((l,i)=>i>start&&/^(Community Info Section|Community highlights|Community Bookmarks|Related Posts|Joined)$/.test(l.trim()));if(end<0)end=lines.length;
    const username=/^(?:u\/)?[A-Za-z0-9_-]{3,30}$/;
    const timestamp=/^(?:\d+\s*(?:m|h|d|w|mo|yr)|\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)) ago$/;
    const marker=/^(?:(?:MOD|OP|Cake icon)\s*)?•$/;
    const avatar=/^u\/([A-Za-z0-9_-]{3,30}) avatar$/;
    const headers:{start:number;bodyStart:number;author:string|null;valid:boolean}[]=[];
    // Vote controls are optional in copied Reddit pages. A new author header must
    // always end the previous body, including when the next header is malformed.
    for(let i=start+1;i+2<end;i++){
      const name=lines[i].trim();
      if(!marker.test(lines[i+1].trim())||!(username.test(name)||name==='[deleted]'||timestamp.test(lines[i+2].trim())))continue;
      const precedingAvatar=i>start+1?lines[i-1].trim().match(avatar):null;
      const author=username.test(name)?name.replace(/^u\//,''):null;
      const valid=timestamp.test(lines[i+2].trim())&&(author!==null||name==='[deleted]')&&(!precedingAvatar||precedingAvatar[1]===author);
      headers.push({start:precedingAvatar?i-1:i,bodyStart:i+3,author,valid});i+=2;
    }
    for(let h=0;h<headers.length;h++){
      const header=headers[h];let bodyStart=header.bodyStart;let bodyEnd=headers[h+1]?.start??end;
      if(!header.valid){uncertain++;continue;}
      while(bodyStart<bodyEnd&&(!lines[bodyStart].trim()||/^(?:•(?: Edited.*)?|Stickied comment|Profile Badge.*)$/.test(lines[bodyStart].trim())))bodyStart++;
      let score:number|null=null;
      for(let i=bodyStart;i<bodyEnd;i++){
        const line=lines[i].trim();
        if(line==='Upvote'&&lines[i+2]?.trim()==='Downvote'){
          const rawScore=lines[i+1].trim();score=/^-?\d+$/.test(rawScore)?Number(rawScore):null;bodyEnd=i;break;
        }
        // Expansion controls and orphan avatar rows have no recoverable nesting
        // or attribution. They are boundaries, never part of another user's quote.
        if(/^\d+ more repl(?:y|ies)$/.test(line)||avatar.test(line)){bodyEnd=i;break;}
      }
      while(bodyEnd>bodyStart&&!lines[bodyEnd-1].trim())bodyEnd--;
      if(bodyEnd<=bodyStart)continue;
      const body=lines.slice(bodyStart,bodyEnd).join('\n');
      comments.push({id:`import-${comments.length+1}`,parentId:null,author:header.author,body,permalink:null,score,publishedAt:null,flair:null,depth:0,locator:`${filename}: lines ${bodyStart+1}-${bodyEnd}`});
    }
  }
  const post=blankCandidate({id:`import-${randomUUID()}`,title,subreddit,body:start<0?text:'Post media and thread URL were not captured in this text export.',commentsInspected:comments.length,method:'pasted-text'});
  return {id:randomUUID(),version:1,post,comments,coverage:{obtainedAt:new Date().toISOString(),method:'pasted-text',retrieved:comments.length,analyzed:0,siteReported:null,limits:['Imported text, not a live discovery.','Reply nesting, absolute timestamps, source URLs, and media are unavailable.','Only recognizable author headers were extracted; missing vote controls leave scores unknown.',...(uncertain?[`${uncertain} malformed or conflicting author headers were excluded.`]:[]),'Previous assistant analyses are not factual authority.']},imported:true,sourceLabel:filename};
}
export function importSnapshot(text:string,filename:string):ThreadSnapshot {
  if(text.length>5_000_000)throw new Error('Import is limited to 5 MB');
  if(/^\s*[\[{]/.test(text)){let parsed:unknown;try{parsed=JSON.parse(text);}catch{throw new Error('Invalid JSON; no data was imported.');}if(Array.isArray(parsed))return snapshotSchema.parse(parseRedditJson(parsed,filename));const snap=snapshotSchema.parse(parsed);return {...snap,id:randomUUID(),imported:true,sourceLabel:filename,coverage:{...snap.coverage,analyzed:0,limits:[...snap.coverage.limits,'Imported snapshot; source provenance is supplied by the file.']}};}
  return snapshotSchema.parse(parseTextImport(text,filename));
}
