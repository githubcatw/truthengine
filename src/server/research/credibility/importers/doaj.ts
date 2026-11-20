// Directory of Open Access Journals (DOAJ). A journal is listed only after DOAJ has checked its
// editorial and publishing practices, so a listing is a positive signal; DOAJ publishes no list of
// rejected or removed journals, so absence from DOAJ says nothing. Records are per host: a host that
// serves at least one DOAJ-indexed journal. Fetching uses the public search API, which returns one
// page of journals at a time and a `next` link.
import { normalizeHost } from '../../../../shared/credibility';
import type { StoredCredibility } from '../resolve';

export const DOAJ_API_ORIGIN = 'https://doaj.org';
// The API caps a page at 50 journals whatever pageSize asks for.
export const DOAJ_FIRST_PAGE = `${DOAJ_API_ORIGIN}/api/search/journals/*?pageSize=50`;

export interface DoajJournal {
  title: string;
  host: string;
  issn: string | null;
  seal: boolean;
}

export interface DoajPage {
  journals: DoajJournal[];
  /** Results with no usable journal homepage. */
  withoutHost: number;
  next: string | null;
  total: number | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function parseDoajPage(body: unknown): DoajPage {
  const root = (body ?? {}) as Record<string, unknown>;
  const results = Array.isArray(root.results) ? (root.results as Array<Record<string, any>>) : [];
  const journals: DoajJournal[] = [];
  let withoutHost = 0;
  for (const r of results) {
    const bib = r?.bibjson ?? {};
    const home = str(bib.ref?.journal);
    const host = home ? normalizeHost(home) : null;
    if (!host) {
      withoutHost++;
      continue;
    }
    journals.push({ title: str(bib.title) ?? host, host, issn: str(bib.eissn) ?? str(bib.pissn), seal: Boolean(r?.admin?.seal) });
  }
  // Only ever follow a link that stays on the DOAJ API.
  const next = str(root.next);
  const safeNext = next && next.startsWith(`${DOAJ_API_ORIGIN}/api/`) ? next : null;
  return { journals, withoutHost, next: safeNext, total: typeof root.total === 'number' ? root.total : null };
}

export function doajRecords(journals: readonly DoajJournal[], importedAtMs: number): StoredCredibility[] {
  const byHost = new Map<string, DoajJournal[]>();
  for (const j of journals) byHost.set(j.host, [...(byHost.get(j.host) ?? []), j]);
  return [...byHost].map(([host, list]) => {
    const first = list[0]!;
    const seal = list.some((j) => j.seal);
    return {
      host,
      origin: 'doaj' as const,
      name: first.title,
      tier: 'high' as const,
      use: 'evidence' as const,
      category: 'journal' as const,
      attribution: false,
      note: `Hosts ${list.length === 1 ? 'a journal' : `${list.length} journals`} indexed in the Directory of Open Access Journals (DOAJ), which checks editorial and publishing practices${seal ? ' (DOAJ Seal)' : ''}: ${first.title}${list.length > 1 ? ' and others' : ''}.`,
      sourceUrl: first.issn ? `${DOAJ_API_ORIGIN}/toc/${first.issn}` : null,
      importedAtMs,
    };
  });
}
