// Your own footage for animated edits. A clip is uploaded on the dashboard, checked with ffprobe and
// copied into a 30 fps working file, so a frame number means the same frame on a contact sheet, in an
// edit and in the render. Nothing here reaches the internet: ffmpeg only reads files on the data volume.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setPriority } from 'node:os';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';

export const FPS = 30;
export const FOOTAGE_ID = /^[a-f0-9]{24}$/;
export const newFootageId = () => randomBytes(12).toString('hex');
export const footageDir = (dir, id) => {
  if (!FOOTAGE_ID.test(id || '')) throw new Error('Unknown footage');
  return join(dir, 'footage', id);
};
export const footageFiles = (dir, id) => {
  const base = footageDir(dir, id);
  return { dir: base, source: join(base, 'source'), work: join(base, 'work.mp4'), poster: join(base, 'poster.jpg'), assets: join(base, 'assets'), renders: join(base, 'renders'), depth: join(base, 'depth'), models: join(base, 'models') };
};
// Limits can be raised in .env; the defaults suit phone clips on a 4 vCPU server without a GPU.
export const limits = (env = process.env) => ({
  bytes: Math.max(1, Number(env.FOOTAGE_MAX_MB) || 1024) * 1048576,
  seconds: Math.max(1, Number(env.FOOTAGE_MAX_SECONDS) || 600),
});
const fail = (message, httpStatus = 400) => Object.assign(new Error(message), { httpStatus });

export const cleanName = name => String(name || '').normalize('NFC').replace(/[^\p{L}\p{N} ._()'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'clip';

// Streams the request body to disk. Express's parsers would hold a whole video in memory.
export async function receive(req, file, maxBytes) {
  const declared = Number(req.headers['content-length']);
  if (declared > maxBytes) throw fail(`That file is too large; keep footage under ${Math.round(maxBytes / 1048576)} MB`, 413);
  let seen = 0;
  const cap = new Transform({
    transform(chunk, _enc, done) {
      seen += chunk.length;
      if (seen > maxBytes) return done(fail(`That file is too large; keep footage under ${Math.round(maxBytes / 1048576)} MB`, 413));
      done(null, chunk);
    },
  });
  try {
    await pipeline(req, cap, createWriteStream(file));
  } catch (err) {
    await rm(file, { force: true });
    throw err.httpStatus ? err : fail('The upload was interrupted; try again');
  }
  if (!seen) { await rm(file, { force: true }); throw fail('Choose a video to upload'); }
  return seen;
}

// Runs ffmpeg or ffprobe and collects stdout. `onLine` sees stdout line by line (for -progress).
function run(bin, args, { onLine, timeoutMs = 120000, nice = false, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    // Long jobs run at a lower priority, so the dashboard stays responsive while a clip is processed.
    // No pid means ffmpeg did not start, and setPriority without one would slow this process instead.
    if (nice && child.pid) try { setPriority(child.pid, 10); } catch {}
    const out = [], err = [];
    let pending = '';
    child.stdout.on('data', d => {
      if (binary || !onLine) out.push(d);
      if (onLine) { pending += d; const lines = pending.split('\n'); pending = lines.pop(); lines.forEach(onLine); }
    });
    child.stderr.on('data', d => { if (err.length < 64) err.push(d); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', e => { clearTimeout(timer); reject(e.code === 'ENOENT' ? new Error(`${bin} is not installed`) : e); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve(Buffer.concat(out));
      const detail = Buffer.concat(err).toString().trim().split('\n').slice(-3).join(' ');
      reject(new Error(signal === 'SIGKILL' ? `${bin} took too long` : `${bin} failed${detail ? `: ${detail}` : ''}`));
    });
  });
}

export async function probe(file) {
  const out = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).catch(() => null);
  if (!out) throw fail('That file is not a video this server can read. Export it as MP4 or MOV and try again');
  return JSON.parse(out.toString());
}

