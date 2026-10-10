import type {Settings} from '../shared/types.js';
import {settingsSchema} from '../shared/validation.js';
export function mergeSettings(current:Settings,base:unknown,requested:unknown):Settings{
  const before=settingsSchema.parse(base);const next=settingsSchema.parse(requested);
  const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
  function merge(live:any,old:any,value:any,path:string):any{
    if(same(old,value))return structuredClone(live);
    if(value&&old&&live&&typeof value==='object'&&!Array.isArray(value)&&!Array.isArray(old)&&!Array.isArray(live)){
      const out:any={...live};for(const key of new Set([...Object.keys(old),...Object.keys(value)])){if(!Object.hasOwn(value,key)){if(same(live[key],old[key]))delete out[key];else throw new Error(`Settings changed in another window (${path}.${key}). Reload that section before saving.`);}else out[key]=merge(live[key],old[key],value[key],`${path}.${key}`);}return out;
    }
    if(!same(live,old)&&!same(live,value))throw new Error(`Settings changed in another window (${path}). Reload that section before saving.`);
    return structuredClone(value);
  }
  return settingsSchema.parse(merge(current,before,next,'settings'));
}
