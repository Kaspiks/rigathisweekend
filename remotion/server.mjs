// Render service for the app. POST /render turns a day's grid into its story video (ticket or envelope
// opener); POST /clip renders an animated edit over uploaded footage, as stills or as a video.
// Chrome loads grids, footage and pictures from this server over localhost, so nothing outside the
// container is fetched. Only one render runs at a time; the app shows a second request as busy.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';

const PORT = Number(process.env.PORT || 3200);
const DATA = resolve(process.env.DATA_DIR || '/data');
const SERVE_URL = resolve('build');
// Chrome Headless Shell from `npx remotion browser ensure` unless another build is named (for local runs).
const browserExecutable = process.env.BROWSER_EXECUTABLE || null;
const EDITION = /^[a-f0-9]{24}$/, DATE = /^\d{4}-\d{2}-\d{2}$/, ASSET = /^[a-z0-9][a-z0-9-]{0,31}$/;
let busy = false;

const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readJson = (req, max = 16_000) => new Promise((ok, fail) => {
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > max) { fail(new Error('Request too large')); req.destroy(); } });
  req.on('end', () => { try { ok(JSON.parse(raw || '{}')); } catch { fail(new Error('Invalid JSON')); } });
});
const text = (v, max) => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

// The ticket opener is the default; the envelope stays available.
const STYLES = { ticket: 'TicketStory', envelope: 'EnvelopeStory' };

async function render({ style = 'ticket', edition, date, day, dateLabel, number, count, kicker, category, holdSeconds }) {
  if (!EDITION.test(edition || '') || !DATE.test(date || '')) throw bad('Invalid edition or date');
  if (!STYLES[style]) throw bad(`Unknown story style ${style}`);
  const props = { day: text(day, 20), kicker: text(kicker, 24), category: text(category, 32), holdSeconds: Math.min(15, Math.max(2, Number(holdSeconds) || 6)) };
  if (!props.day || !props.kicker || !props.category) throw bad('Day, kicker and category are required');
  if (style === 'ticket') Object.assign(props, { date: text(dateLabel, 24) || '', number: /^\d{4}$/.test(number || '') ? number : '0000', count: Math.min(6, Math.max(1, Number(count) || 1)) });
  const dir = join(DATA, 'media', edition);
  await stat(join(dir, `grid-${date}.png`)).catch(() => { throw bad('Build the grid first', 409); });
  const inputProps = { ...props, sheet: `http://127.0.0.1:${PORT}/grid/${edition}/${date}.png` };
  const composition = await selectComposition({ serveUrl: SERVE_URL, id: STYLES[style], inputProps, browserExecutable });
  const out = join(dir, `grid-${date}.mp4`), tmp = `${out}.part.mp4`;
  await renderMedia({ composition, serveUrl: SERVE_URL, codec: 'h264', crf: 18, inputProps, outputLocation: tmp, overwrite: true, logLevel: 'error', browserExecutable });
  await rename(tmp, out);
  return { file: `grid-${date}.mp4`, style, seconds: composition.durationInFrames / composition.fps };
}

// An edit over footage. The app has already checked the edit against the clip (src/edits.js); this side
// only decides where Chrome finds the files, so an edit can never point the renderer anywhere else.
async function clip({ footage, render: id, kind, frames, scale, range, props }) {
  if (!EDITION.test(footage || '') || !Number.isInteger(id) || id < 1) throw bad('Invalid footage or render');
  if (!props?.spec || !props?.plan?.segments || !props?.source) throw bad('Missing edit');
  const dir = join(DATA, 'footage', footage);
  await stat(join(dir, 'work.mp4')).catch(() => { throw bad('The footage is not ready', 409); });
  const assets = {};
  for (const [name, a] of Object.entries(props.assets || {})) {
    if (!ASSET.test(name)) throw bad(`Invalid asset name ${name}`);
    assets[name] = { width: Number(a.width), height: Number(a.height), src: `http://127.0.0.1:${PORT}/footage/${footage}/assets/${name}.png` };
  }
  const models = {};
  for (const name of Object.keys(props.models || {})) {
    if (!ASSET.test(name)) throw bad(`Invalid model name ${name}`);
    models[name] = { src: `http://127.0.0.1:${PORT}/footage/${footage}/models/${name}.glb` };
  }
  const sounds = {};
  for (const name of Object.keys(props.sounds || {})) {
    if (!ASSET.test(name)) throw bad(`Invalid sound name ${name}`);
    sounds[name] = { src: `http://127.0.0.1:${PORT}/footage/${footage}/sounds/${name}.wav` };
  }
  const depth = props.depth?.frames > 0 ? { frames: Number(props.depth.frames), base: `http://127.0.0.1:${PORT}/footage/${footage}/depth` } : null;
  const inputProps = { spec: props.spec, plan: props.plan, source: props.source, assets, depth, models, sounds, video: `http://127.0.0.1:${PORT}/footage/${footage}/work.mp4` };
  const k = Math.min(1, Math.max(0.2, Number(scale) || 1));
  const out = join(dir, 'renders');
  await mkdir(out, { recursive: true });
  const puppeteerInstance = await openBrowser('chrome', { browserExecutable });
  try {
    const composition = await selectComposition({ serveUrl: SERVE_URL, id: 'FootageEdit', inputProps, puppeteerInstance });
    const last = composition.durationInFrames - 1;
    if (kind === 'stills') {
      if (!Array.isArray(frames) || !frames.length || frames.length > 12) throw bad('Ask for 1 to 12 frames');
      const files = [];
      for (const f of frames) {
        if (!Number.isInteger(f) || f < 0 || f > last) throw bad(`Frame ${f} is outside the edit (0–${last})`);
        const file = `${id}-f${f}.jpg`;
        await renderStill({ composition, serveUrl: SERVE_URL, inputProps, frame: f, output: join(out, file), imageFormat: 'jpeg', jpegQuality: 88, scale: k, puppeteerInstance, overwrite: true, logLevel: 'error' });
        files.push({ frame: f, file });
      }
      return { files };
    }
    if (kind !== 'video') throw bad(`Unknown render kind ${kind}`);
    const frameRange = Array.isArray(range) ? [Math.max(0, range[0] | 0), Math.min(last, range[1] | 0)] : null;
    if (frameRange && frameRange[1] < frameRange[0]) throw bad('The frame range is empty');
    const file = `${id}.mp4`, tmp = join(out, `${id}.part.mp4`);
    await renderMedia({ composition, serveUrl: SERVE_URL, codec: 'h264', crf: k < 1 ? 23 : 18, inputProps, outputLocation: tmp, overwrite: true, logLevel: 'error', scale: k, frameRange, puppeteerInstance, muted: props.spec.audio === 'mute' && !props.spec.sounds?.length })
      .catch(async err => { await rm(tmp, { force: true }); throw err; });
    await rename(tmp, join(out, file));
    const count = frameRange ? frameRange[1] - frameRange[0] + 1 : composition.durationInFrames;
    return { file, seconds: count / composition.fps, width: Math.round(composition.width * k), height: Math.round(composition.height * k) };
  } finally {
    await puppeteerInstance.close({ silent: true }).catch(() => {});
  }
}