// What matters about a clip, from ffprobe's JSON. Sizes are as displayed: a phone clip stored sideways
// with a rotation flag is reported upright, the way ffmpeg will decode it.
export function describe(probed) {
  const video = (probed.streams || []).find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video) throw fail('That file has no video track');
  const audio = (probed.streams || []).some(s => s.codec_type === 'audio');
  const matrix = (video.side_data_list || []).find(d => d.rotation != null);
  const rotation = ((Math.round(Number(matrix?.rotation ?? video.tags?.rotate ?? 0)) % 360) + 360) % 360;
  const sideways = rotation === 90 || rotation === 270;
  const rate = s => { const [a, b] = String(s || '0/1').split('/').map(Number); return b ? a / b : 0; };
  const duration = Number(probed.format?.duration || video.duration || 0);
  const width = sideways ? video.height : video.width, height = sideways ? video.width : video.height;
  if (!width || !height || !(duration > 0)) throw fail('That video has no readable frames');
  return {
    width, height, rotation, duration: Math.round(duration * 1000) / 1000,
    fps: Math.round((rate(video.avg_frame_rate) || rate(video.r_frame_rate)) * 100) / 100,
    codec: video.codec_name || null, audio,
    // HLG and PQ are what phones record as HDR; without tone mapping they look grey and flat in H.264.
    hdr: ['smpte2084', 'arib-std-b67'].includes(video.color_transfer),
  };
}

let filters = null;
const hasFilter = async name => {
  filters ??= run('ffmpeg', ['-hide_banner', '-filters']).then(b => b.toString()).catch(() => '');
  return new RegExp(`\\s${name}\\s`).test(await filters);
};

// The working copy: H.264 at a constant 30 fps, upright, at most 1080×1920 (or 1920×1080), SDR, with
// stereo AAC when the clip has sound. Every later step reads this file, never the original.
export async function transcode(source, out, info, { onProgress = () => {}, timeoutMs = 60 * 60000 } = {}) {
  const [bw, bh] = info.width >= info.height ? [1920, 1080] : [1080, 1920];
  const tonemap = info.hdr && await hasFilter('zscale') && await hasFilter('tonemap')
    ? 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,' : '';
  const vf = `${tonemap}scale=w='min(iw,${bw})':h='min(ih,${bh})':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=${FPS},format=yuv420p`;
  const part = `${out}.part.mp4`;
  let last = 0;
  await run('ffmpeg', ['-y', '-v', 'error', '-nostdin', '-progress', 'pipe:1', '-i', source, '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', String(FPS), '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000',
    '-map_metadata', '-1', '-movflags', '+faststart', part], {
    nice: true, timeoutMs,
    onLine: line => {
      const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
      if (!m || Date.now() - last < 2000) return;
      last = Date.now();
      onProgress(Math.min(0.99, Number(m[1]) / 1e6 / info.duration));
    },
  }).catch(async err => { await rm(part, { force: true }); throw err; });
  await rename(part, out);
  const probed = await probe(out);
  const video = probed.streams.find(s => s.codec_type === 'video');
  const duration = Number(probed.format.duration || video.duration);
  return {
    width: video.width, height: video.height, fps: FPS,
    frames: Number(video.nb_frames) || Math.round(duration * FPS),
    duration: Math.round(duration * 1000) / 1000,
    audio: probed.streams.some(s => s.codec_type === 'audio'),
    size: (await stat(out)).size,
  };
}

