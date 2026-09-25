// Animated edits over your own footage, driven from ChatGPT through MCP or from the dashboard.
// Footage is uploaded here, looked at through contact sheets and single frames, animated with a JSON
// edit (src/edits.js) and rendered by the render service one job at a time. Nothing is published from
// here: a finished video waits on the dashboard to be downloaded.
import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { GUIDE, McpEditSpec, fromMcpEdit, toMcpEdit, planEdit, previewFrames, sourceFrameAt } from './edits.js';
import {
  ASSET_NAME, FOOTAGE_ID, FPS, cleanName, contactSheet, describe, footageFiles, frameWithGrid, grabFrame, limits,
  newFootageId, probe, receive, sampleSheet, saveAsset, secondsOf, spread, transcode, writePoster,
} from './footage.js';
import { fetchPublic } from './photos.js';

const fail = (message, httpStatus = 400) => Object.assign(new Error(message), { httpStatus });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const Id = z.string().regex(FOOTAGE_ID).describe('Footage id from list_footage');
const AssetName = z.string().regex(ASSET_NAME).describe('Name edits use for the picture: lowercase letters, digits and dashes, e.g. pasta-drawn');
const MAX_ASSET = 15 * 1048576, LINK_MINUTES = 30;
const tokenHash = token => createHash('sha256').update(token).digest('hex');

// Stores a picture for a clip, whichever way it arrived: dashboard, upload link or ChatGPT file.
async function storeAsset(store, id, name, buffer) {
  const f = store.footage(id);
  if (!ASSET_NAME.test(name)) throw fail('Name the picture with lowercase letters, digits and dashes (up to 32), e.g. pasta-drawn');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail('Send the picture itself as the body');
  const folder = footageFiles(store.dir, f.id).assets;
  await mkdir(folder, { recursive: true });
  return { footage: f.id, name, ...await saveAsset(buffer, join(folder, `${name}.png`)) };
}

// PUT or POST /u/<token>: the one route that needs no login. The token is the permission: made by an
// authorised MCP call, good for one picture of one clip, and gone after one use or 30 minutes. Mounted
// before the login check in app.js.
export function uploadLinkRoute(store) {
  const handler = async (req, res) => {
    const hash = tokenHash(req.params[0]);
    res.set('Cache-Control', 'no-store');
    const link = store.claimUploadLink(hash);
    if (!link) return res.status(404).json({ error: 'This upload link does not exist, was already used or has expired; ask for a new one' });
    try {
      if (/multipart\/form-data/i.test(req.headers['content-type'] || '')) throw fail('Send the file itself as the body (curl --data-binary @file or -T file), not as a form');
      const saved = await storeAsset(store, link.footage, link.name, req.body);
      store.finishUploadLink(hash);
      res.status(201).json(saved);
    } catch (err) {
      if (err.httpStatus === 404) store.finishUploadLink(hash); else store.releaseUploadLink(hash);
      res.status(err.httpStatus || 400).json({ error: err.message });
    }
  };
  const route = express.Router();
  const raw = express.raw({ type: () => true, limit: MAX_ASSET });
  route.put(/^\/u\/([A-Za-z0-9_-]{32})$/, raw, handler);
  route.post(/^\/u\/([A-Za-z0-9_-]{32})$/, raw, handler);
  return route;
}

export async function assetList(dir, id) {
  const folder = footageFiles(dir, id).assets;
  const names = (await readdir(folder).catch(() => [])).filter(f => /^[a-z0-9][a-z0-9-]{0,31}\.png$/.test(f)).sort();
  return Promise.all(names.map(async f => {
    const meta = await sharp(join(folder, f)).metadata();
    return { name: f.slice(0, -4), width: meta.width, height: meta.height };
  }));
}

