import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../src/store.js';
import { createAnimator } from '../src/animate.js';
import { createApp } from '../src/app.js';
import { describe, grabFrame, probe, transcode, footageFiles } from '../src/footage.js';
import { planEdit, previewFrames, sourceFrameAt } from '../src/edits.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
const needsFfmpeg = { skip: !hasFfmpeg && 'ffmpeg not installed' };
const ffmpeg = args => { const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args]); if (r.status !== 0) throw new Error(r.stderr.toString()); };

// A clip whose brightness gives away its frame number: frame N has luma 16 + 3N.
async function rampClip(dir, { fps = 30, seconds = 2, size = '64x96' } = {}) {
  const file = join(dir, `ramp-${fps}.mp4`);
  ffmpeg(['-f', 'lavfi', '-i', `color=black:s=${size}:r=${fps},geq=lum='16+N*3':cb=128:cr=128`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '8', '-c:a', 'aac', '-shortest', file]);
  return file;
}
// Stands in for the depth model in tests: same input and output as Depth Anything, and its "depth" is
// just each pixel's brightness, so a clip that brightens left to right has depth growing left to right.
const STANDIN_DEPTH = new URL('./fixtures/standin-depth.onnx', import.meta.url).pathname;
const frameOf = async jpeg => Math.round((await sharp(jpeg).stats()).channels[0].mean / (3 * 255 / 219));

test('Clips are described upright, with HDR and sound noted, and files without video are refused', () => {
  const probed = { format: { duration: '4.2' }, streams: [
    { codec_type: 'video', codec_name: 'hevc', width: 1920, height: 1080, avg_frame_rate: '30000/1001', color_transfer: 'arib-std-b67', side_data_list: [{ rotation: -90 }] },
    { codec_type: 'audio' },
  ] };
  assert.deepEqual(describe(probed), { width: 1080, height: 1920, rotation: 270, duration: 4.2, fps: 29.97, codec: 'hevc', audio: true, hdr: true });
  assert.equal(describe({ format: { duration: '1' }, streams: [{ codec_type: 'video', width: 640, height: 480, r_frame_rate: '25/1' }] }).hdr, false);
  assert.throws(() => describe({ format: { duration: '3' }, streams: [{ codec_type: 'audio' }] }), /no video track/);
  assert.throws(() => describe({ format: {}, streams: [{ codec_type: 'video', width: 10, height: 10 }] }), /no readable frames/);
});

test('The working copy runs at 30 fps and frame N on a sheet is frame N in the file', needsFfmpeg, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'riga-ramp-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = await rampClip(dir);
  const info = describe(await probe(source));
  const work = await transcode(source, join(dir, 'work.mp4'), info);
  assert.equal(work.frames, 60);
  assert.equal(work.fps, 30);
  assert.equal(work.audio, true);
  for (const n of [0, 1, 29, 30, 31, 59]) assert.equal(await frameOf(await grabFrame(join(dir, 'work.mp4'), n)), n, `frame ${n}`);
  // 25 fps footage is retimed: two seconds is still sixty frames.
  const slow = await rampClip(dir, { fps: 25 });
  assert.equal((await transcode(slow, join(dir, 'work25.mp4'), describe(await probe(slow)))).frames, 60);
});

test('An edit maps output frames to source frames through cuts, holds and speed changes', () => {
  const footage = { frames: 300, width: 1080, height: 1920 };
  const { plan, timeline, spec, warnings } = planEdit({
    timeline: [{ from: 30, to: 118 }, { hold: 118, frames: 60 }, { from: 118, to: 138, speed: 0.5 }, { from: 200, to: 240, speed: 2 }],
    anchors: { fork: [{ frame: 118, x: 0.55, y: 0.45 }, { frame: 96, x: 0.52, y: 0.64 }] },
    layers: [{ type: 'text', from: 0, to: 500, text: 'Hello', style: 'title' }, { type: 'zoom', from: 60, to: 150, scale: 1.4, focus: 'fork' }, { type: 'flash', from: 84, to: 88 }],
  }, footage);
  assert.deepEqual(timeline, [{ output: [0, 88], source: [30, 118] }, { output: [88, 148], hold: 118 }, { output: [148, 188], source: [118, 138], speed: 0.5 }, { output: [188, 208], source: [200, 240], speed: 2 }]);
  assert.equal(plan.durationInFrames, 208);
  assert.deepEqual([0, 87, 88, 147, 148, 149, 150, 187, 188, 207].map(f => sourceFrameAt(plan.segments, f)), [30, 117, 118, 118, 118, 118, 119, 137, 200, 238]);
  assert.deepEqual(spec.anchors.fork.map(k => k.frame), [96, 118], 'keyframes are put in order');
  assert.equal(spec.layers[0].to, 208, 'a layer past the end is cut at the end');
  assert.match(warnings.join('\n'), /cut at frame 208/);
  assert.doesNotMatch(warnings.join('\n'), /flash.*shortened/, 'a flash has no entrance and exit to shorten');
  assert.equal(spec.format, 'vertical'); assert.equal(spec.layers[0].enter, 'pop', 'defaults are filled in so a version renders the same later');
  const frames = previewFrames(plan, spec.layers, 8);
  assert.ok(frames.length <= 8 && frames[0] === 0 && frames.at(-1) === 207);
});

