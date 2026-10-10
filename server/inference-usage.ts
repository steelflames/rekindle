import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { InferenceAttempt } from '../shared/types.js';

const count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
const attemptSchema=z.object({
  id:z.uuid(),startedAt:z.iso.datetime(),updatedAt:z.iso.datetime(),model:z.string().max(200),
  status:z.enum(['started','received','accepted','rejected','failed','cancelled']),
  code:z.enum(['request_started','response_received','accepted','integrity_rejected','invalid_output','incomplete_response','http_error','response_limit','network_error','cancelled','usage_log_error']),
  httpStatus:z.number().int().min(100).max(599).nullable(),submittedComments:z.number().int().min(0).max(2000),
  usage:z.object({inputTokens:count,outputTokens:count}),
});
export const MAX_USAGE_ATTEMPTS=500;

/** Bounded latest-attempt journal, separate from source content and library exports. */
export function recordInferenceAttempt(directory:string,attempt:InferenceAttempt):void {
  mkdirSync(directory,{recursive:true});const file=join(directory,'inference-usage.jsonl');
  const records:InferenceAttempt[]=[];
  if(existsSync(file)){
    if(statSync(file).size>1_000_000)throw new Error('Inference usage journal exceeds its bound. Preserve it for inspection.');
    for(const line of readFileSync(file,'utf8').split('\n').filter(Boolean))records.push(attemptSchema.parse(JSON.parse(line)));
  }
  // The schema deliberately strips any accidental response text, prompts or keys.
  const safe=attemptSchema.parse(attempt);
  const next=[...records.filter(r=>r.id!==safe.id),safe].slice(-MAX_USAGE_ATTEMPTS);
  const temporary=join(directory,'inference-usage.jsonl.tmp');
  writeFileSync(temporary,next.map(r=>JSON.stringify(r)).join('\n')+'\n',{encoding:'utf8',flush:true});
  renameSync(temporary,file);
}

export function clearInferenceAttempts(directory:string):void {
  for(const name of ['inference-usage.jsonl','inference-usage.jsonl.tmp'])rmSync(join(directory,name),{force:true});
}
