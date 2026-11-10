// Server-side page/PDF retrieval (PART 9.1 step 3, layer A). An HTTP 200 only
// proves that a page was returned; it never makes a source credible.
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { RESEARCH } from '../config';
import type { RetrievalFailureReason } from '../../shared/schemas';

export interface FetchedPage {
  ok: true;
  requestedUrl: string;
  finalUrl: string;
  title: string | null;
  kind: 'html' | 'pdf' | 'text';
  /** For PDFs one entry per page (page numbers from 1); otherwise a single entry with page null. */
  pages: Array<{ page: number | null; text: string }>;
}
export interface FetchFailure {
  ok: false;
  requestedUrl: string;
  finalUrl: string | null;
  reason: RetrievalFailureReason;
  detail: string;
}
export type FetchOutcome = FetchedPage | FetchFailure;

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.');
}

/** Refuses non-http(s) URLs and hosts that resolve to private networks (SSRF protection). */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('unsupported protocol');
  if (u.username || u.password) throw new Error('credentials in URL');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('private address');
  return u;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]!.replace(/\s+/g, ' ').trim()) || null : null;
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body)
    .split('\n')
    .map((l) => l.replace(/[ \t\f\v ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return { title, text };
}

async function readCapped(res: Response): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > RESEARCH.maxFetchBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(Math.min(total, RESEARCH.maxFetchBytes));
  let off = 0;
  for (const c of chunks) {
    out.set(c.subarray(0, out.length - off), off);
    off += c.byteLength;
    if (off >= out.length) break;
  }
  return out;
}

export async function extractPdfPages(data: Uint8Array): Promise<Array<{ page: number; text: string }>> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).map((t, i) => ({ page: i + 1, text: t }));
}

const fail = (requestedUrl: string, finalUrl: string | null, reason: RetrievalFailureReason, detail: string): FetchFailure => ({
  ok: false,
  requestedUrl,
  finalUrl,
  reason,
  detail,
});

export async function fetchSource(url: string): Promise<FetchOutcome> {
  let current = url;
  try {
    for (let hop = 0; hop < 6; hop++) {
      await assertPublicUrl(current);
      const res = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(RESEARCH.fetchTimeoutMs),
        headers: {
          'User-Agent': RESEARCH.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5',
          'Accept-Language': 'hy,en;q=0.9,ru;q=0.8',
        },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        current = new URL(res.headers.get('location')!, current).toString();
        continue;
      }
      if (res.status === 401) return fail(url, current, 'auth_required', 'HTTP 401');
      if (res.status === 403) return fail(url, current, 'blocked_403', 'HTTP 403');
      if (res.status === 429) return fail(url, current, 'rate_limited_429', 'HTTP 429');
      if (res.status === 404 || res.status === 410) return fail(url, current, 'not_found', `HTTP ${res.status}`);
      if (!res.ok) return fail(url, current, res.status >= 500 ? 'timeout' : 'parse_error', `HTTP ${res.status}`);
      if (/\/(login|signin|sign-in|auth)(\/|\?|$)/i.test(new URL(current).pathname)) {
        return fail(url, current, 'auth_required', 'Redirected to a sign-in page');
      }
      const type = (res.headers.get('content-type') ?? '').toLowerCase();
      const bytes = await readCapped(res);
      if (type.includes('application/pdf') || current.toLowerCase().endsWith('.pdf')) {
        try {
          const pages = await extractPdfPages(bytes);
          if (!pages.some((p) => p.text.trim())) return fail(url, current, 'parse_error', 'PDF has no extractable text');
          return { ok: true, requestedUrl: url, finalUrl: current, title: null, kind: 'pdf', pages };
        } catch {
          return fail(url, current, 'parse_error', 'PDF could not be parsed');
        }
      }
      if (type.includes('html') || type.includes('xml')) {
        const { title, text } = htmlToText(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
        if (text.length < 200) return fail(url, current, 'parse_error', 'Page had no readable text');
        return { ok: true, requestedUrl: url, finalUrl: current, title, kind: 'html', pages: [{ page: null, text }] };
      }
      if (type.startsWith('text/')) {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        return { ok: true, requestedUrl: url, finalUrl: current, title: null, kind: 'text', pages: [{ page: null, text }] };
      }
      return fail(url, current, 'parse_error', `Unsupported content type ${type || 'unknown'}`);
    }
    return fail(url, current, 'parse_error', 'Too many redirects');
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') return fail(url, current, 'timeout', 'Request timed out');
    const msg = String((err as Error)?.message ?? '');
    if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return fail(url, current, 'not_found', 'Host not found');
    return fail(url, current, 'parse_error', 'Request failed');
  }
}
