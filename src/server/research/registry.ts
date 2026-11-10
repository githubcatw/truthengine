// Trusted-sources registry lookup (PART 9.1 step 7). A registry entry is a
// preference signal only; it never makes a statement automatically correct.
import { C, col } from '../pipeline/store';

export interface TrustedSourceMatch {
  sourceId: string;
  name: string;
  verificationStatus: 'unverified' | 'verified_by_admin';
}

let cache: { at: number; byHost: Map<string, TrustedSourceMatch> } | null = null;

export function invalidateTrustedSources() {
  cache = null;
}

export async function trustedSourceFor(host: string): Promise<TrustedSourceMatch | null> {
  if (!cache || Date.now() - cache.at > 5 * 60_000) {
    const snap = await col(C.trustedSources).limit(1000).get();
    cache = {
      at: Date.now(),
      byHost: new Map(snap.docs.map((d) => [d.get('host') as string, { sourceId: d.id, name: d.get('name'), verificationStatus: d.get('verificationStatus') }])),
    };
  }
  // Match the host or any parent domain (e.g. a faculty subdomain of a listed university).
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const m = cache.byHost.get(parts.slice(i).join('.'));
    if (m) return m;
  }
  return null;
}
