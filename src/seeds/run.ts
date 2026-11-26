import { connectDb, disconnectDb } from '../db';
import { seedBase, seedDemo } from './data';
import { logger } from '../utils/logger';

async function main() {
  const mode = process.argv[2] === 'demo' ? 'demo' : 'base';
  await connectDb();
  if (mode === 'demo') {
    await seedDemo();
    logger.info('Seeded base + demo data');
  } else {
    await seedBase();
    logger.info('Seeded base catalog & admin');
  }
  await disconnectDb();
}

main().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
