import { threadLocation } from './extract';

const SERVICE = 'http://127.0.0.1:47831';
const inFlight = new Set<number>();
const localProtection = browser.storage.local.setAccessLevel?.('TRUSTED_CONTEXTS').catch(() => {});
const isOwnPage = (sender: RekindleSender, path: string) => sender.id === browser.runtime.id && sender.url?.split('?')[0].split('#')[0] === browser.runtime.getURL(path);
const isContent = (sender: RekindleSender) => sender.id === browser.runtime.id && sender.frameId === 0 && typeof sender.tab?.id === 'number' && !!threadLocation(sender.url || '');
const keyFor = (tabId: number) => `reader:${tabId}`;

async function service(path: string, init: RequestInit = {}, token?: string, readerRequest = false) {
  const response = await fetch(SERVICE + path, {...init, signal: AbortSignal.timeout(20_000), credentials: 'omit', redirect: 'error', headers: {'Content-Type': 'application/json', 'X-Rekindle-Request': '1', ...(token ? {Authorization: `Bearer ${token}`} : {}), ...init.headers}});
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error(readerRequest ? 'This reading connection expired or was not accepted. Return to the original thread and choose Rekindle again.' : 'Pair Rekindle again in the extension settings. The local service did not accept this connection.');
    throw new Error(`The local service returned ${response.status}. Your original thread is unchanged.`);
  }
  return response.json();
}

