# AI agents

The system instructions are in `src/server/agents/prompts.ts`. They use only `{{PLACEHOLDERS}}` and contain no example topics. Output schemas are in `src/shared/agents.ts`.

Every call goes through `callStructured`, which does three things:

- validates the JSON output against the Zod schema;
- runs deterministic checks after the schema passes;
- allows exactly one repair retry that names the problem, then fails with `AI_OUTPUT_INVALID`.

Each claim-level call begins with the fixed TOPIC block. The output's `claimId`, `debateId` and `topicHash` are checked in code before anything else. No keyword-overlap relevance check exists, so valid reasoning that uses synonyms or translations is not rejected. The optional batched semantic check from PART 11.1 rule 4 is deliberately not implemented. The identifiers are pinned as single-value enums in the response schema and checked in code, so a mismatch is caught deterministically and repaired once. A semantic check would add a Gemini call to every step for little gain (PART 0.6).

Model names are set in `src/server/config.ts`. The `fast` model handles extraction, triage, research and the debate; the `judge` model is used only by the Judge. Temperature is 0 for extraction, triage and the Judge, and low for research.

| Agent | Module | Input | Output and checks |
|---|---|---|---|
| Content Extractor | `documents/extract.ts` | File bytes | Per-page text and status. PDF pages are read as native text; scanned pages and images go through Gemini OCR. Encrypted, corrupted and unreadable pages are recorded. |
| Quality and Citation Auditor | `handlers/audit.ts` | Document text | Candidate passages, which must appear verbatim in the document. Checks performed: Crossref lookup for DOIs, URL fetch, web search for books and papers, verbatim search for quotations. Fixed cautious labels are used. |
| Claim Extractor | `handlers/extractClaims.ts` | Document chunks | Atomic claims. `originalText` must appear verbatim in the document. Opinions, predictions and value judgments become `not_verifiable`. Ambiguity is flagged. Claims are deduplicated and ranked. |
| Triage | `handlers/triage.ts` | TOPIC | `complexityClass`, `timeSensitivity` and query languages. These set the budget and the debate mode. |
| Evidence Researcher | `handlers/research.ts` | TOPIC, fetched passages | Query plan in neutral, supporting and contradicting tracks. Per-source usability, verbatim excerpt (verified in code), layer B quality, provisional layer C relation, and whether the source repeats a primary source. |
| Defender / Prosecutor | `handlers/debate.ts` | TOPIC, evidence pool, persisted earlier steps | At most 3 arguments, each at most 2 sentences. Evidence assessments with verbatim quotes. Challenges must name existing opponent argument IDs. Every challenge must be answered. No minimum number of arguments. Each side is an advocate: before conceding it must look for reasonable readings of the claim (another period, sense of a term, scope, partial truth) that the evidence supports, and the Judge then decides which reading is the natural one for the claim as worded. Arguments without retrieved evidence are flagged `unsupported_assertion`. |
| Independent Judge | `handlers/judge.ts` | TOPIC, evidence with layers A, B and C, both sides in random order, unsupported assertions removed | The winner and verdict must match. `verdictBasis` must be consistent with the verdict. Every ID must exist, and decisive evidence must be `quote_verified`. Also produces the believability sections. |
| Pedagogue | `handlers/pedagogue.ts` | Decision, evidence, arguments, grade, language | Explanation, fallacies tied to real argument IDs, source-evaluation tips, and 1 to 3 exercises linked to real evidence IDs |

## Zero-hallucination contract

These rules are enforced in `validation/contract.ts` and in the handlers:

- **Unknown evidence IDs are rejected.**
- **URLs never come from the model.** A URL is accepted only from grounding metadata, a server-fetched page, or the trusted-sources registry.
- **Only text found verbatim in fetched content is called an excerpt.** Snippets are labelled "Search snippet (not a verified quotation)".
- **Research fails closed.** Zero `quote_verified` evidence makes the claim `research_failed`, with no verdict.
- **User documents and web pages are untrusted.** They are wrapped in `UNTRUSTED` blocks with unforgeable delimiters, and the agents are told to ignore instructions inside them.

## Research budget

The budget table is `RESEARCH_BUDGETS` in `config.ts`. The research loop works as follows:

1. Plan 3 to 6 queries and run grounded searches. Searches go through `searchCache`.
2. Fetch the chosen results, balancing the tracks and keeping at most 2 sources per domain. Pages go through `pageCache`.
3. Assess the sources in batches and verify the excerpts.
4. In `research_refine`, stop when direct, credible, independent evidence meets the target. Otherwise run another round with the remaining budget. Targets never force invented sources.
