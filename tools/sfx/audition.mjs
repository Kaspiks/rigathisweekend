// Measures candidate sounds (downloaded like make.mjs does): length, peak, how much of it is low end (under
// 150 Hz), and when it hits, so heavy ones can be picked without guessing.
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';
const CACHE = join(dirname(fileURLToPath(import.meta.url)), '.cache');
const ids = process.argv.slice(2).map(Number);
const stat = (file, af) => spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', `${af}volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
for (const id of ids) {
  const file = join(CACHE, `${id}.mp3`);
  if (!existsSync(file)) {
    const html = await (await fetch(`https://freesound.org/s/${id}/`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
    const cc0 = html.includes('creativecommons.org/publicdomain/zero/1.0/');
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/ - Freesound$/, '').replace(/^Freesound - /, '');
    const preview = html.match(/https:\/\/cdn\.freesound\.org\/previews\/[^"]+-hq\.mp3/)?.[0];
    if (!cc0 || !preview) { console.log(id, 'SKIP', cc0 ? 'no preview' : 'not CC0', title); continue; }
    writeFileSync(file, Buffer.from(await (await fetch(preview)).arrayBuffer()));
    writeFileSync(`${file}.title`, title || '');
    await new Promise(r => setTimeout(r, 800));
  }
  const full = stat(file, ''), low = stat(file, 'lowpass=f=150,');
  const dur = full.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const secs = dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : 0;
  const pk = +full.match(/max_volume: (-?[\d.]+)/)[1], mean = +full.match(/mean_volume: (-?[\d.]+)/)[1];
  const lowMean = +low.match(/mean_volume: (-?[\d.]+)/)[1];
  const title = existsSync(`${file}.title`) ? (await import('node:fs')).readFileSync(`${file}.title`, 'utf8') : '';
  console.log(`${id}`.padEnd(7), `${secs.toFixed(2)}s`.padEnd(7), `peak ${pk}`.padEnd(11), `low-end share ${(lowMean - mean).toFixed(1)} dB`.padEnd(24), title.slice(0, 60));
}
