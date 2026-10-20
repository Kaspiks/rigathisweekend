// Renders a saved Riga edit (the FootageEdit composition) on this machine instead of in the render service,
// from the props the app plans for it (dumped on the server; see src/trailer/README.md), with the clips it
// cuts between served from local files. Used for the "Of the Empire" trailer master: the same composition,
// titles, grades and finish as the server would draw, on the GPU, muted (the sound is mixed separately).
//   node src/trailer/master.mjs props.json clips.json stills 0,200,400 [scale]
//   node src/trailer/master.mjs props.json clips.json video out/trailer/master.mp4
// clips.json maps footage ids to local video files: {"0852...": "out/trailer/TrailerEmpire.mp4", ...}
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { createReadStream, mkdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const [propsFile, clipsFile, mode = 'stills', arg = '0', scaleArg = '0.5'] = process.argv.slice(2);
if (!propsFile || !clipsFile) { console.error('Usage: node src/trailer/master.mjs props.json clips.json stills|video [frames|output] [scale]'); process.exit(1); }
const { props, footage, version } = JSON.parse(readFileSync(propsFile, 'utf8'));
const files = JSON.parse(readFileSync(clipsFile, 'utf8'));

// Chrome reads the clips over HTTP, with byte ranges, like it does from the render service.
const server = http.createServer((req, res) => {
  const m = req.url.match(/^\/footage\/([a-f0-9]{24})\/work\.mp4$/);
  const file = m && files[m[1]] && path.resolve(files[m[1]]);
  if (!file) { res.writeHead(404).end(); return; }
  const size = statSync(file).size, range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]), end = range[1] && range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
    createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    createReadStream(file).pipe(res);
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const missing = Object.values(props.videos).filter((v) => !files[v.footage]).map((v) => v.footage);
if (missing.length) { console.error(`No local file for clip(s) ${missing.join(', ')}`); process.exit(1); }
// Only what the layers use: an edit on a blank canvas has no video of its own, and these layers draw no pictures.
const inputProps = {
  spec: props.spec, plan: props.plan, source: props.source, assets: {}, depth: null, models: {}, sounds: {}, track: null, world: null,
  videos: Object.fromEntries(Object.entries(props.videos).map(([name, v]) => [name, { src: `${base}/footage/${v.footage}/work.mp4`, width: v.width, height: v.height, frames: v.frames }])),
  video: props.blank ? '' : `${base}/footage/${footage}/work.mp4`,
};
if (props.spec.layers.some((l) => l.asset || l.type === 'model' || l.depth)) { console.error('This edit uses pictures, models or depth, which this runner does not serve'); process.exit(1); }

const browserExecutable = process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const options = { browserExecutable, chromeMode: 'chrome-for-testing', chromiumOptions: { gl: 'angle' }, logLevel: 'error' };
const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') });
const composition = await selectComposition({ serveUrl, id: 'FootageEdit', inputProps, ...options });
console.log(`edit ${footage} v${version}: ${composition.width}x${composition.height}, ${composition.durationInFrames} frames at ${composition.fps} fps`);
const started = Date.now();
try {
  if (mode === 'stills') {
    const out = path.resolve('out/trailer/master-stills');
    mkdirSync(out, { recursive: true });
    for (const frame of arg.split(',').map(Number)) {
      const output = path.join(out, `v${version}-${frame}.jpg`);
      await renderStill({ composition, serveUrl, inputProps, frame, output, imageFormat: 'jpeg', jpegQuality: 90, scale: Number(scaleArg), ...options });
      console.log(output);
    }
  } else {
    const output = path.resolve(arg);
    mkdirSync(path.dirname(output), { recursive: true });
    let last = -1;
    await renderMedia({ composition, serveUrl, inputProps, codec: 'h264', crf: 15, muted: true, outputLocation: output, concurrency: 6, ...options,
      onProgress: ({ progress }) => { const p = Math.floor(progress * 20); if (p !== last) { last = p; console.log(`${p * 5}%`); } } });
    console.log(output);
  }
} finally {
  server.close();
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
