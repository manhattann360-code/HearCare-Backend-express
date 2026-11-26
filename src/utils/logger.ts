import pino from 'pino';
import { config, isTest } from '../config';

export const logger = pino({
  level: isTest ? 'silent' : 'info',
  ...(config.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
    : {}),
  redact: ['req.headers.authorization'],
});
