import mongoose from 'mongoose';
import { config, isProd } from './config';
import { allModels } from './models';
import { logger } from './utils/logger';

let memoryServer: { stop: () => Promise<unknown>; getUri: () => string } | null = null;

export async function connectDb(uri = config.MONGODB_URI) {
  if (mongoose.connection.readyState === 1) return;
  let target = uri;
  if (uri === 'memory') {
    if (isProd) throw new Error('In-memory MongoDB is not allowed in production.');
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const srv = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
    memoryServer = srv;
    target = srv.getUri();
    logger.info('Using in-memory MongoDB for development/testing');
  }
  await mongoose.connect(target);
  await Promise.all(allModels.map((m) => m.createIndexes()));
}

export async function disconnectDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}
