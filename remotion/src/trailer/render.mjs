// Renders the trailer plates on this machine (GPU WebGL through the installed Chrome), not in the
// render service: stills to check a shot, or the whole shot as silent H.264 with its handles.
//   node src/trailer/render.mjs TrailerEmpire stills 0,150,300,436
//   node src/trailer/render.mjs TrailerEmpire video
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const [id, mode = 'stills', list = '0', scaleArg = '0.5'] = process.argv.slice(2);
if (!id) { console.error('Usage: node src/trailer/render.mjs <CompositionId> stills|video [frames] [scale]'); process.exit(1); }
const browserExecutable = process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const options = { browserExecutable, chromeMode: 'chrome-for-testing', chromiumOptions: { gl: 'angle' }, logLevel: 'error' };
const out = path.resolve('out/trailer');
mkdirSync(out, { recursive: true });

const serveUrl = await bundle({ entryPoint: path.resolve('src/trailer/index.ts') });
const composition = await selectComposition({ serveUrl, id, ...options });
const started = Date.now();
if (mode === 'stills') {
  for (const frame of list.split(',').map(Number)) {
    const output = path.join(out, `${id}-${frame}.jpg`);
    await renderStill({ composition, serveUrl, frame, output, imageFormat: 'jpeg', jpegQuality: 90, scale: Number(scaleArg), ...options });
    console.log(output);
  }
} else {
  const output = path.join(out, `${id}.mp4`);
  let last = -1;
  await renderMedia({ composition, serveUrl, codec: 'h264', crf: 16, muted: true, outputLocation: output, concurrency: 4, ...options,
    onProgress: ({ progress }) => { const p = Math.floor(progress * 10); if (p !== last) { last = p; console.log(`${p * 10}%`); } } });
  console.log(output);
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
