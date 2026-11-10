import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { readGeminiKey } from './config';
import { AppError } from './errors';
import { firebaseStatus, storageStatus } from './firebase';
import { log } from './logger';
import type { SetupStatus } from '../shared/schemas';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

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

  app.use('/api', (_req, _res, next) => next(new AppError('NOT_FOUND', 'Not found.')));

  if (process.env.NODE_ENV === 'production') {
    const dist = path.resolve(process.cwd(), 'dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // Consistent, safe error responses: internal detail is logged (redacted), never returned.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      if (err.status >= 500) log.warn('request failed', { path: req.path, code: err.code });
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    log.error('unhandled error', { path: req.path, name: (err as Error)?.name });
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server.' } });
  });

  return app;
}
