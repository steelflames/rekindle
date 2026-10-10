export function decodeEntities(text:string):string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,v:string)=>{
    if(v[0]==='#'){const n=v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):parseInt(v.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'�';}
    return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '} as Record<string,string>)[v.toLowerCase()]??_;
  });
}
export function htmlToText(html:string):string {
  return decodeEntities(html.replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi,'')
    .replace(/<br\s*\/?\s*>/gi,'\n').replace(/<li\b[^>]*>/gi,'\n• ')
    .replace(/<\/(p|div|h[1-6]|blockquote|pre|ul|ol)>/gi,'\n\n')
    .replace(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,(_,url,label)=>`${label} (${url})`)
    .replace(/<[^>]*>/g,''))
    .replace(/\r\n?/g,'\n').replace(/\n[ \t]+\n/g,'\n\n').replace(/\n{4,}/g,'\n\n\n').trim();
}
