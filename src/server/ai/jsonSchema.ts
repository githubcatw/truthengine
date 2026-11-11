// Converts the shared Zod schemas to a conservative JSON Schema for Gemini's
// responseJsonSchema, so the model is told every field name and enum value.
// Zod remains the authority: the output is still validated in code.
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const KEEP = new Set(['type', 'properties', 'required', 'items', 'enum', 'description', 'minItems', 'maxItems', 'minimum', 'maximum', 'anyOf']);

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!node || typeof node !== 'object') return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // Limits the API may not accept as keywords are kept as plain-language hints.
  const hints = [
    typeof src.maxLength === 'number' ? `at most ${src.maxLength} characters` : null,
    typeof src.pattern === 'string' ? `must match ${src.pattern}` : null,
  ].filter(Boolean);
  if (hints.length) out.description = [src.description, ...hints].filter(Boolean).join('; ');
  for (const [k, v] of Object.entries(src)) {
    if (k === 'description' && out.description) continue;
    if (!KEEP.has(k)) continue;
    if (k === 'properties') {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, sanitize(pv)]));
    } else out[k] = sanitize(v);
  }
  return out;
}

/** `pins` force exact values (topic-lock identifiers) through a single-value enum. */
export function toResponseSchema(schema: z.ZodTypeAny, pins: Record<string, string> = {}): Record<string, unknown> {
  const json = sanitize(zodToJsonSchema(schema, { $refStrategy: 'none' })) as { properties?: Record<string, unknown> };
  for (const [k, v] of Object.entries(pins)) if (json.properties?.[k]) json.properties[k] = { type: 'string', enum: [v] };
  return json as Record<string, unknown>;
}
