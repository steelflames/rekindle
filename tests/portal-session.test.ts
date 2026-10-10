import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionTransport } from '../web/session.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
const ok = () => new Response('{"ok":true}', { status: 200 });
const expired = () => new Response('{"error":"expired"}', { status: 401 });

test('concurrent portal 401s share one recovery and preserve the original mutation', async () => {
  let sessions = 0, requests = 0, recovered = false;
  const started = deferred<void>(), session = deferred<Response>();
  const options: RequestInit = { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Rekindle-Request': '1' }, body: '{"probe":true}' };
  const request = createSessionTransport(async (path, received) => {
    if (path === '/api/session') {
      sessions += 1;
      assert.equal(received?.method, 'POST');
      assert.equal(received?.credentials, 'same-origin');
      assert.equal(new Headers(received?.headers).get('X-Rekindle-Request'), '1');
      started.resolve();
      const response = await session.promise;
      recovered = true;
      return response;
    }
    requests += 1;
    assert.strictEqual(received, options);
    return recovered ? ok() : expired();
  }, true);
  const results = Promise.all([request('/api/settings', options), request('/api/settings', options)]);
  await started.promise;
  session.resolve(ok());
  assert.equal((await results).every(response => response.ok), true);
  assert.equal(sessions, 1);
  assert.equal(requests, 4);
});

test('a delayed 401 from the previous cookie reuses the recovered generation', async () => {
  let sessions = 0, requests = 0;
  const stale = deferred<Response>();
  const request = createSessionTransport(async path => {
    if (path === '/api/session') { sessions += 1; return ok(); }
    requests += 1;
    if (requests === 1) return expired();
    if (requests === 2) return stale.promise;
    return ok();
  }, true);
  const first = request('/api/jobs'), second = request('/api/state');
  assert.equal((await first).ok, true);
  stale.resolve(expired());
  assert.equal((await second).ok, true);
  assert.equal(sessions, 1);
  assert.equal(requests, 4);
});

test('a failed retry remains a 401 and cannot loop', async () => {
  let sessions = 0, requests = 0;
  const request = createSessionTransport(async path => {
    if (path === '/api/session') { sessions += 1; return ok(); }
    requests += 1;
    return expired();
  }, true);
  assert.equal((await request('/api/jobs')).status, 401);
  assert.equal(sessions, 1);
  assert.equal(requests, 2);
});

test('embedded reader 401s never create or escalate a portal session', async () => {
  const paths: string[] = [];
  const request = createSessionTransport(async path => { paths.push(path); return expired(); }, false);
  assert.equal((await request('/api/state')).status, 401);
  assert.deepEqual(paths, ['/api/state']);
});

test('concurrent callers share a failed recovery and retain its truthful error', async () => {
  let sessions = 0;
  const started = deferred<void>(), session = deferred<Response>();
  const request = createSessionTransport(async path => {
    if (path === '/api/session') { sessions += 1; started.resolve(); return session.promise; }
    return expired();
  }, true);
  const results = Promise.allSettled([request('/api/jobs'), request('/api/state')]);
  await started.promise;
  session.resolve(new Response('{}', { status: 503 }));
  for (const result of await results) {
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') assert.match(result.reason.message, /local session could not reconnect/);
  }
  assert.equal(sessions, 1);
});
