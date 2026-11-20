// Shows the credibility policy for hosts or URLs, to see what the research pipeline will do with them.
//
//   npm run credibility:check -- facebook.com https://ysu.am/page journal.anau.am
//   npm run credibility:check -- --offline x.gov.am        built-in rules only, no database needed
import { normalizeHost } from '../src/shared/credibility';
import { resolvePolicy } from '../src/server/research/credibility/resolve';

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const inputs = args.filter((a) => !a.startsWith('--'));
if (!inputs.length) {
  console.error('Usage: npm run credibility:check -- [--offline] <host-or-url>...');
  process.exit(1);
}

const hosts = inputs.map((i) => ({ input: i, host: normalizeHost(i) }));
const policies = offline
  ? new Map(hosts.map((h) => [h.host!, h.host ? resolvePolicy(h.host, []) : null]))
  : await (await import('../src/server/research/credibility/store')).policiesFor(hosts.flatMap((h) => (h.host ? [h.host] : [])));

for (const { input, host } of hosts) {
  if (!host) {
    console.log(`${input}\n  not a usable host name`);
    continue;
  }
  const p = policies.get(host);
  console.log(p ? `${host}\n  ${p.tier} credibility, ${p.use}${p.attribution ? ', speaks for its owner' : ''} [${p.category}] from ${p.origin} (${p.rule})\n  ${p.note}` : `${host}\n  unknown site: no policy, decisions cap it at medium`);
}