test('Edits that do not fit the clip are refused with the reason', () => {
  const footage = { frames: 120, width: 1080, height: 1920 };
  const refuse = (edit, pattern, assets) => assert.throws(() => planEdit(edit, footage, assets), pattern);
  refuse({ timeline: [{ from: 10, to: 5 }] }, /'to' must be after 'from'/);
  refuse({ timeline: [{ hold: 400, frames: 10 }] }, /past the end of the clip \(its last frame is 119\)/);
  refuse({ layers: [{ type: 'sticker', from: 0, to: 10, shape: 'steam', at: 'cup' }] }, /no anchor 'cup'/);
  refuse({ layers: [{ type: 'text', from: 200, to: 210, text: 'late' }] }, /only 120 frames long/);
  refuse({ layers: [{ type: 'image', from: 0, to: 10, asset: 'drawn' }] }, /no image called 'drawn'/);
  refuse({ anchors: { a: [{ frame: 1, x: 0.5, y: 0.5 }] }, layers: [{ type: 'zoom', from: 0, to: 50, scale: 2, focus: 'a' }, { type: 'zoom', from: 40, to: 90, scale: 1.5, focus: { x: 0.2, y: 0.2 } }] }, /one zoom at a time/);
  refuse({ layers: [{ type: 'text', from: 0, to: 10, text: 'a\nb\nc\nd' }] }, /three lines/);
  refuse({ layers: [{ type: 'text', from: 0, to: 10, text: 'x', color: 'url(javascript:1)' }] }, /palette name|#rrggbb|Invalid/);
  refuse({ anchors: { 'Bad Name': [{ frame: 1, x: 0.5, y: 0.5 }] } }, /anchors.Bad Name: use lowercase/);
  refuse({ layers: [{ type: 'illustrate', from: 0, to: 10, colors: ['ink'] }] }, /exactly 2/);
  refuse({ layers: [{ type: 'script', from: 0, to: 10 }] }, /Invalid discriminator|type/);
  refuse({ layers: [{ type: 'text', from: 0, to: 10, text: 'x', css: 'position:fixed' }] }, /Unrecognized key/);
  const ok = planEdit({ layers: [{ type: 'image', from: 0, to: 10, asset: 'drawn', place: 'footage' }] }, footage, { drawn: { width: 1000, height: 1000 } });
  assert.match(ok.warnings.join(), /not the shape of the footage/);
});

// An app with a stand-in render service: it writes the files the real one would, and can be busy.
async function setup(t, { renderUrl = 'http://render:3200', busy = 0, failRender = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'riga-footage-'));
  const store = new Store(dir);
  const calls = [];
  const fetcher = async (url, opts) => {
    // Anything but the render service is a picture being fetched for add_picture.
    if (String(url).endsWith('.glb')) {
      const model = glb();
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/octet-stream', 'content-length': String(model.length) }), arrayBuffer: async () => model };
    }
    if (!String(url).endsWith('/clip')) {
      const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#d4ed86' } }).png().toBuffer();
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png', 'content-length': String(png.length) }), arrayBuffer: async () => png };
    }
    const body = JSON.parse(opts.body);
    calls.push({ url, body });
    if (busy-- > 0) return { ok: false, status: 409, json: async () => ({ error: 'Another video is rendering', busy: true }) };
    if (failRender) return { ok: false, status: 500, json: async () => ({ error: 'Chrome crashed' }) };
    const files = footageFiles(dir, body.footage);
    await mkdir(files.renders, { recursive: true });
    if (body.kind === 'stills') {
      const out = [];
      for (const f of body.frames) {
        const file = `${body.render}-f${f}.jpg`;
        await sharp({ create: { width: 270, height: 480, channels: 3, background: { r: f % 255, g: 80, b: 60 } } }).jpeg().toFile(join(files.renders, file));
        out.push({ frame: f, file });
      }
      return { ok: true, status: 200, json: async () => ({ files: out }) };
    }
    await copyFile(files.work, join(files.renders, `${body.render}.mp4`));
    return { ok: true, status: 200, json: async () => ({ file: `${body.render}.mp4`, seconds: 2, width: 540, height: 960 }) };
  };
  const token = 'f'.repeat(32);
  const app = createApp(store, { ADMIN_TOKEN: token, RENDER_URL: renderUrl, APP_ORIGIN: 'http://localhost:3100', FOOTAGE_MAX_MB: '2', DEPTH_MODEL: STANDIN_DEPTH }, { fetcher, animator: { previewWaitMs: 5000, busyWaitMs: 10 } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const settle = async () => { while (app.locals.renders.size) await Promise.all([...app.locals.renders]); };
  t.after(async () => { await settle(); await new Promise(r => server.close(r)); store.close(); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`, auth = { Authorization: `Bearer ${token}` };
  const upload = (buffer, name = 'clip.mp4', type = 'video/mp4') => fetch(`${base}/api/footage?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { ...auth, 'Content-Type': type }, body: buffer });
  const mcp = async () => {
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: auth } }));
    t.after(() => client.close());
    return client;
  };
  return { dir, store, app, base, auth, upload, settle, calls, mcp };
}
const json = r => r.json();
const imageOf = result => Buffer.from(result.content.find(c => c.type === 'image').data, 'base64');
const dataOf = result => JSON.parse(result.content.find(c => c.type === 'text').text);

test('Uploaded footage is checked, processed in the background, and served only behind the login', needsFfmpeg, async t => {
  const { dir, store, base, auth, upload, settle } = await setup(t);
  const clip = await readFile(await rampClip(dir, { fps: 25 }));
  const res = await upload(clip, 'Pasta night.mp4');
  assert.equal(res.status, 202);
  const accepted = await res.json();
  assert.equal(accepted.status, 'processing');
  assert.equal(accepted.name, 'Pasta night.mp4');
  await settle();
  const f = store.footage(accepted.id);
  assert.equal(f.status, 'ready', f.error);
  assert.deepEqual([f.info.work.frames, f.info.source.fps], [60, 25]);
  assert.ok(!existsSync(footageFiles(dir, f.id).source), 'the original upload is dropped once the working copy exists');
  assert.equal((await fetch(`${base}/footage/${f.id}/poster.jpg`)).status, 401);
  assert.equal((await fetch(`${base}/footage/${f.id}/poster.jpg`, { headers: auth })).headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(`${base}/footage/${f.id}/source`, { headers: auth })).status, 404, 'the original is never served');
  const listed = await fetch(`${base}/api/footage`, { headers: auth }).then(json);
  assert.equal(listed.footage[0].frames, 60);
  assert.equal(listed.footage[0].orientation, 'portrait');
  // Not a video, or too big: refused, and nothing is left behind.
  const notVideo = await upload(Buffer.from('hello'), 'notes.txt', 'application/octet-stream');
  assert.equal(notVideo.status, 400);
  assert.match((await notVideo.json()).error, /not a video/);
  const huge = await upload(Buffer.alloc(3 * 1048576), 'huge.mp4');
  assert.equal(huge.status, 413);
  assert.equal(store.footageList().length, 1);
  assert.equal((await fetch(`${base}/api/footage/${f.id}`, { method: 'DELETE', headers: auth })).status, 200);
  assert.ok(!existsSync(footageFiles(dir, f.id).dir));
});

