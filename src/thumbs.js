// Small copies of rendered slides for the review page. The dashboard showed full 1080-wide JPEGs for
// every event of every edition, which is tens of megabytes a visit; these are ~40× smaller and cached.
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const THUMB_W = 360;
export const THUMBABLE = /^(feed|story|cover|photo|grid)-[A-Za-z0-9#._-]+\.(jpg|png)$/;

// Built on first request and kept next to the media, so later visits are a plain static read.
export async function ensureThumb(dir, editionId, file) {
  if (!/^[a-f0-9]{24}$/.test(editionId) || !THUMBABLE.test(file)) throw new Error('Not a thumbnail');
  const source = join(dir, 'media', editionId, file);
  if (!existsSync(source)) throw Object.assign(new Error('No such image'), { code: 'ENOENT' });
  const out = join(dir, 'thumbs', editionId, `${file.replace(/\.(jpg|png)$/, '')}.jpg`);
  if (existsSync(out)) return out;
  await mkdir(join(dir, 'thumbs', editionId), { recursive: true });
  const tmp = `${out}.${process.pid}.tmp`;
  await sharp(source).resize(THUMB_W).jpeg({ quality: 72, progressive: true }).toFile(tmp);
  await rename(tmp, out);
  return out;
}
