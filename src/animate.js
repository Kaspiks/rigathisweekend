// Animated edits over your own footage, driven from ChatGPT through MCP or from the dashboard.
// Footage is uploaded here, looked at through contact sheets and single frames, animated with a JSON
// edit (src/edits.js) and rendered by the render service one job at a time. Nothing is published from
// here: a finished video waits on the dashboard to be downloaded.
import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { LOOKS, LOOK_NAMES, levelsFrom, matchKnobs, matchLooks, rgbToHex } from './grade.js';
import { FORMATS, GUIDE, GraphicDef, McpEditSpec, fromMcpEdit, graphicErrors, toMcpEdit, planEdit, previewFrames, sourceFrameAt } from './edits.js';
import {
  ASSET_NAME, FOOTAGE_ID, FPS, cleanName, contactSheet, describe, footageFiles, frameWithGrid, grabFrame, limits,
  newFootageId, probe, receive, sampleSheet, saveAsset, secondsOf, spread, transcode, writePoster,
  importDepth, depthAt, depthFrameName,
} from './footage.js';
import { fetchPublic } from './photos.js';
import { MAX_MODEL, deleteModel, modelList, saveModel } from './models.js';
import { depthEstimateSeconds, depthLimits, depthModel, makeDepth } from './depth.js';
import { MAX_SOUND, MAX_SOUND_SECONDS, deleteSound, loudness, processedSound, saveSound, soundList } from './sounds.js';
import { createEleven } from './eleven.js';
import { STYLES, STYLE_NAMES, capReading, captionLayers, directedText, estimateCredits, takesTags, voiceSettings, wordsFromAlignment } from './voice.js';
import { loadTrack, locate, normalizeTrack, project, saveTrack, sceneCentre, solveTrack, trackLimits, trackOverlay } from './tracking.js';
import http from 'node:http';

const fail = (message, httpStatus = 400) => Object.assign(new Error(message), { httpStatus });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const Id = z.string().regex(FOOTAGE_ID).describe('Footage id from list_footage');
const AssetName = z.string().regex(ASSET_NAME).describe('Name edits use for the picture: lowercase letters, digits and dashes, e.g. pasta-drawn');
const MAX_ASSET = 15 * 1048576, MAX_DEPTH = 1024 * 1048576, LINK_MINUTES = 30;
// A clip fetched from a link or handed over as a file is held in memory while it is checked, so it is
// capped well below what an upload link allows; anything bigger should stream straight to disk.
const MAX_FETCHED_VIDEO = 220 * 1048576;
const tokenHash = token => createHash('sha256').update(token).digest('hex');
// What an edit is checked against: the working copy, and whether per-frame depth has been uploaded for it.
const clipInfo = f => ({ ...f.info.work, depth: f.info.depth ?? null, track: f.info.track ?? null, blank: !!f.info.blank });
const MAX_TRACK = 40 * 1048576;
// Reads an uploaded camera track (JSON), checks it and stores it for a clip. An AR track recorded while
// filming beats one solved from the footage, so it replaces whatever track the clip had.
async function storeTrack(store, id, body) {
  const f = store.footage(id);
  if (f.status !== 'ready') throw fail('The clip is not ready yet', 409);
  if (['queued', 'running'].includes(f.info.trackJob?.status)) throw fail('A camera track is being solved for this clip; wait for it to finish', 409);
  let json;
  try { json = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body)); } catch { throw fail('A camera track is JSON; that file is not'); }
  const track = normalizeTrack(json, f.info.work, 'upload');
  const summary = await saveTrack(footageFiles(store.dir, f.id).dir, track);
  const { trackJob, ...info } = store.footage(f.id).info;
  store.updateFootage(f.id, { info: { ...info, track: summary } });
  return { footage: f.id, track: summary };
}

// Taking in a new clip, however it arrived. `write` puts the original on disk - streamed from a request
// for a big upload, or written from a buffer for a file or link handed over - and the rest is the same
// either way: probe it, refuse it if it is too long, then hand it to the background transcoder.
export async function intakeVideo(store, env, name, write) {
  const id = newFootageId(), files = footageFiles(store.dir, id), max = limits(env);
  store.addFootage(id, cleanName(name));
  try {
    await mkdir(files.dir, { recursive: true });
    await write(files.source, max);
    const info = describe(await probe(files.source));
    if (info.duration > max.seconds) throw fail(`That clip is ${Math.round(info.duration)} s long; keep footage under ${max.seconds} s (FOOTAGE_MAX_SECONDS)`);
    store.updateFootage(id, { status: 'processing', info: { source: info } });
  } catch (err) {
    store.deleteFootage(id);
    await rm(files.dir, { recursive: true, force: true });
    throw err;
  }
  return id;
}

// An animation with no clip behind it. Kept as a footage row with `info.blank`, rather than a second
// kind of thing: every tool that already works on a clip - versions, previews, renders, pictures, models,
// sounds, the dashboard - then works on it too, and the only difference is that nothing is drawn under
// the layers.
export function createBlank(store, { name, format = 'vertical', seconds = 6 }) {
  const size = FORMATS[format];
  if (!size) throw fail(`format must be one of ${Object.keys(FORMATS).join(', ')}`);
  const length = Math.round(Math.min(180, Math.max(1, Number(seconds) || 6)) * FPS);
  const id = newFootageId();
  store.addFootage(id, cleanName(name) || 'Animation');
  const work = { width: size[0], height: size[1], frames: length, duration: +(length / FPS).toFixed(3), audio: false };
  return store.updateFootage(id, { status: 'ready', progress: 1, error: null, info: { blank: true, work, source: null } });
}

// Stores a picture for a clip, whichever way it arrived: dashboard, upload link or ChatGPT file.
async function storeAsset(store, id, name, buffer) {
  const f = store.footage(id);
  if (!ASSET_NAME.test(name)) throw fail('Name the picture with lowercase letters, digits and dashes (up to 32), e.g. pasta-drawn');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail('Send the picture itself as the body');
  const folder = footageFiles(store.dir, f.id).assets;
  await mkdir(folder, { recursive: true });
  return { footage: f.id, name, ...await saveAsset(buffer, join(folder, `${name}.png`)) };
}