test('Pictures for an edit are stored as PNG under a safe name', needsFfmpeg, async t => {
  const { dir, store, base, auth, upload, settle } = await setup(t);
  const { id } = await upload(await readFile(await rampClip(dir))).then(json); await settle();
  const png = await sharp({ create: { width: 640, height: 960, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 0.5 } } }).png().toBuffer();
  const put = (name, body) => fetch(`${base}/api/footage/${id}/assets/${name}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'image/png' }, body });
  assert.equal((await put('Bad Name!', png)).status, 400);
  assert.equal((await put('pasta-drawn', Buffer.from('nope'))).status, 400);
  assert.deepEqual(await put('pasta-drawn', png).then(json), { name: 'pasta-drawn', width: 640, height: 960 });
  assert.equal((await sharp(join(footageFiles(dir, id).assets, 'pasta-drawn.png')).metadata()).hasAlpha, true, 'transparency is kept');
  assert.deepEqual((await fetch(`${base}/api/footage`, { headers: auth }).then(json)).footage[0].assets, [{ name: 'pasta-drawn', width: 640, height: 960 }]);
  assert.equal(store.footage(id).status, 'ready');
});

test('save_edit advertises a compatible MCP input schema', async t => {
  const fixtureId = 'a'.repeat(24);
  let saved;
  const store = {
    dir: join(tmpdir(), 'riga-schema-check'),
    recoverFootage() {},
    footage: id => ({ id, status: 'ready', info: { work: { frames: 120, width: 1080, height: 1920, duration: 4 } } }),
    saveEdit: (_id, spec, note) => (saved = { version: 1, spec, note }),
    edit: () => saved,
    edits: () => [{ version: 1 }],
    graphics: () => ({}),
    footageList: () => [],
  };
  const app = { locals: { renders: new Set() }, get() {}, post() {}, patch() {}, delete() {} };
  const server = new McpServer({ name: 'schema-check', version: '1' });
  createAnimator(app, store, { APP_ORIGIN: 'http://localhost' }).register(server);
  const client = new Client({ name: 'schema-check', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await server.close(); });
  const tools = (await client.listTools()).tools;
  const schema = tools.find(x => x.name === 'save_edit').inputSchema;
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    assert.ok(!('propertyNames' in value), 'the MCP schema must not advertise propertyNames');
    if ('items' in value) assert.ok(!Array.isArray(value.items), 'array items must be one schema, not a tuple');
    if ('additionalProperties' in value) assert.equal(typeof value.additionalProperties, 'boolean', 'the MCP schema must not advertise arbitrary keyed records');
    for (const child of Object.values(value)) walk(child);
  };
  walk(schema);
  assert.equal(schema.properties.edit.type, 'object');
  assert.equal(schema.properties.edit.properties.anchors.type, 'array');
  assert.equal(schema.properties.edit.properties.anchors.items.properties.name.type, 'string');
  const result = await client.callTool({ name: 'save_edit', arguments: {
    footage: fixtureId, edit: {
      anchors: [{ name: 'cup', keys: [{ frame: 8, x: 0.5, y: 0.6 }] }],
      layers: [{ type: 'illustrate', from: 0, to: 30, style: 'duotone', colors: ['ink', '#d4ed86'], at: 'cup' }],
    },
  } });
  assert.ok(!result.isError, result.content[0]?.text);
  assert.deepEqual(saved.spec.anchors, { cup: [{ frame: 8, x: 0.5, y: 0.6 }] });
  assert.deepEqual(saved.spec.layers[0].colors, ['ink', '#d4ed86']);
  const fetched = await client.callTool({ name: 'get_edit', arguments: { footage: fixtureId } });
  assert.deepEqual(dataOf(fetched).edit.anchors, [{ name: 'cup', keys: [{ frame: 8, x: 0.5, y: 0.6 }] }]);
  const duplicate = await client.callTool({ name: 'save_edit', arguments: {
    footage: fixtureId, edit: { anchors: [
      { name: 'cup', keys: [{ frame: 8, x: 0.5, y: 0.6 }] },
      { name: 'cup', keys: [{ frame: 9, x: 0.6, y: 0.6 }] },
    ] },
  } });
  assert.ok(duplicate.isError);
});

test('ChatGPT can look at a clip, save an edit, preview it and render it over MCP', needsFfmpeg, async t => {
  const { dir, store, upload, settle, calls, mcp } = await setup(t, { busy: 1 });
  const { id } = await upload(await readFile(await rampClip(dir))).then(json); await settle();
  const client = await mcp();
  const names = (await client.listTools()).tools.map(x => x.name);
  // ChatGPT refuses a tool whose schema uses $ref, tuple-style items or propertyNames ("Invalid MCP tool schema").
  for (const tool of (await client.listTools()).tools) assert.doesNotMatch(JSON.stringify(tool.inputSchema), /"\$ref"|"items":\[|"propertyNames"/, tool.name);
  for (const name of ['list_footage', 'sample_footage', 'get_frame', 'get_edit_guide', 'get_edit', 'save_edit', 'preview_edit', 'render_edit', 'get_render']) assert.ok(names.includes(name), name);
  assert.equal(dataOf(await client.callTool({ name: 'list_footage', arguments: {} }))[0].id, id);

  const sheet = await client.callTool({ name: 'sample_footage', arguments: { footage: id, count: 6 } });
  assert.ok(!sheet.isError);
  assert.equal((await sharp(imageOf(sheet)).metadata()).format, 'jpeg');
  assert.deepEqual(dataOf(sheet).samples.map(s => s.frame), [5, 15, 25, 35, 45, 55]);
  const exact = await client.callTool({ name: 'sample_footage', arguments: { footage: id, frames: [59, 3] } });
  assert.deepEqual(dataOf(exact).samples.map(s => s.frame), [3, 59]);
  assert.ok((await client.callTool({ name: 'sample_footage', arguments: { footage: id, frames: [60] } })).isError, 'past the last frame');

  const frame = await client.callTool({ name: 'get_frame', arguments: { footage: id, frame: 30, region: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 } } });
  const meta = await sharp(imageOf(frame)).metadata();
  assert.equal(Math.max(meta.width, meta.height), 1080, 'a region is shown enlarged');
  assert.equal(dataOf(frame).seconds, 1);
  assert.match((await client.callTool({ name: 'get_edit_guide', arguments: {} })).content[0].text, /Two clocks/);

  const bad = await client.callTool({ name: 'save_edit', arguments: { footage: id, edit: { layers: [{ type: 'sticker', from: 0, to: 10, shape: 'steam', at: 'cup' }] } } });
  assert.ok(bad.isError);
  assert.match(bad.content[0].text, /no anchor 'cup'/);
  const edit = { timeline: [{ from: 10, to: 40 }, { hold: 40, frames: 15 }], anchors: [{ name: 'cup', keys: [{ frame: 10, x: 0.4, y: 0.5 }, { frame: 40, x: 0.6, y: 0.4 }] }],
    layers: [{ type: 'illustrate', from: 25, to: 45, style: 'ink', transition: 'iris', at: 'cup' }, { type: 'text', from: 30, to: 45, text: 'Crema', style: 'callout', at: 'cup', offset: { x: -0.2, y: 0.2 }, pointer: true }] };
  const saved = dataOf(await client.callTool({ name: 'save_edit', arguments: { footage: id, edit, note: 'first cut' } }));
  assert.equal(saved.version, 1);
  assert.equal(saved.durationFrames, 45);
  assert.deepEqual(saved.timeline, [{ output: [0, 30], source: [10, 40] }, { output: [30, 45], hold: 40 }]);
  const fetched = dataOf(await client.callTool({ name: 'get_edit', arguments: { footage: id } })).edit;
  assert.equal(fetched.layers[1].text, 'Crema');
  assert.deepEqual(fetched.anchors, edit.anchors);

  // The renderer is busy with a story at first: the preview waits its turn instead of failing.
  const preview = await client.callTool({ name: 'preview_edit', arguments: { footage: id, frames: [44, 5, 30] } });
  assert.ok(!preview.isError, preview.content?.[0]?.text);
  assert.deepEqual(dataOf(preview).frames.map(f => [f.output, f.source]), [[5, 15], [30, 40], [44, 40]]);
  assert.equal((await sharp(imageOf(preview)).metadata()).format, 'jpeg');
  const stillCalls = calls.filter(c => c.body.kind === 'stills');
  assert.equal(stillCalls.length, 2, 'asked again once the renderer was free');
  assert.equal(stillCalls[1].body.props.plan.durationInFrames, 45);
  assert.equal(stillCalls[1].body.props.video, undefined, 'the app never tells the renderer where to fetch from');

  const late = await client.callTool({ name: 'preview_edit', arguments: { footage: id, frames: [45] } });
  assert.ok(late.isError); assert.match(late.content[0].text, /last frame is 44/);

  const queued = dataOf(await client.callTool({ name: 'render_edit', arguments: { footage: id, quality: 'final' } }));
  assert.equal(queued.status, 'queued');
  await settle();
  const done = await client.callTool({ name: 'get_render', arguments: { render: queued.render } });
  assert.equal(dataOf(done).status, 'ready');
  assert.equal(dataOf(done).url, `http://localhost:3100/footage/${id}/renders/${queued.render}.mp4`);
  assert.equal((await sharp(imageOf(done)).metadata()).format, 'jpeg', 'a video comes back as frames from it');
  assert.equal(dataOf(done).sheet, `${queued.render}-sheet.jpg`, 'the frame sheet is made with the video');
  assert.ok(existsSync(join(footageFiles(dir, id).renders, `${queued.render}-sheet.jpg`)));
  assert.equal(calls.at(-1).body.scale, 1);
  assert.equal(store.footageRender(queued.render).request.quality, 'final');
});

