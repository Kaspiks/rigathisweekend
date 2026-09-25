// Cuts the story openers' sound effects out of Freesound recordings and writes them to remotion/public/sfx,
// with a CREDITS.md beside them. Run `npm run make` here after changing a cue; the WAVs it writes are what
// ships (the render image never runs this, so ffmpeg-static stays out of it).
//
// Each source is downloaded once into .cache (Freesound's HQ preview) and only if its page still says CC0:
// anything else would need a credit on every post, so it's refused here rather than slipping in.
// Each cue: trim, high-pass the rumble, optionally denoise (quiet recordings get a lot of gain, and their hiss
// with it), fade in and out so nothing clicks, optionally a small room, then level to a -3 dB peak so every
// file starts equal and the compositions set the mix.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, '.cache'), OUT = join(HERE, '../../remotion/public/sfx');

// Freesound sources: id -> [author, title].
const SOURCES = {
  119798: ['lmbubec', 'Thumb Tack.wav'],
  446634: ['Nicolas4677', 'ThumbTack'],
  320913: ['mickdow', 'Paper Flutter .wav'],
  767489: ['danluxradium', 'Paper Grab'],
  470710: ['I.fekry', 'traditional stamp.wav'],
  444619: ['vintage2005', 'Barefoot steps on tile'],
  125406: ['jasonLON', 'hand slaps.aif'],
  531862: ['magnuswaker', 'Seismic Slam'],
  869495: ['Sadiquecat', 'Door thump - Binaural OKM-1'],
  164932: ['ShawnyBoy', 'Gunshot 3 (wet towel smacked on a tile floor)'],
  74488: ['qubodup', 'Wet Towel Floor Impact Punch Drop Bag Cloth'],
  679391: ['adviseme333', 'wet thwack'],
  333516: ['oscaraudiogeek', 'Hand Slap on Sweater'],
  463848: ['thisisjoewells', 'sketchbook-drawing-pencil-sounds.aif'],
  444676: ['AO-SoundPawz', 'Drawing with Pencil (Slow & Continuous)'],
  482891: ['ssalo', 'painting_1.aif'],
  174718: ['paespedro', 'Single Water Drop'],
  457318: ['Stek59', 'Autumn wind and dry leaves.wav'],
  146932: ['crashoverride6', 'Wind Gust'],
  683096: ['florianreichelt', 'Woosh'],
  40953: ['hopflog', 'paper bag movement.wav'],
  119142: ['esperri', 'Papebag Cumple.wav'],
  181773: ['keweldog', 'tearing paper4.wav'],
  320148: ['OwlStorm', 'Paper Sketchbook Page Flips 1'],
  415518: ['krokoi63', 'Painting, many short brush strokes'],
  442773: ['qubodup', 'Big Water Splash'],
};

