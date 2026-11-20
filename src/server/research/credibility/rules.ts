// Built-in credibility rules: the project's own first opinion, kept in code so it is reviewed,
// versioned and testable. Imported lists (Wikipedia, DOAJ, EUvsDisinfo) live in Firestore and are
// combined with these by resolve.ts.
//
// Pattern syntax (all lowercase):
//   example.com    the domain and every subdomain of it
//   *.example.com  the same (the apex is included; it hosts nothing of interest on blog platforms)
//   .gov           any host ending in .gov (a suffix class)
//   .ac.*          any host whose second-level label is `ac` under a two-letter country code (ox.ac.uk)
import type { PolicyOrigin, SourcePolicy } from '../../../shared/credibility';

export interface BuiltinRule {
  id: string;
  match: string[];
  /**
   * explicit: chosen by name, beats imported lists.
   * class: a broad suffix guess (.gov, .edu, .ac.*); any more specific imported record beats it.
   */
  authority: 'explicit' | 'class';
  /** A stored record of one of these origins for the same host or a more specific one replaces this rule. */
  overridableBy?: PolicyOrigin[];
  policy: Omit<SourcePolicy, 'origin' | 'rule'>;
}

const SPEAKS_FOR_OWNER = 'Context only. It can show what the account owner said, never that it is true.';

export const BUILTIN_RULES: BuiltinRule[] = [
  {
    id: 'social_media',
    authority: 'explicit',
    match: [
      'facebook.com', 'fb.com', 'fb.me', 'fb.watch', 'instagram.com', 'x.com', 'twitter.com', 't.co', 'threads.net',
      'tiktok.com', 'reddit.com', 'redd.it', 'youtube.com', 'youtu.be', 'linkedin.com', 'pinterest.com', 'snapchat.com',
      'tumblr.com', 'quora.com', 'vk.com', 'vk.ru', 'ok.ru', 't.me', 'telegram.me', 'telegra.ph', 'discord.com',
      'discord.gg', 'whatsapp.com', 'bsky.app', 'mastodon.social', 'weibo.com', 'twitch.tv',
    ],
    policy: { tier: 'low', use: 'context_only', category: 'social_media', attribution: true, note: `Social network (user-generated). ${SPEAKS_FOR_OWNER}` },
  },
  {
    id: 'blog_platform',
    authority: 'explicit',
    match: ['*.wordpress.com', '*.blogspot.com', 'blogger.com', 'medium.com', 'substack.com', 'livejournal.com', 'wixsite.com', 'weebly.com'],
    policy: { tier: 'low', use: 'context_only', category: 'blog_platform', attribution: true, note: `Self-published blog platform. ${SPEAKS_FOR_OWNER}` },
  },
  {
    id: 'file_sharing',
    authority: 'explicit',
    match: [
      'scribd.com', 'studocu.com', 'slideshare.net', 'coursehero.com', 'docsity.com', 'issuu.com', 'yumpu.com',
      'docplayer.net', 'pdfcoffee.com', 'dokumen.pub', 'docs.google.com', 'drive.google.com', 'dropbox.com',
    ],
    // Anyone can upload any document under any name, so even "who said it" is unknown.
    policy: { tier: 'low', use: 'context_only', category: 'file_sharing', attribution: false, note: 'User-uploaded files: the uploader is unknown and the file may be altered. Context only.' },
  },
  {
    id: 'wikipedia',
    authority: 'explicit',
    match: ['wikipedia.org'],
    policy: { tier: 'medium', use: 'context_only', category: 'encyclopedia', attribution: false, note: 'Wikipedia is a useful starting point but is edited by anyone. Follow its references to the original sources. Context only.' },
  },
  {
    id: 'government',
    authority: 'explicit',
    match: ['*.gov.am', 'escs.am'],
    policy: {
      tier: 'high',
      use: 'evidence',
      category: 'government',
      attribution: true,
      note: 'Government site. A primary source for what this body said, decided or published; on matters where the state is itself a party, weigh it as the official position.',
    },
  },
  {
    // A suffix guess. Any imported record for a more specific host (for example academia.edu) beats it.
    id: 'government_gov',
    authority: 'class',
    match: ['.gov'],
    policy: {
      tier: 'high',
      use: 'evidence',
      category: 'government',
      attribution: true,
      note: 'Government site. A primary source for what this body said, decided or published; on matters where the state is itself a party, weigh it as the official position.',
    },
  },
  {
    id: 'education',
    authority: 'explicit',
    match: ['lib.armedu.am', '*.sci.am'],
    policy: { tier: 'high', use: 'evidence', category: 'education', attribution: false, note: 'Educational or academic institution (Armenian education ministry library or National Academy of Sciences).' },
  },
  {
    id: 'education_suffix',
    authority: 'class',
    match: ['.edu', '.ac.*'],
    policy: { tier: 'high', use: 'evidence', category: 'education', attribution: false, note: 'University or academic domain. Personal and student pages on these domains are not institutional publications.' },
  },
  {
    id: 'journal',
    authority: 'explicit',
    match: ['journal.anau.am', 'mpcs.sci.am'],
    // DOAJ is asked first: a DOAJ record for the same host replaces this opinion.
    overridableBy: ['doaj'],
    policy: { tier: 'high', use: 'evidence', category: 'journal', attribution: false, note: 'Academic journal of an Armenian university or the National Academy of Sciences.' },
  },
];