test('A failed render says why, and renders cut short by a restart are marked', needsFfmpeg, async t => {
  const { dir, store, base, auth, upload, settle, mcp } = await setup(t, { failRender: true });
  const { id } = await upload(await readFile(await rampClip(dir))).then(json); await settle();
  const client = await mcp();
  await client.callTool({ name: 'save_edit', arguments: { footage: id, edit: { layers: [{ type: 'text', from: 0, to: 30, text: 'Hi' }] } } });
  const preview = await client.callTool({ name: 'preview_edit', arguments: { footage: id } });
  assert.ok(preview.isError); assert.match(preview.content[0].text, /Chrome crashed/);
  const r = await fetch(`${base}/api/footage/${id}/renders`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ quality: 'draft' }) }).then(json);
  await settle();
  assert.equal(store.footageRender(r.render).status, 'failed');
  // A restart in the middle of a render leaves it marked, not stuck.
  store.db.prepare("UPDATE footage_renders SET status='rendering' WHERE id=?").run(r.render);
  store.addFootage('0'.repeat(24), 'half uploaded');
  store.recoverFootage();
  assert.match(store.footageRender(r.render).error, /interrupted/);
  assert.equal(store.footage('0'.repeat(24)).status, 'failed');
});

test('Without a render service, editing still works but nothing is queued', needsFfmpeg, async t => {
  const { dir, store, upload, settle, mcp } = await setup(t, { renderUrl: '' });
  const { id } = await upload(await readFile(await rampClip(dir))).then(json); await settle();
  const client = await mcp();
  assert.ok(!(await client.callTool({ name: 'save_edit', arguments: { footage: id, edit: {} } })).isError);
  const render = await client.callTool({ name: 'render_edit', arguments: { footage: id } });
  assert.ok(render.isError); assert.match(render.content[0].text, /RENDER_URL/);
  assert.equal(store.footageRenders(id).length, 0);
});

test('ChatGPT can send a picture from its sandbox through a one-time upload link, or hand over a file or link', needsFfmpeg, async t => {
  const { dir, store, base, upload, settle, mcp } = await setup(t);
  const { id } = await upload(await readFile(await rampClip(dir))).then(json); await settle();
  const client = await mcp();
  const link = dataOf(await client.callTool({ name: 'create_upload_link', arguments: { footage: id, name: 'cube-drawn' } }));
  assert.match(link.url, /^http:\/\/localhost:3100\/u\/[A-Za-z0-9_-]{32}$/);
  const path = new URL(link.url).pathname;
  const png = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 30, g: 90, b: 200, alpha: 1 } } }).png().toBuffer();
  const send = (body, type = 'image/png', method = 'PUT') => fetch(base + path, { method, headers: { 'Content-Type': type }, body });
  assert.equal((await send(Buffer.from('not a picture'))).status, 400, 'no login needed, but it must be a picture');
  assert.equal((await send(png, 'multipart/form-data; boundary=x')).status, 400, 'a form is refused with a hint');
  const ok = await send(png);
  assert.equal(ok.status, 201, 'a failed try leaves the link usable');
  assert.deepEqual(await ok.json(), { footage: id, name: 'cube-drawn', width: 400, height: 400 });
  assert.equal((await send(png)).status, 404, 'a link works once');
  assert.equal((await send(png, 'image/png', 'POST')).status, 404);
  assert.ok(existsSync(join(footageFiles(dir, id).assets, 'cube-drawn.png')));
  assert.ok(!store.db.prepare('SELECT 1 FROM upload_links WHERE token=?').get(path.slice(3)), 'only a hash of the token is kept');
  // Expired links are refused.
  const old = dataOf(await client.callTool({ name: 'create_upload_link', arguments: { footage: id, name: 'late' } }));
  store.db.prepare("UPDATE upload_links SET expires='2000-01-01T00:00:00.000Z' WHERE name='late'").run();
  assert.equal((await fetch(base + new URL(old.url).pathname, { method: 'PUT', body: png })).status, 404);
  // A file handed over by ChatGPT, or a public link, is fetched with the same guards as posters.
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.find(x => x.name === 'add_picture')._meta, { 'openai/fileParams': ['file'] });
  const added = await client.callTool({ name: 'add_picture', arguments: { footage: id, name: 'from-chat', file: { download_url: 'https://93.184.216.34/f.png', file_id: 'file-1' } } });
  assert.deepEqual(dataOf(added), { footage: id, name: 'from-chat', width: 300, height: 200 });
  const local = await client.callTool({ name: 'add_picture', arguments: { footage: id, name: 'sneaky', url: 'https://127.0.0.1/secret.png' } });
  assert.ok(local.isError); assert.match(local.content[0].text, /Non-public address/);
  const none = await client.callTool({ name: 'add_picture', arguments: { footage: id, name: 'nothing' } });
  assert.ok(none.isError); assert.match(none.content[0].text, /create_upload_link/);
});

test('Animations move: sprite sheets play frame by frame along a path that can land on an anchor', async t => {
  const footage = { frames: 120, width: 1080, height: 1920 }, assets = { 'bird-flap': { width: 2400, height: 240 }, 'bird-perch': { width: 300, height: 240 } };
  const { spec, warnings } = planEdit({
    timeline: [{ from: 0, to: 60 }, { hold: 60, frames: 60 }],
    anchors: { rim: [{ frame: 60, x: 0.5, y: 0.3 }] },
    layers: [
      { type: 'sequence', from: 40, to: 100, asset: 'bird-flap', count: 8, facing: 'path', path: [{ frame: 99, at: 'rim' }, { frame: 40, x: 0.05, y: 0.1 }, { frame: 70, x: 0.8, y: 0.4 }] },
      { type: 'image', from: 100, to: 120, asset: 'bird-perch', at: 'rim' },
      { type: 'sticker', from: 60, to: 90, shape: 'hearts', path: [{ frame: 60, x: 0.2, y: 0.8 }, { frame: 89, x: 0.8, y: 0.8 }] },
    ],
  }, footage, assets);
  assert.deepEqual(spec.layers[0].path.map(k => k.frame), [40, 70, 99], 'path keys are put in order');
  assert.deepEqual([spec.layers[0].fps, spec.layers[0].loop], [12, true]);
  assert.equal(spec.layers[2].at, undefined, 'a sticker on a path needs no fixed position');
  assert.deepEqual(warnings, []);
  const refuse = (layer, pattern, a = assets) => assert.throws(() => planEdit({ layers: [layer] }, footage, a), pattern);
  refuse({ type: 'sequence', from: 0, to: 10, asset: 'missing', count: 4 }, /no sprite sheet called 'missing'/);
  refuse({ type: 'sequence', from: 0, to: 10, asset: 'bird-flap', count: 8, path: [{ frame: 0, x: 0.1 }, { frame: 9, x: 0.2, y: 0.2 }] }, /either x and y, or at/);
  refuse({ type: 'image', from: 0, to: 10, asset: 'bird-perch', path: [{ frame: 0, at: 'nest' }, { frame: 9, x: 0.2, y: 0.2 }] }, /no anchor 'nest'/);
  refuse({ type: 'sequence', from: 0, to: 10, asset: 'bird-flap', count: 1 }, /2|count/);
  const uneven = planEdit({ layers: [{ type: 'sequence', from: 0, to: 10, asset: 'bird-flap', count: 7 }] }, footage, assets);
  assert.match(uneven.warnings.join(), /does not split evenly into 7 frames/);
});

