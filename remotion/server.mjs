// Render service for the app: POST /render turns a day's grid into its story video (ticket or envelope opener).
// Chrome loads the grid from this server over localhost, so nothing outside the container is fetched.
// Only one render runs at a time; the app shows a second request as busy.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { renderMedia, selectComposition } from '@remotion/renderer';

const PORT = Number(process.env.PORT || 3200);
const DATA = resolve(process.env.DATA_DIR || '/data');
const SERVE_URL = resolve('build');
const EDITION = /^[a-f0-9]{24}$/, DATE = /^\d{4}-\d{2}-\d{2}$/;
const ANIM = /^[a-f0-9]{12}$/, COMPOSITION = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;
let busy = false;

const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readJson = req => new Promise((ok, fail) => {
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 16_000) { fail(new Error('Request too large')); req.destroy(); } });
  req.on('end', () => { try { ok(JSON.parse(raw || '{}')); } catch { fail(new Error('Invalid JSON')); } });
});
const text = (v, max) => typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null;

// The ticket opener is the default; the envelope stays available.
const STYLES = { ticket: 'TicketStory', envelope: 'EnvelopeStory' };

async function render({ style = 'ticket', edition, date, day, dateLabel, number, count, kicker, category, holdSeconds }) {
  if (!EDITION.test(edition || '') || !DATE.test(date || '')) throw Object.assign(new Error('Invalid edition or date'), { status: 400 });
  if (!STYLES[style]) throw Object.assign(new Error(`Unknown story style ${style}`), { status: 400 });
  const props = { day: text(day, 20), kicker: text(kicker, 24), category: text(category, 32), holdSeconds: Math.min(15, Math.max(2, Number(holdSeconds) || 6)) };
  if (!props.day || !props.kicker || !props.category) throw Object.assign(new Error('Day, kicker and category are required'), { status: 400 });
  if (style === 'ticket') Object.assign(props, { date: text(dateLabel, 24) || '', number: /^\d{4}$/.test(number || '') ? number : '0000', count: Math.min(6, Math.max(1, Number(count) || 1)) });
  const dir = join(DATA, 'media', edition);
  await stat(join(dir, `grid-${date}.png`)).catch(() => { throw Object.assign(new Error('Build the grid first'), { status: 409 }); });
  const inputProps = { ...props, sheet: `http://127.0.0.1:${PORT}/grid/${edition}/${date}.png` };
  const composition = await selectComposition({ serveUrl: SERVE_URL, id: STYLES[style], inputProps });
  const out = join(dir, `grid-${date}.mp4`), tmp = `${out}.part.mp4`;
  await renderMedia({ composition, serveUrl: SERVE_URL, codec: 'h264', crf: 18, inputProps, outputLocation: tmp, overwrite: true, logLevel: 'error' });
  await rename(tmp, out);
  return { file: `grid-${date}.mp4`, style, seconds: composition.durationInFrames / composition.fps };
}

// A standalone clip: any composition in the bundle, rendered on its own. Unlike /render it needs no
// edition and no grid PNG - nothing is composited in, so there is no precondition to check. Props not
// given here fall back to the composition's defaultProps, which is what makes an empty body useful.
async function animation({ id, composition, holdSeconds, props = {} }) {
  if (!ANIM.test(id || '')) throw Object.assign(new Error('Invalid animation id'), { status: 400 });
  if (!COMPOSITION.test(composition || '')) throw Object.assign(new Error('Invalid composition name'), { status: 400 });
  const dir = join(DATA, 'media', 'animations');
  await mkdir(dir, { recursive: true });
  const inputProps = { ...props, holdSeconds: Math.min(30, Math.max(1, Number(holdSeconds) || 5)) };
  let comp;
  try { comp = await selectComposition({ serveUrl: SERVE_URL, id: composition, inputProps }); }
  catch { throw Object.assign(new Error(`No composition named ${composition} in the bundle`), { status: 400 }); }
  const out = join(dir, `${id}.mp4`), tmp = `${out}.part.mp4`;
  // WebGL compositions (three.js) need a GL backend; the container has no GPU, so SwiftShader via ANGLE.
  const chromiumOptions = ['AutumnStory', 'BaroqueStory', 'MosaicStory'].includes(comp.id) ? { gl: 'swangle' } : undefined;
  await renderMedia({ composition: comp, serveUrl: SERVE_URL, codec: 'h264', crf: 18, inputProps, chromiumOptions, outputLocation: tmp, overwrite: true, logLevel: 'error' });
  await rename(tmp, out);
  return { file: `${id}.mp4`, composition, seconds: comp.durationInFrames / comp.fps };
}

http.createServer(async (req, res) => {
  try {
    const grid = req.method === 'GET' && req.url.match(/^\/grid\/([a-f0-9]{24})\/(\d{4}-\d{2}-\d{2})\.png$/);
    if (grid) {
      const file = join(DATA, 'media', grid[1], `grid-${grid[2]}.png`);
      await stat(file);
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return createReadStream(file).pipe(res);
    }
    if (req.method === 'GET' && req.url === '/healthz') return send(res, 200, { ok: true, busy });
    if (req.method === 'POST' && req.url === '/animation') {
      if (busy) return send(res, 409, { error: 'Another story is rendering; try again in a minute' });
      busy = true;
      try { return send(res, 200, await animation(await readJson(req))); } finally { busy = false; }
    }
    if (req.method === 'POST' && req.url === '/render') {
      if (busy) return send(res, 409, { error: 'Another story is rendering; try again in a minute' });
      busy = true;
      try { return send(res, 200, await render(await readJson(req))); } finally { busy = false; }
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    send(res, err.status || (err.code === 'ENOENT' ? 404 : 500), { error: err.message });
  }
}).listen(PORT, '0.0.0.0', () => console.log(`Render service on :${PORT}`));
