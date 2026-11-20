import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { USAGE_LIMITS } from './config';
import { AppError } from './errors';

export const handler =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).then(
      (body) => {
        if (!res.headersSent) res.json(body ?? { ok: true });
      },
      next,
    );
  };

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
      .join('; ');
    throw new AppError('INVALID_INPUT', `Invalid input — ${msg}`);
  }
  return r.data;
}

/** Simple fixed-window rate limiter per user (or IP before auth). In-memory: a burst guard, not a datastore. */
const windows = new Map<string, { start: number; count: number }>();
export function rateLimit(req: Request, _res: Response, next: NextFunction) {
  const key = req.user?.uid ?? req.ip ?? 'anon';
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > 60_000) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 50_000) windows.clear();
    return next();
  }
  w.count++;
  if (w.count > USAGE_LIMITS.requestsPerMinute) return next(new AppError('RATE_LIMITED', 'Too many requests. Please wait a moment.'));
  next();
}
