import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppState, Batch, Bootstrap, Candidate, Comment, Curation, Feedback, Job, Media, SavedItem, Settings, Source, ThreadSnapshot, Voice } from '../shared/types';
import { createSessionTransport } from './session';
import { TopicWeightInput } from './fields';
import { InferenceAttemptNote } from './inference-note';
import './styles.css';

type View = 'discover' | 'read' | 'saved' | 'tune';
type Route = { view: View; thread: string | null; batch: string | null };
type Notice = { text: string; error: boolean } | null;
const embedded = new URLSearchParams(location.search).get('embed') === '1';
const extensionReader = embedded && location.protocol === 'moz-extension:';
const sessionFragment = new URLSearchParams(location.hash.slice(1)).get('session');
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
let readerToken: string | null = null;
const sessionTransport = createSessionTransport((path, options) => fetch(path, options), !embedded);

async function extensionApi<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const runtime = (globalThis as any).browser?.runtime;
  if (!runtime || !getRoute().thread) throw new Error('This reader needs a new capture from the Firefox extension.');
  const result = await runtime.sendMessage({
    type: 'reader-api', snapshotId: getRoute().thread, path, body,
    method: method || (body === undefined ? 'GET' : 'POST'),
  });
  if (!result?.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'The Firefox reader could not reach the local service.');
  return result.data as T;
}

async function api<T = Record<string, unknown>>(path: string, body?: unknown, method?: string): Promise<T> {
  if (extensionReader) return extensionApi<T>(path, body, method);
  const options: RequestInit = {
    method: method || (body === undefined ? 'GET' : 'POST'), credentials: 'same-origin',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'X-Rekindle-Request': '1', ...(readerToken ? { Authorization: `Bearer ${readerToken}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  const response = await sessionTransport(path, options);
  const content = await response.text();
  let data: any;
  try { data = content ? JSON.parse(content) : {}; } catch { throw new Error(`The local service returned an unreadable response (${response.status}).`); }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${response.status}).`);
  return data as T;
}
function getRoute(): Route {
  const query = new URLSearchParams(location.search);
  const view = query.get('view');
  return { view: query.has('thread') ? 'read' : ['discover', 'read', 'saved', 'tune'].includes(view || '') ? view as View : 'discover', thread: query.get('thread'), batch: query.get('batch') };
}
function safeLink(value?: string | null): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !host.includes('.') || /\.(local|localhost|internal|lan|home)$/.test(host) || host.startsWith('[')) return;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split('.').map(Number);
      if ([0, 10, 127].includes(a) || a >= 224 || a === 169 && b === 254 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19].includes(b)) return;
    }
    return url.href;
  } catch { /* Untrusted links remain plain text. */ }
}
function mediaLink(value?: string): string | undefined {
  const safe = safeLink(value);
  if (!safe) return;
  const url = new URL(safe);
  if (url.protocol === 'https:' && (['i.redd.it', 'preview.redd.it', 'external-preview.redd.it', 'v.redd.it', 'i.imgur.com'].includes(url.hostname) || /^[a-z0-9-]+\.thumbs\.redditmedia\.com$/.test(url.hostname))) return safe;
}
function date(value: string | null | undefined, long = false): string {
  if (!value || Number.isNaN(new Date(value).getTime())) return 'Date unavailable';
  return new Date(value).toLocaleDateString(undefined, { month: long ? 'long' : 'short', day: 'numeric', year: 'numeric' });
}
function author(value: string | null): string { return value ? `u/${value}` : 'Author unavailable'; }
function pretty(value: string): string { return value.replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase()); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function previewBody(value: string): string {
  const cleaned = value.split('\n').filter(line => !/^\s*(?:\(?https?:\/\/\S+\)?|\[(?:link|comments)\].*|submitted by\b.*)\s*$/i.test(line)).join('\n').trim();
  return cleaned.split(/\s+/).length > 3 ? cleaned : '';
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    arrow: <><path d="M4 12h15M13 6l6 6-6 6" /></>,
    back: <><path d="M20 12H5m6 6-6-6 6-6" /></>,
    save: <path d="M6 4h12v17l-6-4-6 4z" />,
    check: <path d="m5 12 4 4L19 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" /></>,
    moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" />,
    spark: <><path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8Z" /></>,
    external: <><path d="M14 4h6v6m0-6-9 9M10 5H5v14h14v-5" /></>,
    sliders: <><path d="M4 6h7m4 0h5M4 12h2m4 0h10M4 18h10m4 0h2" /><circle cx="13" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="16" cy="18" r="2" /></>,
    book: <><path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Z" /><path d="M12 6v14" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.spark}</svg>;
}
function Flame({ className = '' }: { className?: string }) {
  return <svg className={className} width="33" height="39" viewBox="0 0 36 44" aria-hidden="true"><path fill="currentColor" d="M22 2c3 11-8 13-5 24 4-1 8-5 7-10 14 14 5 26-6 26C1 42-2 25 12 12c0 8 2 10 2 10S23 12 22 2Z"/><path fill="var(--paper)" d="M19 26c5 5 5 10-1 11-6-1-5-6 1-11Z"/></svg>;
}
function External({ href, children, className }: { href?: string | null; children: React.ReactNode; className?: string }) {
  const safe = safeLink(href);
  return safe ? <a href={safe} className={className} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a> : <span className={className}>{children}</span>;
}

