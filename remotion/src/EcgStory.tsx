// Single-event story for Medbaltica, the medical fair: a heart monitor. A trace sweeps across the screen
// and the heart beats harder each time: every beat makes the text glow in, brighter than the last, before
// it fades out again, until the strongest beat brings it in to stay. Until then the screen is black except
// for the pulse; the last beat opens the monitor up from the top of its spike, and the heart settles.
//
// Built as a practice piece: the TASK functions below are the motion (the beat's shape, the sweep, the
// thump spring, the fading trail and the glow), each with the notes it was written from; everything under
// them is drawing.
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

export type EcgStoryProps = {
  title: string[];
  days: string;
  when: string;
  venue: string;
  price: string;
  accent: string;
  background: string;
  holdSeconds: number;
};
export const ECG_FPS = 30;
// Three seconds of beats and reveal, then the finished card holds while the heart keeps beating calmly.
export const ecgDuration = (holdSeconds: number) => Math.round((3 + holdSeconds) * ECG_FPS);

// Laid out for Reels: Instagram draws its top bar over roughly the top 250 px, the caption and account
// over the bottom 420 px and the like/comment/share buttons over the right 150 px, so the card and the
// readouts stay inside what is left. The profile grid shows the middle 1080 × 1440, which all of it fits.
const W = 1080;
const SAFE_TOP = 290, SAFE_RIGHT = 170;
const BASELINE = 620; // y of the flat line
const AMP = 240; // how many pixels a height of 1 is
const SPEED = 18; // how many pixels the pen moves right per frame (1080 / 18 = one sweep every 60 frames)
const BEAT_LEN = 14; // how many frames one heartbeat's shape lasts
const TRAIL = 50; // how many frames of trace stay on screen behind the pen

// When the heart beats: four quick beats for the reveal, each stronger than the last, then a calm rhythm.
// A beat's strength scales everything it does: the height of its spike, its thump and how bright the text gets.
export const REVEAL_BEATS = [20, 40, 60, 80];
const REVEAL_STRENGTHS = [0.3, 0.5, 0.75, 1];
const CALM_STRENGTH = 0.6;
const CALM_EVERY = 30; // frames between beats afterwards: 60 bpm
export const strengthOf = (beat: number) => { const i = REVEAL_BEATS.indexOf(beat); return i < 0 ? CALM_STRENGTH : REVEAL_STRENGTHS[i]; };
export function beatStarts(untilFrame: number): number[] {
  const out = [...REVEAL_BEATS];
  for (let b = REVEAL_BEATS[REVEAL_BEATS.length - 1] + CALM_EVERY; b <= untilFrame; b += CALM_EVERY) out.push(b);
  return out.filter(b => b <= untilFrame);
}

// ─── TASK 1 · The shape of one heartbeat ──────────────────────────────────────────────────────────
// `t` runs from 0 to 1 across one beat. Return the height of the line at that moment: 0 is flat,
// 1 is a full spike up (AMP pixels), negatives go down.
// A real ECG beat is: a small rounded bump (P), a small dip (Q), a tall sharp spike (R), a dip below the
// line (S), then a wide gentle bump (T), and back to flat.
// Hint: one bump is a "bell curve": height * Math.exp(-((t - centre) / width) ** 2). A tall narrow bell
// is a spike, a low wide one is a gentle bump. Add five of them together, with R's width about 0.03.
// Done when: the trace shows a heartbeat you'd recognise, starting and ending flat.
export function ecgShape(t: number): number {
  // One bell curve: `height` at `centre`, fading to almost nothing a couple of `width`s either side.
  // Note the minus inside exp(): without it the curve grows away from the centre instead of dying off.
  const bell = (height: number, centre: number, width: number) => height * Math.exp(-(((t - centre) / width) ** 2));
  // All five are added at every t, rather than picking one per window: each bell is ~0 away from its own
  // centre, so they don't disturb each other, and each fades out smoothly instead of being cut off.
  return bell(0.1, 0.05, 0.02)     // P: small bump
    + bell(-0.1, 0.15, 0.02)       // Q: small dip
    + bell(1, 0.225, 0.03)         // R: the tall spike
    + bell(-0.2, 0.3, 0.02)        // S: dip below the line
    + bell(0.3, 0.425, 0.05);      // T: wide gentle bump
}

