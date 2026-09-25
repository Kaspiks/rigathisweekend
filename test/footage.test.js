import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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
  refuse({ anchors: { 'Bad Name': [{ frame: 1, x: 0.5, y: 0.5 }] } }, /Invalid/);
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
  const app = createApp(store, { ADMIN_TOKEN: token, RENDER_URL: renderUrl, APP_ORIGIN: 'http://localhost:3100', FOOTAGE_MAX_MB: '2' }, { fetcher, animator: { previewWaitMs: 5000, busyWaitMs: 10 } });
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
