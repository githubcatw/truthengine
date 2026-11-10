import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { readGeminiKey } from './config';
import { AppError } from './errors';
import { firebaseStatus, storageStatus } from './firebase';
import { log } from './logger';
import { claimsRouter } from './routes/claims';
import { classroomsRouter } from './routes/classrooms';
import { filesRouter } from './routes/files';
import { learningRouter } from './routes/learning';
import { meRouter } from './routes/me';
import { platformRouter } from './routes/platform';
import { reportsRouter } from './routes/reports';
import { verificationsRouter } from './routes/verifications';
import type { SetupStatus } from '../shared/schemas';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // CORS: same origin by default; extra origins only if configured.
  const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-File-Name');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use('/api', express.json({ limit: '1mb' }));

  // Reports only whether each service is configured — never a key or credential.
  app.get('/api/setup-status', (_req, res) => {
    const status: SetupStatus = {
      gemini: readGeminiKey()
        ? { configured: true, message: null }
        : { configured: false, message: 'The Gemini API key is not configured. Add GEMINI_API_KEY to the server Secrets.' },
      firebase: firebaseStatus(),
      storage: storageStatus(),
    };
    res.json(status);
  });

  app.use('/api/me', meRouter);
  app.use('/api/verifications', verificationsRouter);
  app.use('/api/claims', claimsRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api', learningRouter, classroomsRouter, platformRouter);

  app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', 'Not found.')));

  if (process.env.NODE_ENV === 'production') {
    const dist = path.resolve(process.cwd(), process.env.STATIC_DIR || 'dist');
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // Consistent, safe error responses: internal detail is logged (redacted), never returned.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      if (err.status >= 500) log.warn('request failed', { path: req.path, code: err.code });
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if ((err as { type?: string })?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'INVALID_INPUT', message: 'The request is too large.' } });
      return;
    }
    if ((err as { type?: string })?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Malformed JSON.' } });
      return;
    }
    log.error('unhandled error', { path: req.path, name: (err as Error)?.name });
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server.' } });
  });

  return app;
}