// ─── TASK 2 · The pen sweeping across the screen ──────────────────────────────────────────────────
// Where the pen is, left to right, at frame `f` (f can be a fraction, e.g. 12.25). Right now it moves
// right forever and runs off the screen after two seconds.
// Hint: a real monitor jumps back to the left edge and starts again. The remainder operator % does that.
// Done when: the trace wraps round to the left edge instead of leaving the screen. (The drawing already
// breaks the line where it jumps back, so you won't get a stroke across the whole screen.)
export function penX(f: number): number {
  // % keeps only what is left over after whole screen-widths: at 1100 px the pen is back at 20.
  return (f * SPEED) % W;
}

// ─── TASK 3 · The thump ───────────────────────────────────────────────────────────────────────────
// How much bigger the card is at `frame`: 0 is normal size, 0.04 is 4% bigger. This is a spring, like
// your bouncing ball but pulled back to 0 instead of falling: loop over every frame up to `frame`, and
// on a frame where a beat starts, kick the velocity (an impulse). Every frame, the spring pulls the
// position back towards 0 (force = -k * position) and damping slows it (force = -c * velocity).
// Hint: start with k = 0.25, c = 0.35 and a kick of 0.045. `beats.includes(f)` tells you if a beat starts on f.
// Done when: the card grows about 4% just after each beat and settles back before the next one, with
// at most one small wobble. Too bouncy: raise c. Too slow: raise k.
export function thump(frame: number, beats: number[]): number {
  const k = 0.25, c = 0.35, kick = 0.045;
  let position = 0, velocity = 0;
  for (let f = 0; f < frame; f++) {
    if (beats.includes(f)) velocity += kick * strengthOf(f); // the heartbeat: an impulse, harder on a stronger beat
    const force = -k * position - c * velocity; // the spring pulls back to normal size, damping calms it
    velocity += force;
    position += velocity;
  }
  return position;
}

// ─── TASK 4 · The fading trail ────────────────────────────────────────────────────────────────────
// How visible a piece of trace is that the pen drew `age` frames ago (0 = just now, TRAIL = the oldest
// still drawn). Right now all of it is fully visible, so the trail ends in a hard cut.
// Hint: 1 when new, 0 at TRAIL. A straight line works; age ** 2 makes it hold longer, then drop off.
// Done when: the line is bright at the pen and fades smoothly to nothing behind it, like a phosphor screen.
export function trailOpacity(age: number): number {
  // Squared, so the fresh part of the trace stays bright for a while and then drops away, like phosphor.
  return Math.max(0, 1 - (age / TRAIL) ** 2);
}

// ─── TASK 5 · The glow ────────────────────────────────────────────────────────────────────────────
// Each reveal beat swells the text up softly, to that beat's strength, and it fades out again before
// the next one: dim, gone, brighter, gone, brighter still, gone, and the last, strongest beat
// lights it fully and it stays. Two numbers per frame:
//   level: how visible the text is (0 to 1).
//   flare: the halo round the letters. It flashes on every beat, including the calm ones afterwards,
//          and always dies down, so the settled text still gives a soft pulse with each heartbeat.
const GLOW_WAVE = 18; // frames one glow takes to swell and fade again; beats are 20 apart, so each is gone first
const GLOW_SETTLE = 12; // frames the last glow takes to come in fully
const FLARE_RISE = 6, FLARE_FADE = 10;
// 0 → 1 with a gentle start and a gentle finish, rather than a straight line with corners.
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
export function glowAt(frame: number, beats: number[]): { level: number; flare: number } {
  let level = 0, flare = 0;
  REVEAL_BEATS.forEach((beat, i) => {
    const age = frame - beat;
    if (age < 0) return;
    // A soft wave: swells from nothing to the beat's strength halfway through, and back to nothing.
    // The last beat eases up to full and stays.
    const wave = i === REVEAL_BEATS.length - 1 ? smooth(age / GLOW_SETTLE) : Math.sin(Math.PI * Math.min(1, age / GLOW_WAVE)) ** 2;
    level = Math.max(level, REVEAL_STRENGTHS[i] * wave);
  });
  for (const beat of beats) {
    const age = frame - beat;
    if (age >= 0) flare = Math.max(flare, strengthOf(beat) * smooth(age / FLARE_RISE) * Math.exp(-Math.max(0, age - FLARE_RISE) / FLARE_FADE));
  }
  return { level, flare };
}

