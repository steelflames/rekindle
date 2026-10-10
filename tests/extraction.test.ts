import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { extractThread, readableText, threadLocation } from '../extension/extract';

// Synthetic DOM fixtures model selectors used by the adapters. They do not prove
// a live Firefox or current production Reddit layout has been exercised.
const URL = 'https://old.reddit.com/r/specializedtools/comments/abc123/a_useful_tool/';
const NOW = '2026-10-09T12:00:00.000Z';
const OLD = `<!doctype html><html><body>
<div class="thing link" data-fullname="t3_abc123" data-score="12"><div class="entry"><a class="title" href="https://example.com/tool">A useful tool</a><p class="tagline"><a class="author">fixture_op</a><time datetime="2026-10-08T12:00:00Z"></time></p><a class="comments">7 comments</a><span class="linkflairlabel">Mechanism</span></div><div class="expando"><div class="usertext-body"><div class="md"><p>What turns the shaft?</p></div></div></div></div>
<aside><div class="thing comment" data-fullname="t1_side"><div class="entry"><div class="md">Sidebar text is not a comment.</div></div></div></aside>
<div class="commentarea"><div class="thing comment" data-fullname="t1_parent"><div class="entry"><a class="author">fixture_explainer</a><time datetime="2026-10-08T14:00:00Z"></time><span class="score unvoted" title="3">3 points</span><span class="flair">Mechanic</span><a class="bylink" href="/r/specializedtools/comments/abc123/a_useful_tool/parent/">permalink</a><div class="usertext-body"><div class="md"><p>The cam drives the lever.</p><ul><li>Watch the pivot.</li><li>Keep clearance.</li></ul><pre><code>if (shaft) {\n  turn();\n}</code></pre><p>E = mc²</p></div></div></div>
<div class="child"><div class="thing comment" data-fullname="t1_reply"><div class="entry"><a class="author">fixture_correction</a><span class="score unvoted">1 point</span><a class="bylink" href="/r/specializedtools/comments/abc123/a_useful_tool/reply/">permalink</a><div class="usertext-body"><div class="md"><p>Correction: the eccentric, not a cam.</p></div></div></div></div></div></div>
<div class="thing comment promoted" data-fullname="t1_ad"><div class="entry"><div class="md">Buy this product.</div></div></div>
<div class="thing comment" data-fullname="t1_orphan" data-parent-fullname="t1_missing"><div class="entry"><div class="usertext-body"><div class="md">The earlier explanation needs context.</div></div></div></div>
<div class="morecomments">Load more comments</div></div></body></html>`;

const CURRENT = `<!doctype html><html><body><main>
<shreddit-post id="t3_abc123" post-title="A useful tool" author="fixture_op" score="12" comment-count="20" created-timestamp="2026-10-08T12:00:00Z" content-href="https://i.redd.it/fixture.jpg" spoiler>
<h1 slot="title">A useful tool</h1><div slot="text-body"><p>How does this work?</p><script>stealSecrets()</script></div><img src="https://i.redd.it/fixture.jpg" alt="A mechanism, as supplied by the poster"><img src="javascript:alert(1)" alt="ignore"><span slot="post-flair">Question</span></shreddit-post>
<shreddit-comment-tree><shreddit-comment thingid="t1_parent" postid="t3_abc123" parentid="t3_abc123" author="fixture_explainer" score="5" depth="0" created-timestamp="2026-10-08T14:00:00Z" permalink="/r/specializedtools/comments/abc123/a_useful_tool/parent/"><div slot="comment"><p>Here is the mechanism.</p><blockquote><p>The setup matters.</p></blockquote></div>
<shreddit-comment thingid="t1_reply" postid="t3_abc123" parentid="t1_parent" author="fixture_reply" depth="1"><div slot="comment"><p>And here is why that is funny.</p></div></shreddit-comment></shreddit-comment>
<shreddit-comment thingid="t1_other" postid="t3_wrong" author="unrelated"><div slot="comment">Another thread recommendation.</div></shreddit-comment>
<shreddit-comment thingid="t1_badurl" postid="t3_abc123" parentid="t3_abc123" permalink="https://evil.example/r/specializedtools/comments/abc123/a_useful_tool/badurl/"><div slot="comment">This source link is untrusted.</div></shreddit-comment></shreddit-comment-tree>
<aside><shreddit-comment thingid="t1_side" postid="t3_abc123"><div slot="comment">Unrelated sidebar.</div></shreddit-comment></aside></main></body></html>`;

