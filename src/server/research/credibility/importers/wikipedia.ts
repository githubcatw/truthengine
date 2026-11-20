// Wikipedia "Perennial sources" (WP:RSP): editors' consensus on sources that are discussed again and
// again. The list is split across subpages /1, /2, ... and each row ends with a {{WP:RSPUSES|domain|...}}
// template naming the sites it covers. This file only parses; fetching is done by the import script.
// Text on Wikipedia is CC BY-SA 4.0; each stored record links to its entry.
import { normalizeHost, type CredibilityTier } from '../../../../shared/credibility';
import type { StoredCredibility } from '../resolve';

export const RSP_PAGE = 'Wikipedia:Reliable_sources/Perennial_sources';
export const RSP_URL = `https://en.wikipedia.org/wiki/${RSP_PAGE}`;

export type RspStatus = 'gr' | 'nc' | 'm' | 'gu' | 'd' | 'b';
const STATUS_TIER: Record<RspStatus, CredibilityTier> = { gr: 'high', nc: 'medium', m: 'medium', gu: 'low', d: 'low', b: 'low' };
const STATUS_LABEL: Record<RspStatus, string> = {
  gr: 'generally reliable',
  nc: 'no consensus on reliability',
  m: 'mixed or marginal reliability',
  gu: 'generally unreliable',
  d: 'deprecated',
  b: 'blacklisted',
};

export interface RspEntry {
  name: string;
  status: RspStatus;
  hosts: string[];
  summary: string;
}

export interface RspParseResult {
  entries: RspEntry[];
  /** Rows with no usable domain (the template lists only paths, or no domain at all). */
  withoutHosts: number;
  /** Domain entries that name a path on a site (aa.com.tr/en): skipped, a path is not a whole site. */
  pathScoped: number;
  unknownStatus: number;
}

const decodeEntities = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** Wikitext to a short plain sentence: drops templates, refs and markup, keeps link labels. */
export function plainWikitext(input: string, max = 260): string {
  let s = input;
  for (let i = 0; i < 6 && /\{\{[^{}]*\}\}/.test(s); i++) s = s.replace(/\{\{[^{}]*\}\}/g, '');
  s = s
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[(?:https?:)?\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  s = decodeEntities(s);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = cut.lastIndexOf('. ');
  return stop > 80 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}

export function parseRspPage(wikitext: string): RspParseResult {
  const result: RspParseResult = { entries: [], withoutHosts: 0, pathScoped: 0, unknownStatus: 0 };
  for (const block of wikitext.split(/\n\|-/).slice(1)) {
    const head = block.slice(0, 300);
    const id = /\bid="([^"]+)"/.exec(head)?.[1];
    if (!id) continue;
    const status = /\{\{WP:RSPSTATUS\|([a-z]+)/.exec(block)?.[1];
    if (!status || !(status in STATUS_TIER)) {
      result.unknownStatus++;
      continue;
    }
    const uses = /\{\{WP:RSPUSES\|([^}]*)\}\}/.exec(block)?.[1] ?? '';
    const hosts: string[] = [];
    for (const token of uses.split('|')) {
      const t = token.trim();
      if (!t || t.includes('=')) continue;
      if (t.includes('/')) {
        result.pathScoped++;
        continue;
      }
      const host = normalizeHost(t);
      if (host && !hosts.includes(host)) hosts.push(host);
    }
    if (!hosts.length) {
      result.withoutHosts++;
      continue;
    }
    const summary = /\{\{WP:RSPLAST\|[^}]*\}\}\s*\n\|\s*([\s\S]*?)\n\|\s*\{\{WP:RSPUSES/.exec(block)?.[1] ?? '';
    result.entries.push({ name: decodeEntities(id), status: status as RspStatus, hosts, summary: plainWikitext(summary) });
  }
  return result;
}

const TIER_ORDER: CredibilityTier[] = ['low', 'medium', 'high'];
const lowestTier = (a: CredibilityTier, b: CredibilityTier) => (TIER_ORDER.indexOf(a) <= TIER_ORDER.indexOf(b) ? a : b);

/**
 * Wikipedia splits some sites into several entries: by topic ("Anadolu Agency (controversial topics)"),
 * by period ("CNET (pre-October 2020)", "Newsweek (2013-present)") or both. A whole-site tier should follow
 * the general, current entry; topic entries become a caveat in the note and old periods are ignored.
 */
export function entryScope(name: string): { scope: 'general' | 'topic' | 'historical'; qualifier: string | null } {
  const qualifier = /\(([^)]*)\)\s*$/.exec(name)?.[1] ?? /\b((?:pre[-\u2013 ]\s*)?\d{4}\s*[-\u2013]\s*(?:\d{4}|present))\s*$/i.exec(name)?.[1] ?? null;
  if (!qualifier) return { scope: 'general', qualifier: null };
  const hasYear = /\d{4}/.test(qualifier) || /^pre[-\u2013 ]/i.test(qualifier);
  if (!hasYear) return { scope: 'topic', qualifier };
  return /present/i.test(qualifier) ? { scope: 'general', qualifier } : { scope: 'historical', qualifier };
}

/** One record per host. Among the entries that cover a host, the general ones decide the tier, and the more cautious wins a tie. */
export function rspRecords(entries: readonly RspEntry[], importedAtMs: number): StoredCredibility[] {
  const byHost = new Map<string, RspEntry[]>();
  for (const entry of entries) for (const host of entry.hosts) byHost.set(host, [...(byHost.get(host) ?? []), entry]);

  const records: StoredCredibility[] = [];
  for (const [host, list] of byHost) {
    const scoped = list.map((entry) => ({ entry, ...entryScope(entry.name) }));
    const general = scoped.filter((x) => x.scope === 'general');
    const deciding = general.length ? general : scoped.filter((x) => x.scope === 'topic').length ? scoped.filter((x) => x.scope === 'topic') : scoped;
    const chosen = deciding.reduce((best, x) => (lowestTier(STATUS_TIER[x.entry.status], STATUS_TIER[best.entry.status]) === STATUS_TIER[best.entry.status] ? best : x));
    const entry = chosen.entry;
    const tier = STATUS_TIER[entry.status];
    const unreliable = tier === 'low';
    const caveats = general.length ? scoped.filter((x) => x.scope === 'topic' && x.qualifier).map((x) => x.qualifier!) : [];
    records.push({
      host,
      origin: 'wikipedia_rsp',
      name: entry.name,
      tier,
      use: unreliable ? 'context_only' : 'evidence',
      category: entry.status === 'd' || entry.status === 'b' ? 'deprecated' : unreliable ? 'unreliable' : 'other',
      attribution: false,
      note: `Wikipedia editors list "${entry.name}" as ${STATUS_LABEL[entry.status]}.${entry.summary ? ` ${entry.summary}` : ''}${caveats.length ? ` Separate entries with different ratings exist for: ${caveats.join('; ')}.` : ''}`.slice(0, 500),
      sourceUrl: `${RSP_URL}#${encodeURIComponent(entry.name.replace(/ /g, '_'))}`,
      importedAtMs,
    });
  }
  return records;
}

/** Subpage numbers the main page transcludes ({{WP:Reliable sources/Perennial sources/3}}). */
export function rspSubpages(mainWikitext: string): number[] {
  const out = new Set<number>();
  for (const m of mainWikitext.matchAll(/\{\{WP:Reliable sources\/Perennial sources\/(\d+)\}\}/g)) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}
