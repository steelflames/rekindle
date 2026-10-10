export type SessionFetch = (path: string, options?: RequestInit) => Promise<Response>;

/** Request-only recovery: never reloads the page or changes any mounted form state. */
export function createSessionTransport(fetcher: SessionFetch, allowPortalRecovery: boolean): SessionFetch {
  let recovery: Promise<void> | null = null;
  let generation = 0;

  async function recover(requestGeneration: number): Promise<void> {
    // A late 401 from an old cookie must not create a second session.
    if (generation !== requestGeneration) return;
    if (!recovery) {
      recovery = (async () => {
        const response = await fetcher('/api/session', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Rekindle-Request': '1' }, body: '{}',
        });
        if (!response.ok) throw new Error('The local session could not reconnect. Your open form is still here; try again when the service is available.');
        generation += 1;
      })().finally(() => { recovery = null; });
    }
    await recovery;
  }

  return async (path, options) => {
    const requestGeneration = generation;
    let response = await fetcher(path, options);
    // Source-scoped readers must never be upgraded into a full portal session.
    if (response.status === 401 && allowPortalRecovery && path !== '/api/session') {
      await recover(requestGeneration);
      response = await fetcher(path, options);
    }
    return response;
  };
}