function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [route, setRoute] = useState<Route>(getRoute);
  const [fatal, setFatal] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [starting, setStarting] = useState(false);
  const [ready, setReady] = useState(false);
  const [localTheme, setLocalTheme] = useState<'light' | 'dark' | null>(null);
  const routeRef = useRef(route); routeRef.current = route;
  const bootRef = useRef(boot); bootRef.current = boot;
  const pendingRefresh = useRef<{ jobId: string; sourceId: string; batch: string | null } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tell = useCallback((text: string, error = false) => {
    setNotice({ text, error });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    if (!error) noticeTimer.current = setTimeout(() => setNotice(null), 6500);
  }, []);
  const refresh = useCallback(async () => {
    const data = await api<Bootstrap>('/api/state');
    setBoot(data);
    return data;
  }, []);
  const navigate = useCallback((view: View, thread?: string | null, batch?: string | null) => {
    if (embedded && (view !== 'read' || !thread)) { window.parent.postMessage({ type: 'rekindle:open-portal' }, '*'); return; }
    const previous = routeRef.current;
    const batchId = previous.batch || bootRef.current?.state.batches[0]?.id;
    const key = previous.view === 'read' && previous.thread ? `thread:${previous.thread}` : previous.view === 'discover' && batchId ? `batch:${batchId}` : null;
    if (key && bootRef.current) { bootRef.current.state.readPositions[key] = window.scrollY; void api('/api/position', { key, position: window.scrollY }).catch(() => {}); }
    const query = new URLSearchParams();
    if (embedded) query.set('embed', '1');
    query.set('view', view);
    if (thread) query.set('thread', thread);
    if (batch) query.set('batch', batch);
    history.pushState(null, '', `/?${query}`);
    setRoute({ view, thread: thread || null, batch: batch || null });
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (extensionReader) {
          await extensionApi('/api/session', {}, 'POST');
          if (alive) { await refresh(); setReady(true); window.parent.postMessage({ type: 'rekindle:ready' }, '*'); }
          return;
        }
        if (embedded && !sessionFragment) throw new Error('This reader needs a fresh session. Close it and press Rekindle again on the original thread.');
        const response = await fetch('/api/session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Rekindle-Request': '1', ...(sessionFragment ? { 'X-Rekindle-Session': sessionFragment } : {}) }, body: '{}' });
        if (!response.ok) throw new Error(embedded ? 'This reader session has expired. Close the reader and press Rekindle again on the original thread.' : 'The local session could not start. Reload Rekindle to try again.');
        const data = await response.json();
        if (embedded && typeof data.token === 'string') readerToken = data.token;
        if (alive) { await refresh(); setReady(true); if (embedded) window.parent.postMessage({ type: 'rekindle:ready' }, '*'); }
      } catch (error) { if (alive) setFatal((error as Error).message); }
    })();
    const pop = () => setRoute(getRoute());
    const escape = (event: KeyboardEvent) => { if (embedded && event.key === 'Escape') { event.preventDefault(); window.parent.postMessage({ type: 'rekindle:close' }, '*'); } };
    window.addEventListener('popstate', pop);
    window.addEventListener('keydown', escape);
    return () => { alive = false; window.removeEventListener('popstate', pop); window.removeEventListener('keydown', escape); };
  }, [refresh]);
  useEffect(() => {
    if (!ready) return;
    let busy = false;
    const update = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const next = await api<{ jobs: Job[] }>('/api/jobs');
        const old = bootRef.current?.jobs || [];
        const finished = next.jobs.filter(j => j.status !== 'running' && old.some(o => o.id === j.id && o.status === 'running'));
        const disappeared = old.some(job => job.status === 'running' && !next.jobs.some(current => current.id === job.id));
        const changed = JSON.stringify(next.jobs) !== JSON.stringify(old);
        if (changed) {
          await refresh();
          if (disappeared) tell('An earlier run is no longer reported by the local service. It may have been interrupted; start a new run if needed.');
          for (const job of finished) {
            if (job.status === 'complete') {
              if (job.kind === 'capture' && job.snapshotId && routeRef.current.view === 'read' && !routeRef.current.thread) navigate('read', job.snapshotId);
              if (job.kind === 'discovery' && job.batchId && routeRef.current.view === 'discover') navigate('discover', null, job.batchId);
              tell(job.message || 'Ready to read.');
            } else tell(job.error || job.message || (job.status === 'cancelled' ? 'Run cancelled.' : 'This run did not finish.'), job.status === 'failed');
          }
        }
      } catch (error) { tell((error as Error).message, true); }
      finally { busy = false; }
    };
    const timer = setInterval(update, 1800);
    const focus = () => { void refresh().catch(error => tell(error.message, true)); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [ready, refresh, navigate, tell]);
  useEffect(() => {
    const intended = pendingRefresh.current;
    if (!intended) return;
    const job = boot?.jobs.find(item => item.id === intended.jobId);
    if (!job || job.status === 'running') return;
    pendingRefresh.current = null;
    if (job.status === 'complete' && job.snapshotId && routeRef.current.view === 'read' && routeRef.current.thread === intended.sourceId) {
      navigate('read', job.snapshotId, intended.batch);
    }
  }, [boot?.jobs, navigate]);
  useEffect(() => {
    const theme = localTheme || boot?.state.settings.theme || 'system';
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme; };
    apply(); system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [boot?.state.settings.theme, localTheme]);
  useEffect(() => {
    if (!boot || !ready) return;
    const batch = route.batch || boot.state.batches[0]?.id;
    const key = route.view === 'read' && route.thread ? `thread:${route.thread}` : route.view === 'discover' && batch ? `batch:${batch}` : null;
    let timer: ReturnType<typeof setTimeout>;
    let pendingPosition: number | null = null;
    let enabled = false;
    const position = key ? boot.state.readPositions[key] || 0 : 0;
    const restore = setTimeout(() => { window.scrollTo({ top: position, behavior: 'instant' }); enabled = true; }, 100);
    const commitPosition = (value: number) => {
      if (!key) return;
      if (bootRef.current) bootRef.current.state.readPositions[key] = value;
      void api('/api/position', { key, position: value }).catch(() => {});
    };
    const save = () => {
      if (!enabled || !key) return;
      clearTimeout(timer);
      const current = window.scrollY;
      pendingPosition = current;
      timer = setTimeout(() => {
        pendingPosition = null;
        commitPosition(current);
      }, 500);
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      clearTimeout(restore); clearTimeout(timer); window.removeEventListener('scroll', save);
      // Capture belongs to the old route; the new route may already have changed scrollY.
      if (pendingPosition !== null) commitPosition(pendingPosition);
    };
  }, [route.view, route.thread, route.batch, ready]);
  const mutate = useCallback(async (path: string, body?: unknown, success?: string, method?: string) => {
    const outgoing = path === '/api/settings' && body && typeof body === 'object'
      ? { baseSettings: bootRef.current?.state.settings, ...body }
      : body;
    try {
      const result = await api<any>(path, outgoing, method);
      if (path === '/api/refresh' && result.job?.id && body && typeof body === 'object' && 'snapshotId' in body) {
        pendingRefresh.current = { jobId: result.job.id, sourceId: String(body.snapshotId), batch: routeRef.current.batch };
      }
      const updated = await refresh();
      if (success) tell(success);
      return path === '/api/settings' ? { ...result, settings: updated.state.settings } : result;
    }
    catch (error) { tell((error as Error).message, true); throw error; }
  }, [refresh, tell]);
  const discover = async (mode: 'fresh' | 'recurate' | 'continue') => {
    if (starting) return;
    setStarting(true);
    try {
      const result = await mutate('/api/discover', { mode });
      if (result.job?.status === 'complete' && result.job.batchId) navigate('discover', null, result.job.batchId);
      else if (result.job?.status === 'failed') tell(result.job.error || result.job.message, true);
    } catch { /* Notice is shown by mutate. */ }
    finally { setStarting(false); }
  };
  if (fatal) return <div className="boot-shell"><Flame /><h1>Let’s reconnect.</h1><p>{fatal}</p><button onClick={() => location.reload()}>Try again</button>{embedded && <button className="subtle" onClick={() => window.parent.postMessage({ type: 'rekindle:close' }, '*')}>Original thread</button>}</div>;
  if (!boot) return <div className="boot-shell" role="status"><Flame /><h1>Rekindle</h1><p>Opening your curiosity cabinet…</p><span className="loading-line" /></div>;
  const { state, jobs, runtime } = boot;
  const activeTheme = localTheme || (state.settings.theme === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : state.settings.theme);
  const working = jobs.filter(job => job.status === 'running');
  const props: SharedProps = { state, jobs, runtime, route, navigate, mutate, tell, refresh };
  return <div className={embedded ? 'app embedded' : 'app'}>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="masthead">
      <button className="brand" onClick={() => navigate('discover')} aria-label="Rekindle home"><Flame /><span>Rekindle<small>Restore the magic.</small></span></button>
      {!embedded && <nav aria-label="Main navigation">{(['discover', 'read', 'saved', 'tune'] as View[]).map(view => <button key={view} aria-current={route.view === view ? 'page' : undefined} className={route.view === view ? 'active' : ''} onClick={() => navigate(view)}>{pretty(view)}{view === 'saved' && state.saved.length > 0 && <span className="nav-count">{state.saved.length}</span>}</button>)}</nav>}
      <div className="header-end"><span className="local-indicator"><i /> Yours, locally</span><button className="icon-button theme-switch" title="Switch color theme" aria-label="Switch color theme" onClick={() => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; if (embedded) { setLocalTheme(next); return; } void mutate('/api/settings', { settings: { ...state.settings, theme: next } }).catch(() => {}); }}><Icon name={activeTheme === 'dark' ? 'sun' : 'moon'} /></button>{embedded && <button className="button quiet small" onClick={() => window.parent.postMessage({ type: 'rekindle:close' }, '*')}>Original thread <Icon name="close" size={14} /></button>}</div>
    </header>
    {notice && <div className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.text}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice(null)}><Icon name="close" /></button></div>}
    {working.length > 0 && <div className="job-tray" aria-live="polite">{working.map(job => <div key={job.id} className="job"><span className="activity-dot" /><div><strong>{job.kind === 'discovery' ? 'Looking beyond the usual.' : job.kind === 'capture' ? 'Bringing the discussion in.' : 'Listening for the good stuff.'}</strong><span>{job.message}</span></div><button className="text-button" onClick={() => void mutate(`/api/jobs/${encodeURIComponent(job.id)}/cancel`, {}, 'Cancellation requested.').catch(() => {})}>Cancel</button></div>)}</div>}
    <main id="main" tabIndex={-1}>
      {route.view === 'discover' && <Discover {...props} discover={discover} starting={starting} />}
      {route.view === 'read' && <Read {...props} />}
      {route.view === 'saved' && <Saved {...props} />}
      {route.view === 'tune' && <Tune {...props} />}
    </main>
    <footer className="site-footer"><span><Flame /> A small doorway to a bigger world.</span><span>Rekindle {runtime.version} <b>·</b> Read with curiosity.</span></footer>
  </div>;
}