export function createAnimator(app, store, env = process.env, { fetcher = fetch, previewWaitMs = 45000, busyWaitMs = 10000 } = {}) {
  const tracked = job => { app.locals.renders.add(job); job.finally(() => app.locals.renders.delete(job)); return job; };
  const renderUrl = () => (env.RENDER_URL || '').replace(/\/$/, '');
  const origin = (env.APP_ORIGIN || '').replace(/\/$/, ''); // links in MCP answers open the dashboard's copy
  store.recoverFootage();

  // Clips are processed one at a time: each is a full ffmpeg transcode.
  let processing = Promise.resolve();
  async function processClip(id) {
    const files = footageFiles(store.dir, id);
    try {
      const f = store.updateFootage(id, { status: 'processing', progress: 0, error: null });
      const work = await transcode(files.source, files.work, f.info.source, { onProgress: p => store.updateFootage(id, { progress: Math.round(p * 100) / 100 }) });
      await writePoster(files.work, files.poster, work.frames);
      store.updateFootage(id, { status: 'ready', progress: 1, info: { ...f.info, work } });
      // The working copy is all that is used from here on; the original upload is only taking up space.
      await rm(files.source, { force: true });
    } catch (err) {
      try { store.updateFootage(id, { status: 'failed', progress: null, error: err.message }); } catch {}
    }
  }
  const queueProcessing = id => tracked(processing = processing.then(() => processClip(id)));

  // Renders run one at a time, in the order asked for. The render service also makes story videos, so
  // when it is busy the job waits its turn instead of failing.
  let pumping = null;
  function pump() {
    if (pumping || !renderUrl()) return pumping;
    pumping = tracked((async () => {
      let job;
      while ((job = store.claimFootageRender())) await runRender(job);
    })().finally(() => {
      pumping = null;
      if (store.db.prepare("SELECT 1 FROM footage_renders WHERE status='queued' LIMIT 1").get()) pump();
    }));
    return pumping;
  }
  const withAssets = async id => Object.fromEntries((await assetList(store.dir, id)).map(a => [a.name, { width: a.width, height: a.height }]));
  async function runRender(job) {
    try {
      const f = store.footage(job.footage);
      if (f.status !== 'ready') throw new Error('The footage is not ready');
      const work = f.info.work, assets = await withAssets(f.id);
      const { spec, plan } = planEdit(store.edit(f.id, job.version).spec, work, assets);
      const body = JSON.stringify({ footage: f.id, render: job.id, kind: job.kind, ...job.request,
        props: { spec, plan, assets, source: { width: work.width, height: work.height, frames: work.frames } } });
      let out;
      for (let waited = 0; ; waited++) {
        const r = await fetcher(`${renderUrl()}/clip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(job.kind === 'stills' ? 5 * 60000 : 60 * 60000) });
        out = await r.json().catch(() => ({}));
        if (r.status === 409 && out.busy && waited < 90) { await sleep(busyWaitMs); continue; }
        if (!r.ok) throw new Error(out.error || `Render service returned HTTP ${r.status}`);
        break;
      }
      // Only the files this job asked for are recorded; their names end up in dashboard links.
      const expected = job.kind === 'stills' ? job.request.frames.map(n => `${job.id}-f${n}.jpg`) : [`${job.id}.mp4`];
      const got = job.kind === 'stills' ? (out.files || []).map(x => x.file) : [out.file];
      if (got.length !== expected.length || got.some((x, i) => x !== expected[i])) throw new Error('The render service returned unexpected files');
      if (job.kind === 'stills') {
        const renders = footageFiles(store.dir, f.id).renders;
        const cells = await Promise.all(out.files.map(async x => ({ image: await sharp(join(renders, x.file)).toBuffer(), label: `out ${x.frame} · src ${sourceFrameAt(plan.segments, x.frame)} · ${secondsOf(x.frame).toFixed(2)}s` })));
        const sheet = `${job.id}-sheet.jpg`;
        await sharp(await contactSheet(cells, { portrait: plan.height >= plan.width })).toFile(join(renders, sheet));
        out = { ...out, sheet, frames: out.files.map(x => ({ output: x.frame, source: sourceFrameAt(plan.segments, x.frame), seconds: secondsOf(x.frame) })) };
      }
      store.finishFootageRender(job.id, null, out);
    } catch (err) {
      store.finishFootageRender(job.id, err.name === 'TimeoutError' ? 'Rendering took too long' : err.message);
    }
  }
  setImmediate(pump); // renders still queued from before a restart

  const ready = id => {
    const f = store.footage(id);
    if (f.status === 'failed') throw fail(`This footage failed to process: ${f.error}`, 409);
    if (f.status !== 'ready') throw fail(`This footage is still being processed${f.progress ? ` (${Math.round(f.progress * 100)}%)` : ''}; try again shortly`, 409);
    return f;
  };
  const checkFrame = (f, frame) => { if (frame > f.info.work.frames - 1) throw fail(`Frame ${frame} is past the end of the clip (its last frame is ${f.info.work.frames - 1})`); return frame; };
  const renderSummary = r => ({
    render: r.id, footage: r.footage, version: r.version, kind: r.kind, status: r.status, error: r.error, requested: r.request, created: r.created, updated: r.updated,
    ...(r.status === 'ready' && r.result ? { file: r.result.file || r.result.sheet, url: `${origin}/footage/${r.footage}/renders/${r.result.file || r.result.sheet}`, seconds: r.result.seconds } : {}),
  });
  async function summary(f) {
    const work = f.info?.work;
    return {
      id: f.id, name: f.name, status: f.status, error: f.error, progress: f.progress, created: f.created,
      ...(work ? { frames: work.frames, fps: FPS, seconds: work.duration, width: work.width, height: work.height, orientation: work.width > work.height ? 'landscape' : work.width < work.height ? 'portrait' : 'square', audio: work.audio } : {}),
      source: f.info?.source ?? null,
      assets: await assetList(store.dir, f.id),
      edits: store.edits(f.id),
      renders: store.footageRenders(f.id).slice(0, 10).map(renderSummary),
    };
  }
  const queueRender = (f, version, kind, request) => {
    const edit = store.edit(f.id, version);
    // Renders take a while and run one at a time; a pile of them only delays the one you want.
    const waiting = store.db.prepare("SELECT count(*) n FROM footage_renders WHERE footage=? AND status IN ('queued','rendering')").get(f.id).n;
    if (waiting >= 4) throw fail('Four renders of this clip are already waiting; let them finish first', 429);
    const job = store.queueFootageRender(f.id, edit.version, kind, request);
    pump();
    return job;
  };
  async function videoRequest(f, version, quality, from, to) {
    if (!renderUrl()) throw fail('The render service is not configured (RENDER_URL)', 409);
    const edit = store.edit(f.id, version);
    const { plan } = planEdit(edit.spec, f.info.work, await withAssets(f.id));
    const last = plan.durationInFrames - 1;
    const range = from != null || to != null ? [Math.min(last, from ?? 0), Math.min(last, to ?? last)] : null;
    if (range && range[1] < range[0]) throw fail('`to` must not be before `from`');
    return queueRender(f, edit.version, 'video', { scale: quality === 'final' ? 1 : 0.5, quality, ...(range ? { range } : {}) });
  }

  // ---- Dashboard and API --------------------------------------------------------------------------
  app.get('/api/footage', async (_req, res) => res.json({ renderConfigured: !!renderUrl(), limits: { mb: limits(env).bytes / 1048576, seconds: limits(env).seconds }, footage: await Promise.all(store.footageList().map(summary)) }));
  // The upload streams straight to disk; the clip is checked with ffprobe before anything else happens.
  app.post('/api/footage', async (req, res) => {
    const id = newFootageId(), files = footageFiles(store.dir, id), max = limits(env);
    store.addFootage(id, cleanName(req.query.name));
    try {
      await mkdir(files.dir, { recursive: true });
      await receive(req, files.source, max.bytes);
      const info = describe(await probe(files.source));
      if (info.duration > max.seconds) throw fail(`That clip is ${Math.round(info.duration)} s long; keep footage under ${max.seconds} s (FOOTAGE_MAX_SECONDS)`);
      store.updateFootage(id, { status: 'processing', info: { source: info } });
    } catch (err) {
      store.deleteFootage(id);
      await rm(files.dir, { recursive: true, force: true });
      throw err;
    }
    queueProcessing(id);
    res.status(202).json(await summary(store.footage(id)));
  });
  app.post('/api/footage/:id/retry', async (req, res) => {
    const f = store.footage(Id.parse(req.params.id));
    if (f.status !== 'failed') throw fail('Only footage that failed to process can be retried');
    if (!existsSync(footageFiles(store.dir, f.id).source)) throw fail('The original upload is gone; delete this clip and upload it again');
    store.updateFootage(f.id, { status: 'processing', error: null, progress: 0 });
    queueProcessing(f.id);
    res.status(202).json(await summary(store.footage(f.id)));
  });
  app.patch('/api/footage/:id', async (req, res) => {
    const f = store.footage(Id.parse(req.params.id));
    res.json(await summary(store.updateFootage(f.id, { name: cleanName(z.string().max(200).parse(req.body?.name)) })));
  });
  app.delete('/api/footage/:id', async (req, res) => {
    const f = store.footage(Id.parse(req.params.id));
    if (['uploading', 'processing'].includes(f.status)) throw fail('This clip is still being processed; delete it once that has finished', 409);
    if (store.footageRenders(f.id).some(r => ['queued', 'rendering'].includes(r.status))) throw fail('This clip has a render in progress; delete it once that has finished', 409);
    store.deleteFootage(f.id);
    await rm(footageFiles(store.dir, f.id).dir, { recursive: true, force: true });
    res.json({ ok: true });
  });
  // Pictures for an edit: an illustrated frame to line up over the footage, a logo, a hand-drawn element.
  app.post('/api/footage/:id/assets/:name', express.raw({ type: ['image/*', 'application/octet-stream'], limit: '15mb' }), async (req, res) => {
    const { footage, ...saved } = await storeAsset(store, Id.parse(req.params.id), String(req.params.name || '').toLowerCase(), req.body);
    res.status(201).json(saved);
  });
  app.delete('/api/footage/:id/assets/:name', async (req, res) => {
    const f = store.footage(Id.parse(req.params.id));
    if (!ASSET_NAME.test(req.params.name)) throw fail('No such picture');
    await rm(join(footageFiles(store.dir, f.id).assets, `${req.params.name}.png`), { force: true });
    res.json({ ok: true });
  });
  app.post('/api/footage/:id/renders', async (req, res) => {
    const f = ready(Id.parse(req.params.id));
    const body = z.object({ version: z.number().int().min(1).optional(), quality: z.enum(['draft', 'final']).default('final') }).parse(req.body || {});
    res.status(202).json(renderSummary(await videoRequest(f, body.version ?? null, body.quality)));
  });
  // The working copy, poster, pictures and renders, for the dashboard. The original upload is not served.
  app.get(/^\/footage\/([a-f0-9]{24})\/(work\.mp4|poster\.jpg|assets\/[a-z0-9][a-z0-9-]{0,31}\.png|renders\/[0-9]+(?:-sheet|-f[0-9]+)?\.(?:jpg|mp4))$/, (req, res, next) => {
    const [id, file] = [req.params[0], req.params[1]];
    res.sendFile(file, { root: resolve(footageFiles(store.dir, id).dir), dotfiles: 'deny' }, err => { if (err) next(err.statusCode === 404 || err.code === 'ENOENT' ? undefined : err); });
  });

  // ---- MCP tools ----------------------------------------------------------------------------------
  const text = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
  const picture = (buffer, data) => ({ content: [{ type: 'image', data: buffer.toString('base64'), mimeType: 'image/jpeg' }, { type: 'text', text: JSON.stringify(data) }] });
  const read = { readOnlyHint: true, openWorldHint: false }, write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
  const stillsResult = async r => picture(await sharp(join(footageFiles(store.dir, r.footage).renders, r.result.sheet)).toBuffer(), { ...renderSummary(r), frames: r.result.frames });
  async function videoResult(r) {
    const renders = footageFiles(store.dir, r.footage).renders, sheet = join(renders, `${r.id}-sheet.jpg`);
    const frames = spread(0, Math.max(1, Math.round((r.result.seconds || 1) * FPS)), 8);
    if (!existsSync(sheet)) {
      const cells = await Promise.all(frames.map(async f => ({ image: await grabFrame(join(renders, r.result.file), f, { width: 600 }), label: `${secondsOf(f).toFixed(2)}s into the render` })));
      await sharp(await contactSheet(cells, { portrait: (r.result.height || 2) >= (r.result.width || 1) })).toFile(sheet);
    }
    return picture(await sharp(sheet).toBuffer(), { ...renderSummary(r), note: 'Frames sampled from the rendered video. The owner downloads it from the dashboard.' });
  }

  function register(server) {
    server.registerTool('list_footage', {
      description: 'List uploaded video clips for animated edits: id, status (processing/ready/failed), length in frames at 30 fps, size, uploaded pictures (assets), saved edit versions and recent renders.',
      inputSchema: {}, annotations: read,
    }, async () => text(await Promise.all(store.footageList().map(summary))));

    server.registerTool('sample_footage', {
      description: 'Contact sheet of a clip: up to 24 frames, each labelled with its SOURCE frame number and time. Use it to find when things happen; narrow in with from/to, or ask for exact frames.',
      inputSchema: {
        footage: Id,
        from: z.number().int().min(0).optional().describe('First SOURCE frame of the range to sample (default 0)'),
        to: z.number().int().min(1).optional().describe('SOURCE frame to stop before (default: end of clip)'),
        count: z.number().int().min(1).max(24).default(12).describe('How many evenly spaced frames'),
        frames: z.array(z.number().int().min(0)).min(1).max(24).optional().describe('Exact SOURCE frames instead of a range'),
      }, annotations: read,
    }, async ({ footage, from, to, count, frames }) => {
      const f = ready(footage), work = f.info.work;
      if (from != null) checkFrame(f, from);
      if (from != null && to != null && to <= from) throw fail('`to` must be after `from`');
      const list = frames ? [...new Set(frames)].sort((a, b) => a - b).map(x => checkFrame(f, x)) : spread(from ?? 0, Math.min(work.frames, to ?? work.frames), count);
      const sheet = await sampleSheet(footageFiles(store.dir, f.id).work, list, { portrait: work.height >= work.width });
      return picture(sheet, { footage: f.id, fps: FPS, totalFrames: work.frames, samples: list.map((frame, i) => ({ n: i + 1, frame, seconds: secondsOf(frame) })) });
    });

    server.registerTool('get_frame', {
      description: 'One SOURCE frame at full detail, with a coordinate grid labelled 0–1 across the whole footage (x left→right, y top→bottom), for placing anchors. Give a region to zoom into part of the frame; labels stay in whole-frame coordinates.',
      inputSchema: {
        footage: Id, frame: z.number().int().min(0).describe('SOURCE frame'),
        grid: z.boolean().default(true),
        region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0.05).max(1), height: z.number().min(0.05).max(1) }).optional().describe('Part of the frame to show, in 0–1 of the footage'),
      }, annotations: read,
    }, async ({ footage, frame, grid, region }) => {
      const f = ready(footage);
      checkFrame(f, frame);
      const out = await frameWithGrid(footageFiles(store.dir, f.id).work, frame, { grid, region: region ?? null });
      return picture(out.image, { footage: f.id, frame, seconds: secondsOf(frame), shown: region ?? { x: 0, y: 0, width: 1, height: 1 }, footageSize: out.source });
    });

    server.registerTool('get_edit_guide', {
      description: 'How to write an edit for save_edit: the workflow, the two frame clocks, coordinates, a worked example and tips. Read it before the first edit.',
      inputSchema: {}, annotations: read,
    }, async () => ({ content: [{ type: 'text', text: GUIDE }] }));

    server.registerTool('get_edit', {
      description: 'The saved edit for a clip (latest version unless one is given), its timeline and the list of versions.',
      inputSchema: { footage: Id, version: z.number().int().min(1).optional() }, annotations: read,
    }, async ({ footage, version }) => {
      const f = ready(footage), edit = store.edit(f.id, version ?? null);
      const { timeline, plan, warnings } = planEdit(edit.spec, f.info.work, await withAssets(f.id));
      return text({ footage: f.id, version: edit.version, note: edit.note, edit: toMcpEdit(edit.spec), durationFrames: plan.durationInFrames, seconds: secondsOf(plan.durationInFrames), timeline, warnings, versions: store.edits(f.id) });
    });

    server.registerTool('save_edit', {
      description: 'Save an animated edit for a clip as a new version (read get_edit_guide first). Checked against the clip and its pictures; answers with the output↔source timeline and warnings. Saving renders nothing and publishes nothing.',
      inputSchema: { footage: Id, edit: McpEditSpec, note: z.string().trim().max(200).optional().describe('What changed, for the version list') }, annotations: write,
    }, async ({ footage, edit, note }) => {
      const f = ready(footage);
      const { spec, plan, timeline, warnings } = planEdit(fromMcpEdit(edit), f.info.work, await withAssets(f.id));
      const saved = store.saveEdit(f.id, spec, note || null);
      return text({ footage: f.id, version: saved.version, format: spec.format, size: [plan.width, plan.height], fps: FPS, durationFrames: plan.durationInFrames, seconds: secondsOf(plan.durationInFrames), timeline, warnings, next: 'preview_edit to check frames, then render_edit' });
    });

    server.registerTool('preview_edit', {
      description: 'Render chosen OUTPUT frames of a saved edit as stills (actual renders, with every layer) and return them as one labelled sheet. Without frames, picks a frame inside each layer. Returns the sheet when it is done within ~45 s; otherwise a render id for get_render.',
      inputSchema: {
        footage: Id, version: z.number().int().min(1).optional().describe('Edit version (default latest)'),
        frames: z.array(z.number().int().min(0)).min(1).max(12).optional().describe('OUTPUT frames to render'),
        scale: z.number().min(0.25).max(1).default(0.5).describe('Size of the stills; 0.5 is half of 1080 wide'),
      }, annotations: write,
    }, async ({ footage, version, frames, scale }) => {
      if (!renderUrl()) throw fail('The render service is not configured (RENDER_URL)');
      const f = ready(footage), edit = store.edit(f.id, version ?? null);
      const { plan, spec } = planEdit(edit.spec, f.info.work, await withAssets(f.id));
      const list = frames ? [...new Set(frames)].sort((a, b) => a - b) : previewFrames(plan, spec.layers, 8);
      const outside = list.find(x => x > plan.durationInFrames - 1);
      if (outside != null) throw fail(`Frame ${outside} is past the end of the edit (its last frame is ${plan.durationInFrames - 1})`);
      const job = queueRender(f, edit.version, 'stills', { frames: list, scale });
      for (const until = Date.now() + previewWaitMs; Date.now() < until;) {
        const r = store.footageRender(job.id);
        if (r.status === 'ready') return stillsResult(r);
        if (r.status === 'failed') throw fail(`The preview failed: ${r.error}`);
        await sleep(400);
      }
      return text({ ...renderSummary(store.footageRender(job.id)), note: 'Still rendering; call get_render with this render id.' });
    });

    server.registerTool('render_edit', {
      description: 'Render a saved edit as an MP4 in the background. quality draft is half size and quicker, for checking motion; final is full size. Optionally only OUTPUT frames from..to. Returns a render id; poll get_render. Nothing is published.',
      inputSchema: {
        footage: Id, version: z.number().int().min(1).optional().describe('Edit version (default latest)'),
        quality: z.enum(['draft', 'final']).default('draft'),
        from: z.number().int().min(0).optional().describe('First OUTPUT frame (default 0)'),
        to: z.number().int().min(0).optional().describe('Last OUTPUT frame, inclusive (default the end)'),
      }, annotations: write,
    }, async ({ footage, version, quality, from, to }) => {
      const f = ready(footage);
      const job = await videoRequest(f, version ?? null, quality, from, to);
      const ahead = store.db.prepare("SELECT count(*) n FROM footage_renders WHERE status IN ('queued','rendering') AND id<?").get(job.id).n;
      return text({ ...renderSummary(job), ahead, note: 'Poll get_render with this render id every 20–30 s. Expect roughly a minute per 10 s of video at full size, more while the footage is redrawn as a drawing or when other renders are waiting.' });
    });

    server.registerTool('create_upload_link', {
      description: 'A one-time link for sending a picture you made (in your sandbox, or generated) to a clip as a named asset, for edits to use. Upload the raw file with PUT or POST as the request body, e.g. curl --fail -T /path/picture.png "<url>". Works once, for 30 minutes. PNG keeps transparency; JPEG and WebP work too.',
      inputSchema: { footage: Id, name: AssetName }, annotations: write,
    }, async ({ footage, name }) => {
      const f = store.footage(footage);
      const token = randomBytes(24).toString('base64url'), expires = new Date(Date.now() + LINK_MINUTES * 60000);
      store.addUploadLink(tokenHash(token), f.id, name, expires);
      const url = `${origin}/u/${token}`;
      return text({ url, expires: expires.toISOString(), footage: f.id, name, maxMB: MAX_ASSET / 1048576, upload: `curl --fail -sS -T /path/to/${name}.png "${url}"`,
        then: `Use it in an edit as {"type":"image","asset":"${name}",...}; list_footage shows it with its size.` });
    });

    server.registerTool('add_picture', {
      description: 'Add a picture to a clip as a named asset, from a file in this conversation (attached or generated) or from a public HTTPS link. If the file does not arrive, use create_upload_link instead.',
      inputSchema: {
        footage: Id, name: AssetName,
        file: z.object({ download_url: z.string().url(), file_id: z.string(), mime_type: z.string().optional(), file_name: z.string().optional() }).optional().describe('The picture as a ChatGPT file'),
        url: z.string().url().max(2000).optional().describe('Or a public HTTPS link to the picture'),
      },
      annotations: { ...write, openWorldHint: true },
      _meta: { 'openai/fileParams': ['file'] },
    }, async ({ footage, name, file, url }) => {
      const source = file?.download_url || url;
      if (!source) throw fail('No file arrived. Ask for create_upload_link and upload the picture there');
      let got;
      try { got = await fetchPublic(source, 'image/*', MAX_ASSET, fetcher); } catch (err) { throw fail(`Could not fetch the picture (${err.message}). Use create_upload_link instead`); }
      return text(await storeAsset(store, footage, name, got.buffer));
    });

    server.registerTool('get_render', {
      description: 'Status of a render. When ready: stills come back as their sheet; a video comes back as frames sampled from it, plus where the owner can download it.',
      inputSchema: { render: z.number().int().min(1) }, annotations: read,
    }, async ({ render }) => {
      const r = store.footageRender(render);
      if (r.status !== 'ready') return text(renderSummary(r));
      return r.kind === 'stills' ? stillsResult(r) : videoResult(r);
    });
  }

  return { register, pump };
}
