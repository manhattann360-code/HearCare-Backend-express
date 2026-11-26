import { config } from './config';
import { connectDb, disconnectDb } from './db';
import { createApp } from './app';
import { ensureAdmin } from './services/auth';
import { seedBase, seedDemo } from './seeds/data';
import { startReminderJob, stopReminderJob } from './jobs/reminders';
import { logger } from './utils/logger';

async function boot() {
  await connectDb();
  await ensureAdmin();
  await seedBase();
  if (config.SEED_DEMO || config.MONGODB_URI === 'memory') {
    await seedDemo();
  }

  startReminderJob();

  const app = createApp();
  const server = app.listen(config.PORT, '0.0.0.0', () => {
    logger.info(`HearCare API listening on 0.0.0.0:${config.PORT} (public: ${config.PUBLIC_URL})`);
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    stopReminderJob();
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

boot().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('\n❌ FATAL: Server failed to start due to runtime error:\n', err);
  logger.error({ err }, 'Server failed to start');
  process.exit(1);
});