test('A wide sprite sheet keeps its frame size when stored', async t => {
  const { saveAsset } = await import('../src/footage.js');
  const dir = await mkdtemp(join(tmpdir(), 'riga-sheet-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sheet = await sharp({ create: { width: 3200, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  assert.deepEqual(await saveAsset(sheet, join(dir, 'bird-flap.png')), { width: 3200, height: 300 });
});

test('ChatGPT can define its own animated graphics and save them to reuse by name', needsFfmpeg, async t => {
  const { dir, upload, settle, mcp, store } = await setup(t);
  const { id } = await upload(await readFile(await rampClip(dir))).then(json); await settle();
  const client = await mcp();
  const wing = { shape: 'path', d: 'M50,52 Q30,20 8,30 Q30,45 50,56Z', fill: '#2f6fdb', origin: { x: 50, y: 54 }, keys: { rotate: [{ frame: 4, value: 30 }, { frame: 0, value: -25 }, { frame: 8, value: -25 }] } };
  const bad = await client.callTool({ name: 'save_graphic', arguments: { name: 'bird', graphic: { elements: [{ shape: 'circle', cx: 5 }] } } });
  assert.ok(bad.isError); assert.match(bad.content[0].text, /circle\) needs r/);
  const saved = await client.callTool({ name: 'save_graphic', arguments: { name: 'bird', note: 'flapping bird', graphic: { loop: 8, elements: [wing, { shape: 'ellipse', cx: 55, cy: 58, rx: 22, ry: 11, fill: 'sky' }] } } });
  assert.ok(!saved.isError, saved.content?.[0]?.text);
  const listed = dataOf(await client.callTool({ name: 'list_graphics', arguments: {} }));
  assert.deepEqual(listed.map(g => [g.name, g.note, g.definition.elements.length]), [['bird', 'flapping bird', 2]]);
  const edit = { layers: [{ type: 'graphic', from: 0, to: 40, use: 'bird', facing: 'path', path: [{ frame: 0, x: 0.1, y: 0.1 }, { frame: 39, x: 0.9, y: 0.5 }] }] };
  const ok = await client.callTool({ name: 'save_edit', arguments: { footage: id, edit } });
  assert.ok(!ok.isError, ok.content?.[0]?.text);
  // The saved edit carries its own copy, so changing the library later does not change this version.
  store.saveGraphic('bird', { elements: [{ shape: 'rect', width: 1, height: 1 }] });
  const stored = store.edit(id).spec.layers[0];
  assert.equal(stored.elements.length, 2);
  assert.deepEqual(stored.elements[0].keys.rotate.map(k => k.frame), [0, 4, 8], 'keyframes are put in order');
  const missing = await client.callTool({ name: 'save_edit', arguments: { footage: id, edit: { layers: [{ type: 'graphic', from: 0, to: 10, use: 'owl' }] } } });
  assert.ok(missing.isError); assert.match(missing.content[0].text, /no saved graphic called 'owl'/);
  const script = await client.callTool({ name: 'save_edit', arguments: { footage: id, edit: { layers: [{ type: 'graphic', from: 0, to: 10, elements: [{ shape: 'path', d: 'M0,0 L1,1 <script>' }] }] } } });
  assert.ok(script.isError, 'path data can only be path data');
});

test('ChatGPT can download a clip, send back its per-frame depth and composite with it', needsFfmpeg, async t => {
  const { dir, store, base, upload, settle, mcp, calls } = await setup(t);
  const { id } = await upload(await readFile(await rampClip(dir))).then(json); await settle();
  const client = await mcp();
  const edit = { depth: { video: true }, layers: [{ type: 'blur', from: 0, to: 30, focus: 0.7 }, { type: 'text', from: 0, to: 30, text: 'Hi', depth: 0.5 }] };
  const early = await client.callTool({ name: 'save_edit', arguments: { footage: id, edit } });
  assert.ok(early.isError); assert.match(early.content[0].text, /no per-frame depth yet/);
  // The working copy goes out through a link that needs no login.
  const down = dataOf(await client.callTool({ name: 'create_download_link', arguments: { footage: id } }));
  assert.equal(down.frames, 60);
  const got = await fetch(base + new URL(down.url).pathname);
  assert.equal(got.status, 200);
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), await readFile(footageFiles(dir, id).work));
  assert.equal((await fetch(base + new URL(down.url).pathname)).status, 200, 'a download can be retried');
  // A depth video with the wrong number of frames is refused, and the link can be used again.
  const depthVideo = async (frames, name) => { const f = join(dir, name); ffmpeg(['-f', 'lavfi', '-i', `color=black:s=64x96:r=30,geq=lum='X*255/64':cb=128:cr=128`, '-frames:v', String(frames), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f]); return readFile(f); };
  const link = dataOf(await client.callTool({ name: 'create_upload_link', arguments: { footage: id, kind: 'depth' } }));
  const path = new URL(link.url).pathname;
  const short = await fetch(base + path, { method: 'PUT', body: await depthVideo(30, 'short.mp4') });
  assert.equal(short.status, 400); assert.match((await short.json()).error, /30 frames but the clip has 60/);
  const ok = await fetch(base + path, { method: 'PUT', body: await depthVideo(60, 'depth.mp4') });
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).depth.frames, 60);
  assert.ok(existsSync(join(footageFiles(dir, id).depth, '00059.jpg')));
  // Depth reads back at points: this test depth grows from left (far) to right (near).
  const read = dataOf(await client.callTool({ name: 'get_depth', arguments: { footage: id, frame: 10, points: [{ x: 0.05, y: 0.5 }, { x: 0.95, y: 0.5 }] } }));
  assert.ok(read.points[0].depth < 0.2 && read.points[1].depth > 0.8, JSON.stringify(read.points));
  assert.equal(dataOf(await client.callTool({ name: 'list_footage', arguments: {} }))[0].depth.frames, 60);
  // Now the edit is accepted, and renders get the depth frames.
  assert.ok(!(await client.callTool({ name: 'save_edit', arguments: { footage: id, edit } })).isError);
  await client.callTool({ name: 'preview_edit', arguments: { footage: id, frames: [5] } });
  assert.equal(calls.at(-1).body.props.depth.frames, 60);
  assert.throws(() => planEdit({ layers: [{ type: 'fog', from: 0, to: 10 }] }, { frames: 60, width: 64, height: 96 }), /no depth source/);
  assert.throws(() => planEdit({ depth: { stills: [{ from: 0, to: 10, asset: 'nope' }] } }, { frames: 60, width: 64, height: 96 }), /no picture called 'nope'/);
});

// A small GLB: one triangle and one animation (and one without a name), enough for the checks.
function glb(extra = {}) {
  const bin = Buffer.alloc(48);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => bin.writeFloatLE(v, i * 4)); // positions
  [0, 1].forEach((v, i) => bin.writeFloatLE(v, 36 + i * 4)); // key times
  const json = {
    asset: { version: '2.0' }, buffers: [{ byteLength: 48 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 8 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1.5] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }],
    animations: [{ name: 'Walk', samplers: [{ input: 1, output: 1 }], channels: [] }, { samplers: [{ input: 1, output: 1 }], channels: [] }],
    ...extra,
  };
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12); header.write('glTF', 0, 'latin1'); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + text.length + 8 + bin.length, 8);
  const chunk = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]); };
  return Buffer.concat([header, chunk(0x4e4f534a, text), chunk(0x004e4942, bin)]);
}

