// Source credibility policy: a deterministic first opinion about a website, decided in code
// from a database and fixed rules, never by a language model. The model's own credibility
// rating (layer B) may only lower it. See DATABASE.md ("Source credibility").
import { z } from 'zod';

export const CredibilityTierSchema = z.enum(['high', 'medium', 'low']);
export type CredibilityTier = z.infer<typeof CredibilityTierSchema>;

/**
 * evidence: a verified quotation may support or contradict the claim.
 * context_only: background to read, never decisive evidence of whether a claim is true
 * (except for claims about who said what, see `attribution`).
 */
export const SourceUseSchema = z.enum(['evidence', 'context_only']);
export type SourceUse = z.infer<typeof SourceUseSchema>;

export const SourceCategorySchema = z.enum([
  'government',
  'education',
  'journal',
  'encyclopedia',
  'social_media',
  'blog_platform',
  'file_sharing',
  'state_media',
  'disinformation',
  'unreliable',
  'deprecated',
  'other',
]);
export type SourceCategory = z.infer<typeof SourceCategorySchema>;

export const PolicyOriginSchema = z.enum(['builtin', 'wikipedia_rsp', 'doaj', 'euvsdisinfo']);
export type PolicyOrigin = z.infer<typeof PolicyOriginSchema>;

export const SourcePolicySchema = z.object({
  tier: CredibilityTierSchema,
  use: SourceUseSchema,
  category: SourceCategorySchema,
  /**
   * The "who said what" exception. When the claim itself is about what this source's owner said,
   * wrote or published, a verified quotation counts as evidence that it was said, never that it is true.
   */
  attribution: z.boolean(),
  origin: PolicyOriginSchema,
  /**
   * A known state-owned or state-controlled media outlet. Independent of the tier: it says who owns the
   * outlet, not whether it is accurate. Missing means "not known to be", never "independent".
   */
  stateOwned: z.boolean().optional(),
  /** The rule id or matched host that produced this policy. */
  rule: z.string(),
  /** One plain sentence shown to the agents and in the interface. */
  note: z.string(),
});
export type SourcePolicy = z.infer<typeof SourcePolicySchema>;

const RANK: Record<CredibilityTier, number> = { low: 0, medium: 1, high: 2 };
export const lowerTier = (a: CredibilityTier, b: CredibilityTier): CredibilityTier => (RANK[a] <= RANK[b] ? a : b);

type PolicyLike = Pick<SourcePolicy, 'tier' | 'use' | 'attribution'> | null | undefined;

/** A context-only source that may speak for its own owner counts as evidence for a claim about what that owner said. */
export function isEvidenceGrade(policy: PolicyLike, attributionClaim: boolean): boolean {
  if (!policy || policy.use === 'evidence') return true;
  return attributionClaim && policy.attribution;
}

/**
 * The credibility used in decisions. The code-set tier is a ceiling and the model's rating can only lower it.
 * A site with no policy is capped at medium, so only a listed or rule-matched site can ever count as high.
 * For a claim about who said what, the owner's own account is a primary source of that fact: medium, not low.
 */
export function effectiveTier(policy: PolicyLike, modelRating: CredibilityTier | null | undefined, attributionClaim = false): CredibilityTier {
  let ceiling: CredibilityTier = policy?.tier ?? 'medium';
  if (policy && policy.use === 'context_only' && attributionClaim && policy.attribution) ceiling = 'medium';
  return modelRating ? lowerTier(ceiling, modelRating) : ceiling;
}

/** Lowercase host without `www.`, or null when the input is not a usable host name. */
export function normalizeHost(input: string): string | null {
  let host = input.trim().toLowerCase();
  if (!host) return null;
  if (host.includes('/') || host.includes(':')) {
    try {
      host = new URL(host.includes('://') ? host : `https://${host}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return null;
  if (/^\d+(\.\d+){3}$/.test(host)) return null; // IP addresses carry no reputation
  return host;
}