interface SharedProps {
  state: AppState; jobs: Job[]; runtime: Bootstrap['runtime']; route: Route;
  navigate: (view: View, thread?: string | null, batch?: string | null) => void;
  mutate: (path: string, body?: unknown, success?: string, method?: string) => Promise<any>;
  tell: (text: string, error?: boolean) => void; refresh: () => Promise<Bootstrap>;
}
function SectionLabel({ children, tail }: { children: React.ReactNode; tail?: React.ReactNode }) { return <div className="section-label"><span>{children}</span>{tail && <span>{tail}</span>}</div>; }
function Discover(props: SharedProps & { discover: (mode: 'fresh' | 'recurate' | 'continue') => Promise<void>; starting: boolean }) {
  const { state, route, navigate, jobs, starting, discover } = props;
  const batch = state.batches.find(b => b.id === route.batch) || state.batches[0];
  const candidates = batch?.candidateIds.map(id => state.candidates[id]).filter(Boolean) || [];
  const active = starting || jobs.some(j => j.kind === 'discovery' && j.status === 'running');
  const sourceCount = state.sources.filter(source => source.enabled).length;
  return <div className={`discover page-width ${batch ? 'has-batch' : ''}`}>
    <section className="discover-intro">
      <div className="intro-copy"><p className="eyebrow">Your personal field guide to the interesting</p><h1>{batch ? 'A little more wonder' : <>Good things are<br />still out there</>}<span>.</span></h1><p className="lede">{batch ? 'A fresh edition, a few detours, and the voices behind them.' : <>The obscure explanation. The perfect joke.<br className="desktop-break" /> That one human story that stays with you.</>}</p><div className="primary-row"><button className="primary discover-button" disabled={active} onClick={() => void discover('fresh')}><Icon name="spark" />{active ? 'Finding the good stuff…' : 'Find me something good'}{!active && <Icon name="arrow" />}</button><span className="action-note">A fresh, finite batch.<br />Something to enjoy, then leave.</span></div></div>
      <div className="curiosity-art" aria-hidden="true"><div className="art-orbit one" /><div className="art-orbit two" /><svg viewBox="0 0 280 290"><g className="art-lines" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M137 210C62 175 33 91 94 42c32-27 108-13 122 37 19 69-11 103-79 131Z"/><path d="M137 210C103 144 87 89 121 49c24-27 59-4 63 33 7 63-16 104-47 128Z"/><path d="M137 210c29-89 28-144 8-175M69 88c58 18 108 22 145-8M84 134c35 13 78 17 126 1M107 175c26 4 52 4 74-5M138 208l-3 50m-12 1h25"/></g><g fill="currentColor"><circle cx="233" cy="182" r="3"/><circle cx="51" cy="182" r="2"/><circle cx="205" cy="25" r="2"/><path d="m49 38 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z"/><path d="m231 115 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/></g></svg><span>A wider world.<br /><em>A warmer corner of it.</em></span></div>
    </section>
    <div className="taste-strip"><span><span className="small-flame">✦</span> Made for your curiosity</span><span>{sourceCount} sources in your map</span><span>{Math.round(state.settings.exploration * 100)}% exploration</span><button className="text-button" onClick={() => navigate('tune')}>Tune my feed <Icon name="sliders" size={15} /></button></div>
    {state.batches.length > 0 && <div className="batch-toolbar"><div><p className="eyebrow">{batch?.kind === 'fresh' ? 'Your collected edition' : 'A fresh selection from your collection'}</p><h2>{candidates.length ? 'Take the scenic route.' : 'The search, honestly.'}</h2></div><div className="batch-tools"><label className="sr-only" htmlFor="batch-select">Choose previous batch</label><select id="batch-select" value={batch?.id} onChange={e => navigate('discover', null, e.target.value)}>{state.batches.map((b, index) => <option key={b.id} value={b.id}>{index === 0 ? 'Latest · ' : ''}{date(b.createdAt)} · {b.candidateIds.length} finds{b.kind === 'recurated' ? ' · re-curated' : ''}</option>)}</select><details className="inline-menu"><summary>Batch options</summary><div className="menu-content"><button disabled={active} onClick={() => void discover('recurate')}>Re-curate existing candidates</button><button disabled={active} onClick={() => void discover('continue')}>Continue this batch</button><p>Re-curation reuses collected material. Continue selects more unread material from the current pool.</p></div></details></div></div>}
    {batch && <BatchCoverage batch={batch} />}
    {candidates.length ? <div className="discovery-grid">{candidates.map((candidate, index) => <DiscoveryCard {...props} candidate={candidate} batch={batch!} index={index} key={candidate.id} />)}</div> : <div className="welcome-grid"><section className="welcome-letter"><span className="chapter-number">01 / A BEGINNING</span><h2>{batch ? 'A quiet edition is an honest one.' : <>Welcome to your<br />curiosity cabinet.</>}</h2><p>{batch ? 'This run did not produce an unread batch. Collection details above show what was accessible. You can try again, re-curate material already collected, or bring in a discussion yourself.' : 'Add communities in Tune to build your source map, or bring a discussion to try the included synthetic sample. Discovery looks across a rotating slice of the sources you choose.'}</p><p>{batch ? 'Nothing has been filled with invented discoveries.' : 'A lovely photograph belongs beside an expert’s explanation. A ridiculous animal belongs beside a life well lived. There’s room for all of it.'}</p><div className="welcome-actions"><button className="text-button" onClick={() => navigate('read')}>Bring a discussion <Icon name="arrow" size={16} /></button>{Object.keys(state.candidates).length > 0 && <button className="text-button" disabled={active} onClick={() => void discover('recurate')}>Re-curate collected material</button>}</div></section><aside className="cabinet-note"><p className="eyebrow">The way we wander</p><ol><li><span>01</span><div><h3>Start somewhere familiar.</h3><p>The communities you choose form a map of possibilities, with every source editable.</p></div></li><li><span>02</span><div><h3>Leave room for a detour.</h3><p>Adjacent interests and plausible wildcards keep the room from getting smaller.</p></div></li><li><span>03</span><div><h3>Keep the people in it.</h3><p>Original voices, traceable quotations, and a door back to the conversation.</p></div></li></ol><button className="text-button" onClick={() => navigate('tune')}>Look at your map <Icon name="arrow" size={15} /></button></aside></div>}
    {candidates.length > 0 && <div className="edition-end"><span>✦</span><h3>A good place to pause.</h3><p>{candidates.length} discoveries. No endless scroll.</p><button className="button quiet" disabled={active} onClick={() => void discover('continue')}>Continue this batch <Icon name="arrow" size={16} /></button></div>}
  </div>;
}
function BatchCoverage({ batch }: { batch: Batch }) {
  const coverage = batch.coverage;
  return <details className="coverage batch-coverage"><summary><span className="coverage-mark">◌</span> {coverage.accessible.length} of {coverage.attempted.length} attempted sources accessible <span className="coverage-divider">·</span> {coverage.freshCandidates} new candidates <span className="detail-cue">Collection notes</span></summary><div className="coverage-body"><p>Collected {date(batch.createdAt, true)}. {coverage.cachedCandidates} cached candidates used. {coverage.inspectedThreads} discussions inspected beyond their listing.</p><p>Attempted: {coverage.attempted.length ? coverage.attempted.map(name => `r/${name}`).join(', ') : 'No remote sources attempted in this run.'}</p>{coverage.notes.map((note, index) => <p key={index}>{note}</p>)}{coverage.failures.length > 0 && <div className="failure-list"><strong>Unavailable during this run</strong>{coverage.failures.map((failure, index) => <p key={index}><b>r/{failure.source}</b>: {failure.error}</p>)}<p>Access failures do not establish inactivity, a ban, or low quality.</p></div>}</div></details>;
}
function DiscoveryCard(props: SharedProps & { candidate: Candidate; batch: Batch; index: number }) {
  const { candidate, batch, index, state, mutate, navigate } = props;
  const [opening, setOpening] = useState(false);
  const snapshot = Object.values(state.snapshots).find(s => s.post.id === candidate.id);
  const reason = batch.reasons[candidate.id];
  const curation = snapshot && Object.values(state.curations).filter(c => c.snapshotId === snapshot.id).at(-1);
  const hookVoice = curation?.voices[0];
  const hookComment = snapshot?.comments.find(c => c.id === hookVoice?.commentId);
  const bodyPreview = previewBody(candidate.body);
  const selectionNote = candidate.lane === 'familiar' ? `From your ${candidate.cluster.toLowerCase()} interests.` : candidate.lane === 'adjacent' ? `A detour through ${candidate.cluster.toLowerCase()}.` : `A wildcard from ${candidate.cluster.toLowerCase()}.`;
  const open = async () => {
    if (opening) return;
    setOpening(true);
    try { const result = await mutate('/api/open', { candidateId: candidate.id }); if (result.snapshot?.id) navigate('read', result.snapshot.id, batch.id); }
    catch { /* The app displays the failure. */ } finally { setOpening(false); }
  };
  return <article className={`discovery-card ${index === 0 ? 'lead-card' : ''} format-${candidate.format}`}>
    {candidate.media.length > 0 && <MediaView media={candidate.media} spoiler={candidate.spoiler} nsfw={candidate.nsfw} compact />}
    <div className="card-inner"><div className="card-meta"><span>r/{candidate.subreddit}</span><span>{candidate.archival ? 'From the archive · ' : ''}{date(candidate.publishedAt)}</span></div><div className="card-flavor"><span>{pretty(candidate.format)}</span>{candidate.lane !== 'familiar' && <span>{candidate.lane === 'adjacent' ? 'A little further afield' : 'A curious detour'}</span>}</div><h3><button disabled={opening || (!snapshot && !candidate.permalink)} onClick={() => void open()}>{candidate.title}</button></h3>{hookVoice && hookComment ? <blockquote className="card-hook">“{quoteText(hookComment, hookVoice).slice(0, 220)}{quoteText(hookComment, hookVoice).length > 220 ? '…' : ''}”<cite>{author(hookComment.author)}</cite></blockquote> : bodyPreview && <p className="card-excerpt">{bodyPreview.slice(0, 230)}{bodyPreview.length > 230 ? '…' : ''}</p>}{reason && <p className="reason-line">{selectionNote}</p>}<div className="card-read-row"><button className="text-button" disabled={opening || (!snapshot && !candidate.permalink)} onClick={() => void open()}>{opening ? 'Opening discussion…' : snapshot ? snapshot.comments.length ? 'Read the voices' : 'Read the source' : 'Open in reader'} <Icon name="arrow" size={15} /></button>{candidate.url && candidate.url !== candidate.permalink && <External href={candidate.url} className="small-link">Source <Icon name="external" size={13} /></External>}</div><ItemActions {...props} candidate={candidate} snapshotId={snapshot?.id} />{reason && <details className="why-this"><summary>Why this?</summary><p>{reason.reasons.join(' ')}</p><dl><div><dt>Policy</dt><dd>{reason.policy}</dd></div><div><dt>Lane</dt><dd>{reason.lane}</dd></div><div><dt>Selection score</dt><dd>{Number.isFinite(reason.score) ? reason.score.toFixed(2) : 'Unknown'}</dd></div>{Object.entries(reason.inputs).map(([key, value]) => <div key={key}><dt>{pretty(key)}</dt><dd>{value === null ? 'Unknown' : value.toFixed(2)}</dd></div>)}</dl><p className="muted">These are selection signals, not measurements of truth. {candidate.commentsInspected} comments inspected for this candidate.</p></details>}</div>
  </article>;
}
function MediaView({ media, spoiler, nsfw, compact = false }: { media: Media[]; spoiler: boolean; nsfw: boolean; compact?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const [failed, setFailed] = useState<Set<number>>(new Set());
  if (!media.length) return null;
  if ((spoiler || nsfw) && !revealed) return <div className="media-gate"><Icon name="book" size={25} /><p>{spoiler && nsfw ? 'Spoiler · marked NSFW at source' : spoiler ? 'Contains a source-marked spoiler' : 'Marked NSFW at source'}</p><button className="button quiet small" onClick={() => setRevealed(true)}>Show source media</button></div>;
  return <div className={`media-view ${compact ? 'compact' : ''}`}>{(compact ? media.slice(0, 1) : media).map((item, index) => {
    const src = mediaLink(item.url);
    return <figure key={index}>{src && !failed.has(index) && item.type === 'image' ? <img src={src} alt={item.caption || 'Image attached to the source post'} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(prev => new Set(prev).add(index))} /> : src && !failed.has(index) && item.type === 'video' ? <video src={src} controls preload="none" poster={mediaLink(item.preview)} onError={() => setFailed(prev => new Set(prev).add(index))}><track kind="captions" /></video> : <div className="media-fallback"><Icon name="external" size={25} /><p>{failed.has(index) ? 'This media could not be loaded here.' : item.type === 'video' ? 'Watch the video at its source.' : 'View the linked source material.'}</p><External href={item.url} className="button quiet small">Open source media <Icon name="external" size={14} /></External></div>}{item.caption && !compact && <figcaption>{item.caption} <External href={item.url}>Source ↗</External></figcaption>}</figure>;
  })}{compact && media.length > 1 && <span className="media-count">+{media.length - 1} source media</span>}</div>;
}
function ItemActions(props: SharedProps & { candidate: Candidate; snapshotId?: string; commentId?: string }) {
  const { candidate, snapshotId, commentId, state, mutate } = props;
  const [feedback, setFeedback] = useState<'less' | 'misrepresented' | null>(null);
  const [scope, setScope] = useState<Feedback['scope']>('treatment');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const saved = state.saved.some(s => s.candidateId === candidate.id && s.snapshotId === snapshotId && (s.commentId || undefined) === commentId);
  const magic = state.feedback.some(f => f.candidateId === candidate.id && f.action === 'magic' && f.commentId === commentId);
  const send = async (action: Feedback['action'], targetScope: Feedback['scope'], text = '') => {
    if (busy) return;
    setBusy(true);
    try { await mutate('/api/feedback', { candidateId: candidate.id, action, scope: targetScope, reason: text, ...(commentId ? { commentId } : {}) }, action === 'misrepresented' ? 'Flag saved with the source reference. Thank you for protecting the meaning.' : action === 'not-today' ? 'Not today. Your underlying interests are unchanged.' : 'Feedback saved. Your next selection will take it into account.'); setFeedback(null); setReason(''); }
    catch { /* App notice. */ } finally { setBusy(false); }
  };
  return <div className="item-action-area"><div className="item-actions"><button className={`text-button ${saved ? 'selected' : ''}`} aria-pressed={saved} disabled={busy} onClick={async () => { setBusy(true); try { await mutate('/api/save', { candidateId: candidate.id, snapshotId, commentId }, saved ? 'Removed from Saved.' : commentId ? 'Voice saved to your cabinet.' : 'Saved to your cabinet.'); } catch {} finally { setBusy(false); } }}><Icon name={saved ? 'check' : 'save'} size={15} />{saved ? 'Saved' : commentId ? 'Save voice' : 'Save'}</button><button className={`text-button ${magic ? 'selected' : ''}`} disabled={busy || magic} onClick={() => void send('magic', 'treatment')}><Icon name="spark" size={15} />{magic ? 'A little magic' : 'This was magic'}</button><details className="inline-menu feedback-menu"><summary aria-label="More feedback options">•••</summary><div className="menu-content"><button onClick={() => { setFeedback('less'); setScope('treatment'); }}>Less like this</button><button onClick={() => void send('seen', 'repetition')}>Already seen</button><button onClick={() => void send('not-today', 'timing')}>Not today</button>{commentId && <button onClick={() => { setFeedback('misrepresented'); setScope('treatment'); }}>Quote is misrepresented</button>}</div></details></div>{feedback && <form className="feedback-form" onSubmit={e => { e.preventDefault(); void send(feedback, scope, reason); }}><strong>{feedback === 'misrepresented' ? 'What did the selection miss?' : 'What would you like less of?'}</strong>{feedback === 'less' && <label>Reason category<select value={scope} onChange={e => setScope(e.target.value as Feedback['scope'])}><option value="treatment">The treatment or framing</option><option value="topic">This topic</option><option value="source">This community</option><option value="repetition">Repetition</option><option value="timing">Just the timing</option></select></label>}<label><span className="sr-only">Optional feedback details</span><textarea value={reason} onChange={e => setReason(e.target.value)} placeholder={feedback === 'misrepresented' ? 'Missing context, an overlooked correction, a misleading excerpt…' : 'Optional note'} rows={2} maxLength={1200} /></label><div className="button-row"><button className="small" disabled={busy} type="submit">Save feedback</button><button className="quiet small" type="button" onClick={() => setFeedback(null)}>Cancel</button></div></form>}</div>;
}

