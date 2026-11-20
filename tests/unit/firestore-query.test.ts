// Production Firestore rejects filter+order queries until the composite index
// exists (the emulator does not), which made list pages return 500 on deploy.
import { describe, expect, it } from 'vitest';
import { orderedQuery, isMissingIndex } from '../../src/server/firestoreQuery';

const rows = [
  { id: 'a', startedAtMs: 1 },
  { id: 'b', startedAtMs: 3 },
  { id: 'c', startedAtMs: 2 },
];

/** Minimal stand-in for a Firestore Query that fails like production without an index. */
function fakeQuery(missingIndex: boolean): any {
  const make = (st: { ordered: boolean; after?: number; limit?: number }): any => ({
    where: () => make(st),
    orderBy: () => make({ ...st, ordered: true }),
    startAfter: (v: number) => make({ ...st, after: v }),
    limit: (n: number) => make({ ...st, limit: n }),
    get: async () => {
      if (st.ordered && missingIndex) {
        throw Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/x/firestore/indexes?create_composite=abc'), { code: 9 });
      }
      let out = [...rows];
      if (st.ordered) out.sort((a, b) => b.startedAtMs - a.startedAtMs);
      if (st.ordered && st.after !== undefined) out = out.filter((r) => r.startedAtMs < st.after!);
      return { docs: out.slice(0, st.limit ?? out.length).map((r) => ({ data: () => r })) };
    },
  });
  return make({ ordered: false });
}

describe('orderedQuery', () => {
  it('uses the indexed query when the index exists', async () => {
    const out = await orderedQuery({ name: 't1', base: fakeQuery(false), orderBy: 'startedAtMs', direction: 'desc', limit: 2 });
    expect(out.map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('falls back to an in-memory sort with the same order and cursor when the index is missing', async () => {
    const out = await orderedQuery({ name: 't2', base: fakeQuery(true), orderBy: 'startedAtMs', direction: 'desc', limit: 2 });
    expect(out.map((r) => r.id)).toEqual(['b', 'c']);
    const page2 = await orderedQuery({ name: 't2', base: fakeQuery(true), orderBy: 'startedAtMs', direction: 'desc', limit: 2, after: 2 });
    expect(page2.map((r) => r.id)).toEqual(['a']);
    const asc = await orderedQuery({ name: 't3', base: fakeQuery(true), orderBy: 'startedAtMs', direction: 'asc', limit: 5, after: 1 });
    expect(asc.map((r) => r.id)).toEqual(['c', 'b']);
  });

  it('recognises the missing-index error and nothing else', () => {
    expect(isMissingIndex({ code: 9 })).toBe(true);
    expect(isMissingIndex(new Error('The query requires an index'))).toBe(true);
    expect(isMissingIndex(new Error('permission denied'))).toBe(false);
  });
});
