// PDF.js (via unpdf) uses Promise.try, which older Node versions lack.
const P = Promise as unknown as { try?: (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => Promise<unknown> };
if (typeof P.try !== 'function') {
  P.try = (fn, ...args) => new Promise((resolve) => resolve(fn(...args)));
}
export {};