test('old Reddit capture retains branch relationships, metadata, corrections and code', () => {
  const snapshot = extractThread(new JSDOM(OLD).window.document, URL, NOW);
  assert.equal(snapshot.post.id, 't3_abc123');
  assert.equal(snapshot.post.title, 'A useful tool');
  assert.equal(snapshot.post.author, 'fixture_op');
  assert.equal(snapshot.post.flair, 'Mechanism');
  assert.deepEqual(snapshot.comments.map(comment => comment.id), ['t1_parent', 't1_reply', 't1_orphan']);
  assert.equal(snapshot.comments[1].parentId, 't1_parent');
  assert.equal(snapshot.comments[1].depth, 1);
  assert.equal(snapshot.comments[1].score, 1);
  assert.match(snapshot.comments[1].body, /^Correction:/);
  assert.match(snapshot.comments[0].body, /• Watch the pivot\./);
  assert.match(snapshot.comments[0].body, /```\nif \(shaft\) \{\n  turn\(\);\n}\n```/);
  assert.match(snapshot.comments[0].body, /E = mc²/);
  assert.doesNotMatch(snapshot.comments[0].body, /eccentric/);
  assert.equal(snapshot.comments[0].flair, 'Mechanic');
  assert.equal(snapshot.comments[0].permalink, URL + 'parent/');
  assert.equal(snapshot.coverage.siteReported, 7);
  assert.equal(snapshot.coverage.retrieved, 3);
  assert.equal(snapshot.coverage.analyzed, 0);
  assert.ok(snapshot.coverage.limits.some(limit => limit.includes('unavailable parent')));
  assert.equal(snapshot.comments[2].author, null);
  assert.equal(snapshot.comments[2].score, null);
  assert.equal(snapshot.comments[2].permalink, null);
});

test('current Reddit capture excludes sidebar, other posts and executable markup', () => {
  const snapshot = extractThread(new JSDOM(CURRENT).window.document, URL.replace('old.', 'www.'), NOW);
  assert.deepEqual(snapshot.comments.map(comment => comment.id), ['t1_parent', 't1_reply', 't1_badurl']);
  assert.equal(snapshot.comments[1].parentId, 't1_parent');
  assert.equal(snapshot.comments[2].permalink, null);
  assert.equal(snapshot.comments[1].permalink, null);
  assert.equal(snapshot.comments[1].score, null);
  assert.doesNotMatch(snapshot.post.body, /stealSecrets|<script>/);
  assert.doesNotMatch(snapshot.comments[0].body, /funny/);
  assert.match(snapshot.comments[0].body, /> The setup matters\./);
  assert.equal(snapshot.post.media.length, 1);
  assert.equal(snapshot.post.media[0].url, 'https://i.redd.it/fixture.jpg');
  assert.equal(snapshot.post.spoiler, true);
  assert.equal(snapshot.coverage.siteReported, 20);
  assert.match(snapshot.coverage.method, /current Reddit/);
});

test('partial bounded capture states limits without manufacturing completeness', () => {
  const snapshot = extractThread(new JSDOM(OLD).window.document, URL, NOW, 1);
  assert.equal(snapshot.comments.length, 1);
  assert.equal(snapshot.coverage.retrieved, 1);
  assert.equal(snapshot.coverage.analyzed, 0);
  assert.equal(snapshot.coverage.siteReported, 7);
  assert.ok(snapshot.coverage.limits.some(limit => limit.includes('at most 1 comments')));
  assert.ok(snapshot.coverage.limits.some(limit => limit.includes('Collapsed, unloaded')));
  assert.equal('percent' in snapshot.coverage, false);
});