test('ChatGPT can upload a 3D model and animate it walking along a path', needsFfmpeg, async t => {
  const { dir, base, upload, settle, mcp, calls } = await setup(t);
  const { id } = await upload(await readFile(await rampClip(dir))).then(json); await settle();
  const client = await mcp();
  const unnamed = await client.callTool({ name: 'create_upload_link', arguments: { footage: id, kind: 'model' } });
  assert.ok(unnamed.isError); assert.match(unnamed.content[0].text, /name/);
  const link = dataOf(await client.callTool({ name: 'create_upload_link', arguments: { footage: id, kind: 'model', name: 'cat' } }));
  assert.match(link.upload, /cat\.glb/);
  const put = body => fetch(base + new URL(link.url).pathname, { method: 'PUT', body });
  const refused = async (body, pattern) => { const r = await put(body); assert.equal(r.status, 400); assert.match((await r.json()).error, pattern); };
  await refused(Buffer.from('solid cube\nendsolid'), /not a GLB/);
  await refused(glb({ extensionsRequired: ['KHR_draco_mesh_compression'] }), /Draco/);
  await refused(glb({ buffers: [{ byteLength: 48, uri: 'cat.bin' }] }), /separate file/);
  await refused(glb({ images: [{ uri: 'https://example.com/fur.png' }] }), /separate file/);
  const ok = await put(glb());
  assert.equal(ok.status, 201, 'failed tries leave the link usable');
  const saved = await ok.json();
  assert.deepEqual(saved.animations, [{ name: 'Walk', seconds: 1.5 }, { name: 'animation_1', seconds: 1.5 }]);
  assert.equal(saved.triangles, 1);
  assert.equal((await put(glb())).status, 404, 'a link works once');
  const listed = dataOf(await client.callTool({ name: 'list_footage', arguments: {} }))[0].models;
  assert.deepEqual(listed.map(m => [m.name, m.animations.length]), [['cat', 2]]);
  // Animation names are checked against the model, and the renderer is told which models there are.
  const layer = { type: 'model', from: 0, to: 50, asset: 'cat', animation: 'Walk', facing: 'path', path: [{ frame: 0, x: 0.1, y: 0.7 }, { frame: 49, x: 0.8, y: 0.7 }] };
  const wrong = await client.callTool({ name: 'save_edit', arguments: { footage: id, edit: { layers: [{ ...layer, actions: [{ frame: 40, animation: 'Sit' }] }] } } });
  assert.ok(wrong.isError); assert.match(wrong.content[0].text, /no animation called 'Sit' \(it has 'Walk', 'animation_1'\)/);
  const missing = await client.callTool({ name: 'save_edit', arguments: { footage: id, edit: { layers: [{ ...layer, asset: 'dog' }] } } });
  assert.ok(missing.isError); assert.match(missing.content[0].text, /no 3D model called 'dog'/);
  const good = await client.callTool({ name: 'save_edit', arguments: { footage: id, edit: { layers: [{ ...layer, actions: [{ frame: 40, animation: 'animation_1', loop: false }] }] } } });
  assert.ok(!good.isError, good.content?.[0]?.text);
  await client.callTool({ name: 'preview_edit', arguments: { footage: id, frames: [5] } });
  const sent = calls.at(-1).body.props;
  assert.deepEqual(sent.models, { cat: { animations: ['Walk', 'animation_1'] } });
  assert.deepEqual([sent.spec.layers[0].size, sent.spec.layers[0].pin, sent.spec.layers[0].blend], [0.2, 'feet', 8], 'defaults are filled in');
  // A sandbox without network hands the file over instead, and the server fetches it with the usual guards.
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.find(x => x.name === 'add_model')._meta, { 'openai/fileParams': ['file'] });
  const handed = await client.callTool({ name: 'add_model', arguments: { footage: id, name: 'kitten', file: { download_url: 'https://93.184.216.34/cat.glb', file_id: 'file-2' } } });
  assert.ok(!handed.isError, handed.content?.[0]?.text);
  assert.deepEqual(dataOf(handed).animations.map(a => a.name), ['Walk', 'animation_1']);
  const inside = await client.callTool({ name: 'add_model', arguments: { footage: id, name: 'sneaky', url: 'https://127.0.0.1/cat.glb' } });
  assert.ok(inside.isError); assert.match(inside.content[0].text, /Non-public address/);
  const notModel = await client.callTool({ name: 'add_model', arguments: { footage: id, name: 'flat', url: 'https://93.184.216.34/cat.png' } });
  assert.ok(notModel.isError); assert.match(notModel.content[0].text, /not a GLB/);
  // A model can ride along with the table as a handheld camera drifts, and plain models can be tinted.
  const riding = await client.callTool({ name: 'save_edit', arguments: { footage: id, edit: { anchors: [{ name: 'table', keys: [{ frame: 0, x: 0.5, y: 0.8 }, { frame: 50, x: 0.45, y: 0.82 }] }], layers: [{ ...layer, follow: 'table', color: 'gold' }] } } });
  assert.ok(!riding.isError, riding.content?.[0]?.text);
  // Ground-contact depth, distance-driven walking and a model built facing sideways.
  const noDepth = await client.callTool({ name: 'save_edit', arguments: { footage: id, edit: { layers: [{ ...layer, depth: 'auto' }] } } });
  assert.ok(noDepth.isError); assert.match(noDepth.content[0].text, /no depth source/);
  const still = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#808080' } }).png().toBuffer();
  assert.equal((await fetch(`${base}/api/footage/${id}/assets/depth-still`, { method: 'POST', headers: { Authorization: `Bearer ${'f'.repeat(32)}`, 'Content-Type': 'image/png' }, body: still })).status, 201);
  const walker = dataOf(await client.callTool({ name: 'save_edit', arguments: { footage: id, edit: { depth: { stills: [{ from: 0, to: 50, asset: 'depth-still' }] }, layers: [{ ...layer, depth: 'auto', stride: 1.2, front: 'right', actions: [{ frame: 30, animation: 'animation_1', stride: 2.5 }] }] } } }));
  assert.ok(walker.version, JSON.stringify(walker));
  const lost = await client.callTool({ name: 'save_edit', arguments: { footage: id, edit: { layers: [{ ...layer, follow: 'table' }] } } });
  assert.ok(lost.isError); assert.match(lost.content[0].text, /follow: there is no anchor 'table'/);
  // Models can also be added and removed from the dashboard.
  const auth = { Authorization: `Bearer ${'f'.repeat(32)}` };
  const dash = await fetch(`${base}/api/footage/${id}/models/fox`, { method: 'POST', headers: { ...auth, 'Content-Type': 'model/gltf-binary' }, body: glb() });
  assert.equal(dash.status, 201);
  await fetch(`${base}/api/footage/${id}/models/fox`, { method: 'DELETE', headers: auth });
  assert.deepEqual(dataOf(await client.callTool({ name: 'list_footage', arguments: {} }))[0].models.map(m => m.name), ['cat', 'kitten']);
});