// ─── The reveal ───────────────────────────────────────────────────────────────────────────────────
// Black everywhere but the pulse until the last reveal beat; then a circle opens from the top of that
// beat's spike and uncovers the monitor (its colour, grid and readouts) across the whole screen.
const SPIKE_AT = 0.225; // where the tall R spike peaks within a beat (see ecgShape)
const REVEAL_FRAMES = 26; // how long the circle takes to cover the screen
const REVEAL_EDGE = 220; // how soft its edge is, in pixels
export function revealRadius(frame: number): number {
  const age = frame - (REVEAL_BEATS[REVEAL_BEATS.length - 1] + SPIKE_AT * BEAT_LEN); // from the top of the spike
  if (age <= 0) return 0;
  const t = Math.min(1, age / REVEAL_FRAMES), eased = 1 - (1 - t) ** 3; // fast out of the spike, easing to a stop
  return eased * (2300 + REVEAL_EDGE); // 2300 px reaches the farthest corner from anywhere on the line
}

// ─── Sound ────────────────────────────────────────────────────────────────────────────────────────
// One monitor beep per beat, sounding on the top of its spike, as loud as the beat is strong; the calm
// beats afterwards stay quiet under the finished card. The beep is a single beep from a CC0 recording
// (freesound 210793), five semitones lower and softened; the swell is a low hum that rises into the
// reveal. Both files are in public/sfx.
const CALM_VOLUME = 0.35;
const SWELL_LEAD = 8; // frames the swell starts before the last spike, so it is already rising when it hits
// Measured in a render: sound lands about 1.4 frames after its frame (the video's audio encoding adds a
// little delay), so each beep starts a frame early to sound on the spike.
const BEEP_EARLY = 1;
const BEEP_FRAMES = 27; // the beep with its echo tail; a beep that would be cut off by the end is left out
// A Reel loops, so the last half-second fades everything back to the black it opens on, and the loop is seamless.
const LOOP_FADE = 15;
const beepVolume = (beat: number) => (REVEAL_BEATS.includes(beat) ? strengthOf(beat) : CALM_VOLUME);

// ─── Everything below is drawing; you shouldn't need to touch it ──────────────────────────────────
// The trace's height at any frame, including fractions: a beat's shape while one is running, else flat.
function heightAt(f: number, beats: number[]): number {
  for (const b of beats) if (f >= b && f < b + BEAT_LEN) return ecgShape((f - b) / BEAT_LEN) * strengthOf(b);
  return 0;
}

const Grid = ({ color }: { color: string }) => (
  <svg width={W} height={1920} style={{ position: 'absolute', inset: 0 }}>
    {Array.from({ length: 28 }, (_, i) => <line key={`v${i}`} x1={i * 40} y1={0} x2={i * 40} y2={1920} stroke={color} strokeOpacity={i % 5 ? 0.06 : 0.14} />)}
    {Array.from({ length: 49 }, (_, i) => <line key={`h${i}`} x1={0} y1={i * 40} x2={W} y2={i * 40} stroke={color} strokeOpacity={i % 5 ? 0.06 : 0.14} />)}
  </svg>
);

