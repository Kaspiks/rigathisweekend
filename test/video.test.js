import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { frameWriter, flatten } from '../src/video.js';
import { stateAt, TIMING } from '../src/envelope.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('flatten blends straight alpha onto the background colour', () => {
  const out = flatten(Buffer.from([255, 0, 0, 255, 255, 0, 0, 0, 255, 255, 255, 128]), [0, 0, 255]);
  assert.deepEqual([...out], [255, 0, 0, 255, 0, 0, 255, 255, 128, 128, 255, 255]);
});

test('frameWriter encodes RGBA frames to mp4 and transparent webm', { skip: !hasFfmpeg && 'ffmpeg not installed' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'riga-video-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const size = { width: 16, height: 16, fps: 10 };
  const mp4 = frameWriter({ ...size, out: join(dir, 'a.mp4'), preset: 'mp4' });
  const webm = frameWriter({ ...size, out: join(dir, 'a.webm'), preset: 'webm' });
  await assert.rejects(mp4.write(Buffer.alloc(10)), /size/);
  for (let i = 0; i < 5; i++) { const f = Buffer.alloc(16 * 16 * 4, i * 40); await mp4.write(flatten(f, [0, 0, 0])); await webm.write(f); }
  await Promise.all([mp4.end(), webm.end()]);
  assert.ok((await stat(join(dir, 'a.mp4'))).size > 0);
  assert.ok((await stat(join(dir, 'a.webm'))).size > 0);
});

test('envelope timeline starts closed and ends with the card out and still', () => {
  assert.equal(stateAt(0).angle, 0);
  assert.equal(stateAt(TIMING.flap[1]).angle, Math.PI);
  assert.equal(stateAt(TIMING.card[1]).cardTop, stateAt(TIMING.duration).cardTop);
  assert.ok(stateAt(TIMING.card[0]).cardTop > stateAt(TIMING.card[1]).cardTop);
});