test('unsupported or unsafe thread URLs fail closed', () => {
  for (const url of ['http://reddit.com/r/x/comments/a/title/', 'https://reddit.com.evil.test/r/x/comments/a/title/', 'https://name:secret@reddit.com/r/x/comments/a/title/', 'https://reddit.com:444/r/x/comments/a/title/', 'https://www.reddit.com/message/inbox/', 'file:///r/x/comments/a/title/']) {
    assert.equal(threadLocation(url), null);
    assert.throws(() => extractThread(new JSDOM(OLD).window.document, url, NOW));
  }
  assert.equal(threadLocation(URL + '?sort=new#comment')?.url.href, URL);
});

test('missing post markup does not silently import navigation as the post', () => {
  assert.throws(() => extractThread(new JSDOM('<h1>Trending now</h1><aside>Lots of text</aside>').window.document, URL, NOW), /no supported thread markup/);
});

test('format normalization preserves ordered lists, line breaks and code indentation', () => {
  const document = new JSDOM('<article><p>A<br>B</p><ol start="3"><li>One</li><li>Two</li></ol><pre>  indented\n\n\n  still indented\n```</pre><iframe src="https://evil.example">bad</iframe></article>').window.document;
  const body = readableText(document.querySelector('article'));
  assert.match(body, /A\nB/);
  assert.match(body, /3\. One/); assert.match(body, /4\. Two/);
  assert.match(body, /````\n  indented\n\n\n  still indented\n```\n````/);
  assert.doesNotMatch(body, /evil|iframe|bad/);
});

test('an observed link to a different comment is not attributed to this comment', () => {
  const html = CURRENT.replace('a_useful_tool/parent/', 'a_useful_tool/someoneelse/');
  assert.equal(extractThread(new JSDOM(html).window.document, URL, NOW).comments[0].permalink, null);
});

test('current moderator announcement keeps the source text without UI labels', () => {
  const html = CURRENT.replace('<p>Here is the mechanism.</p><blockquote><p>The setup matters.</p></blockquote>', '<shreddit-mod-comment><div>Moderator Announcement <a href="#">Read More »</a></div><span class="hidden"><div id="t1_parent-post-rtjson-content"><p>The source announcement itself.</p></div></span></shreddit-mod-comment>');
  const snapshot = extractThread(new JSDOM(html).window.document, URL, NOW);
  assert.equal(snapshot.comments[0].body, 'The source announcement itself.');
});

test('background keeps credentials private and limits the shared reader relay to its captured source', async () => {
  const source = await build({entryPoints: ['extension/background.ts'], bundle: true, format: 'iife', platform: 'browser', write: false});
  let listener: (message: any, sender: any) => Promise<any> = async () => undefined;
  const pairToken = 'fixturePairingSecret0123456789abcdef';
  const readerToken = 'fixtureReaderSecret0123456789abcdef';
  const local: Record<string, any> = {pairingToken: pairToken};
  const session: Record<string, any> = {};
  const calls: {url: string; options: RequestInit}[] = [];
  const storage = (data: Record<string, any>) => ({get: async (key: string) => ({[key]: data[key]}), set: async (next: Record<string, any>) => {Object.assign(data, next);}, remove: async (key: string) => {delete data[key];}, setAccessLevel: async () => {}});
  const extensionOrigin = 'moz-extension://fixture-uuid/';
  const browser = {
    runtime: {id: 'fixture@rekindle', getURL: (path: string) => extensionOrigin + path, openOptionsPage: async () => {}, onMessage: {addListener: (handler: typeof listener) => {listener = handler;}}},
    storage: {local: storage(local), session: storage(session)},
    action: {onClicked: {addListener: () => {}}},
    tabs: {onRemoved: {addListener: () => {}}, sendMessage: async () => {}, create: async () => {}}
  };
  runInNewContext(source.outputFiles[0].text, {browser, URL: globalThis.URL, AbortSignal, fetch: async (url: string, options: RequestInit) => {
    calls.push({url, options}); return {ok: true, json: async () => ({snapshotId: 'stored-fixture', readerToken})};
  }});
  const sender = {id: 'fixture@rekindle', frameId: 0, url: URL, tab: {id: 7, url: URL}};
  const snapshot = extractThread(new JSDOM(OLD).window.document, URL, NOW);
  const hostile = await listener({type: 'capture', snapshot}, {...sender, id: 'different-addon'});
  assert.equal(hostile.ok, false); assert.equal(calls.length, 0);
  const nested = await listener({type: 'capture', snapshot}, {...sender, frameId: 1});
  assert.equal(nested.ok, false); assert.equal(calls.length, 0);
  const mismatched = await listener({type: 'capture', snapshot: {...snapshot, post: {...snapshot.post, id: 't3_other'}}}, sender);
  assert.equal(mismatched.ok, false); assert.equal(calls.length, 0);
  const capture = await listener({type: 'capture', snapshot}, sender);
  assert.equal(capture.ok, true);
  assert.equal(capture.readerUrl, extensionOrigin + 'reader.html?thread=stored-fixture');
  assert.equal(JSON.stringify(capture).includes(readerToken), false);
  assert.equal(JSON.stringify(capture).includes(pairToken), false);
  assert.equal(calls[0].url, 'http://127.0.0.1:47831/api/extension/capture');
  assert.equal((calls[0].options.headers as Record<string, string>).Authorization, `Bearer ${pairToken}`);
  const rejectedReady = await listener({type: 'reader-ready', snapshotId: 'stored-fixture'}, sender);
  assert.equal(rejectedReady, undefined);
  const wrapper = {...sender, url: extensionOrigin + 'reader.html?thread=stored-fixture', frameId: 1};
  const wrongTab = await listener({type: 'reader-ready', snapshotId: 'stored-fixture'}, {...wrapper, tab: {id: 8}});
  assert.equal(wrongTab.ok, false);
  const ready = await listener({type: 'reader-ready', snapshotId: 'stored-fixture'}, wrapper);
  assert.equal(ready.ok, true); assert.equal(ready.url, extensionOrigin + 'portal.html?embed=1&thread=stored-fixture');
  assert.equal(JSON.stringify(ready).includes(readerToken), false);
  assert.equal(JSON.stringify(ready).includes(pairToken), false);
  const replay = await listener({type: 'reader-ready', snapshotId: 'stored-fixture'}, wrapper);
  assert.equal(replay.ok, false);
  const renderer = {...wrapper, url: ready.url, frameId: 2};
  const request = {type: 'reader-api', snapshotId: 'stored-fixture', path: '/api/session', method: 'POST', body: {}};
  const handshake = await listener(request, renderer);
  assert.deepEqual(JSON.parse(JSON.stringify(handshake)), {ok: true, data: {ok: true}});
  assert.equal(JSON.stringify(handshake).includes(readerToken), false);
  assert.equal((calls.at(-1)!.options.headers as Record<string, string>).Authorization, `Bearer ${readerToken}`);
  assert.equal((calls.at(-1)!.options.headers as Record<string, string>)['X-Rekindle-Session'], readerToken);
  for (const bad of [
    {...request, path: 'https://evil.example/'},
    {...request, path: '/api/settings'},
    {...request, path: '/api/delete'},
    {...request, path: '/api/state', method: 'DELETE'},
    {...request, path: '/api/jobs/../secrets/cancel'},
    {...request, path: '/api/curate', body: {snapshotId: 'another-source'}},
    {...request, path: '/api/save', body: {snapshotId: 'another-source', candidateId: 't3_abc123'}},
    {...request, path: '/api/feedback', body: {candidateId: 't3_another'}},
    {...request, path: '/api/position', body: {key: 'thread:another-source', position: 100}}
  ]) {
    const before: number = calls.length;
    assert.equal((await listener(bad, renderer)).ok, false);
    assert.equal(calls.length, before);
  }
  const before: number = calls.length;
  assert.equal((await listener(request, {...renderer, tab: {id: 8}})).ok, false);
  assert.equal((await listener(request, wrapper)).ok, false);
  await listener(request, sender);
  assert.equal(calls.length, before);
  const state = await listener({...request, path: '/api/state', method: 'GET', body: undefined}, renderer);
  assert.equal(state.ok, true);
  assert.equal(calls.at(-1)!.url, 'http://127.0.0.1:47831/api/state');
  assert.equal((calls.at(-1)!.options.headers as Record<string, string>).Authorization, `Bearer ${readerToken}`);
  session['reader:7'].expiresAt = 0;
  assert.equal((await listener(request, renderer)).ok, false);
  assert.equal((await listener({type: 'reader-close', snapshotId: 'stored-fixture'}, wrapper)).ok, true);
});
