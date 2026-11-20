// Polite HTTP for the import scripts: identifies itself, spaces requests out and backs off when a
// site says it is being asked too much. Import scripts run by hand, never inside a request.
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * These scripts are API clients, not crawlers, so they do not use the page fetcher's "research bot" agent:
 * DOAJ's firewall refuses any agent containing "bot". The name still says who is asking and why.
 */
export function importUserAgent(): string {
  const contact = process.env.CREDIBILITY_IMPORT_CONTACT?.trim();
  const base = 'TruthEngineClassroom-credibility-import/1.0 (educational fact-checking project)';
  return contact ? `${base}; ${contact}` : base;
}

export async function politeGet(url: string, opts: { minGapMs: number; retries?: number; accept?: string } = { minGapMs: 1000 }): Promise<Response> {
  const retries = opts.retries ?? 6;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': importUserAgent(), Accept: opts.accept ?? '*/*' }, signal: AbortSignal.timeout(60_000) });
    if (res.ok) {
      await sleep(opts.minGapMs);
      return res;
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) throw new Error(`HTTP ${res.status} for ${url}`);
    const header = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(header) && header > 0 ? header * 1000 : Math.min(120_000, 5_000 * 2 ** attempt);
    await sleep(wait);
  }
}
