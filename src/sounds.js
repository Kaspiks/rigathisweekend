// Sound effects and music for edits: any audio file ffmpeg reads (MP3, WAV, OGG, FLAC, M4A…), checked and
// stored as 48 kHz stereo WAV so the renderer mixes every file the same way. Edits place them on the
// timeline by name (src/edits.js, "sounds").
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { soundEffects, tailSeconds } from './edits.js';

const fail = (message, httpStatus = 400) => Object.assign(new Error(message), { httpStatus });
export const MAX_SOUND = 50 * 1048576;
export const MAX_SOUND_SECONDS = 180;

function ffmpeg(bin, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const out = [], err = [];
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => { if (err.length < 32) err.push(d); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('error', e => { clearTimeout(timer); reject(e.code === 'ENOENT' ? new Error(`${bin} is not installed`) : e); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(Buffer.concat(err).toString().trim().split('\n').pop() || `${bin} failed`)); });
    if (input) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}

export const soundFile = (folder, name) => join(folder, `${name}.wav`);

// Reads the upload from a temporary file (ffprobe needs to seek in some formats), checks it has sound and
// is not too long, and writes the WAV the renderer uses. Returns its name and length.
export async function saveSound(buffer, folder, name) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail('Send the sound file itself as the body');
  await mkdir(folder, { recursive: true });
  const incoming = join(folder, `${name}.upload`), wav = soundFile(folder, name), part = `${wav}.part.wav`;
  await writeFile(incoming, buffer);
  try {
    let probed;
    try { probed = JSON.parse((await ffmpeg('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', incoming])).toString()); }
    catch { throw fail('That file is not a sound this server can read. Send MP3, WAV, OGG, FLAC or M4A'); }
    if (!probed.streams?.some(s => s.codec_type === 'audio')) throw fail('That file has no sound in it');
    const seconds = Number(probed.format?.duration) || 0;
    if (seconds > MAX_SOUND_SECONDS) throw fail(`That sound is ${Math.round(seconds)} s long; keep it under ${MAX_SOUND_SECONDS} s (trim it first)`);
    await ffmpeg('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-i', incoming, '-vn', '-map', '0:a:0', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', part]);
    const length = Number(JSON.parse((await ffmpeg('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', part])).toString()).format?.duration) || seconds;
    if (length < 0.02) throw fail('That sound is too short to hear');
    await rename(part, wav);
    const info = { seconds: Math.round(length * 1000) / 1000, updated: new Date().toISOString() };
    await writeFile(join(folder, `${name}.json`), JSON.stringify(info));
    return { name, seconds: info.seconds };
  } finally {
    await rm(incoming, { force: true });
    await rm(part, { force: true });
  }
}

export async function deleteSound(folder, name) {
  await rm(soundFile(folder, name), { force: true });
  await rm(join(folder, `${name}.json`), { force: true });
  // Processed copies are cheap to make again, so they all go rather than tracking which came from what.
  for (const f of await readdir(folder).catch(() => [])) if (/^fx-[a-f0-9]{20}\.wav$/.test(f)) await rm(join(folder, f), { force: true });
}

export async function soundList(folder) {
  const names = (await readdir(folder).catch(() => [])).filter(f => /^[a-z0-9][a-z0-9-]{0,31}\.json$/.test(f)).sort();
  const list = await Promise.all(names.map(async f => {
    try { const { seconds } = JSON.parse(await readFile(join(folder, f), 'utf8')); return { name: f.slice(0, -5), seconds }; } catch { return null; }
  }));
  return list.filter(Boolean);
}

// A cue's effects, applied to its sound with ffmpeg and kept as fx-<hash>.wav next to it, so a render
// only works a sound out once. Returns the file name (without .wav) the renderer should play.
export async function processedSound(folder, cue) {
  if (!soundEffects(cue)) return cue.sound;
  const meta = JSON.parse(await readFile(join(folder, `${cue.sound}.json`), 'utf8'));
  const fx = { pan: cue.pan, pitch: cue.pitch, reverse: cue.reverse, lowpass: cue.lowpass, highpass: cue.highpass, bass: cue.bass, treble: cue.treble, echo: cue.echo, reverb: cue.reverb, normalize: cue.normalize };
  const name = `fx-${createHash('sha1').update(JSON.stringify([cue.sound, meta.updated, fx])).digest('hex').slice(0, 20)}`;
  const out = soundFile(folder, name);
  if (existsSync(out)) return name;
  const chain = [];
  if (cue.normalize) chain.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  if (cue.reverse) chain.push('areverse');
  if (cue.pitch) { const r = 2 ** (cue.pitch / 12); chain.push(`asetrate=${Math.round(48000 * r)}`, 'aresample=48000', `atempo=${(1 / r).toFixed(5)}`); }
  if (cue.highpass) chain.push(`highpass=f=${cue.highpass}`);
  if (cue.lowpass) chain.push(`lowpass=f=${cue.lowpass}`);
  if (cue.bass) chain.push(`bass=g=${cue.bass}`);
  if (cue.treble) chain.push(`treble=g=${cue.treble}`);
  const tail = tailSeconds(cue);
  if (tail) chain.push(`apad=pad_dur=${tail.toFixed(3)}`);
  if (cue.echo) chain.push(`aecho=0.8:0.88:${cue.echo.delay}|${cue.echo.delay * 2}|${cue.echo.delay * 3}:${cue.echo.decay}|${(cue.echo.decay ** 2).toFixed(3)}|${(cue.echo.decay ** 3).toFixed(3)}`);
  if (cue.reverb) {
    // A room as a spread of early reflections that die away: close enough for a sound effect.
    const taps = [23, 41, 67, 97, 131, 173, 229, 293, 367, 449].map(ms => Math.round(ms * (0.6 + cue.reverb)));
    const decays = taps.map((_, i) => (cue.reverb * 0.6 * 0.82 ** i).toFixed(3));
    chain.push(`aecho=0.9:0.9:${taps.join('|')}:${decays.join('|')}`);
  }
  if (cue.pan) chain.push(`pan=stereo|c0=${Math.min(1, 1 - cue.pan).toFixed(3)}*c0|c1=${Math.min(1, 1 + cue.pan).toFixed(3)}*c1`);
  chain.push('aresample=48000');
  const part = `${out}.part.wav`;
  try {
    await ffmpeg('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-i', soundFile(folder, cue.sound), '-af', chain.join(','), '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', part]);
    await rename(part, out);
  } finally { await rm(part, { force: true }); }
  return name;
}

// How loud a rendered video is every quarter second, in dB (-60 is near silence, 0 the loudest), so
// ChatGPT, which cannot listen, can check that each sound lands where it was placed. Null without sound.
export async function loudness(video) {
  let text;
  try {
    text = (await ffmpeg('ffmpeg', ['-v', 'error', '-nostdin', '-i', video, '-vn', '-af',
      'aresample=8000,asetnsamples=n=2000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-', '-f', 'null', '-'])).toString();
  } catch { return null; }
  const db = [...text.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map(m => (m[1] === '-inf' ? -60 : Math.max(-60, Math.round(Number(m[1])))));
  return db.length ? { every: 0.25, db } : null;
}