function Read(props: SharedProps) {
  const { state, route, navigate } = props;
  const snapshot = route.thread ? state.snapshots[route.thread] : undefined;
  if (snapshot) return <ThreadReader {...props} snapshot={snapshot} key={snapshot.id} />;
  const recent = Object.values(state.snapshots).sort((a, b) => b.coverage.obtainedAt.localeCompare(a.coverage.obtainedAt));
  return <div className="page-width reading-home"><p className="eyebrow">The people are the point</p><h1>A discussion.<br />A door into someone’s world.</h1><p className="page-lede">Bring a Reddit thread, a saved capture, or plain source text.<br />The original voices are available as soon as they arrive.</p>{route.thread && <p className="inline-alert">This snapshot is no longer in your local library. You can capture or import it again.</p>}<CaptureForm {...props} /><SectionLabel tail={`${recent.length} local snapshots`}>On your reading table</SectionLabel>{recent.length ? <div className="reading-list">{recent.map(s => <button className="reading-list-item" onClick={() => navigate('read', s.id)} key={s.id}><span className="reading-list-icon"><Icon name="book" size={23} /></span><div><span className="card-meta">r/{s.post.subreddit} · {date(s.coverage.obtainedAt)}{s.imported ? ' · imported source' : ''}</span><h3>{s.post.title}</h3><p>{s.comments.length} captured comments · {s.sourceLabel}</p></div><Icon name="arrow" /></button>)}</div> : <div className="quiet-empty"><Icon name="book" size={34} /><h2>Your reading table is ready.</h2><p>Captured discussions will appear here, with their source material and your place preserved.</p></div>}</div>;
}
function CaptureForm({ mutate, navigate, tell, jobs }: SharedProps) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [filename, setFilename] = useState('pasted-source.txt');
  const [busy, setBusy] = useState(false);
  const running = jobs.some(job => job.kind === 'capture' && job.status === 'running');
  const importText = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { const data = await mutate('/api/import', { text, filename }); if (data.snapshot?.id) navigate('read', data.snapshot.id); }
    catch {} finally { setBusy(false); }
  };
  return <div className="capture-box"><form className="url-form" onSubmit={async e => { e.preventDefault(); setBusy(true); try { const data = await mutate('/api/capture', { url }); if (data.job?.snapshotId && data.job.status === 'complete') navigate('read', data.job.snapshotId); } catch {} finally { setBusy(false); } }}><label htmlFor="thread-url">Open a Reddit discussion</label><div className="input-with-button"><input id="thread-url" type="url" required value={url} placeholder="https://www.reddit.com/r/…/comments/…" onChange={e => setUrl(e.target.value)} /><button type="submit" disabled={busy || running || !url.trim()}>Read thread <Icon name="arrow" size={17} /></button></div><p className="field-help">If Reddit won’t allow direct retrieval, capture the page with the Firefox extension or import the source below.</p></form><details className="import-details"><summary>Import source text or a file <span>Works when direct access doesn’t.</span></summary><div className="import-form"><label htmlFor="source-file">Choose a source file</label><input id="source-file" type="file" accept=".txt,.json,.md,text/plain,application/json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 5_000_000) { tell('Please choose a source file smaller than 5 MB.', true); return; } setText(await file.text()); setFilename(file.name); }} /><label htmlFor="source-text">Or paste the source material</label><textarea id="source-text" rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="Paste thread text, a source snapshot, or Reddit JSON. Source text is treated as untrusted material, never as instructions." /><button disabled={busy || !text.trim()} onClick={() => void importText()}>{busy ? 'Importing…' : 'Import and read'}</button><p className="field-help">Imported material keeps an honest source locator when a real permalink is unavailable.</p></div></details><details className="sample-details"><summary>Try the synthetic sample discussion</summary><p>This imports a fictional discussion written for testing. Its people and events are invented; it is not a live Reddit discovery.</p><button className="quiet small" disabled={busy} onClick={async () => { setBusy(true); try { const data = await mutate('/api/sample', {}); if (data.snapshot?.id) navigate('read', data.snapshot.id); } catch {} finally { setBusy(false); } }}>Import synthetic sample</button></details></div>;
}
function quoteText(comment: Comment, voice: Voice): string {
  if (!voice.excerpts.length || voice.excerpts.some((span, index) => !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end > comment.body.length || span.end <= span.start || index > 0 && span.start < voice.excerpts[index - 1].end)) return '';
  const text = voice.excerpts.map((span, index) => (index > 0 && span.start > voice.excerpts[index - 1].end ? ' […] ' : '') + comment.body.slice(span.start, span.end)).join('');
  return (voice.excerpts[0].start > 0 ? '[…] ' : '') + text + (voice.excerpts.at(-1)!.end < comment.body.length ? ' […]' : '');
}
function ThreadReader(props: SharedProps & { snapshot: ThreadSnapshot }) {
  const { snapshot, state, jobs, runtime, mutate, navigate, route } = props;
  const latestCuration = Object.values(state.curations).filter(c => c.snapshotId === snapshot.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const [curation, setCuration] = useState<Curation | undefined>(latestCuration);
  const visibleCurationId = curation?.id;
  const setVisibleCurationId = (id: string) => setCuration(Object.values(state.curations).find(c => c.id === id));
  const [mode, setMode] = useState<'curated' | 'original'>('curated');
  const [limit, setLimit] = useState(() => (state.readPositions[`thread:${snapshot.id}`] || 0) > 300 ? 2000 : 5);
  const [originalLimit, setOriginalLimit] = useState(() => (state.readPositions[`thread:${snapshot.id}`] || 0) > 300 ? 2000 : 15);
  const [starting, setStarting] = useState(false);
  const attempted = useRef(false);
  const curating = jobs.some(job => job.kind === 'curation' && job.snapshotId === snapshot.id && job.status === 'running');
  const priorCurationFailure = jobs.some(job => job.kind === 'curation' && job.snapshotId === snapshot.id && (job.status === 'failed' || job.status === 'cancelled'));
  const latestAttempt = jobs.filter(job => job.kind === 'curation' && job.snapshotId === snapshot.id && job.inferenceAttempt).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]?.inferenceAttempt;
  const canCurate = state.settings.ai.enabled && runtime.inferenceConfigured;
  const curate = async () => {
    if (starting || curating) return;
    setStarting(true); attempted.current = true;
    try { await mutate('/api/curate', { snapshotId: snapshot.id }); } catch {} finally { setStarting(false); }
  };
  useEffect(() => { if (canCurate && !latestCuration && !curating && !priorCurationFailure && !attempted.current && snapshot.comments.length > 0) void curate(); }, [canCurate, snapshot.id, snapshot.comments.length, latestCuration?.id, priorCurationFailure]);
  useEffect(() => { if (latestCuration && window.scrollY < 240 && mode === 'curated') setVisibleCurationId(latestCuration.id); }, [latestCuration?.id]);
  const post = snapshot.post;
  const selected = curation?.voices.map(voice => ({ voice, comment: snapshot.comments.find(c => c.id === voice.commentId) })).filter((item): item is { voice: Voice; comment: Comment } => !!item.comment && !!quoteText(item.comment, item.voice)) || [];
  return <article className="thread-page page-width">
    <div className="reader-topline">{!embedded && <button className="text-button" onClick={() => navigate(route.batch ? 'discover' : 'read', null, route.batch)}><Icon name="back" size={16} />{route.batch ? 'Back to your edition' : 'Reading table'}</button>}<div>{embedded && <button className="text-button" onClick={() => window.parent.postMessage({ type: 'rekindle:open-portal' }, '*')}>Open in portal <Icon name="external" size={14} /></button>}{post.permalink && <External href={post.permalink} className="text-button">Open and participate <Icon name="external" size={14} /></External>}</div></div>
    <header className="thread-header"><div className="thread-meta"><span>r/{post.subreddit}</span><span>{date(post.publishedAt)}</span>{post.flair && <span>{post.flair}</span>}{snapshot.imported && <span className="tag">Imported source</span>}</div><h1>{post.title}</h1><p className="post-attribution">{author(post.author)}{post.score !== null && <> <span>·</span> {post.score} source score</>}</p><ItemActions {...props} candidate={post} snapshotId={snapshot.id} /></header>
    <div className="reader-layout"><div className="reader-main"><MediaView media={post.media} spoiler={post.spoiler} nsfw={post.nsfw} />{post.url && post.url !== post.permalink && <p className="source-link"><External href={post.url}>Open the linked source <Icon name="external" size={14} /></External></p>}{post.body && <SourceBody body={post.body} label="The original post" limit={1400} />}
      {latestCuration && visibleCurationId !== latestCuration.id && <div className="curation-ready" role="status"><span>Comment mode is ready. Your originals are still in place.</span><button className="text-button" onClick={() => { setVisibleCurationId(latestCuration.id); setMode('curated'); }}>Read the curated voices <Icon name="arrow" size={15} /></button></div>}<div className="reader-view-bar"><div className="segmented" aria-label="Reading view"><button aria-pressed={mode === 'curated'} className={mode === 'curated' ? 'active' : ''} onClick={() => { if (latestCuration) setVisibleCurationId(latestCuration.id); setMode('curated'); }}>Comment mode</button><button aria-pressed={mode === 'original'} className={mode === 'original' ? 'active' : ''} onClick={() => setMode('original')}>Original comments <span>{snapshot.comments.length}</span></button></div>{canCurate && <button className="text-button" disabled={starting || curating} onClick={() => void curate()}>{starting || curating ? 'Curating…' : curation ? 'Curate again' : 'Curate voices'} <Icon name="spark" size={15} /></button>}</div>
      {mode === 'curated' && curation ? <div className="curated-reading"><div className="curation-label"><span className="small-flame">✦</span> Comment mode <span>Selected with {curation.model}</span></div>{curation.orientation && <p className="orientation">{curation.orientation}</p>}{selected.slice(0, limit).map(({ voice, comment }, index) => <VoiceCard {...props} voice={voice} comment={comment} number={index + 1} key={`${comment.id}-${index}`} />)}{selected.length > limit && <button className="button quiet show-more" onClick={() => setLimit(n => n + 5)}>Show more voices <span>{selected.length - limit} more selected</span><Icon name="plus" size={16} /></button>}{selected.length === 0 && <p className="inline-alert">No valid source excerpts are available in this curation. The original comments remain below the Original comments tab.</p>}{curation.closing && <div className="reader-closing"><span>One thought to take with you</span><p>{curation.closing}</p></div>}{curation.realityCheck && <div className="reality-check"><h3>A note about this discussion</h3><p>{curation.realityCheck}</p></div>}{curation.warnings.length > 0 && <details className="coverage"><summary>Curation notes ({curation.warnings.length})</summary><div className="coverage-body">{curation.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div></details>}<button className="text-button all-voices" onClick={() => setMode('original')}>Read all {snapshot.comments.length} captured voices <Icon name="arrow" size={16} /></button></div> : <><div className={`reader-state ${curating || starting ? 'working' : ''}`}>{mode === 'curated' && <><Icon name={curating || starting ? 'spark' : 'book'} size={22} /><div><h3>{curating || starting ? 'The originals are here. Comment mode is on its way.' : canCurate ? 'Ready to find the voices worth keeping.' : 'Original voices, ready to read.'}</h3><p>{curating || starting ? 'Read the source while the curator works. Your place will stay put.' : canCurate ? 'Choose Curate voices to select traceable excerpts from this snapshot.' : 'AI curation is off or not configured. Nothing here is generated. You can enable a provider in Tune.'}</p>{!canCurate && <button className="text-button" onClick={() => navigate('tune')}>{embedded ? 'Set up in portal' : 'Set up Comment mode'} <Icon name="arrow" size={15} /></button>}</div></>}</div><div className="original-comments">{snapshot.comments.slice(0, originalLimit).map(comment => <OriginalComment key={comment.id} comment={comment} snapshot={snapshot} />)}{snapshot.comments.length === 0 && <div className="quiet-empty"><h3>No comments were captured.</h3><p>The post remains readable. Coverage notes explain the retrieval limits; refreshing or importing a fuller capture may provide more voices.</p></div>}{snapshot.comments.length > originalLimit && <button className="button quiet show-more" onClick={() => setOriginalLimit(n => n + 30)}>Show more original comments <span>{snapshot.comments.length - originalLimit} remaining</span><Icon name="plus" size={16} /></button>}</div></>}
    </div><aside className="reader-aside"><div className="reader-aside-inner"><p className="eyebrow">Source notebook</p><h3>People first.<br />Meaning intact.</h3><p>Quotes come from the saved source. Editorial notes are AI interpretation, not independent verification.</p><details className="coverage"><summary>Acquisition & coverage</summary><div className="coverage-body"><dl><div><dt>Obtained</dt><dd>{date(snapshot.coverage.obtainedAt, true)}</dd></div><div><dt>Method</dt><dd>{snapshot.coverage.method}</dd></div><div><dt>Retrieved comments</dt><dd>{snapshot.coverage.retrieved}</dd></div><div><dt>Comments in accepted analysis</dt><dd>{curation?.analyzedIds.length ?? snapshot.coverage.analyzed}</dd></div><div><dt>Site-reported comments</dt><dd>{snapshot.coverage.siteReported ?? 'Unknown'}</dd></div><div><dt>Snapshot</dt><dd>Version {snapshot.version}</dd></div><div><dt>Source label</dt><dd>{snapshot.sourceLabel}</dd></div></dl>{snapshot.coverage.limits.map((limit, index) => <p key={index}>{limit}</p>)}</div></details>{curation && <details className="coverage"><summary>Curation provenance</summary><div className="coverage-body"><dl><div><dt>Model</dt><dd>{curation.model}</dd></div><div><dt>Prompt version</dt><dd>{curation.promptVersion}</dd></div><div><dt>Created</dt><dd>{date(curation.createdAt)}</dd></div><div><dt>Input tokens</dt><dd>{curation.usage.inputTokens ?? 'Not reported'}</dd></div><div><dt>Output tokens</dt><dd>{curation.usage.outputTokens ?? 'Not reported'}</dd></div></dl><p>Charges are not estimated when pricing is unknown.</p></div></details>}{latestAttempt && <InferenceAttemptNote attempt={latestAttempt} />}<div className="source-maintenance">{post.permalink && !snapshot.imported && <button className="text-button" onClick={() => embedded ? window.parent.postMessage({ type: 'rekindle:open-portal' }, '*') : void mutate('/api/refresh', { snapshotId: snapshot.id }, 'Source refresh requested.').then(data => { if (data.snapshot?.id) navigate('read', data.snapshot.id); }).catch(() => {})}>{embedded ? 'Refresh in portal' : 'Refresh source'} <Icon name="arrow" size={14} /></button>}{post.permalink && <External href={post.permalink} className="text-button">Original discussion <Icon name="external" size={14} /></External>}</div><p className="small-print">Retrieved and site-reported counts describe different things. They are not a completeness percentage.</p></div></aside></div>
  </article>;
}
function SourceBody({ body, label, limit = 900 }: { body: string; label?: string; limit?: number }) {
  const [full, setFull] = useState(false);
  const long = body.length > limit;
  return <div className="source-body">{label && <p className="eyebrow">{label}</p>}<div className="source-text">{!full && long ? body.slice(0, limit) + '…' : body}</div>{long && <button className="text-button" aria-expanded={full} onClick={() => setFull(!full)}>{full ? 'Show less' : 'Read the full original'} <Icon name={full ? 'close' : 'plus'} size={14} /></button>}</div>;
}
function CommentSource({ comment }: { comment: Comment }) {
  return comment.permalink && safeLink(comment.permalink) ? <External href={comment.permalink} className="comment-source">View source <Icon name="external" size={12} /></External> : <span className="comment-source source-locator">{comment.locator || `Imported comment ${comment.id}`}</span>;
}
function OriginalComment({ comment, snapshot, context = false }: { comment: Comment; snapshot: ThreadSnapshot; context?: boolean }) {
  const parent = snapshot.comments.find(c => c.id === comment.parentId);
  return <article className={`original-comment ${context ? 'context-comment' : ''}`}><div className="comment-meta"><strong>{author(comment.author)}</strong>{comment.flair && <span>{comment.flair}</span>}{comment.score !== null && <span>{comment.score} source score</span>}<CommentSource comment={comment} /></div>{parent && !context && <details className="parent-context"><summary>In reply to {author(parent.author)}</summary><div className="source-text">{parent.body}</div><CommentSource comment={parent} /></details>}<SourceBody body={comment.body} />{comment.publishedAt && <span className="comment-date">{date(comment.publishedAt)}</span>}</article>;
}
function VoiceCard(props: SharedProps & { snapshot: ThreadSnapshot; voice: Voice; comment: Comment; number: number }) {
  const { voice, comment, snapshot, number } = props;
  const contextIds = [...new Set([...(comment.parentId ? [comment.parentId] : []), ...voice.contextIds])];
  const contexts = contextIds.map(id => snapshot.comments.find(c => c.id === id)).filter((c): c is Comment => !!c && c.id !== comment.id);
  return <section className={`voice-card voice-${voice.kind}`}><div className="voice-heading"><span className="voice-number">{String(number).padStart(2, '0')}</span><span>{pretty(voice.kind)}</span></div>{contexts.length > 0 && <details className="surrounding-context" open={voice.kind === 'humor' || voice.kind === 'correction'}><summary>{voice.kind === 'humor' ? 'The setup & surrounding context' : 'Surrounding context'} <span>{contexts.length} source {contexts.length === 1 ? 'comment' : 'comments'}</span></summary><div>{contexts.map(context => <OriginalComment comment={context} snapshot={snapshot} context key={context.id} />)}</div></details>}<blockquote className="voice-quote">{quoteText(comment, voice)}</blockquote><div className="voice-attribution"><span>{author(comment.author)}</span>{comment.flair && <span>{comment.flair}</span>}<CommentSource comment={comment} /></div>{voice.commentary && <div className="editor-note"><span>Rekindle’s reading</span><p>{voice.commentary}</p></div>}<details className="voice-why"><summary>Why this voice?</summary><p>{voice.reason}</p></details><ItemActions {...props} candidate={snapshot.post} snapshotId={snapshot.id} commentId={comment.id} /><details className="full-comment"><summary>Read the complete source comment</summary><SourceBody body={comment.body} limit={2500} /><External href={`https://www.google.com/search?q=${encodeURIComponent(comment.body.slice(0, 220))}`} className="small-link">Search for outside sources <Icon name="external" size={13} /></External><p className="small-print">This opens an external search. It does not verify the claim.</p></details></section>;
}

function Saved(props: SharedProps) {
  const { state, navigate, mutate } = props;
  const [search, setSearch] = useState('');
  const [collection, setCollection] = useState('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const collections = [...new Set(state.saved.map(item => item.collection || 'Unfiled'))].sort();
  const items = [...state.saved].reverse().filter(item => {
    const post = state.candidates[item.candidateId];
    const snapshot = item.snapshotId ? state.snapshots[item.snapshotId] : Object.values(state.snapshots).find(s => s.post.id === item.candidateId);
    const comment = snapshot?.comments.find(c => c.id === item.commentId);
    return (collection === 'all' || (item.collection || 'Unfiled') === collection) && `${post?.title || ''} ${post?.body || ''} ${post?.subreddit || ''} ${comment?.body || ''} ${item.collection} ${snapshot?.comments.map(c => c.body).join(' ') || ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  });
  return <div className="page-width saved-page"><p className="eyebrow">The things that stayed with you</p><div className="page-title-row"><h1>Your curiosity cabinet<span>.</span></h1><span className="large-count">{state.saved.length}<small>{state.saved.length === 1 ? 'keepsake' : 'keepsakes'}</small></span></div><p className="page-lede">Good discoveries deserve somewhere to live.<br />Keep a whole discussion or a particular human voice.</p><div className="library-controls"><label className="search-input"><Icon name="search" /><span className="sr-only">Search saved titles, source text and quotes</span><input type="search" placeholder="Search titles, source text, and voices…" value={search} onChange={e => setSearch(e.target.value)} /></label><label><span className="sr-only">Filter by collection</span><select value={collection} onChange={e => setCollection(e.target.value)}><option value="all">All collections</option>{collections.map(c => <option key={c}>{c}</option>)}</select></label></div>{items.length ? <div className="saved-list">{items.map(item => {
    const candidate = state.candidates[item.candidateId];
    const snapshot = item.snapshotId ? state.snapshots[item.snapshotId] : Object.values(state.snapshots).find(s => s.post.id === item.candidateId);
    const comment = snapshot?.comments.find(c => c.id === item.commentId);
    return <article className="saved-card" key={item.id}><div className="saved-type"><Icon name={item.commentId ? 'spark' : 'book'} size={23} /><span>{item.commentId ? 'A voice' : 'A discovery'}</span></div><div className="saved-content"><p className="card-meta">{candidate ? `r/${candidate.subreddit}` : 'Source no longer retained'} <span>·</span> Saved {date(item.savedAt)}{(snapshot?.coverage.obtainedAt || candidate?.capturedAt) && <><span>·</span> Captured {date(snapshot?.coverage.obtainedAt || candidate?.capturedAt)}</>}</p><h2>{snapshot ? <button onClick={() => navigate('read', snapshot.id)}>{candidate?.title || snapshot.post.title}</button> : <External href={candidate?.permalink}>{candidate?.title || 'Source unavailable'}</External>}</h2>{comment && <blockquote>“{comment.body.slice(0, 350)}{comment.body.length > 350 ? '…' : ''}”<cite>{author(comment.author)}</cite></blockquote>}<div className="saved-bottom"><span className="collection-tag">{item.collection || 'Unfiled'}</span><button className="text-button" onClick={() => { setEditing(item.id); setName(item.collection || ''); }}>Move to collection</button>{snapshot && <button className="text-button" onClick={() => navigate('read', snapshot.id)}>Read <Icon name="arrow" size={14} /></button>}<button className="text-button" onClick={() => void mutate('/api/save', { candidateId: item.candidateId, snapshotId: item.snapshotId, commentId: item.commentId, collection: item.collection }, 'Removed from Saved.').catch(() => {})}>Remove</button></div>{editing === item.id && <form className="collection-form" onSubmit={async e => { e.preventDefault(); try { await mutate('/api/collection', { savedId: item.id, collection: name.trim() || 'Unfiled' }, 'Collection updated.'); setEditing(null); } catch {} }}><label><span className="sr-only">Collection name</span><input list="collection-names" value={name} onChange={e => setName(e.target.value)} placeholder="A collection name" maxLength={80} /></label><button className="small" type="submit">Move</button><button className="small quiet" type="button" onClick={() => setEditing(null)}>Cancel</button></form>}</div></article>;
  })}</div> : <div className="quiet-empty"><Icon name="save" size={33} /><h2>{state.saved.length ? 'Nothing in this corner yet.' : 'Keep a little of the magic.'}</h2><p>{state.saved.length ? 'Try another search or collection.' : 'Use Save on a discovery or Save voice beside a quotation. Everything stays together here.'}</p><button className="text-button" onClick={() => navigate('discover')}>Go exploring <Icon name="arrow" size={16} /></button></div>}<datalist id="collection-names">{collections.map(c => <option key={c} value={c} />)}</datalist></div>;
}

function Slider({ label, description, low, high, value, set }: { label: string; description: string; low: string; high: string; value: number; set: (n: number) => void }) {
  return <label className="taste-slider"><div><strong>{label}</strong><output>{Math.round(value * 100)}%</output></div><p>{description}</p><input type="range" min={0} max={100} value={Math.round(value * 100)} onChange={e => set(Number(e.target.value) / 100)} /><div className="range-labels"><span>{low}</span><span>{high}</span></div></label>;
}
function NumberField({ label, value, min, max, set }: { label: string; value: number; min: number; max: number; set: (value: number) => void }) {
  return <label className="number-field">{label}<input type="number" min={min} max={max} required value={value} onChange={e => set(Number(e.target.value))} /></label>;
}
function Tune(props: SharedProps) {
  const { state, runtime, mutate, tell } = props;
  const [settings, setSettings] = useState<Settings>(() => clone(state.settings));
  const draftBaseline = useRef(clone(state.settings));
  const [boostedDraft, setBoostedDraft] = useState(state.settings.boostedTerms.join(', '));
  const [mutedDraft, setMutedDraft] = useState(state.settings.mutedTerms.join(', '));
  const [natural, setNatural] = useState('');
  const [preview, setPreview] = useState<{ settings: Settings; changes: unknown } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(settings) !== JSON.stringify(draftBaseline.current);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(current => ({ ...current, [key]: value }));
  const setAi = <K extends keyof Settings['ai']>(key: K, value: Settings['ai'][K]) => setSettings(current => ({ ...current, ai: { ...current.ai, [key]: value } }));
  const replaceDraft = (next: Settings) => { draftBaseline.current = clone(next); setSettings(clone(next)); setBoostedDraft(next.boostedTerms.join(', ')); setMutedDraft(next.mutedTerms.join(', ')); };
  const saveSettings = async (next = settings) => {
    setBusy(true);
    try { const result = await mutate('/api/settings', { settings: next, baseSettings: draftBaseline.current }, 'Your taste settings are saved. They will shape the next selection.'); replaceDraft(result.settings || next); return true; }
    catch { return false; } finally { setBusy(false); }
  };
  const clusters = [...new Set(state.sources.map(source => source.cluster))].sort();
  return <div className="page-width tune-page"><p className="eyebrow">Your taste, with room to grow</p><h1>Follow your curiosity<span>.</span></h1><p className="page-lede">A few meaningful dials. A map you can change.<br />These are starting hypotheses, and you get the last word.</p>
    <div className="tune-layout"><div className="tune-main"><form onSubmit={e => { e.preventDefault(); void saveSettings(); }}><section className="tune-section"><SectionLabel>Make it feel like you</SectionLabel><div className="sliders-grid"><Slider label="Leave room for a detour" description="Give adjacent interests and wildcards more of the batch." low="Familiar territory" high="Further afield" value={settings.exploration} set={n => set('exploration', n)} /><Slider label="Set the reading mood" description="Balance lighter, visual pleasures with substantial discussions." low="Light & visual" high="Go a little deeper" value={settings.depth} set={n => set('depth', n)} /><Slider label="Let good things age" description="Allow dated, still-worthwhile material into the selection." low="Keep it current" high="More from the archive" value={settings.archival} set={n => set('archival', n)} /><Slider label="Choose your temperature" description="Set your appetite for contentious current affairs." low="A quieter corner" high="Room for the fray" value={settings.contention} set={n => set('contention', n)} /></div><div className="settings-save"><button type="submit" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save my taste'}</button><span>{dirty ? 'Unsaved changes' : 'Your current settings are saved.'}</span>{dirty && <button type="button" className="text-button" onClick={() => replaceDraft(state.settings)}>Discard changes</button>}</div></section>
      <section className="tune-section"><details className="advanced-section"><summary><span><Icon name="sliders" /> The finer details</span><span>Topics, selection limits & prompts</span></summary><div className="advanced-body"><h3>Topic emphasis</h3><p className="field-help">Weights are editable selection inputs. They are not assumptions about your beliefs or identity.</p><div className="topic-weights">{clusters.map(cluster => <TopicWeightInput key={cluster} label={pretty(cluster)} value={settings.topicWeights[cluster] ?? 1} onChange={value => set('topicWeights', { ...settings.topicWeights, [cluster]: value })} />)}</div><h3>Keep the batch varied and bounded</h3><div className="numeric-grid"><NumberField label="Target batch size" value={settings.batchSize} min={5} max={30} set={n => set('batchSize', n)} /><NumberField label="Sources per fresh run" value={settings.sourceBudget} min={1} max={16} set={n => set('sourceBudget', n)} /><NumberField label="Posts per source" value={settings.postsPerSource} min={3} max={25} set={n => set('postsPerSource', n)} /><NumberField label="Maximum per community" value={settings.communityCap} min={1} max={10} set={n => set('communityCap', n)} /><NumberField label="Maximum per topic cluster" value={settings.clusterCap} min={1} max={20} set={n => set('clusterCap', n)} /></div><label className="stack-label">Encourage these terms<input value={boostedDraft} onChange={e => { setBoostedDraft(e.target.value); set('boostedTerms', e.target.value.split(',').map(s => s.trim()).filter(Boolean)); }} placeholder="obscure expertise, history" /><span className="field-help">Comma-separated words or phrases.</span></label><label className="stack-label">Downweight these terms<input value={mutedDraft} onChange={e => { setMutedDraft(e.target.value); set('mutedTerms', e.target.value.split(',').map(s => s.trim()).filter(Boolean)); }} placeholder="Terms you’d like to see less often" /></label><label className="stack-label">Comment mode instructions<textarea rows={14} value={settings.commentPrompt} onChange={e => set('commentPrompt', e.target.value)} /><span className="field-help">Your editorial instructions. Source excerpts still must pass the code’s integrity checks.</span></label><label className="stack-label">Discovery curator instructions<textarea rows={7} value={settings.curatorPrompt} onChange={e => set('curatorPrompt', e.target.value)} /><span className="field-help">The deterministic selection policy and visible controls govern ranking. This prompt is retained as editorial context.</span></label><button type="submit" disabled={busy || !dirty}>Save advanced settings</button></div></details></section>
      <section className="tune-section"><details className="advanced-section"><summary><span><Icon name="spark" /> Comment mode & inference</span><span>{runtime.inferenceConfigured ? 'Provider configured' : 'No provider key configured'}</span></summary><div className="advanced-body"><p>Source reading, fresh collection, and your library work without inference. AI Comment mode sends a bounded portion of the selected discussion and your editorial instructions to the provider you choose.</p><p className="field-help">Your build-time ChatGPT plan does not supply runtime API credentials. Provider charges can apply. Rekindle does not estimate a cost when usage or pricing is unknown.</p><label className="checkbox-label"><input type="checkbox" checked={settings.ai.enabled} onChange={e => setAi('enabled', e.target.checked)} /><span>Enable AI curation for discussions I open</span></label><div className="provider-grid"><label className="stack-label">Provider<select value={settings.ai.provider} onChange={e => setAi('provider', e.target.value as Settings['ai']['provider'])}><option value="openai">OpenAI</option><option value="compatible">OpenAI-compatible endpoint</option></select></label><label className="stack-label">Runtime model ID<input value={settings.ai.model} onChange={e => setAi('model', e.target.value)} placeholder="A model available to your provider account" required={settings.ai.enabled} /></label></div>{settings.ai.provider === 'compatible' && <label className="stack-label">Provider base URL<input type="url" value={settings.ai.baseUrl} onChange={e => setAi('baseUrl', e.target.value)} /><span className="field-help">Only use an endpoint you trust with source text. Private network endpoints may be rejected by the local service.</span></label>}<div className="numeric-grid"><NumberField label="Maximum calls per run" value={settings.ai.maxCallsPerRun} min={0} max={5} set={n => setAi('maxCallsPerRun', n)} /><NumberField label="Input character limit" value={settings.ai.maxInputCharacters} min={1000} max={100000} set={n => setAi('maxInputCharacters', n)} /><NumberField label="Output token limit" value={settings.ai.maxOutputTokens} min={500} max={12000} set={n => setAi('maxOutputTokens', n)} /></div><button type="submit" disabled={busy || !dirty}>Save inference settings</button></div></details></section>
      <section className="tune-section appearance-section"><label className="stack-label">Reading light<select value={settings.theme} onChange={e => set('theme', e.target.value as Settings['theme'])}><option value="system">Follow the system</option><option value="light">Warm daylight</option><option value="dark">After hours</option></select></label><button type="submit" className="quiet" disabled={!dirty || busy}>Save appearance</button></section>
    </form>
    <section className="tune-section natural-tune"><p className="eyebrow">Put it in your own words</p><h2>A little more this. A little less that.</h2><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { const result = await api<{ settings: Settings; changes: unknown }>('/api/tune', { text: natural }); setPreview(result); } catch (error) { tell((error as Error).message, true); } finally { setBusy(false); } }}><label className="sr-only" htmlFor="natural-tune">Describe how to tune your feed</label><textarea id="natural-tune" rows={3} value={natural} onChange={e => setNatural(e.target.value)} placeholder="More obscure expertise and history, less AI culture-war stuff, but keep actual AI breakthroughs." maxLength={1500} /><button className="quiet" disabled={!natural.trim() || busy}>Preview changes <Icon name="arrow" size={15} /></button></form>{preview && <div className="tune-preview"><h3>Here’s the proposed adjustment.</h3>{Array.isArray(preview.changes) ? <ul>{preview.changes.map((change, i) => <li key={i}>{typeof change === 'string' ? change : JSON.stringify(change)}</li>)}</ul> : <p>{typeof preview.changes === 'string' ? preview.changes : JSON.stringify(preview.changes)}</p>}<p className="field-help">This has not changed your feed. Apply it, then refine any control above.</p><div className="button-row"><button disabled={busy} onClick={async () => { if (await saveSettings(preview.settings)) setPreview(null); }}>Apply these settings</button><button className="quiet" onClick={() => setPreview(null)}>Dismiss</button></div></div>}</section>
    <SourceMap {...props} />
    <Secrets {...props} />
    <DataControls {...props} />
    </div><aside className="tune-note"><div><span className="small-flame">✦</span><h2>A broader world.<br />Still your world.</h2><p>Your selected communities are hints, not permanent endorsements. A saved post does not become a personality test.</p><p>Explicit feedback matters more than passive reading. “Not today” is temporary. Exploration always has a place.</p><p className="note-signoff">Curiosity is allowed<br /><em>to change its mind.</em></p></div></aside></div>
  </div>;
}
function SourceMap({ state, mutate, tell, refresh }: SharedProps) {
  const [sources, setSources] = useState(() => clone(state.sources));
  const [search, setSearch] = useState('');
  const [cluster, setCluster] = useState('all');
  const [limit, setLimit] = useState(25);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCluster, setNewCluster] = useState('');
  const editable = (rows: Source[]) => rows.map(({ name, cluster, enabled, lane, title, description, provenance }) => ({ name, cluster, enabled, lane, title, description, provenance }));
  const dirty = JSON.stringify(editable(sources)) !== JSON.stringify(editable(state.sources));
  const [rosterImport, setRosterImport] = useState<{ name: string; data: any } | null>(null);
  const clusters = [...new Set(sources.map(source => source.cluster))].sort();
  const filtered = sources.filter(source => (cluster === 'all' || source.cluster === cluster) && `${source.name} ${source.title} ${source.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const change = (name: string, patch: Partial<Source>) => setSources(rows => rows.map(row => row.name === name ? { ...row, ...patch } : row));
  const mergeRoster = async () => {
    if (!rosterImport || dirty) return;
    setBusy(true);
    try {
      const result = await mutate('/api/sources/import', { data: rosterImport.data });
      const next = await refresh();
      setSources(clone(next.state.sources)); setRosterImport(null);
      tell(`Roster merged. ${result.report.subreddits} community entries and ${result.report.profiles} profile entries checked. Existing source settings were preserved.`);
    } catch {} finally { setBusy(false); }
  };
  return <section className="tune-section source-map"><details className="advanced-section"><summary><span><Icon name="book" /> Your source map</span><span>{sources.length} communities · {state.profiles.length} profiles kept separately</span></summary><div className="advanced-body"><p>Your added and imported communities are listed here. Supplied descriptions are not verified claims of current quality or activity. Community names are preserved exactly.</p><div className="source-filters"><label className="search-input"><Icon name="search" /><span className="sr-only">Search communities</span><input type="search" placeholder="Find a community or interest…" value={search} onChange={e => { setSearch(e.target.value); setLimit(25); }} /></label><label><span className="sr-only">Filter communities by topic</span><select value={cluster} onChange={e => { setCluster(e.target.value); setLimit(25); }}><option value="all">All topics</option>{clusters.map(c => <option key={c} value={c}>{pretty(c)}</option>)}</select></label></div><p className="field-help">{filtered.length} matching sources · {sources.filter(s => s.enabled).length} enabled. Access and observed activity are tracked separately.</p><div className="source-rows">{filtered.slice(0, limit).map(source => <div className="source-row" key={source.name}><label className="source-checkbox"><input type="checkbox" checked={source.enabled} onChange={e => change(source.name, { enabled: e.target.checked })} /><span className="sr-only">Include r/{source.name} in collection</span></label><div className="source-info"><External href={`https://www.reddit.com/r/${encodeURIComponent(source.name)}/`}><strong>r/{source.name}</strong></External><div className="source-status"><span>{source.access === 'unchecked' ? 'Access unchecked' : source.access === 'accessible' ? 'Access observed' : 'Access unavailable'}</span><span>{source.activity === 'observed' ? 'Posting observed' : 'Activity unknown'}</span></div><details><summary>Source description & provenance</summary><p>{source.description || 'No description was supplied.'}</p><p className="small-print">{source.provenance}</p>{source.lastAttempt && <p className="small-print">Last attempted {date(source.lastAttempt)}{source.lastSuccess ? `; last accessible ${date(source.lastSuccess)}` : ''}.</p>}{source.lastError && <p className="small-print">{source.lastError}</p>}</details></div><div className="source-selects"><label><span className="sr-only">Topic for r/{source.name}</span><select value={source.cluster} onChange={e => change(source.name, { cluster: e.target.value })}>{clusters.map(c => <option key={c} value={c}>{pretty(c)}</option>)}</select></label><label><span className="sr-only">Discovery lane for r/{source.name}</span><select value={source.lane} onChange={e => change(source.name, { lane: e.target.value as Source['lane'] })}><option value="familiar">Familiar</option><option value="adjacent">Adjacent</option><option value="wildcard">Wildcard</option></select></label></div></div>)}</div>{filtered.length > limit && <button className="quiet small" onClick={() => setLimit(n => n + 50)}>Show more sources ({filtered.length - limit} remaining)</button>}<div className="settings-save"><button disabled={!dirty || busy} onClick={async () => { setBusy(true); try { await mutate('/api/sources', { sources: sources.map(source => { const current = state.sources.find(s => s.name === source.name); return current ? { ...current, enabled: source.enabled, lane: source.lane, cluster: source.cluster } : source; }) }, 'Your source map is saved. Reddit subscriptions are unchanged.'); } catch {} finally { setBusy(false); } }}>{busy ? 'Saving…' : 'Save source map'}</button>{dirty && <button className="text-button" onClick={() => setSources(clone(state.sources))}>Discard changes</button>}</div><details className="add-source"><summary>Add a community to your map</summary><form onSubmit={e => { e.preventDefault(); const name = newName.trim().replace(/^r\//i, ''); if (!/^[A-Za-z0-9_]{2,30}$/.test(name)) { tell('Use a valid community name, with letters, numbers, and underscores.', true); return; } if (sources.some(s => s.name.toLowerCase() === name.toLowerCase())) { tell('That community is already in your source map.', true); return; } setSources(rows => [...rows, { name, title: name, description: '', cluster: newCluster || clusters[0] || 'other', enabled: true, lane: 'adjacent', provenance: 'Explicitly added in Rekindle by the user.', access: 'unchecked', activity: 'unknown' }]); setNewName(''); tell('Community added to the draft. Save your source map to apply it.'); }}><label className="stack-label">Community name<input value={newName} onChange={e => setNewName(e.target.value)} placeholder="r/community" required /></label><label className="stack-label">Topic<select value={newCluster || clusters[0]} onChange={e => setNewCluster(e.target.value)}>{clusters.map(c => <option key={c} value={c}>{pretty(c)}</option>)}</select></label><button className="quiet small" type="submit">Add to draft</button><p className="field-help">Adding a source does not subscribe, join, or change anything on Reddit.</p></form></details><details className="roster-import"><summary>Merge another subscription roster</summary><p className="field-help">Import a normalized Rekindle seed JSON with explicit subreddits and followed_profiles arrays. Matching names are deduplicated case-insensitively. Existing preferences are retained; description links are never treated as subscriptions.</p><label className="stack-label">Choose a normalized roster<input type="file" accept=".json,application/json" disabled={dirty || busy} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { if (file.size > 5_000_000) throw new Error('Choose a roster smaller than 5 MB.'); const data = JSON.parse(await file.text()); if (!Array.isArray(data.subreddits)) throw new Error('This file needs an explicit subreddits roster.'); setRosterImport({ name: file.name, data }); } catch (error) { tell((error as Error).message, true); } }} /></label>{dirty && <p className="field-help">Save or discard the source edits above before merging a roster.</p>}{rosterImport && <div className="restore-preview"><h3>{rosterImport.name}</h3><p>{rosterImport.data.subreddits.length} listed community entries will be validated and merged. New sources use editable initial classifications.</p><div className="button-row"><button disabled={busy || dirty} onClick={() => void mergeRoster()}>Merge source roster</button><button className="quiet" onClick={() => setRosterImport(null)}>Cancel</button></div></div>}</details><details className="profiles-details"><summary>{state.profiles.length} followed user profiles, kept separately</summary><p className="field-help">Profiles are preserved as imported roster entries. They are not queried as subreddits, and no Reddit identities are linked.</p>{state.profiles.map(profile => <p key={profile.name}><strong>{profile.name}</strong><br /><span className="small-print">{profile.provenance}</span></p>)}</details></div></details></section>;
}
function Secrets({ runtime, mutate, tell }: SharedProps) {
  const [openaiKey, setKey] = useState('');
  const [redditToken, setReddit] = useState('');
  const [pairing, setPairing] = useState('');
  const [busy, setBusy] = useState(false);
  return <section className="tune-section"><details className="advanced-section"><summary><span><Icon name="plus" /> Connections & private credentials</span><span>Firefox, inference & authorized access</span></summary><div className="advanced-body"><h3>Your Firefox reader</h3><p>Pair the extension once with this local portal. Create a token, then paste it into the extension’s options page. Treat this token as private.</p><button className="quiet" disabled={busy} onClick={async () => { setBusy(true); try { const data = await mutate('/api/pair', {}); setPairing(data.token); } catch {} finally { setBusy(false); } }}>{pairing ? 'Create a replacement pairing token' : 'Create extension pairing token'}</button>{pairing && <div className="pairing-token"><label className="stack-label">Pairing token<input value={pairing} readOnly type="password" autoComplete="off" aria-label="Private extension pairing token" /></label><button className="quiet small" onClick={async () => { try { await navigator.clipboard.writeText(pairing); tell('Pairing token copied. Paste it in Firefox extension options.'); } catch { tell('Clipboard access was denied. Select and copy the token field.', true); } }}>Copy token</button><button className="text-button" onClick={() => setPairing('')}>Hide token</button></div>}<h3>Provider credentials</h3><p className="field-help">Credentials are handled by the local service and excluded from exports. They are never sent to Reddit pages or stored in the frontend bundle. See the operating guide for the local storage protection boundary.</p><p className="connection-status">Inference key: <strong>{runtime.inferenceConfigured ? 'Configured' : 'Not configured'}</strong> <span>·</span> Authorized Reddit token: <strong>{runtime.redditConfigured ? 'Configured' : 'Not configured'}</strong></p><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await mutate('/api/secrets', { ...(openaiKey.trim() ? { openaiKey: openaiKey.trim() } : {}), ...(redditToken.trim() ? { redditToken: redditToken.trim() } : {}) }, 'Credentials updated in the local service.'); setKey(''); setReddit(''); } catch {} finally { setBusy(false); } }}><label className="stack-label">Inference API key<input type="password" value={openaiKey} onChange={e => setKey(e.target.value)} autoComplete="new-password" placeholder="Enter a new key to configure or replace it" /></label><label className="stack-label">Authorized Reddit access token, if available<input type="password" value={redditToken} onChange={e => setReddit(e.target.value)} autoComplete="new-password" placeholder="Optional existing authorized access token" /><span className="field-help">Direct access may still be unavailable. Rekindle does not bypass challenges or request your Reddit password.</span></label><button disabled={busy || (!openaiKey.trim() && !redditToken.trim())}>{busy ? 'Saving…' : 'Save credentials locally'}</button></form><details className="danger-disclosure"><summary>Remove stored credentials</summary><p>Saved provider, Reddit, and extension pairing credentials will be removed. Environment-provided credentials may remain configured. Saved sources and settings remain.</p><button className="quiet danger" disabled={busy} onClick={() => void mutate('/api/secrets', undefined, 'Stored credentials removed.', 'DELETE').catch(() => {})}>Remove credentials</button></details></div></details></section>;
}
function DataControls({ state, runtime, mutate, tell, navigate }: SharedProps) {
  const [confirmation, setConfirmation] = useState('');
  const [target, setTarget] = useState<'library' | 'all'>('library');
  const [restore, setRestore] = useState<{ data: AppState; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return <section className="tune-section data-controls"><details className="advanced-section"><summary><span><Icon name="save" /> Your data stays yours</span><span>Export, restore, retention & reset</span></summary><div className="advanced-body"><p>Your source map, feedback, reading positions, and library are stored by this local installation. Keep an export somewhere safe before upgrades or a device change.</p><p className="field-help">{runtime.retention}</p><div className="data-stats"><span>{state.saved.length} saves</span><span>{Object.keys(state.snapshots).length} source snapshots</span><span>{state.feedback.length} feedback records</span></div><button className="quiet" disabled={busy} onClick={async () => { setBusy(true); try { const data = await api('/api/export'); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const href = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = href; link.download = `rekindle-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(href), 30000); tell('Local export prepared. Credentials are excluded.'); } catch (error) { tell((error as Error).message, true); } finally { setBusy(false); } }}>Export my Rekindle data</button><label className="stack-label restore-label">Restore a Rekindle export<input type="file" accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { if (file.size > 24_000_000) throw new Error('Choose an export smaller than 24 MB.'); const parsed = JSON.parse(await file.text()); const data = parsed.state || parsed; if (typeof data.schemaVersion !== 'number' || !Array.isArray(data.sources) || !data.settings) throw new Error('This does not look like a Rekindle data export.'); setRestore({ data, name: file.name }); } catch (error) { tell((error as Error).message, true); } }} /></label>{restore && <div className="restore-preview"><h3>Ready to restore {restore.name}</h3><p>{restore.data.sources.length} sources, {restore.data.saved?.length || 0} saved items. Restoring replaces this installation’s current state. Export it first if you need a rollback.</p><div className="button-row"><button disabled={busy} onClick={async () => { setBusy(true); try { await mutate('/api/restore', { data: restore.data }, 'Your export has been restored.'); setRestore(null); navigate('discover'); } catch {} finally { setBusy(false); } }}>Replace local state with this export</button><button className="quiet" onClick={() => setRestore(null)}>Cancel</button></div></div>}<details className="maintenance-details"><summary>Clear collected cache</summary><p>Clear reusable collection cache. Saved material and your original source map are retained by the local service.</p><button className="quiet small" disabled={busy} onClick={() => void mutate('/api/cache/clear', {}, 'Collection cache cleared.').catch(() => {})}>Clear cache</button></details><details className="maintenance-details"><summary>Reset learned preferences</summary><p>Remove feedback-derived preferences while keeping saved material and the subscription map.</p><button className="quiet small" disabled={busy} onClick={() => void mutate('/api/learning/reset', {}, 'Learned preferences reset. Your source map and saved material remain.').catch(() => {})}>Reset learning</button></details><details className="danger-disclosure"><summary>Delete local data</summary><p>This is permanent for this installation. Deleting all personal data removes the stored library, source map, followed profiles, and preferences. Make an export first if you want a backup. Exported files and manually imported source files remain on disk and must be managed separately.</p><label className="stack-label">What to delete<select value={target} onChange={e => setTarget(e.target.value as 'library' | 'all')}><option value="library">Library and reading data</option><option value="all">All personal data and preferences</option></select></label><label className="stack-label">Type DELETE to confirm<input value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" placeholder="DELETE" /></label><button className="danger" disabled={confirmation !== 'DELETE' || busy} onClick={async () => { setBusy(true); try { await mutate('/api/delete', { target, confirmation }, 'Selected local data deleted.'); setConfirmation(''); navigate('discover'); } catch {} finally { setBusy(false); } }}>Delete {target === 'library' ? 'library data' : 'all personal data'}</button></details></div></details></section>;
}

createRoot(document.getElementById('root')!).render(<App />);












