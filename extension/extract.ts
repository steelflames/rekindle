import type { Comment, Media, ThreadSnapshot } from '../shared/types';

const REDDIT_HOSTS = new Set(['reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com']);
const COMMENT_SELECTOR = 'shreddit-comment, .thing.comment';
export const CAPTURE_LIMIT = 600;

export function threadLocation(value: string): {url: URL; subreddit: string; postId: string} | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !REDDIT_HOSTS.has(url.hostname) || url.username || url.password || url.port) return null;
    const match = url.pathname.match(/^\/r\/([a-z0-9_]+)\/comments\/([a-z0-9]+)(?:\/|$)/i);
    if (!match) return null;
    url.search = ''; url.hash = '';
    return {url, subreddit: match[1], postId: `t3_${match[2]}`};
  } catch { return null; }
}

function safeLink(value: string | null | undefined, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function sourceLink(value: string | null | undefined, base: string, postId: string, commentId?: string): string | null {
  const link = safeLink(value, base);
  const location = link && threadLocation(link);
  return location && location.postId === postId && (!commentId || location.url.pathname.split('/').filter(Boolean).at(-1) === commentId.slice(3)) ? location.url.href : null;
}

function own(root: Element, selectors: string): Element | null {
  return Array.from(root.querySelectorAll(selectors)).find(node => node.closest(COMMENT_SELECTOR) === root) ?? null;
}

function num(value: string | null | undefined): number | null {
  if (!value || /hidden|vote|score/i.test(value) && !/\d/.test(value)) return null;
  const raw = value.trim().replace(/,/g, '').match(/^(-?\d+(?:\.\d+)?)\s*([km])?(?:\s|$)/i);
  if (!raw) return null;
  const parsed = Number(raw[1]) * (raw[2]?.toLowerCase() === 'k' ? 1_000 : raw[2]?.toLowerCase() === 'm' ? 1_000_000 : 1);
  return Number.isFinite(parsed) ? parsed : null;
}

function stamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

// Stored source normalization: DOM text, LF block boundaries, list markers and code
// fences. No rewriting of the words inside these structures; no raw HTML is kept.
export function readableText(root: Element | null): string {
  if (!root) return '';
  function walk(node: Node): string {
    if (node.nodeType === 3) return (node.nodeValue ?? '').replace(/[\t\r\n ]+/g, ' ');
    if (node.nodeType !== 1) return '';
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'button', 'iframe', 'svg', 'noscript'].includes(tag) || el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return '';
    if (tag === 'pre') {
      const text = (el.textContent ?? '').replace(/\r\n?/g, '\n');
      const fence = '`'.repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), match => match[0].length + 1)));
      return `\n\n${fence}\n${text}\n${fence}\n\n`;
    }
    if (tag === 'br') return '\n';
    if (tag === 'img') return el.getAttribute('alt') ?? '';
    const value = Array.from(el.childNodes).map(walk).join('');
    if (tag === 'li') {
      const ordered = el.parentElement?.tagName.toLowerCase() === 'ol';
      const index = ordered ? Array.from(el.parentElement!.children).indexOf(el) + Number(el.parentElement!.getAttribute('start') || 1) : 0;
      return `\n${ordered ? `${index}.` : '•'} ${value.trim()}\n`;
    }
    if (tag === 'blockquote') return `\n\n${value.trim().split('\n').map(line => `> ${line}`).join('\n')}\n\n`;
    if (['p', 'div', 'section', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'table', 'tr'].includes(tag)) return `\n\n${value}\n\n`;
    if (tag === 'td' || tag === 'th') return `${value}\t`;
    return value;
  }
  let fence = ''; let blank = 0;
  const lines: string[] = [];
  for (const line of walk(root).split('\n')) {
    if (/^`{3,}$/.test(line)) { fence = fence === line ? '' : fence || line; blank = 0; lines.push(line); }
    else if (fence) lines.push(line);
    else if (!line.trim()) { if (++blank <= 1) lines.push(''); }
    else { blank = 0; lines.push(line.trim()); }
  }
  return lines.join('\n').trim();
}

function isExcluded(el: Element): boolean {
  return !!el.closest('aside, nav, [role="navigation"], .side, .promoted, [promoted], [is-promoted="true"], shreddit-ad-post, [data-testid="recommended-posts"]');
}

export function extractThread(doc: Document, sourceUrl: string, now = new Date().toISOString(), limit = CAPTURE_LIMIT): ThreadSnapshot {
  const location = threadLocation(sourceUrl);
  if (!location) throw new Error('Open a supported HTTPS Reddit discussion first.');
  const {url, subreddit, postId} = location;
  const modernPost = Array.from(doc.querySelectorAll('shreddit-post')).find(el => (el.getAttribute('id') === postId || el.getAttribute('post-id') === postId) && !isExcluded(el));
  const oldPost = Array.from(doc.querySelectorAll('.thing.link')).find(el => el.getAttribute('data-fullname') === postId && !isExcluded(el));
  const post = modernPost ?? oldPost;
  if (!post) throw new Error('This page has no supported thread markup yet. Wait for the discussion to load, then try again.');
  const title = post.getAttribute('post-title') || post.querySelector('[slot="title"], h1, a.title')?.textContent?.trim();
  if (!title) throw new Error('The post title is unavailable. Capture was not saved.');
  const method = modernPost ? 'Firefox explicit page capture · current Reddit DOM' : 'Firefox explicit page capture · old Reddit DOM';
  const count = num(post.getAttribute('comment-count') || post.querySelector('.comments')?.textContent);
  const limits = [
    'Only text already present in this discussion DOM was captured. Collapsed, unloaded, deleted and inaccessible content may be absent.',
    `Bounded page capture: at most ${Math.max(1, Math.min(CAPTURE_LIMIT, limit))} comments. Vote order is not used to choose captured comments.`,
    'Capture does not expand controls or alter Reddit. Open more branches on the original thread and capture again to include them.',
    'Formatting is normalized to text with block boundaries, list markers and code fences; prose is not rewritten.'
  ];
  const comments: Comment[] = [];
  const seen = new Set<string>();
  const bound = Math.max(1, Math.min(CAPTURE_LIMIT, limit));
  const nodes = Array.from(doc.querySelectorAll(COMMENT_SELECTOR)).filter(el => !isExcluded(el));
  for (const node of nodes) {
    if (comments.length >= bound) break;
    const modern = node.tagName.toLowerCase() === 'shreddit-comment';
    const id = node.getAttribute('thingid') || node.getAttribute('data-fullname');
    if (!id || !/^t1_[a-z0-9]+$/i.test(id) || seen.has(id)) continue;
    const ownerPost = node.getAttribute('postid');
    if (ownerPost && ownerPost !== postId) continue;
    if (!modern && !node.closest('.commentarea')) continue;
    const bodyNode = (modern ? own(node, 'shreddit-mod-comment [id$="-post-rtjson-content"]') : null)
      ?? own(node, modern ? '[slot="comment"], [data-testid="comment-body"], .md' : '.entry .usertext-body .md, .entry .md');
    const body = readableText(bodyNode);
    if (!body) continue;
    const parentNode = node.parentElement?.closest(COMMENT_SELECTOR);
    const parentRaw = node.getAttribute('parentid') || node.getAttribute('data-parent-fullname') || parentNode?.getAttribute('thingid') || parentNode?.getAttribute('data-fullname') || postId;
    const parentId = /^t[13]_[a-z0-9]+$/i.test(parentRaw) ? parentRaw : null;
    const author = node.getAttribute('author') || own(node, '.author, [data-testid="comment_author_link"]')?.textContent?.trim() || null;
    const permalink = sourceLink(node.getAttribute('permalink') || own(node, 'a.bylink, a[data-testid="comment_permalink"], a[slot="permalink"]')?.getAttribute('href'), url.href, postId, id);
    let ancestryDepth = 0; let cursor = parentNode;
    while (cursor && ancestryDepth < 100) { ancestryDepth++; cursor = cursor.parentElement?.closest(COMMENT_SELECTOR); }
    comments.push({
      id, parentId, author, body, permalink,
      score: num(node.getAttribute('score') || own(node, '.score.unvoted, .score, [data-score]')?.getAttribute('title') || own(node, '.score.unvoted, .score')?.textContent),
      publishedAt: stamp(node.getAttribute('created-timestamp') || node.getAttribute('created') || own(node, 'time')?.getAttribute('datetime')),
      flair: own(node, '.flair, [slot="author-flair"], [data-testid="author-flair"]')?.textContent?.trim() || null,
      depth: num(node.getAttribute('depth')) ?? ancestryDepth,
      locator: `Captured page ${url.href} · ${id}`
    });
    seen.add(id);
  }
  const missingParents = comments.filter(comment => comment.parentId && comment.parentId !== postId && !seen.has(comment.parentId));
  if (missingParents.length) limits.push(`${missingParents.length} captured replies have unavailable parent context. Their parent identifiers are retained.`);
  if (nodes.length > comments.length) limits.push('Some DOM nodes were excluded, unavailable, duplicated, from other posts, or beyond the capture bound.');
  const media: Media[] = [];
  const mediaSeen = new Set<string>();
  for (const node of post.querySelectorAll('img, video, source')) {
    if (node.closest(COMMENT_SELECTOR) || node.closest('[slot="credit-bar"], .tagline, .author')) continue;
    const link = safeLink(node.getAttribute('src') || node.getAttribute('data-src'), url.href);
    if (!link || mediaSeen.has(link) || /(?:avatar|icon|emoji)/i.test(node.getAttribute('class') || '') || media.length >= 8) continue;
    const isVideo = node.tagName.toLowerCase() !== 'img';
    media.push({type: isVideo ? 'video' : 'image', url: link, caption: node.getAttribute('alt') || (isVideo ? 'Video captured from the source post.' : 'Image captured from the source post.'), ...(isVideo && safeLink(node.getAttribute('poster'), url.href) ? {preview: safeLink(node.getAttribute('poster'), url.href)!} : {})});
    mediaSeen.add(link);
  }
  const postAuthor = post.getAttribute('author') || post.querySelector('.tagline .author')?.textContent?.trim() || null;
  const target = safeLink(post.getAttribute('content-href') || post.querySelector('a.title')?.getAttribute('href'), url.href);
  return {
    id: `page-${postId}-${Date.parse(now) || Date.now()}`, version: 1, imported: false, sourceLabel: url.href,
    post: {
      id: postId, title: title.slice(0, 1_000), body: readableText(post.querySelector('[slot="text-body"], .expando .usertext-body .md, [data-testid="post-content"]')),
      subreddit, author: postAuthor, permalink: url.href, url: target,
      publishedAt: stamp(post.getAttribute('created-timestamp') || post.querySelector('time')?.getAttribute('datetime')),
      capturedAt: now, score: num(post.getAttribute('score') || post.getAttribute('data-score')), numComments: count,
      flair: post.querySelector('[slot="post-flair"], .linkflairlabel')?.textContent?.trim() || null,
      media, cluster: 'Unmapped', lane: 'familiar', format: media.length ? 'visual' : 'discussion',
      method, commentsInspected: comments.length, spoiler: post.hasAttribute('spoiler') || post.classList.contains('spoiler'), nsfw: post.hasAttribute('nsfw') || post.classList.contains('over18')
    },
    comments,
    coverage: {obtainedAt: now, method, retrieved: comments.length, analyzed: 0, siteReported: count, limits}
  };
}