// [file, source, start s, length s, fade in s, fade out s, options]. Options: denoise (quiet, hissy
// recordings), room (a touch of space for hits that sound too dry up close), hp (the high-pass cut-off in Hz,
// 70 by default; wind and booms are mostly low end, so they keep more), lead (cut the silence before the hit,
// so it lands on its frame), reverb (the wet level, 0 to 1, of the room below; adds a 1.2 s tail), pitch
// (a playback-rate factor: under 1 is lower and slower, which reads as bigger and heavier).
const CUES = [
  // Pinboard: flyers arrive with a flutter, the tacks go in.
  ['pin-tack-1', 119798, 1.56, 0.36, 0.005, 0.12],
  ['pin-tack-2', 446634, 0.0, 0.5, 0.005, 0.15, { denoise: true }],
  ['pin-flutter-1', 320913, 7.30, 0.6, 0.03, 0.25],
  ['pin-flutter-2', 320913, 0.18, 0.6, 0.03, 0.25],
  ['pin-flutter-3', 320913, 8.05, 0.6, 0.03, 0.25, { denoise: true }],
  // Every opener's footer band slides in on paper.
  ['paper-slide', 767489, 0.84, 0.6, 0.01, 0.3],
  // Leave your mark: the stamp, bare feet, slaps and splats, the cards slammed down.
  ['mark-stamp', 470710, 0.46, 0.7, 0.003, 0.3, { room: true }],
  ['mark-step-1', 444619, 1.54, 0.34, 0.005, 0.15, { denoise: true }],
  ['mark-step-2', 444619, 2.34, 0.34, 0.005, 0.15, { denoise: true }],
  ['mark-step-3', 444619, 3.08, 0.34, 0.005, 0.15, { denoise: true }],
  ['mark-step-4', 444619, 3.92, 0.34, 0.005, 0.15, { denoise: true }],
  ['mark-slap-1', 125406, 3.42, 0.34, 0.003, 0.15],
  ['mark-slap-2', 125406, 12.04, 0.34, 0.003, 0.15],
  ['mark-slap-3', 125406, 16.56, 0.34, 0.003, 0.15],
  ['mark-slap-4', 125406, 19.24, 0.34, 0.003, 0.15],
  // Paint hits, all real recordings: wet towels smacked on a tile floor (heavy), and a lighter wet thwack
  // for the hands.
  ['mark-splat-1', 164932, 1.15, 0.6, 0.002, 0.25],
  ['mark-splat-2', 74488, 6.82, 0.6, 0.002, 0.25],
  ['mark-splat-3', 74488, 3.57, 0.6, 0.002, 0.25],
  ['mark-splat-4', 679391, 0.30, 0.5, 0.002, 0.2],
  // The cards slammed down: Seismic Slam (a heavy foley impact) for the hit, a door thump under it for the
  // weight, both in a room. The last card's slam is pitched down a little, so it lands biggest.
  ['mark-slam-1', 531862, 0.0, 1.6, 0.002, 0.6, { lead: true, hp: 25, reverb: 0.35 }],
  ['mark-slam-2', 531862, 0.0, 1.6, 0.002, 0.6, { lead: true, hp: 25, reverb: 0.4, pitch: 0.88 }],
  ['mark-thump', 869495, 0.0, 1.4, 0.002, 0.6, { lead: true, hp: 25, reverb: 0.25 }],
  // Sketchbook: the pencil writing and boxing, a drop into each box, the wash spreading.
  ['sketch-write', 463848, 2.75, 1.0, 0.03, 0.2, { denoise: true }],
  ['sketch-box', 444676, 3.40, 1.2, 0.02, 0.2, { denoise: true }],
  ['sketch-drop', 174718, 0.0, 0.47, 0.002, 0.15],
  ['sketch-wash', 482891, 5.70, 1.4, 0.05, 0.6, { denoise: true }],
  // Leaf gust: the wind front with leaves in it, a swell under it, the card carried off.
  ['leaf-gust', 457318, 1.0, 3.2, 0.3, 1.2, { hp: 30 }],
  ['leaf-swell', 146932, 0.4, 4.2, 0.4, 1.8, { denoise: true, hp: 30 }],
  ['leaf-woosh', 683096, 0.1, 1.4, 0.05, 0.5, { hp: 30 }],
  // Harvest bag: it lands, takes the strain, rips; the halves flutter away.
  ['bag-land', 40953, 1.25, 0.7, 0.02, 0.3, { denoise: true }],
  ['bag-tug', 119142, 0.58, 0.6, 0.01, 0.25],
  ['bag-rip', 181773, 0.30, 1.23, 0.02, 0.2],
  // Pressed leaf: the page turns, the leaf drifts.
  ['book-turn', 320148, 6.55, 1.3, 0.05, 0.4],
  ['book-leaf', 320913, 2.0, 0.9, 0.08, 0.4, { denoise: true }],
  // Art Riga Fair: brush strokes, rinsing, the cup knocked over and the water running out.
  ['fair-brush-1', 415518, 0.85, 1.4, 0.05, 0.4, { denoise: true }],
  ['fair-brush-2', 415518, 2.9, 1.3, 0.05, 0.4, { denoise: true }],
  ['fair-drop', 174718, 0.0, 0.47, 0.002, 0.15],
  ['fair-knock', 333516, 9.4, 0.5, 0.003, 0.25, { room: true }],
  ['fair-splash', 442773, 0.0, 2.17, 0.002, 0.8, { hp: 40 }],
  ['fair-wet', 482891, 5.70, 3.0, 0.3, 1.2, { denoise: true }],
];

