// Render service for the app. POST /render turns a day's grid into its story video (ticket or envelope
// opener); POST /clip renders an animated edit over uploaded footage, as stills or as a video; POST
// /animation renders any composition on its own.
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
const EDITION = /^[a-f0-9]{24}$/, ASSET = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DATE = /^(?:\d{4}-\d{2}-\d{2}|weekend)$/;
const ANIM = /^[a-f0-9]{12}$/, COMPOSITION = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;
let busy = false;
// Compositions that draw with three.js; they need the software GL backend in a container with no GPU.
const WEBGL = ['AutumnStory', 'BaroqueStory', 'MosaicStory', 'ResearchersStory', 'LeafGustStory'];

const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readJson = (req, max = 16_000) => new Promise((ok, fail) => {
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > max) { fail(new Error('Request too large')); req.destroy(); } });
  req.on('end', () => { try { ok(JSON.parse(raw || '{}')); } catch { fail(new Error('Invalid JSON')); } });
});
const text = (v, max) => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;
const bad = (message, status = 400) => Object.assign(new Error(message), { status });

// The ticket opener is the default; the envelope, the three autumn openers and the three hands-on ones are
// the alternatives.
const STYLES = { ticket: 'TicketStory', envelope: 'EnvelopeStory', leaves: 'LeafGustStory', bag: 'HarvestBagStory', book: 'PressedLeafStory',
  mark: 'MarkStory', sketch: 'SketchStory', pinboard: 'PinboardStory' };
// An event's photo for the pinboard's flyers: your upload first, then the organiser's image (as the cards use).
const photoFile = async (edition, index) => {
  for (const name of [`upload-${index}.jpg`, `photo-${index}.jpg`]) {
    const file = join(DATA, 'media', edition, name);
    if (await stat(file).then(() => true, () => false)) return file;
  }
  return null;
};
const clipText = (v, max) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

async function render({ style = 'ticket', edition, date, day, dateLabel, number, count, kicker, category, holdSeconds, events }) {
  if (!EDITION.test(edition || '') || !DATE.test(date || '')) throw bad('Invalid edition or date');
  if (!STYLES[style]) throw bad(`Unknown story style ${style}`);
  const props = { day: text(day, 20), kicker: text(kicker, 24), category: text(category, 32), holdSeconds: Math.min(15, Math.max(2, Number(holdSeconds) || 6)) };
  if (!props.day || !props.kicker || !props.category) throw bad('Day, kicker and category are required');
  // Everything but the envelope prints the date and the card count; only the ticket has a serial number.
  if (style !== 'envelope') Object.assign(props, { date: text(dateLabel, 24) || '', count: Math.min(6, Math.max(1, Number(count) || 1)) });
  if (style === 'ticket') props.number = /^\d{4}$/.test(number || '') ? number : '0000';
  // The pinboard's flyers are the day's events, each with its photo in the corner when there is one.
  if (style === 'pinboard' && Array.isArray(events)) {
    props.events = [];
    for (const e of events.slice(0, 6)) {
      const title = clipText(e?.title, 120), when = clipText(e?.when, 40);
      if (!title || !when) continue;
      const index = Number.isInteger(e.index) && e.index >= 0 ? e.index : null;
      const photo = index != null && await photoFile(edition, index) ? `http://127.0.0.1:${PORT}/photo/${edition}/${index}.jpg` : undefined;
      const languages = Array.isArray(e.languages) ? e.languages.filter(l => ['EN', 'LV', 'RU'].includes(l)).slice(0, 3) : [];
      props.events.push({ title, when, price: clipText(e.price, 60), venue: clipText(e.venue, 120), languages: languages.length ? languages : undefined, photo });
    }
  }
  const dir = join(DATA, 'media', edition);
  await stat(join(dir, `grid-${date}.png`)).catch(() => { throw bad('Build the grid first', 409); });
  const inputProps = { ...props, sheet: `http://127.0.0.1:${PORT}/grid/${edition}/${date}.png` };
  const composition = await selectComposition({ serveUrl: SERVE_URL, id: STYLES[style], inputProps, browserExecutable });
  const out = join(dir, `grid-${date}.mp4`), tmp = `${out}.part.mp4`;
  const chromiumOptions = WEBGL.includes(composition.id) ? { gl: 'swangle' } : undefined;
  await renderMedia({ composition, serveUrl: SERVE_URL, codec: 'h264', crf: 18, inputProps, chromiumOptions, outputLocation: tmp, overwrite: true, logLevel: 'error', browserExecutable });
  await rename(tmp, out);
  return { file: `grid-${date}.mp4`, style, seconds: composition.durationInFrames / composition.fps };
}

