// Pure resolution of one host's credibility policy from the built-in rules and stored records.
// No database access here, so the precedence below is fully unit-tested.
//
// Order of precedence:
//   1. An explicit built-in rule (named sites such as social networks, Wikipedia, *.gov.am, journals).
//      Exception: a rule marked overridableBy yields to a stored record of that origin (DOAJ for journals).
//   2. Stored records (Wikipedia perennial sources, DOAJ, EUvsDisinfo). The most specific host wins;
//      on a tie the most cautious record wins (lowest tier, then context-only).
//   3. A class rule (.gov, .edu, .ac.*), a broad suffix guess that any stored record beats.
//   4. Nothing: the site is unknown and decisions cap it at medium.
import { lowerTier, type PolicyOrigin, type SourcePolicy } from '../../../shared/credibility';
import { BUILTIN_RULES, matchBuiltin, specificity, type BuiltinRule } from './rules';

/** A record from an imported list, as stored in Firestore (collection `sourceCredibility`). */
export interface StoredCredibility {
  host: string;
  origin: Exclude<PolicyOrigin, 'builtin'>;
  name: string;
  tier: SourcePolicy['tier'];
  use: SourcePolicy['use'];
  category: SourcePolicy['category'];
  attribution: boolean;
  note: string;
  /** Where the entry can be checked by a person. */
  sourceUrl: string | null;
  importedAtMs: number;
}

const storedMatches = (host: string, r: StoredCredibility) => host === r.host || host.endsWith(`.${r.host}`);

function storedPolicy(r: StoredCredibility): SourcePolicy {
  return { tier: r.tier, use: r.use, category: r.category, attribution: r.attribution, origin: r.origin, rule: r.host, note: r.note };
}

/** More cautious first: lower tier, then context-only before evidence. */
function cautiousFirst(a: StoredCredibility, b: StoredCredibility): number {
  if (a.tier !== b.tier) return lowerTier(a.tier, b.tier) === a.tier ? -1 : 1;
  if (a.use !== b.use) return a.use === 'context_only' ? -1 : 1;
  return a.origin.localeCompare(b.origin);
}

export function resolvePolicy(host: string, stored: readonly StoredCredibility[], rules: readonly BuiltinRule[] = BUILTIN_RULES): SourcePolicy | null {
  const candidates = stored.filter((r) => storedMatches(host, r));
  const builtinPolicy = (m: NonNullable<ReturnType<typeof matchBuiltin>>): SourcePolicy => ({ ...m.rule.policy, origin: 'builtin', rule: m.rule.id });

  const explicit = matchBuiltin(host, 'explicit', rules);
  if (explicit) {
    const overrides = explicit.rule.overridableBy;
    if (overrides) {
      const replacing = candidates
        .filter((r) => overrides.includes(r.origin) && specificity(r.host) >= explicit.specificity)
        .sort(cautiousFirst)[0];
      if (replacing) return storedPolicy(replacing);
    }
    return builtinPolicy(explicit);
  }

  if (candidates.length) {
    const top = Math.max(...candidates.map((r) => specificity(r.host)));
    return storedPolicy(candidates.filter((r) => specificity(r.host) === top).sort(cautiousFirst)[0]!);
  }

  const cls = matchBuiltin(host, 'class', rules);
  return cls ? builtinPolicy(cls) : null;
}

/** The host itself and each parent domain with at least two labels: the hosts whose records can apply. */
export function candidateHosts(host: string): string[] {
  const labels = host.split('.');
  const out: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) out.push(labels.slice(i).join('.'));
  return out;
}
