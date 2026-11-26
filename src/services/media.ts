import mongoose from 'mongoose';
import sharp from 'sharp';
import { Readable } from 'node:stream';
import { config } from '../config';
import { AppError } from '../utils/errors';

function bucket() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database not connected');
  return new mongoose.mongo.GridFSBucket(db, { bucketName: 'media' });
}

/** Resize + convert to WebP and store in MongoDB GridFS (no external storage needed). */
export async function saveImage(buffer: Buffer, filename = 'image'): Promise<{ id: string; url: string }> {
  let out: Buffer;
  try {
    out = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'That file is not a valid picture. Please use JPG, PNG or WebP.');
  }
  const id = await new Promise<mongoose.mongo.ObjectId>((resolve, reject) => {
    const up = bucket().openUploadStream(filename.replace(/\.[^.]+$/, '') + '.webp', {
      metadata: { contentType: 'image/webp' },
    });
    up.on('error', reject);
    up.on('finish', () => resolve(up.id as mongoose.mongo.ObjectId));
    Readable.from(out).pipe(up);
  });
  return { id: String(id), url: `${config.PUBLIC_URL.replace(/\/$/, '')}/media/${id}` };
}

export async function streamImage(id: string) {
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  const oid = new mongoose.mongo.ObjectId(id);
  const files = await bucket().find({ _id: oid }).limit(1).toArray();
  if (!files.length) return null;
  return { stream: bucket().openDownloadStream(oid), length: files[0].length };
}
