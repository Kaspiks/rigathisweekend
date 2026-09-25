// Depth made on this server, so ChatGPT does not need a depth model in its sandbox. The model is Depth
// Anything V2 Small (Apache-2.0), about 100 MB as ONNX, fetched once from Hugging Face on first use and
// kept under the data folder; DEPTH_MODEL points at a copy you placed yourself instead. The work runs in a
// separate low-priority process (src/depth-worker.js) so the dashboard and ChatGPT stay responsive.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { setPriority } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { depthFrameName } from './footage.js';

const fail = (message, httpStatus = 400) => Object.assign(new Error(message), { httpStatus });
export const DEPTH_MODEL_URL = 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx';
const MAX_MODEL_BYTES = 500 * 1048576;
const WORKER = join(dirname(fileURLToPath(import.meta.url)), 'depth-worker.js');

export const depthLimits = env => ({ seconds: Number(env.DEPTH_MAX_SECONDS) || 120, detail: Math.min(770, Math.max(196, Number(env.DEPTH_DETAIL) || 392)) });

// The model file, downloaded once. Several requests at once share one download.
let downloading = null;
export function depthModel(dataDir, env = process.env) {
  if (env.DEPTH_MODEL) {
    if (!existsSync(env.DEPTH_MODEL)) return Promise.reject(fail(`DEPTH_MODEL points to ${env.DEPTH_MODEL}, which does not exist`, 500));
    return Promise.resolve(env.DEPTH_MODEL);
  }
  const file = join(dataDir, 'models', 'depth-anything-v2-small.onnx');
  if (existsSync(file)) return Promise.resolve(file);
  downloading ??= (async () => {
    await mkdir(dirname(file), { recursive: true });
    const res = await fetch(env.DEPTH_MODEL_URL || DEPTH_MODEL_URL, { signal: AbortSignal.timeout(15 * 60000) });
    if (!res.ok || !res.body) throw new Error(`Could not download the depth model (HTTP ${res.status})`);
    let size = 0;
    const cap = new Transform({ transform(chunk, _enc, done) { size += chunk.length; done(size > MAX_MODEL_BYTES ? new Error('The depth model download is larger than expected') : null, chunk); } });
    const part = `${file}.part`;
    try {
      await pipeline(Readable.fromWeb(res.body), cap, createWriteStream(part));
      if ((await stat(part)).size < 1048576) throw new Error('The depth model download is too small; it is not the model');
      await rename(part, file);
    } catch (err) { await rm(part, { force: true }); throw new Error(`Could not download the depth model: ${err.message}`); }
    return file;
  })().finally(() => { downloading = null; });
  return downloading;
}

// Runs the model over every frame of the working copy into `folder` (replacing what was there only once
// every frame is done). onProgress gets 0–1; `detail` is the shorter side the model sees (a multiple of 14 is best). Returns what importDepth returns for an uploaded video.
export async function makeDepth(video, folder, work, model, { onProgress, detail = 392, timeoutMs = 4 * 60 * 60000 } = {}) {
  const part = `${folder}.part`;
  await rm(part, { recursive: true, force: true });
  const job = { video, out: part, model, width: work.width, height: work.height, frames: work.frames, short: detail };
  let done = null;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [WORKER, JSON.stringify(job)], { stdio: ['ignore', 'pipe', 'pipe'] });
      if (child.pid) try { setPriority(child.pid, 15); } catch {}
      let pending = '', err = '';
      child.stdout.on('data', d => {
        pending += d;
        const lines = pending.split('\n'); pending = lines.pop();
        for (const line of lines) {
          let msg; try { msg = JSON.parse(line); } catch { continue; }
          if (msg.frame) onProgress?.(Math.min(0.99, msg.frame / work.frames));
          if (msg.done != null) done = msg;
        }
      });
      child.stderr.on('data', d => { err = (err + d).slice(-2000); });
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.on('error', e => { clearTimeout(timer); reject(e); });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (code === 0 && done) return resolve();
        const why = err.split('\n').map(l => l.trim()).filter(l => /error/i.test(l)).pop() || err.trim().split('\n').pop() || '';
        reject(new Error(signal === 'SIGKILL' ? 'Making depth took too long' : `Making depth failed${why ? `: ${why.slice(0, 300)}` : ''}`));
      });
    });
    if (Math.abs(done.done - work.frames) > 1) throw new Error(`Depth came out with ${done.done} frames for a clip of ${work.frames}`);
  } catch (err) { await rm(part, { recursive: true, force: true }); throw err; }
  await rm(folder, { recursive: true, force: true });
  await rename(part, folder);
  const first = await sharp(join(folder, depthFrameName(0))).metadata();
  return { frames: Math.min(done.done, work.frames), width: first.width, height: first.height, updated: new Date().toISOString(), source: 'server' };
}

// A rough guess of how long it takes, to tell the person waiting: under a second a frame on 4 cores.
export const depthEstimateSeconds = frames => Math.round(frames * 0.8 + 30);