// One frame of the working copy as JPEG. Seeking to half a frame before the one wanted lands exactly on
// it: ffmpeg decodes from the previous keyframe and drops everything earlier than the seek point.
export function grabFrame(work, frame, { width = null } = {}) {
  const at = Math.max(0, (frame - 0.5) / FPS).toFixed(4);
  return run('ffmpeg', ['-v', 'error', '-nostdin', '-ss', at, '-i', work, '-frames:v', '1', '-an', ...(width ? ['-vf', `scale=${width}:-2`] : []), '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '2', '-'], { binary: true, timeoutMs: 60000 });
}

export async function writePoster(work, out, frames) {
  await sharp(await grabFrame(work, Math.min(FPS, Math.floor(frames / 2)), { width: 360 })).jpeg({ quality: 78 }).toFile(out);
}

// Seconds with two decimals, the way the sheets print them.
export const secondsOf = frame => Math.round((frame / FPS) * 100) / 100;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function mapLimit(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

// Images side by side with a caption strip under each one: what a vision model reads to find moments
// and check a render. `cells` holds { image: Buffer, label: string }.
export async function contactSheet(cells, { portrait = true } = {}) {
  const columns = portrait ? Math.min(4, cells.length) : Math.min(3, cells.length);
  const cw = portrait ? 300 : 420, strip = 34, gap = 6;
  const images = await mapLimit(cells, 4, async c => {
    const img = await sharp(c.image).resize({ width: cw }).jpeg().toBuffer({ resolveWithObject: true });
    return { ...c, buffer: img.data, height: img.info.height };
  });
  const ch = Math.max(...images.map(i => i.height));
  const rows = Math.ceil(images.length / columns);
  const width = columns * cw + (columns + 1) * gap, height = rows * (ch + strip) + (rows + 1) * gap;
  const layers = images.flatMap((img, i) => {
    const left = gap + (i % columns) * (cw + gap), top = gap + Math.floor(i / columns) * (ch + strip + gap);
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${strip}"><rect width="100%" height="100%" fill="#17352d"/><text x="10" y="23" font-family="DejaVu Sans,Arial,sans-serif" font-size="17" font-weight="bold" fill="#d4ed86">${esc(img.label)}</text></svg>`);
    return [{ input: img.buffer, left, top }, { input: label, left, top: top + ch }];
  });
  return sharp({ create: { width, height, channels: 3, background: '#0f241e' } }).composite(layers).jpeg({ quality: 82 }).toBuffer();
}

export async function sampleSheet(work, frames, { portrait = true } = {}) {
  const cells = await mapLimit(frames, 4, async (frame, i) => ({ image: await grabFrame(work, frame, { width: portrait ? 600 : 840 }), label: `#${i + 1} · f${frame} · ${secondsOf(frame).toFixed(2)}s` }));
  return contactSheet(cells, { portrait });
}

// A single frame with a coordinate grid, for placing things precisely: x and y run 0–1 across the whole
// frame, whatever part of it is shown. `region` zooms into part of the frame (all values 0–1).
export async function frameWithGrid(work, frame, { region = null, grid = true, longSide = 1080 } = {}) {
  const full = await grabFrame(work, frame);
  const meta = await sharp(full).metadata();
  const r = region || { x: 0, y: 0, width: 1, height: 1 }, digits = region ? 3 : 1;
  const box = {
    left: Math.min(meta.width - 8, Math.max(0, Math.round(r.x * meta.width))), top: Math.min(meta.height - 8, Math.max(0, Math.round(r.y * meta.height))),
    width: Math.max(8, Math.round(r.width * meta.width)), height: Math.max(8, Math.round(r.height * meta.height)),
  };
  box.width = Math.min(box.width, meta.width - box.left); box.height = Math.min(box.height, meta.height - box.top);
  const scale = longSide / Math.max(box.width, box.height);
  const w = Math.round(box.width * scale), h = Math.round(box.height * scale);
  let img = sharp(full).extract(box).resize(w, h);
  if (grid) {
    // Ten divisions across the part shown, labelled in whole-frame coordinates.
    const lines = [];
    const x0 = box.left / meta.width, y0 = box.top / meta.height, xs = box.width / meta.width, ys = box.height / meta.height;
    for (let k = 1; k < 10; k++) {
      const x = Math.round((k / 10) * w), y = Math.round((k / 10) * h);
      const major = k === 5;
      for (const [attr, pos] of [['x', x], ['y', y]]) {
        const d = attr === 'x' ? `M${pos},0V${h}` : `M0,${pos}H${w}`;
        lines.push(`<path d="${d}" stroke="#000" stroke-opacity=".45" stroke-width="${major ? 4 : 3}"/><path d="${d}" stroke="#fff" stroke-opacity=".8" stroke-width="${major ? 2 : 1}"/>`);
      }
      const lx = (x0 + (k / 10) * xs).toFixed(digits), ly = (y0 + (k / 10) * ys).toFixed(digits);
      lines.push(`<text x="${x + 4}" y="20" class="l">x ${lx}</text><text x="6" y="${y - 6}" class="l">y ${ly}</text>`);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><style>.l{font:bold 16px 'DejaVu Sans',Arial,sans-serif;fill:#fff;stroke:#000;stroke-width:3px;paint-order:stroke}</style>${lines.join('')}</svg>`;
    img = sharp(await img.toBuffer()).composite([{ input: Buffer.from(svg) }]);
  }
  return { image: await img.jpeg({ quality: 85 }).toBuffer(), width: w, height: h, source: { width: meta.width, height: meta.height } };
}

// Evenly spaced frames across [from, to), for a first look at a clip.
export function spread(from, to, count) {
  const span = Math.max(1, to - from);
  const n = Math.max(1, Math.min(count, span));
  return [...new Set(Array.from({ length: n }, (_, i) => from + Math.floor(((i + 0.5) * span) / n)))];
}

// Image assets for an edit (a hand-drawn illustration, a logo): re-encoded as PNG, keeping transparency.
export const ASSET_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
export async function saveAsset(buffer, file) {
  let meta;
  try { meta = await sharp(buffer).metadata(); } catch { throw fail('That file is not an image this server can read. Export it as PNG, JPEG or WebP'); }
  if (Math.max(meta.width || 0, meta.height || 0) < 64) throw fail('That image is too small to use');
  const tmp = `${file}.part`;
  // Up to 2160 tall and 8192 wide, so a sprite sheet of many frames side by side keeps its frame size.
  const out = await sharp(buffer).rotate().resize(8192, 2160, { fit: 'inside', withoutEnlargement: true }).png().toFile(tmp);
  await rename(tmp, file);
  return { width: out.width, height: out.height };
}

// Per-frame depth for a clip: a greyscale video with one frame per frame of the working copy (near is
// white). It is checked against the clip and split into small JPEG frames the renderer reads by number,
// so the depth always matches the footage frame on screen, through cuts, freezes and speed changes.
export const DEPTH_WIDTH = 360;
export const depthFrameName = n => `${String(n).padStart(5, '0')}.jpg`;
export async function importDepth(video, folder, work) {
  const probed = await probe(video).catch(() => { throw fail('That depth file is not a video this server can read; send an MP4'); });
  const stream = probed.streams.find(s => s.codec_type === 'video');
  if (!stream) throw fail('That depth file has no video track');
  const frames = Number(stream.nb_frames) || Math.round(Number(probed.format.duration) * FPS);
  if (Math.abs(frames - work.frames) > 1) throw fail(`The depth video has ${frames} frames but the clip has ${work.frames}; make one depth frame per frame of the clip (download it with create_download_link)`);
  const ratio = (stream.width / stream.height) / (work.width / work.height);
  if (Math.abs(ratio - 1) > 0.03) throw fail(`The depth video is ${stream.width}×${stream.height}, which is not the shape of the clip (${work.width}×${work.height})`);
  const part = `${folder}.part`;
  await rm(part, { recursive: true, force: true });
  await mkdir(part, { recursive: true });
  try {
    // passthrough keeps every uploaded frame, so frame N stays frame N whatever frame rate the file claims.
    await run('ffmpeg', ['-v', 'error', '-nostdin', '-i', video, '-vf', `scale=${DEPTH_WIDTH}:-2,format=gray`, '-fps_mode', 'passthrough', '-q:v', '3', '-start_number', '0', join(part, '%05d.jpg')], { nice: true, timeoutMs: 20 * 60000 });
  } catch (err) { await rm(part, { recursive: true, force: true }); throw err; }
  await rm(folder, { recursive: true, force: true });
  await rename(part, folder);
  const count = Math.min(frames, work.frames);
  const first = await sharp(join(folder, depthFrameName(0))).metadata();
  return { frames: count, width: first.width, height: first.height, updated: new Date().toISOString() };
}

// Depth (0 far – 1 near) at points given in 0–1 of the footage, from a depth frame or picture.
export async function depthAt(file, points) {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  return points.map(p => {
    const x = Math.min(info.width - 1, Math.max(0, Math.round(p.x * (info.width - 1)))), y = Math.min(info.height - 1, Math.max(0, Math.round(p.y * (info.height - 1))));
    // A 5×5 average, so a single noisy pixel does not decide it.
    let sum = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= info.width || yy >= info.height) continue;
      sum += data[(yy * info.width + xx) * info.channels]; n++;
    }
    return Math.round((sum / n / 255) * 1000) / 1000;
  });
}
