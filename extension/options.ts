const statusElement = document.querySelector<HTMLElement>('#status')!;
const tokenInput = document.querySelector<HTMLInputElement>('#token')!;
const pairButton = document.querySelector<HTMLButtonElement>('#pair')!;
const checkButton = document.querySelector<HTMLButtonElement>('#check')!;
async function run(message: unknown, success?: string) {
  statusElement.textContent = 'Connecting to Rekindle on this computer…';
  pairButton.disabled = true; checkButton.disabled = true;
  try {
    const response = await browser.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || 'The connection could not be checked.');
    statusElement.textContent = success || (response.paired ? 'Connected and paired. Open a Reddit discussion and choose Rekindle.' : 'The local portal is running. Pair it with the token from Tune.');
  } catch (error) { statusElement.textContent = error instanceof Error ? error.message : 'The local portal is unavailable.'; }
  finally { pairButton.disabled = false; checkButton.disabled = false; tokenInput.value = ''; }
}
document.querySelector('#pair-form')!.addEventListener('submit', event => { event.preventDefault(); void run({type: 'pair', token: tokenInput.value}, 'Paired. Open a Reddit discussion and choose Rekindle.'); });
checkButton.onclick = () => { void run({type: 'status'}); };
document.querySelector<HTMLButtonElement>('#unpair')!.onclick = () => { void run({type: 'unpair'}, 'This extension is unpaired. Saved material in the portal is unchanged.'); };
void run({type: 'status'});
export {};
