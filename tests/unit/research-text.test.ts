import { describe, expect, it } from 'vitest';
import { describeResearch, eventExtras } from '../../src/client/lib/events';
import { en } from '../../src/client/i18n/en';
import { hy } from '../../src/client/i18n/hy';

const tFor = (dict: Record<string, string>) => (key: string, vars?: Record<string, string | number>) => {
  let s = dict[key] ?? key;
  for (const [k, v] of Object.entries(vars ?? {})) s = s.split(`{${k}}`).join(String(v));
  return s;
};

describe('research log text', () => {
  const failed = { kind: 'retrieval_failed', host: 'researchgate.net', url: 'https://www.researchgate.net/publication/1_A_very_long_title', failureReason: 'blocked_403' };

  it('names the site and a plain reason instead of an HTTP code', () => {
    expect(describeResearch(failed, tFor(en) as never, null)).toBe('researchgate.net — Could not retrieve: no permission');
    expect(describeResearch({ ...failed, failureReason: 'parse_error' }, tFor(en) as never, null)).toBe('researchgate.net — Could not retrieve: the page could not be read');
  });

  it('is localized and never contains raw codes', () => {
    const text = describeResearch(failed, tFor(hy) as never, null);
    expect(text).toBe('researchgate.net — Հնարավոր չեղավ ստանալ՝ թույլտվություն չկա');
    for (const reason of ['blocked_403', 'rate_limited_429', 'auth_required', 'parse_error', 'timeout', 'not_found']) {
      expect(describeResearch({ ...failed, failureReason: reason }, tFor(hy) as never, null)).not.toMatch(/HTTP|_\d{3}|parse_error/);
    }
  });

  it('search results become a count plus site chips', () => {
    const d = { kind: 'search', query: 'q', sites: ['a.org', 'b.am'], cached: false };
    expect(describeResearch(d, tFor(en) as never, null)).toBe('“q” — 2 results');
    expect(eventExtras({ type: 'research_log', data: d } as never).sites).toEqual(['a.org', 'b.am']);
    expect(eventExtras({ type: 'research_log', data: failed } as never).url).toBe(failed.url);
  });
});
