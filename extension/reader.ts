const READER_PAGE = browser.runtime.getURL('portal.html');
const snapshotId = new URLSearchParams(location.search).get('thread') || '';
const status = document.querySelector<HTMLElement>('#status')!;
const frame = document.querySelector<HTMLIFrameElement>('#reader')!;
let ready = false;
let loaded = false;

async function action(type: string) {
  const response = await browser.runtime.sendMessage({type, snapshotId});
  if (!response?.ok) { status.hidden = false; status.textContent = response?.error || 'The reader connection is unavailable. Return to the original thread and try again.'; }
}
document.querySelector('#close')!.addEventListener('click', () => { void action('reader-close'); });
document.querySelector('#portal')!.addEventListener('click', () => { void action('reader-open'); });
window.addEventListener('keydown', event => { if (event.key === 'Escape') void action('reader-close'); });
window.addEventListener('message', event => {
  if (!ready || event.origin !== location.origin || event.source !== frame.contentWindow) return;
  if (event.data?.type === 'rekindle:ready') { loaded = true; status.hidden = true; document.querySelector('header')!.hidden = true; void action('reader-loaded'); }
  if (event.data?.type === 'rekindle:close') void action('reader-close');
  if (event.data?.type === 'rekindle:open-portal') void action('reader-open');
});

void (async () => {
  try {
    const response = await browser.runtime.sendMessage({type: 'reader-ready', snapshotId});
    if (!response?.ok) throw new Error(response?.error || 'The reader session could not be opened.');
    const url = new URL(response.url);
    if (url.href.split('?')[0] !== READER_PAGE || url.searchParams.get('embed') !== '1' || url.searchParams.get('thread') !== snapshotId || url.hash) throw new Error('The reader address did not match this capture.');
    ready = true;
    frame.src = url.href; frame.hidden = false;
    setTimeout(() => { if (!loaded) status.textContent = 'The reader has not connected yet. Check that Rekindle is running, then return to the original thread and try again.'; }, 25_000);
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'The local reader could not be opened.'; }
})();
export {};
