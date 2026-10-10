import { extractThread, threadLocation } from './extract';

const contentWindow = window as Window & {__rekindleInstalled?: boolean};
if (!contentWindow.__rekindleInstalled) {
  contentWindow.__rekindleInstalled = true;
  const host = document.createElement('div');
  host.id = 'rekindle-reader-control';
  const shadow = host.attachShadow({mode: 'closed'});
  const style = document.createElement('style');
  style.textContent = `
    :host{all:initial;color-scheme:light dark;font:15px/1.5 system-ui,sans-serif}
    *{box-sizing:border-box} [hidden]{display:none!important} button{font:inherit;cursor:pointer} button:focus-visible,a:focus-visible{outline:3px solid #bc6134;outline-offset:4px}
    .launch{position:fixed;right:22px;bottom:24px;z-index:2147483645;border:1px solid #e5b793;border-radius:24px;padding:10px 18px;background:#fbf4e8;color:#302b24;box-shadow:0 4px 24px #0003;font-weight:650;letter-spacing:.01em}
    .launch:hover{background:#f5e5ce}.spark{color:#a94b29;margin-right:8px}
    dialog{position:fixed;inset:0;margin:0;width:100vw;max-width:none;height:100dvh;max-height:none;border:0;padding:0;background:#f5f0e6;color:#302b24;z-index:2147483647}
    dialog::backdrop{background:#f5f0e6} .layout{height:100%;display:flex;flex-direction:column}
    .bar{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:10px 20px;border-bottom:1px solid #dcd4c6;background:#fbf7ef;flex-shrink:0}
    .bar button,.action{border:1px solid #c9bdab;border-radius:8px;background:#fffaf2;color:#332d26;padding:8px 14px}
    .context{font-size:12px;color:#756b5f;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    .body{flex:1;min-height:0;display:flex}.shell{margin:auto;max-width:580px;padding:40px 24px;overflow:auto}.wordmark{font:42px/1.1 Georgia,serif;margin:0 0 8px}.tagline{color:#9d4c2e;margin:0 0 40px}.status{font-size:17px;line-height:1.6}.subtle{font-size:13px;color:#776e62}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:24px}iframe{width:100%;height:100%;border:0;display:block;background:#f5f0e6}
    @media(max-width:550px){.context{display:none}.bar{padding:8px 12px}.launch{right:12px;bottom:16px}.shell{padding:24px}}`;
  const launch = document.createElement('button');
  launch.className = 'launch'; launch.type = 'button'; launch.textContent = '✦ Rekindle';
  launch.setAttribute('aria-label', 'Read this discussion with Rekindle');
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', 'Rekindle thread reader');
  shadow.append(style, launch, dialog);
  let currentUrl = location.href;
  let generation = 0;
  let originalScroll = {x: 0, y: 0};
  let previousFocus: Element | null = null;
  let originalOverflow = '';

  function close(restore = true) {
    generation++;
    if (!dialog.open) return;
    dialog.close(); dialog.replaceChildren();
    if (document.body.style.overflow === 'hidden') document.body.style.overflow = originalOverflow;
    if (restore) {
      window.scrollTo(originalScroll.x, originalScroll.y);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({preventScroll: true});
    }
  }

  async function activate() {
    if (!threadLocation(location.href)) return;
    if (dialog.open) return;
    const requestId = ++generation;
    const captureUrl = location.href;
    originalScroll = {x: window.scrollX, y: window.scrollY};
    previousFocus = document.activeElement;
    originalOverflow = document.body.style.overflow;
    const layout = document.createElement('div'); layout.className = 'layout';
    const bar = document.createElement('div'); bar.className = 'bar';
    const back = document.createElement('button'); back.type = 'button'; back.textContent = '← Original thread'; back.addEventListener('click', () => close());
    const context = document.createElement('span'); context.className = 'context'; context.textContent = threadLocation(captureUrl)!.url.pathname;
    bar.append(back, context);
    const body = document.createElement('div'); body.className = 'body';
    const shell = document.createElement('section'); shell.className = 'shell';
    const wordmark = document.createElement('h1'); wordmark.className = 'wordmark'; wordmark.textContent = 'Rekindle';
    const tagline = document.createElement('p'); tagline.className = 'tagline'; tagline.textContent = 'Restore the magic.';
    const status = document.createElement('p'); status.className = 'status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.textContent = 'Bringing the human voices into focus…';
    const detail = document.createElement('p'); detail.className = 'subtle'; detail.textContent = 'Capturing this discussion’s available text. Your original thread and reading position are waiting here.';
    shell.append(wordmark, tagline, status, detail); body.append(shell); layout.append(bar, body); dialog.append(layout);
    dialog.showModal(); document.body.style.overflow = 'hidden';
    // Let the clean shell paint before reading a potentially large comment DOM.
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    try {
      const snapshot = extractThread(document, captureUrl);
      status.textContent = `Captured ${snapshot.comments.length} available comments. Opening your reader…`;
      const result = await browser.runtime.sendMessage({type: 'capture', snapshot});
      if (requestId !== generation || captureUrl !== location.href) return;
      if (!result?.ok) throw new Error(result?.error || 'The local service could not open this capture.');
      if (typeof result.readerUrl !== 'string' || !result.readerUrl.startsWith(browser.runtime.getURL('reader.html') + '?thread=')) throw new Error('The reader returned an invalid address.');
      const iframe = document.createElement('iframe'); iframe.title = 'Rekindle curated thread reader'; iframe.src = result.readerUrl;
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      body.replaceChildren(iframe);
    } catch (error) {
      if (requestId !== generation) return;
      status.textContent = error instanceof Error ? error.message : 'The discussion could not be captured.';
      detail.textContent = 'You can retry after starting the local portal, or pair this extension in settings. Nothing on Reddit was changed.';
      const actions = document.createElement('div'); actions.className = 'actions';
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'action'; retry.textContent = 'Try again'; retry.onclick = () => { close(); void activate(); };
      const options = document.createElement('button'); options.type = 'button'; options.className = 'action'; options.textContent = 'Extension settings'; options.onclick = () => { void browser.runtime.sendMessage({type: 'options'}); };
      actions.append(retry, options); shell.append(actions);
    }
  }

  function observeNavigation() {
    if (location.href !== currentUrl) { currentUrl = location.href; close(false); }
    launch.hidden = !threadLocation(location.href);
    if (!host.isConnected && document.body) document.body.append(host);
  }
  launch.onclick = () => { void activate(); };
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id) return;
    if (message?.type === 'rekindle:activate') { void activate(); return Promise.resolve({ok: true}); }
    if (message?.type === 'rekindle:close') { close(); return Promise.resolve({ok: true}); }
    if (message?.type === 'rekindle:loaded' && dialog.open) { const bar = dialog.querySelector<HTMLElement>('.bar'); if (bar) bar.hidden = true; dialog.querySelector('iframe')?.focus(); return Promise.resolve({ok: true}); }
  });
  window.addEventListener('popstate', observeNavigation);
  window.addEventListener('pageshow', observeNavigation);
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(() => { scheduled = false; observeNavigation(); }, 120);
  }).observe(document.documentElement, {childList: true, subtree: true});
  // Covers history.pushState without patching Reddit's scripts or history methods.
  window.setInterval(observeNavigation, 1_000);
  observeNavigation();
}
