import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  /** "memory" starts a throw-away in-memory MongoDB (dev only). */
  MONGODB_URI: z.string().default('memory'),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me-please'),
  PUBLIC_URL: z.string().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('*'),
  ADMIN_EMAIL: z.string().default('admin@hearcare.local'),
  ADMIN_PASSWORD: z.string().default('ChangeMe123!'),
  ADMIN_NAME: z.string().default('HearCare Admin'),
  SMS_PROVIDER: z.enum(['console', 'africastalking', 'beem']).default('console'),
  SMS_SENDER_ID: z.string().default('HearCare'),
  AT_USERNAME: z.string().default('sandbox'),
  AT_API_KEY: z.string().default(''),
  BEEM_API_KEY: z.string().default(''),
  BEEM_SECRET: z.string().default(''),
  SMS_REMINDERS: bool.default('true'),
  /** App-store reviewer login (optional): this phone always accepts this code. */
  REVIEW_PHONE: z.string().default(''),
  REVIEW_OTP: z.string().default(''),
  MIN_APP_VERSION: z.string().default('1.0.0'),
  MAINTENANCE_MODE: bool.default('false'),
  MAINTENANCE_MESSAGE: z.string().default('We are improving HearCare. Please try again soon.'),
  SUPPORT_PHONE: z.string().default('+255700000000'),
  SUPPORT_WHATSAPP: z.string().default('+255700000000'),
  RUN_JOBS: bool.default('true'),
  SEED_DEMO: bool.default('false'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';

if (isProd && config.JWT_SECRET.startsWith('dev-only')) {
  // eslint-disable-next-line no-console
  console.error('JWT_SECRET must be set in production.');
  process.exit(1);
}
