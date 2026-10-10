export const SCHEMA_VERSION = 2;
export const POLICY_VERSION = 'curiosity-1.0';
export type Lane = 'familiar' | 'adjacent' | 'wildcard';
export type Format = 'discussion' | 'story' | 'visual' | 'humor' | 'link';
export interface Source {
  name: string; title: string; description: string; cluster: string; enabled: boolean;
  lane: Lane; provenance: string; access: 'unchecked'|'accessible'|'unavailable';
  activity: 'unknown'|'observed'; lastAttempt?: string; lastSuccess?: string; lastError?: string;
}
export interface Media {type: 'image'|'video'|'link'; url: string; caption: string; preview?: string}
export interface Candidate {
  id: string; title: string; body: string; subreddit: string; author: string|null;
  permalink: string|null; url: string|null; publishedAt: string|null; capturedAt: string;
  score: number|null; numComments: number|null; flair: string|null; media: Media[];
  cluster: string; lane: Lane; format: Format; method: string; commentsInspected: number;
  spoiler: boolean; nsfw: boolean; crosspostId?: string; archival?: boolean;
}
export interface Comment {
  id: string; parentId: string|null; author: string|null; body: string; permalink: string|null;
  score: number|null; publishedAt: string|null; flair: string|null; depth: number;
  locator?: string;
}
export interface Coverage {
  obtainedAt: string; method: string; retrieved: number; analyzed: number;
  siteReported: number|null; limits: string[];
}
export interface ThreadSnapshot {
  id: string; version: number; post: Candidate; comments: Comment[]; coverage: Coverage;
  imported: boolean; sourceLabel: string;
}
export interface Voice {
  commentId: string; excerpts: {start: number; end: number}[]; contextIds: string[];
  reason: string; commentary: string; kind: 'insight'|'story'|'humor'|'dissent'|'correction';
}
export interface Curation {
  id: string; snapshotId: string; createdAt: string; model: string; promptVersion: string;
  orientation: string; voices: Voice[]; closing: string; realityCheck: string;
  analyzedIds: string[]; usage: {inputTokens: number|null; outputTokens: number|null};
  warnings: string[]; mode: 'ai';
}
export interface Settings {
  theme: 'light'|'dark'|'system'; exploration: number; depth: number; archival: number;
  contention: number; batchSize: number; sourceBudget: number; postsPerSource: number;
  communityCap: number; clusterCap: number; topicWeights: Record<string, number>;
  mutedTerms: string[]; boostedTerms: string[]; commentPrompt: string; curatorPrompt: string;
  ai: {enabled: boolean; provider: 'openai'|'compatible'; model: string; baseUrl: string;
    maxCallsPerRun: number; maxInputCharacters: number; maxOutputTokens: number};
}
export interface SelectionReason {score: number; inputs: Record<string, number|null>; reasons: string[]; policy: string; lane: Lane}
export interface Batch {
  id: string; createdAt: string; kind: 'fresh'|'recurated'; candidateIds: string[];
  reasons: Record<string, SelectionReason>; coverage: {
    attempted: string[]; accessible: string[]; failures: {source: string; error: string}[];
    freshCandidates: number; cachedCandidates: number; inspectedThreads: number; notes: string[];
  }; settings: Settings; cursor: number;
}
export interface Feedback {
  id: string; candidateId: string; action: 'magic'|'less'|'seen'|'not-today'|'misrepresented';
  scope: 'topic'|'source'|'treatment'|'repetition'|'timing'; reason: string; createdAt: string; commentId?: string;
}
export interface SavedItem {id: string; candidateId: string; snapshotId?: string; commentId?: string; collection: string; savedAt: string}
export interface AppState {
  schemaVersion: number; sources: Source[]; profiles: {name: string; provenance: string}[];
  settings: Settings; candidates: Record<string,Candidate>; snapshots: Record<string,ThreadSnapshot>;
  curations: Record<string,Curation>; batches: Batch[]; saved: SavedItem[]; feedback: Feedback[];
  readPositions: Record<string,number>; seen: string[]; sourceCursor: number;
}
export interface Job {
  id: string; kind: 'discovery'|'capture'|'curation'; status: 'running'|'complete'|'cancelled'|'failed';
  message: string; startedAt: string; finishedAt?: string; batchId?: string; snapshotId?: string;
  error?: string; inferenceAttempt?: InferenceAttempt;
}
export interface InferenceAttempt {
  id:string; startedAt:string; updatedAt:string; model:string;
  status:'started'|'received'|'accepted'|'rejected'|'failed'|'cancelled';
  code:'request_started'|'response_received'|'accepted'|'integrity_rejected'|'invalid_output'|'incomplete_response'|'http_error'|'response_limit'|'network_error'|'cancelled'|'usage_log_error';
  httpStatus:number|null; submittedComments:number;
  usage:{inputTokens:number|null;outputTokens:number|null};
}
export interface Bootstrap {state: AppState; jobs: Job[]; runtime: {inferenceConfigured: boolean; redditConfigured: boolean; version: string; retention: string}}
