// Per-frame depth for a clip, run as its own low-priority process (src/depth.js starts it). Every frame of
// the working copy goes through a monocular depth model (Depth Anything V2 Small, ONNX), then the frames
// are scaled to one shared range so the depth does not pump from frame to frame, and saved as small JPEGs
// named by frame number, the same way an uploaded depth video is stored (near = white).
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import ort from 'onnxruntime-node';
import sharp from 'sharp';

const { video, out, model, width, height, frames, short = 392, depthWidth = 360 } = JSON.parse(process.argv[2]);
const say = msg => process.stdout.write(`${JSON.stringify(msg)}\n`);
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

// The model takes sides that are multiples of 14; the shorter side is `short` pixels.
const k = short / Math.min(width, height);
const inW = Math.max(14, Math.round((width * k) / 14) * 14), inH = Math.max(14, Math.round((height * k) / 14) * 14);
const outW = depthWidth, outH = Math.max(2, Math.round((depthWidth * height) / width / 2) * 2);
const frameBytes = inW * inH * 3;
const name = n => `${String(n).padStart(5, '0')}`;

const session = await ort.InferenceSession.create(model, { executionProviders: ['cpu'], intraOpNumThreads: Math.max(1, availableParallelism() - 1), graphOptimizationLevel: 'all' });
const [input] = session.inputNames, [output] = session.outputNames;
await mkdir(out, { recursive: true });

// Frame N of the file is frame N of the clip: passthrough keeps every decoded frame.
const ffmpeg = spawn('ffmpeg', ['-v', 'error', '-nostdin', '-i', video, '-vf', `scale=${inW}:${inH}:flags=bicubic`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
let ffmpegError = '';
ffmpeg.stderr.on('data', d => { ffmpegError = (ffmpegError + d).slice(-400); });
const ffmpegDone = new Promise(resolve => ffmpeg.on('close', resolve));

const stats = [];
const pixels = new Float32Array(frameBytes);
let pending = Buffer.alloc(0), n = 0;
async function infer(rgb) {
  const plane = inW * inH;
  for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) pixels[c * plane + i] = (rgb[i * 3 + c] / 255 - MEAN[c]) / STD[c];
  const result = await session.run({ [input]: new ort.Tensor('float32', pixels, [1, 3, inH, inW]) });
  const depth = result[output], [dh, dw] = depth.dims.slice(-2), data = depth.data;
  let lo = Infinity, hi = -Infinity;
  for (const v of data) { if (v < lo) lo = v; if (v > hi) hi = v; }
  // The 2nd and 98th percentiles, from a sample: stray pixels do not set the range.
  const step = Math.max(1, Math.floor(data.length / 8192)), sample = [];
  for (let i = 0; i < data.length; i += step) sample.push(data[i]);
  sample.sort((a, b) => a - b);
  const p2 = sample[Math.floor(sample.length * 0.02)], p98 = sample[Math.floor(sample.length * 0.98)];
  // Kept as 8 bits over the frame's own full range until every frame's range is known.
  const span = hi - lo || 1, grey = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) grey[i] = Math.round(((data[i] - lo) / span) * 255);
  await sharp(grey, { raw: { width: dw, height: dh, channels: 1 } }).resize(outW, outH, { fit: 'fill' }).png({ compressionLevel: 1 }).toFile(join(out, `raw-${name(n)}.png`));
  stats.push({ lo, hi, p2, p98 });
  n++;
  if (n % 5 === 0 || n === frames) say({ frame: n });
}

for await (const chunk of ffmpeg.stdout) {
  pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
  while (pending.length >= frameBytes) {
    const frame = pending.subarray(0, frameBytes);
    pending = pending.subarray(frameBytes);
    await infer(frame); // the loop does not read on until this frame is done
  }
}
if ((await ffmpegDone) !== 0) throw new Error(`ffmpeg could not read the clip: ${ffmpegError.trim()}`);

// One range per frame, smoothed over half a second either side: the model's scale drifts a little from
// frame to frame, and this follows the drift without letting a single frame jump.
const HALF = 15;
for (let i = 0; i < n; i++) {
  let lo = 0, hi = 0, count = 0;
  for (let j = Math.max(0, i - HALF); j <= Math.min(n - 1, i + HALF); j++) { lo += stats[j].p2; hi += stats[j].p98; count++; }
  lo /= count; hi /= count;
  const s = stats[i], range = hi - lo || 1;
  // Stored value v stands for s.lo + v/255·(s.hi − s.lo); mapped so that lo → 0 and hi → 255.
  const a = (s.hi - s.lo) / range, b = (255 * (s.lo - lo)) / range;
  const raw = join(out, `raw-${name(i)}.png`);
  await sharp(raw).greyscale().linear(a, b).jpeg({ quality: 85 }).toFile(join(out, `${name(i)}.jpg`));
  await rm(raw);
}
say({ done: n, width: outW, height: outH });