// The only routes that need no login. The token is the permission: made by an authorised MCP call and
// gone after 30 minutes. PUT or POST /u/<token> takes one picture, 3D model, sound or clip's per-frame depth video, and
// works once. GET /d/<token> hands out a clip's working copy, so ChatGPT can compute depth from it.
// Mounted before the login check in app.js.
async function readBody(req, max) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw fail(`That file is too large; keep it under ${Math.round(max / 1048576)} MB`, 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function uploadLinkRoute(store, env = process.env) {
  const upload = async (req, res) => {
    const hash = tokenHash(req.params[0]);
    res.set('Cache-Control', 'no-store');
    const link = store.claimUploadLink(hash);
    if (!link) return res.status(404).json({ error: 'This upload link does not exist, was already used or has expired; ask for a new one' });
    try {
      if (/multipart\/form-data/i.test(req.headers['content-type'] || '')) throw fail('Send the file itself as the body (curl --data-binary @file or -T file), not as a form');
      if (link.kind === 'video') {
        // The clip row was made when the link was, so the original streams straight into its folder
        // rather than through memory: this is the door for footage too big to hand over as a file.
        const f = store.footage(link.footage);
        if (f.status !== 'uploading') throw fail('That link has already been used', 409);
        const files = footageFiles(store.dir, f.id), max = limits(env);
        await mkdir(files.dir, { recursive: true });
        await receive(req, files.source, max.bytes);
        const info = describe(await probe(files.source));
        if (info.duration > max.seconds) throw fail(`That clip is ${Math.round(info.duration)} s long; keep footage under ${max.seconds} s (FOOTAGE_MAX_SECONDS)`);
        store.updateFootage(f.id, { status: 'processing', info: { source: info } });
        store.finishUploadLink(hash);
        // createAnimator puts the transcoder here; the two are mounted separately, so the route
        // reaches it through the app rather than through an argument it would have to be given first.
        req.app.locals.queueProcessing?.(f.id);
        res.status(201).json({ footage: f.id, status: 'processing' });
        return;
      }
      if (link.kind === 'depth') {
        const f = store.footage(link.footage);
        if (f.status !== 'ready') throw fail('The clip is not ready yet', 409);
        if (['queued', 'running'].includes(f.info.depthJob?.status)) throw fail('Depth is being made for this clip on the server; wait for it to finish', 409);
        const files = footageFiles(store.dir, f.id), incoming = join(files.dir, 'depth-upload.mp4');
        try {
          await receive(req, incoming, MAX_DEPTH);
          const depth = await importDepth(incoming, files.depth, f.info.work);
          store.updateFootage(f.id, { info: { ...store.footage(f.id).info, depth } });
          store.finishUploadLink(hash);
          res.status(201).json({ footage: f.id, depth });
        } finally { await rm(incoming, { force: true }); }
        return;
      }
      if (link.kind === 'track') {
        const saved = await storeTrack(store, link.footage, await readBody(req, MAX_TRACK));
        store.finishUploadLink(hash);
        return res.status(201).json(saved);
      }
      const folders = () => footageFiles(store.dir, store.footage(link.footage).id);
      const saved = link.kind === 'model'
        ? { footage: link.footage, ...await saveModel(await readBody(req, MAX_MODEL), folders().models, link.name) }
        : link.kind === 'sound'
          ? { footage: link.footage, ...await saveSound(await readBody(req, MAX_SOUND), folders().sounds, link.name) }
          : await storeAsset(store, link.footage, link.name, await readBody(req, MAX_ASSET));
      store.finishUploadLink(hash);
      res.status(201).json(saved);
    } catch (err) {
      if (err.httpStatus === 404) store.finishUploadLink(hash); else store.releaseUploadLink(hash);
      res.status(err.httpStatus || 400).json({ error: err.message });
    }
  };
  const route = express.Router();
  route.put(/^\/u\/([A-Za-z0-9_-]{32})$/, upload);
  route.post(/^\/u\/([A-Za-z0-9_-]{32})$/, upload);
  route.get(/^\/d\/([A-Za-z0-9_-]{32})\.mp4$/, (req, res) => {
    const link = store.downloadLink(tokenHash(req.params[0]));
    res.set('Cache-Control', 'no-store');
    if (!link) return res.status(404).json({ error: 'This download link does not exist or has expired; ask for a new one' });
    res.sendFile(footageFiles(store.dir, link.footage).work, err => { if (err && !res.headersSent) res.status(404).json({ error: 'The clip is gone' }); });
  });
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

// Node's global fetch is undici, and its headersTimeout and bodyTimeout are both 300s. Neither is
// governed by the AbortSignal we pass, so a clip render that runs longer than five minutes is killed
// by the CLIENT even after the render service was told to hold the connection - the caller sees
// UND_ERR_HEADERS_TIMEOUT. node:http has no such default, so the clip call gets this transport
// instead. It speaks just enough of the fetch response shape for the one call site, and RENDER_URL is
// an internal http:// service, so there is no TLS to handle.
const longFetch = (url, { method = 'GET', headers = {}, body, signal } = {}) => new Promise((ok, fail) => {
  const u = new URL(url);
  const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, res => {
    let raw = '';
    res.setEncoding('utf8');
    res.on('data', c => { raw += c; });
    res.on('end', () => ok({
      ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode,
      json: async () => JSON.parse(raw || '{}'), text: async () => raw,
    }));
  });
  req.on('error', fail);
  if (signal) signal.addEventListener('abort', () => req.destroy(Object.assign(new Error('Rendering took too long'), { name: 'TimeoutError' })), { once: true });
  if (body) req.write(body);
  req.end();
});

export function createAnimator(app, store, env = process.env, { fetcher = fetch, clipFetcher = fetcher === fetch ? longFetch : fetcher, previewWaitMs = 45000, busyWaitMs = 10000 } = {}) {
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
  app.locals.queueProcessing = queueProcessing;

  // Depth made here (src/depth.js), one clip at a time. Its state lives in the clip's info as depthJob
  // while it is waiting or running, or failed with the reason; finished depth replaces info.depth.
  const setInfo = (id, patch) => store.updateFootage(id, { info: { ...store.footage(id).info, ...patch } });
  for (const f of store.footageList()) if (['queued', 'running'].includes(f.info?.depthJob?.status)) setInfo(f.id, { depthJob: { status: 'failed', error: 'Interrupted by a restart; ask again' } });
  for (const f of store.footageList()) if (['queued', 'running'].includes(f.info?.trackJob?.status)) setInfo(f.id, { trackJob: { status: 'failed', error: 'Interrupted by a restart; ask again' } });
  let depthWork = Promise.resolve();
  function queueDepth(f) {
    const job = f.info.depthJob;
    if (['queued', 'running'].includes(job?.status)) return job;
    const max = depthLimits(env);
    if (f.info.work.duration > max.seconds) throw fail(`Depth is made on the server for clips up to ${max.seconds} s (DEPTH_MAX_SECONDS); this one is ${Math.round(f.info.work.duration)} s`);
    setInfo(f.id, { depthJob: { status: 'queued', progress: 0, requested: new Date().toISOString() } });
    tracked(depthWork = depthWork.then(async () => {
      const id = f.id;
      try {
        setInfo(id, { depthJob: { status: 'running', progress: 0, started: new Date().toISOString() } });
        const model = await depthModel(store.dir, env);
        const files = footageFiles(store.dir, id);
        let shown = 0;
        const depth = await makeDepth(files.work, files.depth, store.footage(id).info.work, model, { detail: max.detail, onProgress: p => {
          if (p - shown < 0.02) return;
          shown = p;
          try { setInfo(id, { depthJob: { ...store.footage(id).info.depthJob, progress: Math.round(p * 100) / 100 } }); } catch {}
        } });
        const { depthJob, ...info } = store.footage(id).info;
        store.updateFootage(id, { info: { ...info, depth } });
      } catch (err) {
        try { setInfo(id, { depthJob: { status: 'failed', error: err.message } }); } catch {}
      }
    }));
    return store.footage(f.id).info.depthJob;
  }
  // Solving the camera with COLMAP, in the background like depth. An AR track recorded while filming is
  // better than anything solved afterwards, so one that has been uploaded is never overwritten by a solve.
  let trackWork = Promise.resolve();
  function queueTrack(f) {
    const job = f.info.trackJob;
    if (['queued', 'running'].includes(job?.status)) return job;
    if (f.info.track?.source === 'upload') throw fail('This clip already has a camera track recorded while filming, which is better than a solve. Delete it first if you want the server to solve one instead');
    const max = trackLimits(env);
    if (f.info.work.duration > max.seconds) throw fail(`Camera tracks are solved on the server for clips up to ${max.seconds} s (TRACK_MAX_SECONDS); this one is ${Math.round(f.info.work.duration)} s`);
    setInfo(f.id, { trackJob: { status: 'queued', stage: 'waiting', requested: new Date().toISOString() } });
    tracked(trackWork = trackWork.then(async () => {
      const id = f.id;
      try {
        setInfo(id, { trackJob: { status: 'running', stage: 'starting', started: new Date().toISOString() } });
        const files = footageFiles(store.dir, id);
        const track = await solveTrack(files.work, store.footage(id).info.work, files.dir, {
          python: max.python,
          onProgress: stage => { try { setInfo(id, { trackJob: { ...store.footage(id).info.trackJob, stage } }); } catch {} },
        });
        const saved = await saveTrack(files.dir, track);
        const { trackJob, ...info } = store.footage(id).info;
        store.updateFootage(id, { info: { ...info, track: saved } });
      } catch (err) {
        try { setInfo(id, { trackJob: { status: 'failed', error: err.message } }); } catch {}
      }
    }));
    return store.footage(f.id).info.trackJob;
  }
  const trackState = f => f.info?.trackJob ?? null;

  const depthState = f => f.info?.depthJob ? { ...f.info.depthJob, ...(f.info.depthJob.status !== 'failed' ? { estimateSeconds: depthEstimateSeconds(f.info.work.frames) } : {}) } : null;

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
  const withSounds = async id => Object.fromEntries((await soundList(footageFiles(store.dir, id).sounds)).map(x => [x.name, { seconds: x.seconds }]));
  // The other clips an edit may cut between, by id: their length and shape, and whether they are real
  // video at all. Only clips that are ready count, so a half-uploaded one is refused with a reason.
  const withClips = () => Object.fromEntries(store.footageList()
    .filter(f => f.status === 'ready' && f.info?.work)
    .map(f => [f.id, { frames: f.info.work.frames, width: f.info.work.width, height: f.info.work.height, blank: !!f.info.blank }]));
  const withModels = async id => Object.fromEntries((await modelList(footageFiles(store.dir, id).models)).map(m => [m.name, { animations: m.animations.map(a => a.name) }]));
  // Each world spot's marks turned into a position in the room, through the clip's camera track. Done
  // before an edit is saved: a spot a layer stands on that cannot be placed would only fail later, in
  // the middle of a render, where the reason is much harder to see.
  async function resolveWorld(f, spec) {
    if (!spec.world?.length) return { points: [], warnings: [] };
    const track = await loadTrack(footageFiles(store.dir, f.id).dir);
    const needed = new Set(spec.layers.flatMap(l => [l.world, ...(l.worldPath ?? []).map(k => k.world)]).filter(Boolean));
    const points = [], warnings = [];
    for (const point of spec.world) {
      let got;
      try { got = locate(track, point.sightings); }
      catch (err) {
        if (needed.has(point.name)) throw fail(`world '${point.name}': ${err.message}`);
        warnings.push(`world '${point.name}': ${err.message}`);
        continue;
      }
      if (got.error != null && got.error > 0.02) warnings.push(`world '${point.name}': the marks disagree by ${(got.error * 100).toFixed(1)}% of the frame height; mark the same spot more carefully, or on frames the camera has moved further between`);
      points.push({ name: point.name, ...got });
    }
    return { points, warnings };
  }
  // ---- Generated sound ----------------------------------------------------------------------------
  // Speech, sound effects and music from ElevenLabs, landing in the same place an uploaded sound does:
  // saveSound turns whatever comes back into the 48 kHz WAV the renderer mixes, so everything the
  // timeline already does - ducking under narration, fades, pitch, reverb, volume keys - works on a
  // generated sound without knowing it was generated.
  //
  // Two things guard the account, and they are different jobs. The CACHE stops the same request being
  // paid for twice, which also keeps a line sounding the same after an edit instead of quietly becoming
  // a different take. The CAP stops a long session emptying the month; it is enforced against
  // ElevenLabs' own count of what the account has spent, not against an estimate made here, because a
  // cap enforced on a guess is not a cap.
  const eleven = createEleven(env, fetcher);
  const voiceDir = () => join(store.dir, 'voice-cache');
  let subAt = 0, subWas = null;
  async function subscription(fresh = false) {
    if (!fresh && subWas && Date.now() - subAt < 60000) return subWas;
    subWas = await eleven.subscription(); subAt = Date.now();
    return subWas;
  }
  const creditCap = sub => {
    const asked = Number(env.ELEVENLABS_CREDIT_CAP);
    return Number.isFinite(asked) && asked > 0 ? Math.round(asked) : Math.floor((sub.limit || 0) * 0.8);
  };
  const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); };

  // How much the account has really spent. ElevenLabs' own `character_count` is the authority, but it
  // LAGS: a generation measured on the server moved the counter by nothing at all, a minute later still
  // nothing. A cap enforced on that number alone would not stop a burst - ChatGPT could generate for a
  // while before any of it showed up, which is exactly the case a cap exists for.
  //
  // So the counter is read, and whatever this server has spent SINCE the counter last moved is added to
  // it. While the account is lagging, the local ledger carries the cap; when the counter catches up and
  // jumps, the mark resets and the ledger starts again from zero, so nothing is counted twice. Other
  // spending - the owner in the ElevenLabs app - arrives as a jump in the counter and is caught the
  // same way.
  function accountUsed(sub) {
    const seen = JSON.parse(store.voiceMeta('account') || 'null');
    const read = capReading({ accountUsed: sub.used, seen, spentSince: seen ? store.voiceSpend(seen.at).credits : 0 });
    if (read.remember) store.setVoiceMeta('account', JSON.stringify({ used: sub.used, at: new Date().toISOString() }));
    return read;
  }

  // Asked BEFORE the call, with the published rates, because the only way to not spend credits is to
  // not make the request.
  async function affordable(kind, estimate, what) {
    const sub = await subscription();
    const ceiling = creditCap(sub), { used, unreflected } = accountUsed(sub);
    if (ceiling > 0 && used + estimate > ceiling)
      throw fail(`That would take the ElevenLabs account past the cap set for it: ${used} of ${ceiling} credits are gone${unreflected ? ` (${unreflected} of them generated here too recently for ElevenLabs to have counted yet)` : ''}, and ${what} needs about ${estimate} more${sub.resets ? ` (the quota resets on ${sub.resets.slice(0, 10)})` : ''}. Ask the owner to raise ELEVENLABS_CREDIT_CAP, or wait.`, 429);
    return sub;
  }
  // What it cost. ElevenLabs' counter is differenced across the call and used when it actually moved;
  // when it has not moved yet - which is the usual case - the estimate goes in the ledger and is
  // reported AS an estimate. A number that might be measured and might be a guess, presented as though
  // it were always measured, is worse than one that says which it is.
  async function charge(kind, before, estimate, detail) {
    let spent = estimate, measured = false;
    try {
      const after = await subscription(true);
      const delta = after.used - before.used;
      if (delta > 0) { spent = delta; measured = true; }
    } catch { /* keep the estimate */ }
    store.logVoiceSpend(kind, spent, detail);
    return { credits: spent, measured };
  }

  // Generate once, keep forever. The key is everything that went into the request, so changing a word,
  // a voice or a setting makes a new take and asking for the same thing twice does not.
  async function generated(kind, key, estimate, what, make) {
    const hash = createHash('sha256').update(JSON.stringify([kind, key])).digest('hex').slice(0, 32);
    const hit = store.cachedVoice(hash);
    if (hit) {
      try { return { buffer: await readFile(join(voiceDir(), hit.file)), meta: hit.meta, credits: 0, cached: true }; }
      catch { store.forgetVoice(hash); } // the file went missing; fall through and make it again
    }
    const before = await affordable(kind, estimate, what);
    const made = await make();
    await mkdir(voiceDir(), { recursive: true });
    const file = `${hash}.mp3`;
    await writeFile(join(voiceDir(), file), made.buffer);
    store.rememberVoice(hash, { kind, file, meta: made.meta ?? null });
    const { credits, measured } = await charge(kind, before, estimate, what);
    return { ...made, credits, measured, cached: false };
  }

  // The account's speech models, kept for five minutes: the list barely changes, and every `speak` needs
  // it to know what the chosen model costs and whether it listens to the style knob.
  let modelsAt = 0, modelsWere = null;
  async function models() {
    if (modelsWere && Date.now() - modelsAt < 300000) return modelsWere;
    modelsWere = await eleven.models(); modelsAt = Date.now();
    return modelsWere;
  }
  // The model to use, and what it will listen to. An unknown name is refused with the list rather than
  // passed through, because ElevenLabs answers a wrong model_id with a 422 that says nothing useful.
  async function modelFor(asked) {
    const list = await models();
    const want = asked || eleven.model;
    const found = list.find(m => m.model === want);
    if (!found) {
      if (asked) throw fail(`That account has no speech model '${asked}'. It has: ${list.map(m => m.model).join(', ')}.`);
      return { model: want, rate: 1, canStyle: true, canSpeakerBoost: true, name: want, unknown: true };
    }
    return found;
  }

  // Which voice reads a style: what the caller asked for, else what the owner pinned to that style,
  // else a default for the whole server, else the first voice on the account - and then say so, because
  // a voice chosen by falling through a list is not a voice anyone chose.
  async function voiceFor(style, asked) {
    if (asked) return { voice: asked, how: 'asked for' };
    const pinned = store.styleVoice(style);
    if (pinned) return { voice: pinned, how: `pinned to '${style}'` };
    if (env.ELEVENLABS_VOICE) return { voice: env.ELEVENLABS_VOICE, how: 'the server default' };
    const list = await eleven.voices();
    if (!list.length) throw fail('That ElevenLabs account has no voices on it. Add one in ElevenLabs, then use set_style_voice.');
    return { voice: list[0].voice, how: `the account's first voice (${list[0].name}) - nothing is pinned to '${style}'; set_style_voice fixes that` };
  }

  async function runRender(job) {
    try {
      const f = store.footage(job.footage);
      if (f.status !== 'ready') throw new Error('The footage is not ready');
      const work = f.info.work, assets = await withAssets(f.id), models = await withModels(f.id), sounds = await withSounds(f.id);
      const planned = planEdit(store.edit(f.id, job.version).spec, clipInfo(f), assets, store.graphics(), models, sounds, withClips()), plan = planned.plan;
      // Stills are silent. A video gets each cue's sound with its effects applied (made once, then kept).
      const folder = footageFiles(store.dir, f.id).sounds, files = {};
      const cues = job.kind === 'video' ? await Promise.all(planned.spec.sounds.map(async c => ({ ...c, file: await processedSound(folder, c) }))) : [];
      for (const c of cues) files[c.file] = {};
      const spec = { ...planned.spec, sounds: cues };
      // A layer placed in the room needs the camera's path and the spots resolved to 3D. The scene
      // points the solve found are left behind: they are only for placing a spot marked once, which has
      // already happened by now, and there are thousands of them.
      let track = null, world = null;
      if (planned.spec.layers.some(l => l.world || l.worldPath)) {
        const t = await loadTrack(footageFiles(store.dir, f.id).dir);
        track = { frames: t.frames, fovY: t.fovY, aspect: t.aspect, up: t.up, scale: t.scale, poses: t.poses };
        world = Object.fromEntries((await resolveWorld(f, planned.spec)).points.map(p => [p.name, p.position]));
      }
      // Where each named clip's video is, and what shape it is: a cut from another clip fills the frame
      // its own way rather than being squeezed into this one's.
      const videos = Object.fromEntries(planned.spec.clips.map(c => {
        const about = store.footage(c.footage).info.work;
        return [c.name, { footage: c.footage, width: about.width, height: about.height, frames: about.frames }];
      }));
      const body = JSON.stringify({ footage: f.id, render: job.id, kind: job.kind, ...job.request,
        props: { spec, plan, assets, source: { width: work.width, height: work.height, frames: work.frames }, depth: f.info.depth ?? null, models, sounds: files, track, world, videos, blank: !!f.info.blank } });
      let out;
      for (let waited = 0; ; waited++) {
        const r = await clipFetcher(`${renderUrl()}/clip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(job.kind === 'stills' ? 5 * 60000 : 60 * 60000) });
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
      // A video comes with a sheet of frames from the file itself, for the dashboard and for ChatGPT.
      if (job.kind === 'video') try { out = { ...out, sheet: await videoSheet(f.id, job.id, out) }; } catch (err) { console.error(`Frame sheet for render ${job.id}: ${err.message}`); }
      if (job.kind === 'video') out = { ...out, loudness: await loudness(join(footageFiles(store.dir, f.id).renders, out.file)) };
      store.finishFootageRender(job.id, null, out);
    } catch (err) {
      const cause = err.cause?.code || err.cause?.message;
      store.finishFootageRender(job.id, err.name === 'TimeoutError' ? 'Rendering took too long' : cause ? `${err.message} (${cause})` : err.message);
    }
  }
  setImmediate(pump); // renders still queued from before a restart

  const needsClip = f => { if (f.info?.blank) throw fail('This is an animation with no clip behind it, so there is nothing to read frames from'); return f; };
  const ready = id => {
    const f = store.footage(id);
    if (f.status === 'failed') throw fail(`This footage failed to process: ${f.error}`, 409);
    if (f.status !== 'ready') throw fail(`This footage is still being processed${f.progress ? ` (${Math.round(f.progress * 100)}%)` : ''}; try again shortly`, 409);
    return f;
  };
  const checkFrame = (f, frame) => { if (frame > f.info.work.frames - 1) throw fail(`Frame ${frame} is past the end of the clip (its last frame is ${f.info.work.frames - 1})`); return frame; };
  // Eight frames spread over a rendered video, read back from the MP4 itself. Returns the sheet's file name.
  async function videoSheet(footage, id, result) {
    const renders = footageFiles(store.dir, footage).renders, name = `${id}-sheet.jpg`;
    if (!existsSync(join(renders, name))) {
      const frames = spread(0, Math.max(1, Math.round((result.seconds || 1) * FPS)), 8);
      const cells = await Promise.all(frames.map(async n => ({ image: await grabFrame(join(renders, result.file), n, { width: 600 }), label: `${secondsOf(n).toFixed(2)}s into the render` })));
      await sharp(await contactSheet(cells, { portrait: (result.height || 2) >= (result.width || 1) })).toFile(join(renders, name));
    }
    return name;
  }
  const renderSummary = r => ({
    render: r.id, footage: r.footage, version: r.version, kind: r.kind, status: r.status, error: r.error, requested: r.request, created: r.created, updated: r.updated,
    ...(r.status === 'ready' && r.result ? { file: r.result.file || r.result.sheet, url: `${origin}/footage/${r.footage}/renders/${r.result.file || r.result.sheet}`, seconds: r.result.seconds,
      ...(r.kind === 'video' && r.result.sheet ? { sheet: r.result.sheet } : {}) } : {}),
  });
  async function summary(f) {
    const work = f.info?.work;
    return {
      id: f.id, name: f.name, status: f.status, error: f.error, progress: f.progress, created: f.created,
      ...(work ? { frames: work.frames, fps: FPS, seconds: work.duration, width: work.width, height: work.height, orientation: work.width > work.height ? 'landscape' : work.width < work.height ? 'portrait' : 'square', audio: work.audio } : {}),
      blank: !!f.info?.blank,
      source: f.info?.source ?? null,
      depth: f.info?.depth ? { frames: f.info.depth.frames, updated: f.info.depth.updated, source: f.info.depth.source || 'upload' } : null,
      depthJob: depthState(f),
      track: f.info?.track ?? null,
      trackJob: trackState(f),
      assets: await assetList(store.dir, f.id),
      models: await modelList(footageFiles(store.dir, f.id).models),
      sounds: await soundList(footageFiles(store.dir, f.id).sounds),
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
    const { plan } = planEdit(edit.spec, clipInfo(f), await withAssets(f.id), store.graphics(), await withModels(f.id), await withSounds(f.id), withClips());
    const last = plan.durationInFrames - 1;
    const range = from != null || to != null ? [Math.min(last, from ?? 0), Math.min(last, to ?? last)] : null;
    if (range && range[1] < range[0]) throw fail('`to` must not be before `from`');
    return queueRender(f, edit.version, 'video', { scale: quality === 'final' ? 1 : 0.5, quality, ...(range ? { range } : {}) });
  }

  // ---- Dashboard and API --------------------------------------------------------------------------
  app.get('/api/footage', async (_req, res) => res.json({ renderConfigured: !!renderUrl(), limits: { mb: limits(env).bytes / 1048576, seconds: limits(env).seconds }, footage: await Promise.all(store.footageList().map(summary)) }));
  // The upload streams straight to disk; the clip is checked with ffprobe before anything else happens.
  // Start an animation with nothing behind it, from the dashboard.
  app.post('/api/animations', async (req, res) => {
    const body = z.object({ name: z.string().trim().min(1).max(80).default('Animation'), format: z.enum(Object.keys(FORMATS)).default('vertical'), seconds: z.number().min(0.5).max(180).default(6) }).parse(req.body || {});
    res.status(201).json(await summary(createBlank(store, body)));
  });
  // Every render ever made, for the history page.
  app.get('/api/renders', async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const names = new Map();
    res.json({ renders: store.allRenders(limit).map(r => {
      if (!names.has(r.footage)) { try { const f = store.footage(r.footage); names.set(r.footage, { name: f.name, blank: !!f.info?.blank }); } catch { names.set(r.footage, null); } }
      const from = names.get(r.footage);
      return { ...renderSummary(r), name: from?.name ?? null, blank: from?.blank ?? false, gone: !from };
    }) });
  });
  app.post('/api/footage', async (req, res) => {
    const id = await intakeVideo(store, env, req.query.name, (file, max) => receive(req, file, max.bytes));
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
    if (['queued', 'running'].includes(f.info?.depthJob?.status)) throw fail('Depth is being made for this clip; delete it once that has finished', 409);
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
  // 3D models (.glb), checked before they are kept (src/models.js).
  app.post('/api/footage/:id/models/:name', express.raw({ type: () => true, limit: MAX_MODEL }), async (req, res) => {
    const f = store.footage(Id.parse(req.params.id)), name = String(req.params.name || '').toLowerCase();
    if (!ASSET_NAME.test(name)) throw fail('Name the model with lowercase letters, digits and dashes (up to 32), e.g. cat');
    res.status(201).json(await saveModel(req.body, footageFiles(store.dir, f.id).models, name));
  });
  // Sounds for edits: any audio file ffmpeg reads, stored as WAV (src/sounds.js).
  app.post('/api/footage/:id/sounds/:name', express.raw({ type: () => true, limit: MAX_SOUND }), async (req, res) => {
    const f = store.footage(Id.parse(req.params.id)), name = String(req.params.name || '').toLowerCase();
    if (!ASSET_NAME.test(name)) throw fail('Name the sound with lowercase letters, digits and dashes (up to 32), e.g. cat-steps');
    res.status(201).json(await saveSound(req.body, footageFiles(store.dir, f.id).sounds, name));
  });
  app.delete('/api/footage/:id/sounds/:name', async (req, res) => {
    const f = store.footage(Id.parse(req.params.id));
    if (!ASSET_NAME.test(req.params.name)) throw fail('No such sound');
    await deleteSound(footageFiles(store.dir, f.id).sounds, req.params.name);
    res.json({ ok: true });
  });
  app.delete('/api/footage/:id/models/:name', async (req, res) => {
    const f = store.footage(Id.parse(req.params.id));
    if (!ASSET_NAME.test(req.params.name)) throw fail('No such model');
    await deleteModel(footageFiles(store.dir, f.id).models, req.params.name);
    res.json({ ok: true });
  });
  app.post('/api/footage/:id/depth', async (req, res) => {
    const f = ready(Id.parse(req.params.id));
    queueDepth(f);
    res.status(202).json(await summary(store.footage(f.id)));
  });
  app.post('/api/footage/:id/renders', async (req, res) => {
    const f = ready(Id.parse(req.params.id));
    const body = z.object({ version: z.number().int().min(1).optional(), quality: z.enum(['draft', 'final']).default('final') }).parse(req.body || {});
    res.status(202).json(renderSummary(await videoRequest(f, body.version ?? null, body.quality)));
  });
  // The working copy, poster, pictures and renders, for the dashboard. The original upload is not served.
  app.get(/^\/footage\/([a-f0-9]{24})\/(work\.mp4|poster\.jpg|assets\/[a-z0-9][a-z0-9-]{0,31}\.png|depth\/\d{5}\.jpg|sounds\/[a-z0-9][a-z0-9-]{0,31}\.wav|renders\/[0-9]+(?:-sheet|-f[0-9]+)?\.(?:jpg|mp4))$/, (req, res, next) => {
    const [id, file] = [req.params[0], req.params[1]];
    res.sendFile(file, { root: resolve(footageFiles(store.dir, id).dir), dotfiles: 'deny' }, err => { if (err) next(err.statusCode === 404 || err.code === 'ENOENT' ? undefined : err); });
  });

  // ---- MCP tools ----------------------------------------------------------------------------------
  const text = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
  const picture = (buffer, data) => ({ content: [{ type: 'image', data: buffer.toString('base64'), mimeType: 'image/jpeg' }, { type: 'text', text: JSON.stringify(data) }] });
  const read = { readOnlyHint: true, openWorldHint: false }, write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
  const stillsResult = async r => picture(await sharp(join(footageFiles(store.dir, r.footage).renders, r.result.sheet)).toBuffer(), { ...renderSummary(r), frames: r.result.frames });
  async function videoResult(r) {
    const sheet = join(footageFiles(store.dir, r.footage).renders, r.result.sheet || await videoSheet(r.footage, r.id, r.result));
    const level = r.result.loudness;
    return picture(await sharp(sheet).toBuffer(), { ...renderSummary(r),
      audio: level ? { every: level.every, db: level.db.join(' '), note: 'Loudness of the rendered sound every quarter second in dB (-60 silence, about -20 a clear sound effect): check each sound starts where it should' } : 'silent',
      note: 'Frames sampled from the rendered video. The owner downloads it from the dashboard.' });
  }

  function register(server) {
    server.registerTool('list_footage', {
      description: 'Lists clips for animated edits: id, status, length in frames at 30 fps, size, assets, models (with their animations, pickable nodes and bounds in model units), sounds, saved edit versions and recent renders.',
      inputSchema: {}, annotations: read,
    }, async () => text(await Promise.all(store.footageList().map(summary))));

    server.registerTool('new_animation', {
      description: 'Starts an animation with no video behind it: a blank canvas of the size and length you ask for, drawn entirely from layers on the edit\'s background colour. Use it when the owner asks for an animation rather than for something over their own footage. It answers with an id that every other tool takes, and edits on it are versioned and kept like any other.',
      inputSchema: {
        name: z.string().trim().min(1).max(80).describe('What this animation is, for the dashboard'),
        format: z.enum(Object.keys(FORMATS)).default('vertical').describe('vertical 1080x1920 (Reels, Stories), portrait 1080x1350, square 1080x1080, landscape 1920x1080'),
        seconds: z.number().min(0.5).max(180).default(6).describe('How long it runs; the edit can still cut this shorter or longer with its timeline'),
      }, annotations: write,
    }, async ({ name, format, seconds }) => {
      const f = createBlank(store, { name, format, seconds });
      return text({ footage: f.id, name: f.name, blank: true, format, width: f.info.work.width, height: f.info.work.height, frames: f.info.work.frames, fps: FPS, seconds: f.info.work.duration,
        then: 'Write the edit with save_edit, using this id as `footage`. There is no clip, so no anchors, follow, illustrate, depth, world or zoom - place layers with at/path in 0-1 of the frame, and set the edit\'s background colour. preview_edit and render_edit work as usual.' });
    });

    server.registerTool('list_renders', {
      description: 'Every render made so far, newest first, across all clips and animations, with what it came from and how it went. The finished files are on the dashboard.',
      inputSchema: { limit: z.number().int().min(1).max(200).default(50), footage: Id.optional().describe('Only this clip or animation') }, annotations: read,
    }, async ({ limit, footage }) => {
      const rows = (footage ? store.footageRenders(footage) : store.allRenders(limit)).slice(0, limit);
      const names = new Map();
      return text({ renders: rows.map(r => {
        if (!names.has(r.footage)) { try { const f = store.footage(r.footage); names.set(r.footage, { name: f.name, blank: !!f.info?.blank }); } catch { names.set(r.footage, null); } }
        const from = names.get(r.footage);
        return { ...renderSummary(r), name: from?.name ?? null, blank: from?.blank ?? null };
      }) });
    });

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
      const f = needsClip(ready(footage)), work = f.info.work;
      if (from != null) checkFrame(f, from);
      if (from != null && to != null && to <= from) throw fail('`to` must be after `from`');
      const list = frames ? [...new Set(frames)].sort((a, b) => a - b).map(x => checkFrame(f, x)) : spread(from ?? 0, Math.min(work.frames, to ?? work.frames), count);
      const sheet = await sampleSheet(footageFiles(store.dir, f.id).work, list, { portrait: work.height >= work.width });
      return picture(sheet, { footage: f.id, fps: FPS, totalFrames: work.frames, samples: list.map((frame, i) => ({ n: i + 1, frame, seconds: secondsOf(frame) })) });
    });

    server.registerTool('get_frame', {
      description: 'One SOURCE frame at full detail under a 0-1 coordinate grid (x left-right, y top-bottom), for placing anchors. `region` zooms in; labels stay in whole-frame coordinates.',
      inputSchema: {
        footage: Id, frame: z.number().int().min(0).describe('SOURCE frame'),
        grid: z.boolean().default(true),
        region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0.05).max(1), height: z.number().min(0.05).max(1) }).optional().describe('Part of the frame to show, in 0–1 of the footage'),
      }, annotations: read,
    }, async ({ footage, frame, grid, region }) => {
      const f = needsClip(ready(footage));
      checkFrame(f, frame);
      const out = await frameWithGrid(footageFiles(store.dir, f.id).work, frame, { grid, region: region ?? null });
      return picture(out.image, { footage: f.id, frame, seconds: secondsOf(frame), shown: region ?? { x: 0, y: 0, width: 1, height: 1 }, footageSize: out.source });
    });

    server.registerTool('get_edit_guide', {
      description: 'How to write an edit for save_edit: the workflow, the two frame clocks, coordinates, a worked example and tips, then the house rules saved with save_guide_note. Read it before the first edit.',
      inputSchema: {}, annotations: read,
    }, async () => {
      const notes = store.guideNotes();
      const house = notes.length ? `\n\n## House rules (saved with save_guide_note; follow them)\n${notes.map(n => `### ${n.title}\n${n.text}`).join('\n\n')}` : '';
      return { content: [{ type: 'text', text: GUIDE + house }] };
    });

    server.registerTool('save_guide_note', {
      description: 'Adds a rule or lesson to the end of get_edit_guide for every later edit and chat, e.g. a working method the owner asked for or a fix that worked. Saving an existing title replaces it. Keep each note short and specific.',
      inputSchema: {
        title: z.string().trim().min(3).max(80).describe('Short title, e.g. "Sprite-first effects"'),
        text: z.string().trim().min(10).max(2000).describe('The rule, in plain words, with the asset or setting names it relies on'),
      }, annotations: write,
    }, async ({ title, text: body }) => {
      if (store.guideNotes().length >= 40 && !store.guideNotes().some(n => n.title === title)) throw fail('There are 40 notes already; replace or delete one first');
      store.saveGuideNote(title, body);
      return text({ saved: title, notes: store.guideNotes().map(n => n.title) });
    });

    server.registerTool('delete_guide_note', {
      description: 'Removes a house rule from get_edit_guide by its title.',
      inputSchema: { title: z.string().trim().min(1).max(80) }, annotations: { ...write, destructiveHint: true },
    }, async ({ title }) => {
      if (!store.deleteGuideNote(title)) throw fail(`No note called '${title}'`);
      return text({ deleted: title, notes: store.guideNotes().map(n => n.title) });
    });

    server.registerTool('get_edit', {
      description: 'The saved edit for a clip (latest version unless one is given), its timeline and the list of versions.',
      inputSchema: { footage: Id, version: z.number().int().min(1).optional() }, annotations: read,
    }, async ({ footage, version }) => {
      const f = ready(footage), edit = store.edit(f.id, version ?? null);
      const { timeline, plan, cues, warnings } = planEdit(edit.spec, clipInfo(f), await withAssets(f.id), store.graphics(), await withModels(f.id), await withSounds(f.id), withClips());
      const world = await resolveWorld(f, edit.spec).catch(err => ({ points: [], warnings: [err.message] }));
      return text({ footage: f.id, version: edit.version, note: edit.note, edit: toMcpEdit(edit.spec), durationFrames: plan.durationInFrames, seconds: secondsOf(plan.durationInFrames), timeline, sounds: cues,
        ...(world.points.length ? { world: world.points } : {}), warnings: [...warnings, ...world.warnings], versions: store.edits(f.id) });
    });

    server.registerTool('save_edit', {
      description: 'Save an animated edit for a clip as a new version (read get_edit_guide first). Checked against the clip and its pictures; answers with the output↔source timeline and warnings. Saving renders nothing and publishes nothing.',
      inputSchema: { footage: Id, edit: McpEditSpec, note: z.string().trim().max(200).optional().describe('What changed, for the version list') }, annotations: write,
    }, async ({ footage, edit, note }) => {
      const f = ready(footage);
      const { spec, plan, timeline, cues, warnings } = planEdit(fromMcpEdit(edit), clipInfo(f), await withAssets(f.id), store.graphics(), await withModels(f.id), await withSounds(f.id), withClips());
      const world = await resolveWorld(f, spec);
      const saved = store.saveEdit(f.id, spec, note || null);
      return text({ footage: f.id, version: saved.version, format: spec.format, size: [plan.width, plan.height], fps: FPS, durationFrames: plan.durationInFrames, seconds: secondsOf(plan.durationInFrames), timeline, sounds: cues,
        ...(world.points.length ? { world: world.points } : {}), warnings: [...warnings, ...world.warnings], next: 'preview_edit to check frames, then render_edit' });
    });

    server.registerTool('preview_edit', {
      description: 'Renders chosen OUTPUT frames of a saved edit as real stills, returned as one labelled sheet. Without `frames`, one inside each layer. Returns the sheet if done in ~45 s, else a render id for get_render.',
      inputSchema: {
        footage: Id, version: z.number().int().min(1).optional().describe('Edit version (default latest)'),
        frames: z.array(z.number().int().min(0)).min(1).max(12).optional().describe('OUTPUT frames to render'),
        scale: z.number().min(0.25).max(1).default(0.5).describe('Size of the stills; 0.5 is half of 1080 wide'),
      }, annotations: write,
    }, async ({ footage, version, frames, scale }) => {
      if (!renderUrl()) throw fail('The render service is not configured (RENDER_URL)');
      const f = ready(footage), edit = store.edit(f.id, version ?? null);
      const { plan, spec } = planEdit(edit.spec, clipInfo(f), await withAssets(f.id), store.graphics(), await withModels(f.id), await withSounds(f.id), withClips());
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
      description: 'Renders a saved edit to MP4 in the background. draft is half size for checking motion, final is full size. Returns a render id; poll get_render. Nothing is published.',
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

    server.registerTool('save_graphic', {
      description: 'Saves a named graphic (shapes with keyframed animation; see get_edit_guide) for any edit to use as {\"type\":\"graphic\",\"use\":\"<name>\"}. Re-saving a name replaces it; saved edits keep their copy.',
      inputSchema: { name: AssetName, graphic: GraphicDef, note: z.string().trim().max(200).optional().describe('What it is, for list_graphics') }, annotations: write,
    }, async ({ name, graphic, note }) => {
      const errors = graphicErrors(graphic, name);
      if (errors.length) throw fail(errors.join('; '));
      store.saveGraphic(name, graphic, note || null);
      return text({ saved: name, elements: graphic.elements.length, use: `{"type":"graphic","use":"${name}","from":…,"to":…,"at":…}` });
    });

    // Sprite sheets from single frames, so ChatGPT can make each frame separately (drawn, generated or
    // rendered) and get one sheet laid out the way sequence and particles layers read it.
    server.registerTool('build_sprite', {
      description: 'Builds a sprite sheet from pictures already uploaded to the clip, one per frame in order, laid out in a grid for a sequence or particles layer. Each frame is centred in an equal cell with transparency kept. Answers with count, columns and a layer to start from.',
      inputSchema: {
        footage: Id, name: AssetName.describe('Name for the sheet'),
        frames: z.array(AssetName).min(2).max(256).describe('Uploaded pictures, in playing order'),
        columns: z.number().int().min(1).max(64).optional().describe('Frames per row (default: as many as fit 8192 px)'),
        remove: z.boolean().default(false).describe('Delete the single frame pictures once the sheet is made'),
      }, annotations: write,
    }, async ({ footage, name, frames, columns, remove }) => {
      const f = store.footage(footage), folder = footageFiles(store.dir, f.id).assets;
      const files = frames.map(n => join(folder, `${n}.png`));
      const missing = frames.filter((n, i) => !existsSync(files[i]));
      if (missing.length) throw fail(`No picture called ${missing.map(n => `'${n}'`).join(', ')} on this clip`);
      const metas = await Promise.all(files.map(file => sharp(file).metadata()));
      let cw = Math.max(...metas.map(m => m.width)), ch = Math.max(...metas.map(m => m.height));
      const LIMIT = 8192;
      let cols = columns ?? Math.max(1, Math.min(frames.length, Math.floor(LIMIT / cw) || 1));
      let rows = Math.ceil(frames.length / cols);
      // Shrink the cells if the sheet would be too big to handle.
      const k = Math.min(1, LIMIT / (cols * cw), LIMIT / (rows * ch), Math.sqrt(40e6 / (cols * cw * rows * ch)));
      cw = Math.max(1, Math.floor(cw * k)); ch = Math.max(1, Math.floor(ch * k));
      const tiles = await Promise.all(files.map(async (file, i) => ({
        input: await sharp(file).resize(cw, ch, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
        left: (i % cols) * cw, top: Math.floor(i / cols) * ch,
      })));
      await mkdir(folder, { recursive: true });
      const out = join(folder, `${name}.png`), tmp = `${out}.part`;
      await sharp({ create: { width: cols * cw, height: rows * ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(tiles).png().toFile(tmp);
      await rename(tmp, out);
      if (remove) for (const [i, n] of frames.entries()) if (n !== name) await rm(files[i], { force: true });
      return text({ name, width: cols * cw, height: rows * ch, count: frames.length, columns: cols, frame: { width: cw, height: ch }, ...(k < 1 ? { note: `Frames were scaled to ${Math.round(k * 100)}% to fit the sheet` } : {}),
        use: { type: 'sequence', asset: name, count: frames.length, columns: cols, fps: 12 } });
    });

    server.registerTool('list_graphics', {
      description: 'Saved graphics that edits can reuse by name, with their definitions.',
      inputSchema: {}, annotations: read,
    }, async () => text(store.graphicList()));

    server.registerTool('create_upload_link', {
      description: 'A one-time 30-minute link for sending a sandbox file to a clip. kind: picture (PNG/JPEG/WebP, default), model (.glb, textures embedded, no Draco), sound (MP3/WAV/OGG/FLAC/M4A, up to 3 min), depth (greyscale MP4, near = white, one frame per clip frame), track (camera track JSON recorded while filming by an AR app). PUT or POST the raw file as the body: curl --fail -T file \"<url>\".',
      inputSchema: { footage: Id.optional().describe('The clip this belongs to; leave out for kind video, which makes a new one'), kind: z.enum(['picture', 'model', 'sound', 'depth', 'track', 'video']).default('picture'), name: AssetName.optional().describe('Required for a picture, model or sound'), title: z.string().trim().min(1).max(80).optional().describe('What the clip is, for kind video') }, annotations: write,
    }, async ({ footage, kind, name, title }) => {
      // A video has no clip to belong to: the link makes one, waiting for the file, and the upload
      // fills it in. Everything else attaches to a clip that is already here.
      const f = kind === 'video'
        ? store.addFootage(newFootageId(), cleanName(title || name || 'Clip'))
        : store.footage(footage ?? '');
      if (!['depth', 'track', 'video'].includes(kind) && !name) throw fail(`Give the ${kind} a name`);
      if (['depth', 'track'].includes(kind) && f.status !== 'ready') throw fail('The clip is not ready yet', 409);
      const token = randomBytes(24).toString('base64url'), expires = new Date(Date.now() + LINK_MINUTES * 60000);
      store.addUploadLink(tokenHash(token), f.id, ['depth', 'track', 'video'].includes(kind) ? kind : name, expires, kind);
      const url = `${origin}/u/${token}`;
      if (kind === 'video') {
        const max = limits(env);
        return text({ url, expires: expires.toISOString(), footage: f.id, kind, name: f.name, maxMB: max.bytes / 1048576, maxSeconds: max.seconds,
          upload: `curl --fail -sS -T /path/to/clip.mp4 "${url}"`,
          then: 'The server makes a 30 fps working copy in the background. Watch list_footage until this clip is ready; it then has a frame count and can be animated, or named in another edit\'s clips to cut between videos.' });
      }

      if (kind === 'track') return text({ url, expires: expires.toISOString(), footage: f.id, kind, maxMB: MAX_TRACK / 1048576, frames: f.info.work.frames, fps: FPS,
        upload: `curl --fail -sS -H 'content-type: application/json' -T /path/to/track.json "${url}"`,
        format: '{"frames":[{"t":<seconds>,"matrix":[16 numbers]}...],"intrinsics":{"fx","fy","width","height"}}, or "position"+"quaternion" [x,y,z,w] per frame and "fovY" in degrees. Optional: "convention" opengl|opencv (default opengl, which is ARKit and three.js), "space" camera-to-world|world-to-camera, "roll" 0|90|-90|180 if the video was rotated on export, "up" [x,y,z], "points" for placing a spot seen on one frame only.',
        then: 'An AR track recorded while filming is used ahead of anything solved here. get_track draws a grid on the ground to check it.' });
      if (kind === 'depth') return text({ url, expires: expires.toISOString(), footage: f.id, kind, maxMB: MAX_DEPTH / 1048576, frames: f.info.work.frames,
        upload: `curl --fail -sS -T /path/to/depth.mp4 "${url}"`, then: 'The server checks it has one frame per clip frame, then edits can use "depth":{"video":true}; get_depth reads values.' });
      if (kind === 'sound') return text({ url, expires: expires.toISOString(), footage: f.id, kind, name, maxMB: MAX_SOUND / 1048576, upload: `curl --fail -sS -T /path/to/${name}.mp3 "${url}"`,
        then: `Place it in the edit's sounds: {"sound":"${name}","at":<output frame>}; list_footage shows it under sounds with its length.` });
      if (kind === 'model') return text({ url, expires: expires.toISOString(), footage: f.id, kind, name, maxMB: MAX_MODEL / 1048576, upload: `curl --fail -sS -T /path/to/${name}.glb "${url}"`,
        then: `The answer lists its animations. Use it as {"type":"model","asset":"${name}","animation":"<one of them>",...}; list_footage shows it under models.` });
      return text({ url, expires: expires.toISOString(), footage: f.id, name, maxMB: MAX_ASSET / 1048576, upload: `curl --fail -sS -T /path/to/${name}.png "${url}"`,
        then: `Use it in an edit as {"type":"image","asset":"${name}",...}; list_footage shows it with its size.` });
    });

    server.registerTool('list_looks', {
      description: 'The colour grading board: every named film look, when it suits a shot, and the colours it pulls a picture towards. Use one on a grade layer: {"type":"grade","from":0,"to":<end>,"look":"teal-orange"}. get_colors says which of them suit a particular clip.',
      inputSchema: {}, annotations: read,
    }, async () => text({ looks: LOOK_NAMES.map(name => ({ look: name, about: LOOKS[name].about, palette: LOOKS[name].palette, sets: LOOKS[name].set })),
      note: 'A grade layer can name a look and still change any knob itself (exposure, contrast, saturation, temperature, tint, lift, gain, fade, vignette, grain, halation, aberration, rolloff), and add letterbox bars. strength 0-1 mixes the look in.',
      matching: 'A look pushes every clip the same way, which only lands if they start from the same place. match_grade measures two clips and works out the knobs that bring one to the other; match the clips to each other first, then put one look over all of them.',
      finishing: 'Grain, bloom and highlight roll-off over the WHOLE frame, titles included, belong on a finish layer rather than a grade: {"type":"finish","from":0,"to":<end>}. That is what makes clips from different cameras look like one print. get_edit_guide has the section.' }));

    server.registerTool('get_colors', {
      description: 'What a frame of a clip is actually made of: its main colours with how much of the picture each covers, and which looks from the grading board suit it. Use it before choosing a grade, so the look matches the shot instead of fighting it.',
      inputSchema: { footage: Id, frame: z.number().int().min(0).default(0).describe('SOURCE frame to read') }, annotations: read,
    }, async ({ footage, frame }) => {
      const f = needsClip(ready(footage));
      const jpeg = await grabFrame(footageFiles(store.dir, f.id).work, checkFrame(f, frame), { width: 160 });
      const { data, info } = await sharp(jpeg).resize(64, 64, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
      // Bucket into a coarse grid and keep the busiest cells: enough to say what a shot is made of,
      // without pretending to a precision that a grading decision does not need.
      const bins = new Map();
      for (let i = 0; i < data.length; i += info.channels) {
        const key = [0, 1, 2].map(k => data[i + k] >> 5).join(',');
        const got = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        got.n++; got.r += data[i]; got.g += data[i + 1]; got.b += data[i + 2];
        bins.set(key, got);
      }
      const pixels = Math.max(1, Math.floor(data.length / info.channels));
      const colours = [...bins.values()].sort((a, b) => b.n - a.n).slice(0, 6)
        .map(c => ({ rgb: [Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)], share: c.n / pixels }));
      const image = await sharp(jpeg).resize({ width: 420 }).jpeg({ quality: 78 }).toBuffer();
      return picture(image, { footage: f.id, frame,
        colours: colours.map(c => ({ hex: rgbToHex(c.rgb), share: +c.share.toFixed(3) })),
        levels: levelsFrom(data, info.channels),
        suits: matchLooks(colours, 4),
        note: 'fit is 0-100: how close the shot already is to that look\'s colours. A high fit needs little pushing; a low one is a bigger change, which may still be what you want.',
        levelsNote: 'levels are 0-1: black and white are where the dark and bright ends of the picture actually sit (1st and 99th percentile), mid its middle, and r/g/b the mean of each channel. Two clips that cut together want the same black. match_grade works the knobs out for you.' });
    });

    server.registerTool('match_grade', {
      description: 'Measures two clips and works out the grade knobs that carry the second towards the first, so a phone clip and stock footage cut together instead of looking like two different films. Answers with both measurements and a grade layer ready to paste. Match every clip in a trailer to the same one.',
      inputSchema: {
        reference: Id.describe('The clip whose look the others should match - usually the best-looking one, or the one the edit opens on'),
        clip: Id.describe('The clip to bring towards it'),
        referenceFrame: z.number().int().min(0).default(0).describe('SOURCE frame of the reference to read'),
        clipFrame: z.number().int().min(0).default(0).describe('SOURCE frame of the other clip to read'),
        name: z.string().regex(/^[a-z][a-z0-9_-]{0,23}$/).optional().describe('The name this clip has in the edit\'s "clips" list, so the grade layer comes back ready to use'),
      },
      annotations: read,
    }, async ({ reference, clip, referenceFrame, clipFrame, name }) => {
      const measure = async (id, frame) => {
        const f = needsClip(ready(id));
        const jpeg = await grabFrame(footageFiles(store.dir, f.id).work, checkFrame(f, frame), { width: 160 });
        const { data, info } = await sharp(jpeg).resize(96, 96, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
        return { id: f.id, frame, ...levelsFrom(data, info.channels) };
      };
      const [a, b] = await Promise.all([measure(reference, referenceFrame), measure(clip, clipFrame)]);
      const { knobs, leftover, limited } = matchKnobs(a, b);
      const was = { black: +(b.black - a.black).toFixed(3), mid: +(b.mid - a.mid).toFixed(3), white: +(b.white - a.white).toFixed(3) };
      return text({
        reference: a, clip: b, knobs,
        layer: { type: 'grade', from: 0, to: 0, ...(name ? { clip: name } : {}), ...knobs },
        apart: { before: was, after: leftover },
        ...(limited.length ? { limited, limitedNote: `${limited.join(' and ')} ran out of range: these two clips are further apart than the knobs reach, so this is as close as grading alone gets. Consider a look on both, or a different clip.` } : {}),
        note: 'Put this on the edit as a grade layer with its own from/to and "clip" set to the name that clip has in "clips", so it covers only the parts that play it. Give the reference clip its own grade too (a look, or nothing) - these knobs move the second clip to where the first ALREADY is, not to where the look will put it.',
        apartNote: 'How far apart the two clips were at each level and how far apart they are left. Exposure and contrast together are a straight line, and a line cannot pass through three points, so the three are fitted rather than forced: the midtones are weighted heaviest (the eye reads overall brightness first) and the extreme white lightest (it is usually one specular, and a roll-off deals with it). If one of them is left further out than you want, nudge that knob yourself: exposure moves everything, contrast opens the ends, lift raises the blacks alone.',
        caveat: 'One frame of each. If either clip changes a lot across its length, measure a frame from the part the edit actually uses.',
      });
    });

    server.registerTool('make_depth', {
      description: 'Makes per-frame depth on the server (Depth Anything V2 Small, near = white) for edits with \"depth\":{\"video\":true}. Background, a few minutes; list_footage shows depthJob progress. Asking again while it runs reports progress.',
      inputSchema: { footage: Id }, annotations: write,
    }, async ({ footage }) => {
      const f = needsClip(ready(footage)), job = queueDepth(f);
      return text({ footage: f.id, depthJob: depthState(store.footage(f.id)) ?? job, frames: f.info.work.frames,
        then: 'Check list_footage until depth is there (depthJob disappears), then use get_depth to read values and "depth": {"video": true} in the edit.' });
    });

    server.registerTool('make_track', {
      description: 'Solves where the camera was on every frame (COLMAP on the server), so things can be placed in the room and stay put when the camera looks away and back. Background, minutes; list_footage shows trackJob. A track recorded while filming by an AR app is better: send one with create_upload_link kind track instead. Needs a clip where the camera MOVES through the room, not just turns on the spot.',
      inputSchema: { footage: Id }, annotations: write,
    }, async ({ footage }) => {
      const f = needsClip(ready(footage)), job = queueTrack(f);
      return text({ footage: f.id, trackJob: trackState(store.footage(f.id)) ?? job, frames: f.info.work.frames,
        then: 'Check list_footage until track is there (trackJob disappears), then get_track to see the ground grid and place points.' });
    });

    server.registerTool('get_track', {
      description: 'The clip\'s camera track, with a checking picture: a grid drawn on the ground and any spots you name, on several frames. If the grid sticks to the same surface as the camera moves, the track is good. Give `sightings` (the same spot marked on two or more frames from different angles) to work out where it is in the room and see it drawn.',
      inputSchema: {
        footage: Id,
        frames: z.array(z.number().int().min(0)).min(1).max(6).optional().describe('SOURCE frames to draw (default: four spread over the clip)'),
        sightings: z.array(z.object({ frame: z.number().int().min(0).describe('SOURCE frame'), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).min(1).max(12).optional()
          .describe('The same spot marked in 0-1 of the footage on two or more frames the camera has moved between'),
      }, annotations: read,
    }, async ({ footage, frames, sightings }) => {
      const f = needsClip(ready(footage));
      if (!f.info.track) throw fail(trackState(f) ? `The camera track is not ready: ${JSON.stringify(trackState(f))}` : 'This clip has no camera track: make_track solves one, or send one recorded while filming with create_upload_link kind track');
      const files = footageFiles(store.dir, f.id);
      const track = await loadTrack(files.dir);
      const spot = sightings?.length ? locate(track, sightings) : null;
      const centre = spot ? spot.position : sceneCentre(track);
      const list = (frames?.length ? [...new Set(frames)].sort((a, b) => a - b) : spread(0, f.info.work.frames - 1, 4)).map(n => checkFrame(f, n));
      const points = spot ? [{ name: 'spot', position: spot.position }] : [];
      const cells = await Promise.all(list.map(async n => ({
        image: await trackOverlay(await grabFrame(files.work, n), track, n, { centre, points, size: 540 }), label: `f${n} · ${secondsOf(n).toFixed(2)}s`,
      })));
      const sheet = await contactSheet(cells, { portrait: f.info.work.height >= f.info.work.width });
      return picture(sheet, { footage: f.id, track: f.info.track, fovY: track.fovY, up: track.up, scale: track.scale, frames: list,
        ...(spot ? { spot, seenAt: sightings.map(s => { const p = project(track, s.frame, spot.position); return { frame: s.frame, marked: [s.x, s.y], lands: p && !p.behind ? [+p.x.toFixed(4), +p.y.toFixed(4)] : null }; }) } : {}),
        note: spot ? (spot.error > 0.02 ? 'The marks do not agree well (error above 0.02); mark the spot more carefully, or on frames the camera has moved further between' : 'The grid lies on the ground through the spot. Check it sticks to the same surface on every frame.')
          : 'The grid is centred on the middle of the scene. Give sightings to place a spot of your own.' });
    });

    server.registerTool('create_download_link', {
      description: 'A 30-minute link to the clip\'s working copy (H.264 MP4, 30 fps, the exact frames edits use), for computing depth yourself. make_depth is easier; get_edit_guide has the recipe.',
      inputSchema: { footage: Id }, annotations: { ...read, openWorldHint: false },
    }, async ({ footage }) => {
      const f = needsClip(ready(footage));
      const token = randomBytes(24).toString('base64url'), expires = new Date(Date.now() + LINK_MINUTES * 60000);
      store.addUploadLink(tokenHash(token), f.id, 'work', expires, 'download');
      return text({ url: `${origin}/d/${token}.mp4`, expires: expires.toISOString(), frames: f.info.work.frames, fps: FPS, width: f.info.work.width, height: f.info.work.height });
    });

    server.registerTool('get_depth', {
      description: 'Reads depth (0 far - 1 near) at points in 0-1 of the footage, at a SOURCE frame or from a depth picture asset, for choosing a layer\'s depth or a blur focus. Also returns the depth picture.',
      inputSchema: {
        footage: Id, frame: z.number().int().min(0).optional().describe('SOURCE frame, for per-frame depth'),
        asset: AssetName.optional().describe('Or a depth picture uploaded as an asset'),
        points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict()).min(1).max(20),
      }, annotations: read,
    }, async ({ footage, frame, asset, points }) => {
      const f = needsClip(ready(footage)), files = footageFiles(store.dir, f.id);
      let file;
      if (asset) file = join(files.assets, `${asset}.png`);
      else {
        if (!f.info.depth) throw fail('This clip has no per-frame depth yet: create_download_link, compute it, then create_upload_link with kind depth');
        file = join(files.depth, depthFrameName(Math.min(f.info.depth.frames - 1, checkFrame(f, frame ?? 0))));
      }
      if (!existsSync(file)) throw fail(asset ? `No picture called '${asset}'` : 'That depth frame is missing');
      const values = await depthAt(file, points);
      const image = await sharp(file).resize({ width: 540, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      return picture(image, { footage: f.id, ...(asset ? { asset } : { frame }), points: points.map((p, i) => ({ ...p, depth: values[i] })), note: '1 is nearest, 0 farthest' });
    });

    server.registerTool('add_video', {
      description: 'Adds a video clip to animate over, from a file in this conversation or a public HTTPS link. The server makes a 30 fps working copy in the background; list_footage shows it as processing, then ready with its frame count. Use it when the owner gives you footage to work with, or to bring in the clips a montage cuts between. For anything over about 200 MB, use create_upload_link with kind video instead.',
      inputSchema: {
        name: z.string().trim().min(1).max(80).describe('What this clip is, for the dashboard'),
        file: z.object({ download_url: z.string().url(), file_id: z.string(), mime_type: z.string().optional(), file_name: z.string().optional() }).optional().describe('The video as a ChatGPT file'),
        url: z.string().url().max(2000).optional().describe('Or a public HTTPS link to the video file itself (not a page it is embedded in)'),
      },
      annotations: { ...write, openWorldHint: true },
      _meta: { 'openai/fileParams': ['file'] },
    }, async ({ name, file, url }) => {
      const source = file?.download_url || url;
      if (!source) throw fail('No video arrived. Attach it to the conversation, give a direct link to the file, or use create_upload_link with kind video');
      let got;
      try { got = await fetchPublic(source, 'video/*, application/octet-stream, */*', MAX_FETCHED_VIDEO, fetcher, 120000); }
      catch (err) { throw fail(`Could not fetch the video (${err.message}). If it is large, use create_upload_link with kind video and curl it up instead`); }
      const id = await intakeVideo(store, env, name, async (dest) => { await writeFile(dest, got.buffer); });
      queueProcessing(id);
      const f = store.footage(id);
      return text({ footage: id, name: f.name, status: f.status, mb: Math.round(got.buffer.length / 104857.6) / 10,
        then: 'Watch list_footage until this clip is ready; it then has a frame count and can be animated, or named in another edit\'s clips to cut between videos.' });
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

    // For a sandbox without outbound network: ChatGPT hands the file over and this server fetches it.
    server.registerTool('add_model', {
      description: 'Adds a 3D model (.glb, textures embedded, no Draco) to a clip from a file in this conversation or a public HTTPS link. Answers with its animations and nodes. Use when your sandbox cannot reach create_upload_link.',
      inputSchema: {
        footage: Id, name: AssetName,
        file: z.object({ download_url: z.string().url(), file_id: z.string(), mime_type: z.string().optional(), file_name: z.string().optional() }).optional().describe('The model as a ChatGPT file'),
        url: z.string().url().max(2000).optional().describe('Or a public HTTPS link to the .glb'),
      },
      annotations: { ...write, openWorldHint: true },
      _meta: { 'openai/fileParams': ['file'] },
    }, async ({ footage, name, file, url }) => {
      const f = store.footage(footage), source = file?.download_url || url;
      if (!source) throw fail('No file arrived. Attach the .glb to the conversation, or ask the owner to add it on the dashboard under 3D models');
      let got;
      try { got = await fetchPublic(source, 'model/gltf-binary, application/octet-stream, */*', MAX_MODEL, fetcher, 60000); } catch (err) { throw fail(`Could not fetch the model (${err.message}). Ask the owner to add it on the dashboard under 3D models`); }
      return text({ footage: f.id, ...await saveModel(got.buffer, footageFiles(store.dir, f.id).models, name) });
    });

    server.registerTool('add_sound', {
      description: 'Adds a sound to a clip from a file in this conversation or a public HTTPS link. MP3, WAV, OGG, FLAC or M4A, up to 3 minutes. Answers with its length; then place it in the edit\'s sounds.',
      inputSchema: {
        footage: Id, name: AssetName,
        file: z.object({ download_url: z.string().url(), file_id: z.string(), mime_type: z.string().optional(), file_name: z.string().optional() }).optional().describe('The sound as a ChatGPT file'),
        url: z.string().url().max(2000).optional().describe('Or a public HTTPS link to the audio file itself'),
      },
      annotations: { ...write, openWorldHint: true },
      _meta: { 'openai/fileParams': ['file'] },
    }, async ({ footage, name, file, url }) => {
      const f = store.footage(footage), source = file?.download_url || url;
      if (!source) throw fail('No file arrived. Attach the sound to the conversation, or ask the owner to add it on the dashboard under Sounds');
      let got;
      try { got = await fetchPublic(source, 'audio/*, application/octet-stream, */*', MAX_SOUND, fetcher, 60000); } catch (err) { throw fail(`Could not fetch the sound (${err.message}). Ask the owner to add it on the dashboard under Sounds`); }
      return text({ footage: f.id, ...await saveSound(got.buffer, footageFiles(store.dir, f.id).sounds, name) });
    });

    // ---- Generated sound ---------------------------------------------------------------------------
    server.registerTool('list_voices', {
      description: 'The narration board: every named delivery, when it is right, and which voice reads it, plus the voices and the speech models on the owner\'s ElevenLabs account. Read it before `speak`, the way list_looks is read before a grade.',
      inputSchema: {}, annotations: read,
    }, async () => {
      const pinned = store.styleVoices();
      const styles = STYLE_NAMES.map(name => ({ style: name, about: STYLES[name].about, sets: STYLES[name].set, voice: pinned[name] ?? null }));
      if (!eleven.configured()) return text({ styles, voices: [], note: 'Generated sound is not set up on this server (ELEVENLABS_API_KEY is not set), so speak, make_sound_effect and make_music will refuse. The board is still what the styles mean.' });
      let voices = [], list = [];
      try { [voices, list] = await Promise.all([eleven.voices(), models()]); } catch (err) { return text({ styles, voices: [], error: err.message }); }
      return text({ styles, voices,
        models: list.map(m => ({ ...m, directedBy: m.canStyle ? 'the style knob' : 'tags written into the text', costPerCharacter: m.rate })),
        usingByDefault: eleven.model,
        note: 'A style carries the DELIVERY (how it is read) and a voice carries who reads it. Pin a voice to a style once with set_style_voice and every later `speak` in that style uses it. Without a pin, the account\'s first voice reads everything, which is rarely what anyone wants.',
        modelNote: 'speak takes a "model". costPerCharacter is ElevenLabs\' own multiplier, so one at 0.5 is half price. Models that report directedBy "tags" ignore the style knob: the board writes its tag into the text for those instead, and you can write your own ([whispers], [sighs], [sarcastic], [excited]) anywhere in the text. Changing model makes a new take rather than reusing the cached one.' });
    });

    server.registerTool('set_style_voice', {
      description: 'Pins one of the account\'s voices to a narration style, so every later `speak` in that style is read by it. Changing it does not touch sounds already made.',
      inputSchema: { style: z.enum(STYLE_NAMES), voice: z.string().min(1).max(64).describe('voice id from list_voices') },
      annotations: write,
    }, async ({ style, voice }) => {
      const known = await eleven.voices();
      const found = known.find(v => v.voice === voice);
      if (!found) throw fail(`That ElevenLabs account has no voice ${voice}. list_voices shows the ones it has.`);
      store.setStyleVoice(style, voice);
      return text({ style, voice, name: found.name, note: `'${style}' is now read by ${found.name}.` });
    });

    server.registerTool('speak', {
      description: 'Reads text aloud in a named delivery (list_voices) and adds it to a clip as a sound, ready to place on the edit\'s timeline. For poems, narration and voiceover. The same words in the same delivery are only ever generated once, so asking again is free and sounds identical.',
      inputSchema: {
        footage: Id, name: AssetName,
        text: z.string().trim().min(1).max(5000).describe('What to say. Punctuation is the direction: a full stop is a beat, a line break a longer one, an em dash a catch'),
        style: z.enum(STYLE_NAMES).default('poem-narrative').describe('How it is read; list_voices says what each one is for'),
        strength: z.number().min(0).max(1).default(1).describe('How far towards that delivery, 0 plain, 1 all of it'),
        voice: z.string().min(1).max(64).optional().describe('A particular voice id, instead of the one pinned to the style'),
        captions: z.boolean().default(false).describe('Also answer with text layers timed to the words, from the voice\'s own timings, to paste into the edit'),
        at: z.number().int().min(0).max(100000).default(0).describe('The OUTPUT frame the narration starts on, so the captions line up with where you put the cue'),
        perLine: z.number().int().min(1).max(8).default(4).describe('Words per caption line'),
        model: z.string().min(1).max(60).optional().describe('Which speech model reads it; list_voices shows the account\'s models with what each costs. Leave it out for the server\'s default'),
      },
      annotations: { ...write, openWorldHint: true },
    }, async ({ footage, name, text: words, style, strength, voice, captions, at, perLine, model }) => {
      const f = store.footage(footage);
      const [{ voice: id, how }, m] = await Promise.all([voiceFor(style, voice), modelFor(model)]);
      // What the model will listen to decides how the delivery is given: a knob for a model that takes
      // knobs, a tag written into the text for one that does not.
      const settings = voiceSettings(style, strength, { style: m.canStyle, speakerBoost: m.canSpeakerBoost });
      const spoken = directedText(words, style, m.model);
      const estimate = estimateCredits('speech', { text: spoken, rate: m.rate });
      const made = await generated('speech', { text: spoken, voice: id, settings, model: m.model, captions }, estimate,
        `${spoken.length} characters of speech on ${m.model}`,
        async () => (captions
          ? await (async () => { const got = await eleven.speechWithTimings(id, spoken, settings, m.model); return { buffer: got.buffer, meta: { words: wordsFromAlignment(got.alignment) } }; })()
          : { buffer: await eleven.speech(id, spoken, settings, m.model), meta: null }));
      const saved = await saveSound(made.buffer, footageFiles(store.dir, f.id).sounds, name);
      const timed = made.meta?.words ? captionLayers(made.meta.words, { at, fps: FPS, perLine }) : null;
      return text({ footage: f.id, ...saved, style, voice: id, voiceChosen: how, model: m.model,
        ...(spoken !== words ? { spoken, spokenNote: `${m.model} is directed by tags in the text rather than by the style knob, so '${style}' was given as ${STYLES[style].tag}. Write your own tags into the text to override it.` } : {}),
        ...(!m.canStyle && !STYLES[style]?.tag ? { styleNote: `${m.model} does not take the style knob, and '${style}' has no tag, so this delivery came only from its stability and speed. eleven_multilingual_v2 would give you the rest of it.` } : {}),
        credits: made.credits, cached: made.cached, creditsAre: made.cached ? 'nothing: it came from the cache' : made.measured ? 'measured from the account' : 'an estimate - ElevenLabs had not counted this generation yet', ...(made.cached ? { cachedNote: 'Already generated with exactly these words and settings, so this cost nothing and sounds the same as before.' } : {}),
        ...(timed ? { captions: timed, captionNote: `Text layers timed to the voice, in OUTPUT frames from ${at}. Paste them into the edit's layers; move them all by changing \`at\` here rather than by hand.` } : {}),
        then: `Place it on the edit: {"sound":"${name}","at":${at},"duck":0.3} under sounds. duck drops the clip's own sound while it talks.` });
    });

    server.registerTool('make_sound_effect', {
      description: 'Generates a sound effect from a description and adds it to a clip: a whoosh, an impact, a door, tyres on gravel, a room tone. Up to 30 seconds. Ask for one sound, described plainly - "heavy wooden door closing in a stone hall", not a sentence about a scene.',
      inputSchema: {
        footage: Id, name: AssetName,
        prompt: z.string().trim().min(2).max(450).describe('The sound itself, plainly described'),
        seconds: z.number().min(0.5).max(30).optional().describe('How long. Left out, ElevenLabs picks a length from the description'),
        influence: z.number().min(0).max(1).default(0.3).describe('How literally to take the words; higher follows them more exactly and invents less'),
        loop: z.boolean().default(false).describe('Make it loop seamlessly, for a bed that runs under a whole shot (rain, engine idle, crowd)'),
      },
      annotations: { ...write, openWorldHint: true },
    }, async ({ footage, name, prompt, seconds, influence, loop }) => {
      const f = store.footage(footage);
      const estimate = estimateCredits('effect', { seconds: seconds ?? 5 });
      const made = await generated('effect', { prompt, seconds: seconds ?? null, influence, loop }, estimate,
        `a ${seconds ? `${seconds} s` : ''} sound effect`.replace('  ', ' '),
        async () => ({ buffer: await eleven.effect(prompt, seconds, influence, loop) }));
      const saved = await saveSound(made.buffer, footageFiles(store.dir, f.id).sounds, name);
      return text({ footage: f.id, ...saved, prompt, credits: made.credits, cached: made.cached, creditsAre: made.cached ? 'nothing: it came from the cache' : made.measured ? 'measured from the account' : 'an estimate - ElevenLabs had not counted this generation yet',
        ...(loop ? { loopNote: 'It loops seamlessly: place it with "loop": true and a length, and it runs under the whole shot.' } : {}),
        then: `Place it on the edit: {"sound":"${name}","at":<output frame>}. An impact wants to land ON the frame the thing happens, not after it.` });
    });

    server.registerTool('make_music', {
      description: 'Generates a music bed from a description and adds it to a clip. Say the mood, the instruments and the pace - "slow piano and low strings, sparse, unresolved" - not the name of a band. The most expensive of these, so decide the length first.',
      inputSchema: {
        footage: Id, name: AssetName,
        prompt: z.string().trim().min(2).max(2000).describe('The music: mood, instruments, pace'),
        seconds: z.number().min(3).max(MAX_SOUND_SECONDS).describe('How long it runs'),
      },
      annotations: { ...write, openWorldHint: true },
    }, async ({ footage, name, prompt, seconds }) => {
      const f = store.footage(footage);
      const estimate = estimateCredits('music', { seconds });
      const made = await generated('music', { prompt, seconds }, estimate, `${seconds} s of music`,
        async () => ({ buffer: await eleven.music(prompt, Math.round(seconds * 1000)) }));
      const saved = await saveSound(made.buffer, footageFiles(store.dir, f.id).sounds, name);
      return text({ footage: f.id, ...saved, prompt, credits: made.credits, cached: made.cached, creditsAre: made.cached ? 'nothing: it came from the cache' : made.measured ? 'measured from the account' : 'an estimate - ElevenLabs had not counted this generation yet',
        then: `Place it as {"sound":"${name}","at":0,"volume":0.35,"fadeOut":30}. Keep music under narration with volume, or duck it with "duck" on the narration cue.` });
    });

    server.registerTool('voice_budget', {
      description: 'What is left of the ElevenLabs account this period, what the cap for generated sound is, and what has been spent on what this month. Check it before a long session of generating.',
      inputSchema: {}, annotations: read,
    }, async () => {
      if (!eleven.configured()) return text({ configured: false, note: 'ELEVENLABS_API_KEY is not set on this server, so nothing can be generated.' });
      const sub = await subscription(true), ceiling = creditCap(sub);
      const { used, unreflected } = accountUsed(sub);
      const since = monthStart(), spend = store.voiceSpend(since);
      return text({ configured: true, tier: sub.tier, used, limit: sub.limit, cap: ceiling, left: Math.max(0, ceiling - used), resets: sub.resets,
        accountSays: sub.used, ...(unreflected ? { notCountedYet: unreflected } : {}),
        thisMonth: { ...spend, byKind: store.voiceSpendByKind(since) },
        note: 'used is what the cap is measured against: the account\'s own count plus anything generated here too recently for ElevenLabs to have counted. accountSays is their raw number, which lags. cap is the ceiling THIS server generates up to, so the owner always keeps some of the plan for their own use.',
        rates: 'Speech is about one credit a character; a sound effect with a length given is 40 credits a second. Anything already generated with the same words and settings comes from the cache and costs nothing - the cheapest thing you can do is not ask twice.' });
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