/**
 * Outlets that are owned or controlled by a state. A marker only: it never changes a tier, because a state-owned
 * outlet can be accurate (and an independent one wrong). Kept short on purpose: only outlets whose ownership is not in
 * doubt. The Wikipedia import adds the outlets its list describes as state-owned, state-run or state-funded.
 */
export const STATE_OWNED_MEDIA: string[] = [
  // Russia
  'rt.com', 'sputniknews.com', 'sputnikglobe.com', 'ria.ru', 'tass.com', 'tass.ru', 'tvzvezda.ru',
  // China
  'xinhuanet.com', 'news.cn', 'cgtn.com', 'chinadaily.com.cn', 'globaltimes.cn', 'people.com.cn',
  // Iran, Belarus, Turkey, Armenia
  'presstv.ir', 'irna.ir', 'belta.by', 'trt.net.tr', 'armenpress.am',
];

export function isBuiltinStateOwned(host: string, list: readonly string[] = STATE_OWNED_MEDIA): boolean {
  return list.some((pattern) => matchesPattern(host, pattern));
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** How specific a pattern is: its number of fixed labels. */
export function specificity(pattern: string): number {
  const p = pattern.replace(/^\*\./, '').replace(/^\./, '');
  return p.split('.').filter((l) => l && l !== '*').length;
}

export function matchesPattern(host: string, pattern: string): boolean {
  if (pattern === '.ac.*') return /(^|\.)ac\.[a-z]{2}$/.test(host);
  if (pattern.startsWith('.')) return host.endsWith(pattern);
  const domain = pattern.replace(/^\*\./, '');
  return host === domain || host.endsWith(`.${domain}`);
}

export interface RuleMatch {
  rule: BuiltinRule;
  pattern: string;
  specificity: number;
}

/** The best matching built-in rule of the given authority (most specific pattern first), or null. */
export function matchBuiltin(host: string, authority: BuiltinRule['authority'], rules: readonly BuiltinRule[] = BUILTIN_RULES): RuleMatch | null {
  let best: RuleMatch | null = null;
  for (const rule of rules) {
    if (rule.authority !== authority) continue;
    for (const pattern of rule.match) {
      if (!matchesPattern(host, pattern)) continue;
      const s = specificity(pattern);
      if (!best || s > best.specificity) best = { rule, pattern, specificity: s };
    }
  }
  return best;
}
