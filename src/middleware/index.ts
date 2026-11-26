import { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { ZodSchema, ZodError } from 'zod';
import { config, isProd, isTest } from '../config';
import { AppError, unauthorized, badRequest } from '../utils/errors';
import { logger } from '../utils/logger';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
    adminId?: string;
  }
}

export function signAccess(userId: string) {
  return jwt.sign({ sub: userId, typ: 'patient' }, config.JWT_SECRET, { expiresIn: '15m' });
}
export function signAdmin(adminId: string) {
  return jwt.sign({ sub: adminId, typ: 'admin' }, config.JWT_SECRET, { expiresIn: '12h' });
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

function verify(token: string, typ: 'patient' | 'admin'): string {
  try {
    const p = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload;
    if (p.typ !== typ || !p.sub) throw new Error('wrong type');
    return String(p.sub);
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
}

export const requireUser: RequestHandler = (req, _res, next) => {
  const t = bearer(req);
  if (!t) throw unauthorized();
  req.userId = verify(t, 'patient');
  next();
};

export const optionalUser: RequestHandler = (req, _res, next) => {
  const t = bearer(req);
  if (t) {
    try {
      req.userId = verify(t, 'patient');
    } catch {
      /* ignore invalid token for optional routes */
    }
  }
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  const t = bearer(req);
  if (!t) throw unauthorized();
  req.adminId = verify(t, 'admin');
  next();
};

/** Validate and replace req.body / req.query with the parsed value. */
export const validate =
  (schema: ZodSchema, where: 'body' | 'query' = 'body'): RequestHandler =>
  (req, _res, next) => {
    const r = schema.safeParse(req[where]);
    if (!r.success) throw zodToError(r.error);
    if (where === 'body') req.body = r.data;
    else (req as any).parsedQuery = r.data;
    next();
  };

export function zodToError(e: ZodError): AppError {
  const issues = e.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  const first = issues[0];
  return badRequest(
    first ? `${first.field ? first.field + ': ' : ''}${first.message}` : 'Invalid input',
    issues,
  );
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) err = zodToError(err);
  if (err instanceof AppError) {
    return res
      .status(err.status)
      .json({ error: { code: err.code, message: err.message, details: err.details ?? {} } });
  }
  if (err?.name === 'MulterError') {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large.' : 'Upload failed.',
        details: {},
      },
    });
  }
  if (err?.name === 'CastError') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found', details: {} } });
  }
  if (!isTest) logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: isProd ? 'Something went wrong. Please try again.' : String(err?.message ?? err),
      details: {},
    },
  });
}