const run = args => execFileSync(ffmpeg, ['-hide_banner', '-nostats', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
const page = id => `https://freesound.org/s/${id}/`;

async function fetchSource(id) {
  const file = join(CACHE, `${id}.mp3`);
  if (existsSync(file)) return file;
  const html = await (await fetch(page(id), { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
  if (!html.includes('creativecommons.org/publicdomain/zero/1.0/')) throw new Error(`Freesound ${id} is not CC0 any more; pick another sound`);
  const preview = html.match(/https:\/\/cdn\.freesound\.org\/previews\/[^"]+-hq\.mp3/)?.[0];
  if (!preview) throw new Error(`No preview found for Freesound ${id}`);
  writeFileSync(file, Buffer.from(await (await fetch(preview)).arrayBuffer()));
  return file;
}

// The room for `reverb`: a convolution reverb's impulse response, made rather than recorded. Two pink noise
// channels (so left and right differ, which is what makes it sound like space and not an echo) dying away
// exponentially over about a second, dulled at the top the way air and walls dull a real room, after a short
// pre-delay for the first reflections to arrive.
const ROOM = join(CACHE, 'room-ir.wav');
const makeRoom = () => existsSync(ROOM) || run(['-y', '-f', 'lavfi', '-i',
  'anoisesrc=d=1.4:c=pink:r=44100:seed=7[l];anoisesrc=d=1.4:c=pink:r=44100:seed=11[r];[l][r]join=inputs=2:channel_layout=stereo,' +
  "volume='exp(-5*t)':eval=frame,lowpass=f=5000,adelay=18|24", '-c:a', 'pcm_s16le', ROOM]);

mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });
makeRoom();
const used = new Set();
for (const [name, id, start, len, fadeIn, fadeOut, opts = {}] of CUES) {
  const src = await fetchSource(id);
  used.add(id);
  const out = join(OUT, `${name}.wav`);
  const input = ['-ss', String(start), '-t', String(len), '-i', src];
  const tail = opts.reverb ? 1.2 : 0, total = len + tail;
  // The graph: level, trim leading silence, high-pass, denoise, pitch, fade in; then, for `reverb`, the dry
  // sound mixed with itself played through the room (padded first so the tail can ring on past the cut);
  // then the fade out over whatever is left.
  const graph = gain => {
    const head = [
      `volume=${gain.toFixed(2)}dB`,
      opts.lead && 'silenceremove=start_periods=1:start_threshold=-50dB',
      `highpass=f=${opts.hp ?? 70}`,
      opts.denoise && 'afftdn=nf=-50:nr=12:tn=1',
      opts.pitch && `asetrate=${Math.round(44100 * opts.pitch)},aresample=44100`,
      `afade=t=in:d=${fadeIn}`,
      opts.room && 'aecho=0.85:0.5:23|41:0.14|0.07',
    ].filter(Boolean).join(',');
    const fade = `afade=t=out:st=${Math.max(0, total - fadeOut - tail).toFixed(3)}:d=${(fadeOut + tail).toFixed(3)}`;
    return opts.reverb
      ? `[0:a]aresample=44100,${head},apad=pad_dur=${tail},asplit[dry][send];[send][1:a]afir=dry=10:wet=10[wet];` +
        `[dry][wet]amix=inputs=2:weights='1 ${opts.reverb}':normalize=0,atrim=0:${total.toFixed(3)},${fade}`
      : `[0:a]aresample=44100,${head},${fade}`;
  };
  const inputs = opts.reverb ? [...input, '-i', ROOM] : input;
  // Peaks are measured in floating point (astats): volumedetect works in 16-bit, so anything over full scale
  // (a reverb mix easily is) would read as 0 dB and then clip.
  const peakIn = (args, g) => Number(spawnSync(ffmpeg, ['-hide_banner', '-nostats', ...args, '-filter_complex', `${g},astats=measure_perchannel=none`, '-f', 'null', '-'], { encoding: 'utf8' })
    .stderr.match(/Peak level dB: (-?[\d.]+)/)?.[1] ?? 0);
  const peakOf = g => peakIn(inputs, g);
  // Bring the cut up to level first: the denoiser judges hiss against a fixed floor, and a quiet recording
  // would otherwise sit under it entirely and be removed along with its noise.
  const raw = peakIn(input, '[0:a]anull');
  const pre = -3 - raw;
  // Then measure again after processing and write it levelled to a -3 dB peak.
  const peak = peakOf(graph(pre));
  run(['-y', ...inputs, '-filter_complex', `${graph(pre)},volume=${(-3 - peak).toFixed(2)}dB`, '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', out]);
  const check = peakIn(['-i', out], '[0:a]anull');
  if (check > -2.5) throw new Error(`${name} came out at ${check} dB; expected -3`);
  console.log(`${name.padEnd(15)} ${total.toFixed(2)} s  raw peak ${raw.toFixed(1)} dB${opts.reverb ? `, reverb ${opts.reverb}` : ''}`);
}

const lines = [...used].sort((a, b) => a - b).map(id => `- ${SOURCES[id][1]} by ${SOURCES[id][0]}: ${page(id)} (CC0)`);
writeFileSync(join(OUT, 'CREDITS.md'), `# Story opener sound effects\n\nCut by tools/sfx/make.mjs from these Freesound recordings, all CC0 (no credit required;\nlisted so the source of every sound is on record).\n\n${lines.join('\n')}\n`);
console.log(`\n${CUES.length} cues from ${used.size} sources; credits in remotion/public/sfx/CREDITS.md`);