browser.runtime.onMessage.addListener(async (message, sender) => {
  if (!message || typeof message.type !== 'string') return;
  try {
    if (isOwnPage(sender, 'options.html')) {
      await localProtection;
      if (message.type === 'pair') {
        const token = String(message.token || '').trim();
        if (!/^[a-zA-Z0-9_=-]{32,512}$/.test(token)) throw new Error('Paste the complete pairing token from the portal Tune panel.');
        await service('/api/extension/status', {}, token);
        await browser.storage.local.set({pairingToken: token});
        return {ok: true};
      }
      if (message.type === 'unpair') { await browser.storage.local.remove('pairingToken'); return {ok: true}; }
      if (message.type === 'status') {
        await service('/api/health');
        const {pairingToken} = await browser.storage.local.get('pairingToken');
        if (pairingToken) await service('/api/extension/status', {}, pairingToken);
        return {ok: true, paired: !!pairingToken};
      }
    }
    const wrapper = isOwnPage(sender, 'reader.html');
    const reader = isOwnPage(sender, 'portal.html');
    if ((wrapper || reader) && typeof sender.tab?.id === 'number') {
      const tabId = sender.tab.id;
      const key = keyFor(tabId);
      const stored = await browser.storage.session.get(key);
      const grant = stored[key];
      const snapshotId = typeof message.snapshotId === 'string' ? message.snapshotId : '';
      // Returning to the original page must remain possible after a session expires.
      if (wrapper && message.type === 'reader-close') { await browser.tabs.sendMessage(tabId, {type: 'rekindle:close'}); return {ok: true}; }
      if (!grant || grant.snapshotId !== snapshotId || grant.expiresAt < Date.now()) throw new Error('This reading connection expired. Return to the thread and choose Rekindle again.');
      if (wrapper && message.type === 'reader-ready') {
        if (grant.opened) throw new Error('This reading connection was already opened. Capture the thread again to reconnect.');
        await browser.storage.session.set({[key]: {...grant, opened: true}});
        return {ok: true, url: `${browser.runtime.getURL('portal.html')}?embed=1&thread=${encodeURIComponent(snapshotId)}`};
      }
      if (wrapper && message.type === 'reader-loaded' && grant.opened) { await browser.tabs.sendMessage(tabId, {type: 'rekindle:loaded'}); return {ok: true}; }
      if (wrapper && message.type === 'reader-open') { await browser.tabs.create({url: `${SERVICE}/?thread=${encodeURIComponent(snapshotId)}`}); return {ok: true}; }
      if (reader && message.type === 'reader-api') {
        const page = new URL(sender.url!);
        if (!grant.opened || page.searchParams.get('embed') !== '1' || page.searchParams.get('thread') !== snapshotId) throw new Error('This reader does not match the captured thread.');
        const path = message.path;
        const method = message.method;
        const input = message.body;
        const isRead = method === 'GET' && ['/api/state', '/api/jobs'].includes(path);
        const isWrite = method === 'POST' && (['/api/session', '/api/curate', '/api/save', '/api/feedback', '/api/position'].includes(path) || /^\/api\/jobs\/[a-zA-Z0-9_-]{1,100}\/cancel$/.test(path));
        if (!isRead && !isWrite) throw new Error('This action is not available in the thread reader.');
        if (isWrite && (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 100_000)) throw new Error('Invalid reader request.');
        if (path === '/api/curate' && input.snapshotId !== snapshotId || path === '/api/save' && (input.snapshotId !== snapshotId || input.candidateId !== grant.postId) || path === '/api/feedback' && input.candidateId !== grant.postId || path === '/api/position' && input.key !== `thread:${snapshotId}`) throw new Error('This action does not belong to the captured thread.');
        if (path === '/api/session') {
          // Confirm validity without exposing any bearer to the renderer or page.
          await service(path, {method, body: '{}', headers: {'X-Rekindle-Session': grant.token}}, grant.token, true);
          return {ok: true, data: {ok: true}};
        }
        const data = await service(path, {method, ...(isWrite ? {body: JSON.stringify(input)} : {})}, grant.token, true);
        return {ok: true, data};
      }
      return {ok: false, error: 'Unsupported reader action.'};
    }
    if (!isContent(sender)) return {ok: false, error: 'Unsupported request origin.'};
    const tabId = sender.tab!.id!;
    if (message.type === 'options') { await browser.runtime.openOptionsPage(); return {ok: true}; }
    if (message.type === 'capture') {
      if (inFlight.has(tabId)) throw new Error('This thread is already being captured.');
      const location = threadLocation(sender.url!);
      const snapshot = message.snapshot;
      if (!snapshot || snapshot.post?.id !== location?.postId || snapshot.post?.permalink !== location?.url.href || !Array.isArray(snapshot.comments) || snapshot.comments.length > 600 || JSON.stringify(snapshot).length > 3_000_000) throw new Error('The captured thread did not match this tab or exceeded the capture bound.');
      await localProtection;
      const {pairingToken} = await browser.storage.local.get('pairingToken');
      if (!pairingToken) throw new Error('Pair this extension with your local Rekindle portal first. Open extension settings below.');
      inFlight.add(tabId);
      try {
        const result = await service('/api/extension/capture', {method: 'POST', body: JSON.stringify({snapshot})}, pairingToken);
        if (typeof result.snapshotId !== 'string' || typeof result.readerToken !== 'string') throw new Error('The local service returned an incomplete capture.');
        await browser.storage.session.set({[keyFor(tabId)]: {snapshotId: result.snapshotId, postId: snapshot.post.id, token: result.readerToken, opened: false, expiresAt: Date.now() + 24 * 60 * 60_000}});
        // No bearer or reader token is returned to the content script or Reddit DOM.
        return {ok: true, readerUrl: `${browser.runtime.getURL('reader.html')}?thread=${encodeURIComponent(result.snapshotId)}`};
      } finally { inFlight.delete(tabId); }
    }
  } catch (error) {
    return {ok: false, error: error instanceof Error && error.name !== 'TypeError' ? error.message : 'Rekindle cannot reach the local service. Start Rekindle, then try again.'};
  }
});

browser.action.onClicked.addListener(async tab => {
  if (typeof tab.id !== 'number') return;
  if (!threadLocation(tab.url || '')) { await browser.runtime.openOptionsPage(); return; }
  try {
    try { await browser.tabs.sendMessage(tab.id, {type: 'rekindle:activate'}); }
    catch {
      await browser.scripting.executeScript({target: {tabId: tab.id}, files: ['content.js']});
      await browser.tabs.sendMessage(tab.id, {type: 'rekindle:activate'});
    }
    await browser.action.setBadgeText({tabId: tab.id, text: ''});
  } catch {
    await browser.action.setBadgeText({tabId: tab.id, text: '!'});
    await browser.action.setTitle({tabId: tab.id, title: 'Rekindle needs access to this Reddit discussion. Check extension permissions.'});
    await browser.runtime.openOptionsPage();
  }
});
browser.tabs.onRemoved.addListener(tabId => { void browser.storage.session.remove(keyFor(tabId)); });