// An edit over footage. The app has already checked the edit against the clip (src/edits.js); this side
// only decides where Chrome finds the files, so an edit can never point the renderer anywhere else.
async function clip({ footage, render: id, kind, frames, scale, range, props }) {
  if (!EDITION.test(footage || '') || !Number.isInteger(id) || id < 1) throw bad('Invalid footage or render');
  if (!props?.spec || !props?.plan?.segments || !props?.source) throw bad('Missing edit');
  const dir = join(DATA, 'footage', footage);
  // A blank canvas has no clip behind it: the animation is everything, drawn on the edit's background.
  if (!props.blank) await stat(join(dir, 'work.mp4')).catch(() => { throw bad('The footage is not ready', 409); });
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
  // Other clips this edit cuts between, each served from its own folder.
  const videos = {};
  for (const [name, v] of Object.entries(props.videos || {})) {
    if (!ASSET.test(name) || !EDITION.test(v.footage || '')) throw bad(`Invalid clip ${name}`);
    videos[name] = { src: `http://127.0.0.1:${PORT}/footage/${v.footage}/work.mp4`, width: Number(v.width), height: Number(v.height), frames: Number(v.frames) };
  }
  const inputProps = { spec: props.spec, plan: props.plan, source: props.source, assets, depth, models, sounds, videos, track: props.track ?? null, world: props.world ?? null,
    video: props.blank ? '' : `http://127.0.0.1:${PORT}/footage/${footage}/work.mp4` };
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
  const grid = url.match(/^\/grid\/([a-f0-9]{24})\/(\d{4}-\d{2}-\d{2}|weekend)\.png$/);
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

// A standalone clip: any composition in the bundle, rendered on its own. Unlike /render it needs no
// edition and no grid PNG - nothing is composited in, so there is no precondition to check. Props not
// given here fall back to the composition's defaultProps, which is what makes an empty body useful.
async function animation({ id, composition, holdSeconds, props = {} }) {
  if (!ANIM.test(id || '')) throw bad('Invalid animation id');
  if (!COMPOSITION.test(composition || '')) throw bad('Invalid composition name');
  const dir = join(DATA, 'media', 'animations');
  await mkdir(dir, { recursive: true });
  const inputProps = { ...props, holdSeconds: Math.min(30, Math.max(1, Number(holdSeconds) || 5)) };
  let comp;
  try { comp = await selectComposition({ serveUrl: SERVE_URL, id: composition, inputProps, browserExecutable }); }
  catch { throw bad(`No composition named ${composition} in the bundle`); }
  const out = join(dir, `${id}.mp4`), tmp = `${out}.part.mp4`;
  // WebGL compositions (three.js) need a GL backend; the container has no GPU, so SwiftShader via ANGLE.
  const chromiumOptions = WEBGL.includes(comp.id) ? { gl: 'swangle' } : undefined;
  await renderMedia({ composition: comp, serveUrl: SERVE_URL, codec: 'h264', crf: 18, inputProps, chromiumOptions, outputLocation: tmp, overwrite: true, logLevel: 'error', browserExecutable });
  await rename(tmp, out);
  return { file: `${id}.mp4`, composition, seconds: comp.durationInFrames / comp.fps };
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
    const photo = req.method === 'GET' && req.url.match(/^\/photo\/([a-f0-9]{24})\/(\d{1,3})\.jpg$/);
    if (photo) {
      const file = await photoFile(photo[1], Number(photo[2]));
      if (!file) return send(res, 404, { error: 'No photo' });
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      return createReadStream(file).pipe(res);
    }
    if (req.method === 'GET' && req.url === '/healthz') return send(res, 200, { ok: true, busy });
    if (req.method === 'POST' && req.url === '/animation') {
      if (busy) return send(res, 409, { error: 'Another video is rendering; try again in a minute', busy: true });
      busy = true;
      try { return send(res, 200, await animation(await readJson(req))); } finally { busy = false; }
    }
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