export const EcgStory = ({ title, days, when, venue, price, accent, background }: EcgStoryProps) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const spikeFrame = (beat: number) => Math.round(beat + SPIKE_AT * BEAT_LEN);
  const beats = beatStarts(frame);
  const bpm = beats.length > 1 ? Math.round(ECG_FPS * 60 / (beats[beats.length - 1] - beats[beats.length - 2])) : '- -';

  // The trace: sampled four times a frame so the spike is smooth, drawn in short pieces so each piece
  // can have its own opacity, and broken wherever the pen jumps back to the left edge.
  const STEP = 0.25, pieces: { d: string; age: number }[] = [];
  let run: string[] = [], lastX = Infinity;
  for (let age = TRAIL; age >= 0; age -= STEP) {
    const f = frame - age;
    if (f < 0) continue;
    const x = penX(f), y = BASELINE - heightAt(f, beats) * AMP;
    if (x < lastX - W / 2 || run.length >= 8) {
      if (run.length > 1) pieces.push({ d: `M${run.join(' L')}`, age: age + STEP * run.length / 2 });
      run = x < lastX - W / 2 ? [] : [run[run.length - 1]];
    }
    run.push(`${x.toFixed(1)},${y.toFixed(1)}`); lastX = x;
  }
  if (run.length > 1) pieces.push({ d: `M${run.join(' L')}`, age: 0 });
  const pen = frame >= 0 ? { x: penX(frame), y: BASELINE - heightAt(frame, beats) * AMP } : null;
  // Where the reveal starts: the top of the last reveal beat's spike (the R peak sits at t = 0.225).
  const lastBeat = REVEAL_BEATS[REVEAL_BEATS.length - 1], peakF = lastBeat + SPIKE_AT * BEAT_LEN;
  const origin = { x: penX(peakF), y: BASELINE - heightAt(peakF, beatStarts(lastBeat)) * AMP };
  const radius = revealRadius(frame);
  const hole = `radial-gradient(circle at ${origin.x.toFixed(0)}px ${origin.y.toFixed(0)}px, transparent ${Math.max(0, radius - REVEAL_EDGE).toFixed(0)}px, black ${radius.toFixed(0)}px)`;

  const scale = 1 + thump(frame, beats), { level, flare } = glowAt(frame, beats);
  const label = { fontFamily: 'DejaVu Sans, Arial, sans-serif', color: '#f5f1ea', letterSpacing: 4 };
  // The halo: a tight bright ring and a wide soft one, both in the accent colour, growing with the flare.
  const halo = `0 0 ${(4 + 10 * flare).toFixed(1)}px ${accent}, 0 0 ${(14 + 36 * flare).toFixed(1)}px ${accent}`;

  return (
    <AbsoluteFill style={{ background }}>
      {beatStarts(durationInFrames).filter(b => spikeFrame(b) + BEEP_FRAMES <= durationInFrames - LOOP_FADE).map(b => (
        <Sequence key={b} from={spikeFrame(b) - BEEP_EARLY} name={`beep ${b}`}>
          <Audio src={staticFile('sfx/ecg-beep.wav')} volume={beepVolume(b)} />
        </Sequence>
      ))}
      <Sequence from={spikeFrame(REVEAL_BEATS[REVEAL_BEATS.length - 1]) - SWELL_LEAD} name="reveal swell">
        <Audio src={staticFile('sfx/ecg-swell.wav')} volume={0.8} />
      </Sequence>
      <Grid color={accent} />
      {/* Monitor readouts: the heart pulses with the thump. */}
      <div style={{ ...label, position: 'absolute', top: SAFE_TOP, left: 80, fontSize: 30, color: accent }}>RĪGA / WEEKEND</div>
      <div style={{ ...label, position: 'absolute', top: SAFE_TOP - 8, right: SAFE_RIGHT, fontSize: 44, color: accent, display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ display: 'inline-block', transform: `scale(${1 + thump(frame, beats) * 6})` }}>♥</span>
        <span>{bpm}</span>
      </div>
      {/* The dark: covers the monitor until the last beat, then a circle opens from its spike. */}
      {radius < 2300 + REVEAL_EDGE && <AbsoluteFill style={{ background: '#000', maskImage: hole, WebkitMaskImage: hole }} />}
      <svg width={W} height={1920} style={{ position: 'absolute', inset: 0, filter: `drop-shadow(0 0 10px ${accent})` }}>
        {pieces.map((p, i) => <path key={i} d={p.d} fill="none" stroke={accent} strokeWidth={7} strokeLinejoin="round" strokeLinecap="round" opacity={trailOpacity(p.age)} />)}
        {pen && <circle cx={pen.x} cy={pen.y} r={12} fill="#fff" />}
      </svg>
      {/* The card: glows in with each beat, scaled by the thump around its own centre. */}
      <div style={{ position: 'absolute', left: 80, right: SAFE_RIGHT, top: 820, opacity: level, textShadow: halo, transform: `scale(${scale})`, transformOrigin: '30% 30%' }}>
        {title.map(t => <div key={t} style={{ ...label, fontSize: 118, fontWeight: 700, letterSpacing: -2, lineHeight: 1.02 }}>{t}</div>)}
        <div style={{ width: 120, height: 10, background: accent, margin: '36px 0 40px', boxShadow: halo }} />
        <div style={{ ...label, fontSize: 52, color: accent }}>{days}</div>
        <div style={{ ...label, fontSize: 44, color: accent, marginTop: 10 }}>{when}</div>
        <div style={{ ...label, fontSize: 34, marginTop: 34, letterSpacing: 3 }}>{venue}</div>
        <div style={{ ...label, fontSize: 52, marginTop: 26 }}>{price}</div>
      </div>
      {/* Back to black for the loop. */}
      <AbsoluteFill style={{ background: '#000', opacity: Math.min(1, Math.max(0, (frame - (durationInFrames - LOOP_FADE)) / (LOOP_FADE - 1))) }} />
    </AbsoluteFill>
  );
};