test('The server makes per-frame depth for a clip in the background', needsFfmpeg, async t => {
  const { dir, base, auth, upload, settle, mcp, store } = await setup(t);
  const clip = join(dir, 'gradient.mp4');
  ffmpeg(['-f', 'lavfi', '-i', "color=black:s=64x96:r=30,geq=lum='X*255/64':cb=128:cr=128", '-frames:v', '45', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
  const { id } = await upload(await readFile(clip)).then(json); await settle();
  const client = await mcp();
  const started = dataOf(await client.callTool({ name: 'make_depth', arguments: { footage: id } }));
  assert.ok(['queued', 'running'].includes(started.depthJob.status), JSON.stringify(started));
  assert.equal(dataOf(await client.callTool({ name: 'make_depth', arguments: { footage: id } })).depthJob.status !== 'failed', true, 'asking again while it runs only reports');
  const busy = await fetch(`${base}/api/footage/${id}`, { method: 'DELETE', headers: auth });
  assert.equal(busy.status, 409, 'a clip is not deleted from under its depth job');
  await settle();
  const listed = dataOf(await client.callTool({ name: 'list_footage', arguments: {} }))[0];
  assert.equal(listed.depthJob, null);
  assert.deepEqual([listed.depth.frames, listed.depth.source], [45, 'server']);
  const read = dataOf(await client.callTool({ name: 'get_depth', arguments: { footage: id, frame: 20, points: [{ x: 0.05, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.95, y: 0.5 }] } }));
  const [left, middle, right] = read.points.map(p => p.depth);
  assert.ok(left < 0.1 && Math.abs(middle - 0.5) < 0.1 && right > 0.9, JSON.stringify(read.points));
  // The dashboard can start it too, and shows a depth frame.
  const frame = await fetch(`${base}/footage/${id}/depth/00020.jpg`, { headers: auth });
  assert.equal(frame.status, 200);
  assert.equal((await fetch(`${base}/api/footage/${id}/depth`, { method: 'POST', headers: auth })).status, 202);
  await settle();
  assert.ok(existsSync(join(footageFiles(dir, id).depth, '00044.jpg')));
  // A job cut short by a restart says so instead of waiting forever.
  store.updateFootage(id, { info: { ...store.footage(id).info, depthJob: { status: 'running', progress: 0.3 } } });
  const routes = () => {};
  createAnimator({ get: routes, post: routes, patch: routes, delete: routes, locals: { renders: new Set() } }, store, {});
  assert.match(store.footage(id).info.depthJob.error, /restart/);
});

test('Sounds are uploaded, placed on frames with levels and effects, and handed to the renderer', needsFfmpeg, async t => {
  const { dir, base, auth, upload, settle, mcp, calls } = await setup(t);
  const { id } = await upload(await readFile(await rampClip(dir))).then(json); await settle();
  const client = await mcp();
  const tone = (seconds, name) => { const f = join(dir, name); ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=660:sample_rate=44100:duration=${seconds}`, '-c:a', 'libmp3lame', f]); return readFile(f); };
  // Through a one-time link, from the dashboard, or handed over by ChatGPT; anything but sound is refused.
  const link = dataOf(await client.callTool({ name: 'create_upload_link', arguments: { footage: id, kind: 'sound', name: 'whoosh' } }));
  const bad = await fetch(base + new URL(link.url).pathname, { method: 'PUT', body: Buffer.from('not a sound at all') });
  assert.equal(bad.status, 400); assert.match((await bad.json()).error, /not a sound/);
  const ok = await fetch(base + new URL(link.url).pathname, { method: 'PUT', body: await tone(0.5, 'whoosh.mp3') });
  assert.equal(ok.status, 201);
  assert.ok(Math.abs((await ok.json()).seconds - 0.5) < 0.1);
  assert.equal((await fetch(`${base}/api/footage/${id}/sounds/steps`, { method: 'POST', headers: { ...auth, 'Content-Type': 'audio/mpeg' }, body: await tone(1, 'steps.mp3') })).status, 201);
  const listed = dataOf(await client.callTool({ name: 'list_footage', arguments: {} }))[0].sounds;
  assert.deepEqual(listed.map(x => x.name), ['steps', 'whoosh']);
  assert.equal((await fetch(`${base}/footage/${id}/sounds/steps.wav`, { headers: auth })).status, 200, 'the dashboard can play it');
  // Cues: checked against the sounds and the edit, with lengths worked out and reported back.
  const save = sounds => client.callTool({ name: 'save_edit', arguments: { footage: id, edit: { sourceVolume: 0.5, sourceKeys: [{ frame: 50, value: 0 }, { frame: 40, value: 1 }], sounds } } });
  const refused = async (sounds, pattern) => { const r = await save(sounds); assert.ok(r.isError); assert.match(r.content[0].text, pattern); };
  await refused([{ sound: 'poof', at: 10 }], /no sound called 'poof'/);
  await refused([{ sound: 'steps', at: 10, loop: true }], /looping sound needs a length/);
  await refused([{ sound: 'steps', at: 70 }], /edit is only 60 frames/);
  const saved = await save([
    { sound: 'whoosh', at: 30, volume: 1.5, pan: 0.5, echo: { delay: 100, decay: 0.3 }, duck: 0.3 },
    { sound: 'steps', at: 0, length: 40, loop: true, volume: 0.4, fadeIn: 5, volumeKeys: [{ frame: 20, value: 0.5 }, { frame: 0, value: 1 }] },
  ]);
  assert.ok(!saved.isError, saved.content?.[0]?.text);
  const answer = dataOf(saved);
  // 0.5 s of whoosh plus 0.4 s of echo tail is 27 frames.
  assert.deepEqual(answer.sounds.map(c => [c.sound, c.output]), [['steps', [0, 40]], ['whoosh', [30, 57]]], 'in order, with the echo tail allowed for');
  const late = dataOf(await save([{ sound: 'steps', at: 50 }]));
  assert.deepEqual(late.sounds[0].output, [50, 60]);
  assert.match(late.warnings.join(), /steps\): runs past the end/);
  // A video render gets each sound with its effects made on the server; stills get none.
  await client.callTool({ name: 'preview_edit', arguments: { footage: id, version: answer.version, frames: [5] } });
  assert.deepEqual(calls.at(-1).body.props.spec.sounds, []);
  const r = dataOf(await client.callTool({ name: 'render_edit', arguments: { footage: id, version: answer.version } }));
  await settle();
  const props = calls.at(-1).body.props, fx = props.spec.sounds.find(c => c.sound === 'whoosh').file;
  assert.match(fx, /^fx-[a-f0-9]{20}$/);
  assert.deepEqual(Object.keys(props.sounds).sort(), [fx, 'steps'].sort());
  assert.ok(existsSync(join(footageFiles(dir, id).sounds, `${fx}.wav`)));
  assert.deepEqual(props.spec.sounds[0].volumeKeys.map(k => k.frame), [0, 20]);
  // ChatGPT cannot listen, so the finished render reports its loudness over time.
  const got = dataOf(await client.callTool({ name: 'get_render', arguments: { render: r.render } }));
  assert.equal(got.audio.every, 0.25);
  assert.ok(got.audio.db.split(' ').length >= 7, got.audio.db);
});

test('ChatGPT can keep house rules that appear in the edit guide in later chats', async t => {
  const { mcp } = await setup(t);
  const client = await mcp();
  const guide = async () => (await client.callTool({ name: 'get_edit_guide', arguments: {} })).content[0].text;
  assert.doesNotMatch(await guide(), /House rules/);
  await client.callTool({ name: 'save_guide_note', arguments: { title: 'Sprite-first effects', text: 'Use the cinema-* sprites for impacts and glints before drawing new graphics.' } });
  await client.callTool({ name: 'save_guide_note', arguments: { title: 'Soft models', text: 'Give model layers soften 0.4 on handheld footage.' } });
  await client.callTool({ name: 'save_guide_note', arguments: { title: 'Sprite-first effects', text: 'Use cinema-impact, cinema-glint and cinema-dust first.' } });
  const text = await guide();
  assert.match(text, /## House rules[\s\S]*### Sprite-first effects\nUse cinema-impact, cinema-glint and cinema-dust first\.[\s\S]*### Soft models/);
  assert.doesNotMatch(text, /before drawing new graphics/, 'saving a title again replaces it');
  const gone = dataOf(await client.callTool({ name: 'delete_guide_note', arguments: { title: 'Soft models' } }));
  assert.deepEqual(gone.notes, ['Sprite-first effects']);
  assert.ok((await client.callTool({ name: 'delete_guide_note', arguments: { title: 'Nope' } })).isError);
});

test('Sprite sheets are built from single frames, and sprites, particles and text animate in more ways', needsFfmpeg, async t => {
  const { dir, base, auth, upload, settle, mcp } = await setup(t);
  const { id } = await upload(await readFile(await rampClip(dir))).then(json); await settle();
  const client = await mcp();
  // Five frames of different sizes become one grid sheet, each centred in an equal cell.
  for (const [i, w] of [100, 120, 100, 90, 110].entries()) {
    const png = await sharp({ create: { width: w, height: 80, channels: 4, background: { r: 200, g: 40 * i, b: 60, alpha: 1 } } }).png().toBuffer();
    assert.equal((await fetch(`${base}/api/footage/${id}/assets/spark-${i}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'image/png' }, body: png })).status, 201);
  }
  const built = dataOf(await client.callTool({ name: 'build_sprite', arguments: { footage: id, name: 'spark', frames: [0, 1, 2, 3, 4].map(i => `spark-${i}`), columns: 3, remove: true } }));
  assert.deepEqual([built.width, built.height, built.count, built.columns, built.frame], [360, 160, 5, 3, { width: 120, height: 80 }]);
  const assets = dataOf(await client.callTool({ name: 'list_footage', arguments: {} }))[0].assets.map(a => a.name);
  assert.deepEqual(assets, ['spark'], 'the single frames were removed');
  const missing = await client.callTool({ name: 'build_sprite', arguments: { footage: id, name: 'x', frames: ['nope', 'spark'] } });
  assert.ok(missing.isError); assert.match(missing.content[0].text, /No picture called 'nope'/);
  // Layers using them are checked.
  const save = layers => client.callTool({ name: 'save_edit', arguments: { footage: id, edit: { layers } } });
  const ok = await save([
    { type: 'sequence', from: 0, to: 30, asset: 'spark', count: 5, columns: 3, range: { from: 1, to: 3 }, playback: 'pingpong', blend: 'add', glow: 12, tint: 'gold', spin: 90 },
    { type: 'particles', from: 0, to: 60, at: { x: 0.5, y: 0.6 }, shape: 'spark', burst: 40, rate: 0, drag: 3, speed: 0.6, spread: 360, blend: 'screen' },
    { type: 'particles', from: 0, to: 60, asset: 'spark', count: 5, columns: 3, rate: 10 },
    { type: 'text', from: 0, to: 60, text: '{n} cups a day', font: 'display', count: { from: 0, to: 1200 }, reveal: { by: 'word', style: 'blur' }, hide: { by: 'letter', style: 'scramble' }, loop: 'wave',
      highlight: { words: ['cups'] }, stroke: { color: 'ink', width: 3 }, glow: 'gold', gradient: ['paper', 'gold'], tracking: 0.2, path: [{ frame: 0, x: 0.2, y: 0.3 }, { frame: 59, x: 0.8, y: 0.3 }] },
  ]);
  assert.ok(!ok.isError, ok.content?.[0]?.text);
  const refuse = async (layer, pattern) => { const r = await save([layer]); assert.ok(r.isError); assert.match(r.content[0].text, pattern); };
  await refuse({ type: 'sequence', from: 0, to: 30, asset: 'spark', count: 5, columns: 3, range: { from: 2, to: 7 } }, /range must run/);
  await refuse({ type: 'particles', from: 0, to: 60, rate: 300, life: 200 }, /particles would be on screen/);
  await refuse({ type: 'particles', from: 0, to: 60, shape: 'dot', asset: 'spark' }, /either shape or asset/);
  const uneven = dataOf(await save([{ type: 'sequence', from: 0, to: 30, asset: 'spark', count: 5, columns: 7 }]));
  assert.match(uneven.warnings.join(), /does not split evenly into 7 columns/);
});

