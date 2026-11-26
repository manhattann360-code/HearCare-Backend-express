import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config, isTest } from './config';
import { logger } from './utils/logger';
import { errorHandler, notFoundHandler } from './middleware';
import { mediaRouter, publicRouter } from './routes/public';
import { adminRouter } from './routes/admin';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  const origins =
    config.CORS_ORIGINS === '*'
      ? '*'
      : config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: origins, credentials: false }));

  if (!isTest) {
    app.use(pinoHttp({ logger }));
  }

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'hearcare-backend', time: new Date().toISOString() });
  });

  app.use('/media', mediaRouter);
  app.use('/api/v1', publicRouter);
  app.use('/api/v1/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
