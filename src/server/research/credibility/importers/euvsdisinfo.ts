// EUvsDisinfo, the EU's database of pro-Kremlin disinformation cases (https://euvsdisinfo.eu).
// The site offers no bulk download or API, and its firewall refuses scripted access to the case
// search, so this importer reads a file that a person has compiled from the database: one outlet per
// line, as a bare domain or a URL, optionally with a name, or a CSV whose rows carry a URL or domain.
// Repeated hosts are counted (one row per case works). Nothing here fetches the site.
import { normalizeHost } from '../../../../shared/credibility';
import type { StoredCredibility } from '../resolve';

export interface OutletFileResult {
  hosts: Array<{ host: string; name: string; cases: number }>;
  skippedLines: number;
}

/** Splits one CSV/TSV/semicolon line, honouring double quotes. */
function fields(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',' || c === '\t' || c === ';') (out.push(cur.trim()), (cur = ''));
    else cur += c;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

export function parseOutletFile(text: string): OutletFileResult {
  const byHost = new Map<string, { name: string; cases: number }>();
  let skippedLines = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cols = fields(line);
    // A field with spaces is a name, never a host.
    const hostIdx = cols.findIndex((c) => !/\s/.test(c) && normalizeHost(c));
    const host = hostIdx >= 0 ? normalizeHost(cols[hostIdx]!) : null;
    if (!host) {
      skippedLines++; // header row or unusable line
      continue;
    }
    const name = cols.find((c, i) => i !== hostIdx && /\s|[A-Z]/.test(c) && !normalizeHost(c)) ?? host;
    const prev = byHost.get(host);
    byHost.set(host, { name: prev?.name && prev.name !== host ? prev.name : name, cases: (prev?.cases ?? 0) + 1 });
  }
  return { hosts: [...byHost].map(([host, v]) => ({ host, ...v })).sort((a, b) => b.cases - a.cases), skippedLines };
}

export function euvsdisinfoRecords(result: OutletFileResult, importedAtMs: number): StoredCredibility[] {
  return result.hosts.map(({ host, name, cases }) => ({
    host,
    origin: 'euvsdisinfo' as const,
    name,
    tier: 'low' as const,
    use: 'context_only' as const,
    category: 'disinformation' as const,
    // The outlet did publish it: a claim about what this outlet said can cite it.
    attribution: true,
    note: `Named as a source of pro-Kremlin disinformation in the EUvsDisinfo database (${cases} case${cases === 1 ? '' : 's'} in the imported list). Context only: it can show what the outlet published, never that it is true.`,
    sourceUrl: 'https://euvsdisinfo.eu/disinformation-cases/',
    importedAtMs,
  }));
}
