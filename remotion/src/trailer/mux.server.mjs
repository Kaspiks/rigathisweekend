// Runs inside the app container: lays an edit's sound cues under a silent video, the way the render
// service would (each cue's effects through the app's own processedSound, then trim, length, loop, fades,
// volume and start frame), sums them without normalising, and writes VIDEO + mix to OUT.
// env: VIDEO, OUT, FOOTAGE, CUES (base64 JSON of the planned spec's sounds), FRAMES, FPS
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const { footageFiles } = await import('/app/src/footage.js');
const { processedSound } = await import('/app/src/sounds.js');
const fps = Number(process.env.FPS || 30), frames = Number(process.env.FRAMES), total = frames / fps;
const cues = JSON.parse(Buffer.from(process.env.CUES, 'base64').toString());
const folder = footageFiles(process.env.DATA_DIR || 'data', process.env.FOOTAGE).sounds;
const args = ['-y', '-v', 'error', '-i', process.env.VIDEO], chains = [];
for (const [i, c] of cues.entries()) {
  if ((c.speed ?? 1) !== 1) throw new Error(`Cue ${c.sound}: speed ${c.speed} is not handled here`);
  const file = join(folder, `${await processedSound(folder, c)}.wav`);
  if (c.loop) args.push('-stream_loop', '-1');
  args.push('-i', file);
  const length = c.length != null ? c.length / fps : null, f = [];
  f.push(`atrim=start=${c.from || 0}${length != null ? `:duration=${length}` : ''}`, 'asetpts=PTS-STARTPTS');
  if (c.volumeKeys?.length) {
    // Linear between keys (frames from the cue's start), held before the first and after the last.
    const k = c.volumeKeys.map((x) => ({ t: x.frame / fps, v: x.value }));
    let expr = `${k[k.length - 1].v}`;
    for (let j = k.length - 2; j >= 0; j--) expr = `if(lt(t,${k[j + 1].t}),${k[j].v}+(${k[j + 1].v}-${k[j].v})*(t-${k[j].t})/${Math.max(1e-6, k[j + 1].t - k[j].t)},${expr})`;
    expr = `if(lt(t,${k[0].t}),${k[0].v},${expr})`;
    f.push(`volume='${expr}':eval=frame`);
  }
  if (c.fadeIn) f.push(`afade=t=in:d=${c.fadeIn / fps}`);
  if (c.fadeOut && length != null) f.push(`afade=t=out:st=${Math.max(0, length - c.fadeOut / fps)}:d=${c.fadeOut / fps}`);
  f.push(`volume=${c.volume ?? 1}`, 'aresample=48000', 'aformat=channel_layouts=stereo', `adelay=${Math.round((c.at / fps) * 1000)}:all=1`);
  chains.push(`[${i + 1}:a]${f.join(',')}[a${i}]`);
}
const graph = `${chains.join(';')};${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:normalize=0:duration=longest,apad,atrim=0:${total}[mix]`;
args.push('-filter_complex', graph, '-map', '0:v', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-ac', '2', '-t', String(total), '-movflags', '+faststart', process.env.OUT);
const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
console.log(JSON.stringify({ out: process.env.OUT, cues: cues.map((c) => c.sound), graph }));