test('A finished film kept as a master downloads byte for byte, beside its working copy', async t => {
  const { createHash } = await import('node:crypto');
  const { dir, store, base, mcp } = await setup(t);
  const film = '0123456789abcdef01234567', plain = '89abcdef0123456789abcdef';
  for (const id of [film, plain]) {
    store.addFootage(id, `Film ${id.slice(0, 4)}`);
    store.updateFootage(id, { status: 'ready', info: { work: { width: 64, height: 96, fps: 30, frames: 60, duration: 2, audio: true } } });
    await mkdir(footageFiles(dir, id).dir, { recursive: true });
    await writeFile(footageFiles(dir, id).work, Buffer.from(`working copy of ${id}`));
  }
  const master = Buffer.from(Array.from({ length: 70000 }, (_, i) => (i * 37) % 256));
  await writeFile(footageFiles(dir, film).master, master);
  const client = await mcp();
  const listed = dataOf(await client.callTool({ name: 'list_footage', arguments: {} }));
  assert.deepEqual(listed.find(c => c.id === film).master, { bytes: master.length });
  assert.equal(listed.find(c => c.id === plain).master, null);
  const link = dataOf(await client.callTool({ name: 'create_download_link', arguments: { footage: film, file: 'master' } }));
  assert.equal(link.bytes, master.length);
  assert.equal(link.sha256, createHash('sha256').update(master).digest('hex'));
  assert.deepEqual(Buffer.from(await (await fetch(base + new URL(link.url).pathname)).arrayBuffer()), master, 'the master, exactly as kept');
  const work = dataOf(await client.callTool({ name: 'create_download_link', arguments: { footage: film } }));
  assert.equal(work.file, 'work');
  assert.equal(Buffer.from(await (await fetch(base + new URL(work.url).pathname)).arrayBuffer()).toString(), `working copy of ${film}`, 'old-style links still serve the working copy');
  const none = await client.callTool({ name: 'create_download_link', arguments: { footage: plain, file: 'master' } });
  assert.ok(none.isError); assert.match(none.content[0].text, /keeps no master/);
  const picture = await client.callTool({ name: 'create_upload_link', arguments: { footage: plain, kind: 'picture', name: 'poster', keep: true } });
  assert.ok(picture.isError); assert.match(picture.content[0].text, /Only a video upload can be kept/);
});

test('A video uploaded with keep stays as sent as the clip master, and only an MP4 can be kept', needsFfmpeg, async t => {
  const { dir, store, base, settle, mcp } = await setup(t);
  const client = await mcp();
  const source = await rampClip(dir), sent = await readFile(source);
  const link = dataOf(await client.callTool({ name: 'create_upload_link', arguments: { kind: 'video', title: 'Finished film', keep: true } }));
  assert.equal(link.keep, true);
  assert.equal((await fetch(base + new URL(link.url).pathname, { method: 'PUT', body: sent })).status, 201);
  await settle();
  assert.equal(store.footage(link.footage).status, 'ready');
  assert.deepEqual(await readFile(footageFiles(dir, link.footage).master), sent, 'kept byte for byte');
  assert.ok(!existsSync(footageFiles(dir, link.footage).source), 'moved, not copied');
  const mkv = join(dir, 'film.mkv'); ffmpeg(['-i', source, '-c', 'copy', mkv]);
  const other = dataOf(await client.callTool({ name: 'create_upload_link', arguments: { kind: 'video', title: 'Not an MP4', keep: true } }));
  const refused = await fetch(base + new URL(other.url).pathname, { method: 'PUT', body: await readFile(mkv) });
  assert.equal(refused.status, 400); assert.match((await refused.json()).error, /needs an MP4/);
  const plain = dataOf(await client.callTool({ name: 'create_upload_link', arguments: { kind: 'video', title: 'Ordinary clip' } }));
  await fetch(base + new URL(plain.url).pathname, { method: 'PUT', body: sent }); await settle();
  assert.ok(!existsSync(footageFiles(dir, plain.footage).master), 'without keep the original is still dropped');
});
