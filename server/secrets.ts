import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
interface Secrets {openaiKey?:string;redditToken?:string;pairToken?:string}
// Windows DPAPI CurrentUser; plaintext travels over child stdin, never command arguments.
async function protect(input:string,decrypt=false):Promise<string>{
  if(process.platform!=='win32')throw new Error('Saved secrets require Windows DPAPI; use process environment on other platforms.');
  const script=`Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=${decrypt?'[Convert]::FromBase64String($v)':'[Text.Encoding]::UTF8.GetBytes($v)'}; $r=[Security.Cryptography.ProtectedData]::${decrypt?'Unprotect':'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write(${decrypt?'[Text.Encoding]::UTF8.GetString($r)':'[Convert]::ToBase64String($r)'})`;
  return new Promise((resolve,reject)=>{const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';p.stdout.on('data',b=>out+=b);p.on('error',()=>reject(new Error('Windows credential protection unavailable')));p.on('exit',c=>c===0?resolve(out):reject(new Error('Could not protect or unlock local credentials')));p.stdin.end(input);});
}
export class SecretStore {
  value:Secrets={};file:string;
  constructor(directory:string){this.file=join(directory,'credentials.dpapi');}
  async load(){if(existsSync(this.file))this.value=JSON.parse(await protect(readFileSync(this.file,'utf8'),true));}
  get(key:keyof Secrets){return this.value[key]||(key==='openaiKey'?process.env.REKINDLE_AI_KEY||process.env.OPENAI_API_KEY:key==='redditToken'?process.env.REKINDLE_REDDIT_TOKEN:undefined);}
  async set(values:Secrets){const next={...this.value,...values};const encrypted=await protect(JSON.stringify(next));writeFileSync(this.file,encrypted,{mode:0o600});this.value=next;}
  clear(){this.value={};if(existsSync(this.file))unlinkSync(this.file);}
}