// Files Chrome reads while rendering: the day's grid, a clip's working copy, its pictures, 3D models, sounds and depth frames.
function localFile(url) {
  const grid = url.match(/^\/grid\/([a-f0-9]{24})\/(\d{4}-\d{2}-\d{2})\.png$/);
  if (grid) return { file: join(DATA, 'media', grid[1], `grid-${grid[2]}.png`), type: 'image/png' };
  const video = url.match(/^\/footage\/([a-f0-9]{24})\/work\.mp4$/);
  if (video) return { file: join(DATA, 'footage', video[1], 'work.mp4'), type: 'video/mp4' };
  const depth = url.match(/^\/footage\/([a-f0-9]{24})\/depth\/(\d{5})\.jpg$/);
  if (depth) return { file: join(DATA, 'footage', depth[1], 'depth', `${depth[2]}.jpg`), type: 'image/jpeg' };
  const asset = url.match(/^\/footage\/([a-f0-9]{24})\/assets\/([a-z0-9][a-z0-9-]{0,31})\.png$/);
  if (asset) return { file: join(DATA, 'footage', asset[1], 'assets', `${asset[2]}.png`), type: 'image/png' };
  const sound = url.match(/^\/footage\/([a-f0-9]{24})\/sounds\/([a-z0-9][a-z0-9-]{0,31})\.wav$/);
  if (sound) return { file: join(DATA, 'footage', sound[1], 'sounds', `${sound[2]}.wav`), type: 'audio/wav' };
  const model = url.match(/^\/footage\/([a-f0-9]{24})\/models\/([a-z0-9][a-z0-9-]{0,31})\.glb$/);
  if (model) return { file: join(DATA, 'footage', model[1], 'models', `${model[2]}.glb`), type: 'model/gltf-binary' };
  return null;
}

const server = http.createServer(async (req, res) => {
  try {
    const local = req.method === 'GET' && localFile(req.url);
    if (local) {
      const { size } = await stat(local.file);
      // CORS so the page can fetch depth pictures and models (src/edit/depth.ts, Model3D.tsx); this service is internal only.
      res.writeHead(200, { 'Content-Type': local.type, 'Content-Length': size, 'Access-Control-Allow-Origin': '*' });
      return createReadStream(local.file).pipe(res);
    }
    if (req.method === 'GET' && req.url === '/healthz') return send(res, 200, { ok: true, busy });
    if (req.method === 'POST' && (req.url === '/render' || req.url === '/clip')) {
      if (busy) return send(res, 409, { error: 'Another video is rendering; try again in a minute', busy: true });
      busy = true;
      try { return send(res, 200, req.url === '/clip' ? await clip(await readJson(req, 2_000_000)) : await render(await readJson(req))); } finally { busy = false; }
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    send(res, err.status || (err.code === 'ENOENT' ? 404 : 500), { error: err.message });
  }
});

// A clip render holds its connection open for the whole job, and Node's default requestTimeout of
// 300s destroys that socket mid-render: the handler carries on working while the caller gets an
// ECONNRESET, which undici reports only as "fetch failed". Every video render longer than five
// minutes died this way while stills, being quicker, always survived.
//
// The client already owns the deadline (the app aborts a video render at 60 minutes), so this is a
// backstop set just past it rather than 0 - a socket that somehow outlives the client still gets
// collected instead of pinning `busy` forever.
server.requestTimeout = 65 * 60_000;
server.listen(PORT, '0.0.0.0', () => console.log(`Render service on :${PORT}`));
