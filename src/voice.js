// Generated sound: the board of narration styles, what each generation costs, and how a voice's own
// timings become captions.
//
// The same idea as the grading board in src/grade.js, and for the same reason. "Read this poem sadly" is
// not something a model can hand to an API, but "cinematic-sad" can be a row in a board that says what
// it is for and which knobs it sets - and then choosing a delivery is reading a list rather than
// guessing at numbers. ElevenLabs' settings are the knobs:
//
//   stability   low lets the read wander and find emotion; high holds it even. Too low wavers, too high
//               drones. It is the one that matters most, and the one worth setting per style.
//   style       how far the voice leans into its own character. Above about 0.6 it starts acting.
//   speed       1 as recorded. Verse wants under 1; news wants over.
//
// Nothing here calls anything. src/eleven.js makes the requests; this is only arithmetic and taste.

export const NEUTRAL_VOICE = { stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1, use_speaker_boost: true };

export const STYLES = {
  'poem-narrative': {
    about: 'Unhurried and even, trusting the line breaks to do the work. The default for verse read straight, with no feeling pushed onto it.',
    set: { stability: 0.55, style: 0.2, speed: 0.92 },
  },
  'cinematic-sad': {
    about: 'Low, close and slow, with the pauses left long. For an elegy, a last shot, a poem about something ending.',
    set: { stability: 0.7, style: 0.35, speed: 0.84 },
  },
  elegy: {
    about: 'Slower and stiller than cinematic-sad, almost without inflection. For grief rather than sadness; it will drag over anything lighter.',
    set: { stability: 0.78, style: 0.3, speed: 0.78 },
  },
  'intimate-whisper': {
    about: 'Quiet and near, as if beside you. Flatters a short, personal line; falls apart over long paragraphs.',
    set: { stability: 0.68, style: 0.25, speed: 0.88 },
  },
  'documentary-warm': {
    about: 'Warm, even and explanatory, the voice of someone who knows the place. For an event listing or anything telling you what you are looking at.',
    set: { stability: 0.6, style: 0.15, speed: 0.98 },
  },
  storybook: {
    about: 'Animated and a little playful, leaning into the characters. For drawn animation and anything with a story in it.',
    set: { stability: 0.4, style: 0.5, speed: 0.96 },
  },
  wry: {
    about: 'Light, dry, a half-smile behind it. For a listing with personality, or a line that would be unbearable read straight.',
    set: { stability: 0.45, style: 0.4, speed: 1 },
  },
  'trailer-hard': {
    about: 'Clipped and driving, pushing forward. For a drift or action trailer, over cuts, under music.',
    set: { stability: 0.4, style: 0.6, speed: 1.05 },
  },
  'epic-declaim': {
    about: 'Big and projected, the film-trailer voice. Use it on three or four words, never on a paragraph.',
    set: { stability: 0.35, style: 0.75, speed: 0.95 },
  },
  'news-brisk': {
    about: 'Fast, flat and factual, with no colour at all. For dates, times and prices, where warmth reads as selling.',
    set: { stability: 0.72, style: 0.05, speed: 1.12 },
  },
};
export const STYLE_NAMES = Object.keys(STYLES);

// A style's settings. `strength` mixes it in from the neutral voice, the way a look's strength does, so
// a delivery can be asked for at half pressure.
export function voiceSettings(style, strength = 1) {
  const chosen = STYLES[style];
  const out = { ...NEUTRAL_VOICE };
  if (!chosen) return out;
  const t = Math.max(0, Math.min(1, strength));
  for (const [k, v] of Object.entries(chosen.set)) {
    // Only the numeric knobs mix; a switch like use_speaker_boost would come out as 0.5 of a boolean.
    if (typeof v !== 'number' || typeof NEUTRAL_VOICE[k] !== 'number') { out[k] = v; continue; }
    out[k] = +(NEUTRAL_VOICE[k] + (v - NEUTRAL_VOICE[k]) * t).toFixed(4);
  }
  return out;
}

// ---- What it costs ---------------------------------------------------------------------------------
// Published rates: speech is one credit a character on the multilingual models and half that on the
// flash ones; a sound effect with a duration is 40 credits a second. Music is NOT a rate this has seen
// documented, so it is guessed high on purpose - the guess is only ever used to decide whether to make
// the call, and what actually gets written to the ledger is measured afterwards against ElevenLabs'
// own count. A cap enforced on a guess would be a cap that lies.
export const RATES = { speech: 1, speechFlash: 0.5, effectPerSecond: 40, musicPerSecond: 100 };
export const FLASH = /flash|turbo/i;

export function estimateCredits(kind, { text = '', seconds = 0, model = '' } = {}) {
  if (kind === 'speech') return Math.ceil(text.length * (FLASH.test(model) ? RATES.speechFlash : RATES.speech));
  if (kind === 'effect') return Math.ceil(Math.max(0.5, seconds) * RATES.effectPerSecond);
  if (kind === 'music') return Math.ceil(Math.max(1, seconds) * RATES.musicPerSecond);
  return 0;
}

// ---- Captions from the voice's own timings ---------------------------------------------------------
// The with-timestamps endpoint answers with a start and end for every CHARACTER it spoke. Characters are
// too fine to put on screen, so they are gathered back into words: a word runs from the start of its
// first character to the end of its last, and whitespace ends it. Punctuation stays attached to the word
// before it, which is what you want on screen ("No lift." not "No lift" then ".").
export function wordsFromAlignment(alignment) {
  const chars = alignment?.characters ?? [];
  const starts = alignment?.character_start_times_seconds ?? [];
  const ends = alignment?.character_end_times_seconds ?? [];
  const words = [];
  let open = null;
  for (let i = 0; i < chars.length; i++) {
    if (/\s/.test(chars[i])) { if (open) { words.push(open); open = null; } continue; }
    if (!open) open = { word: '', from: starts[i] ?? 0, to: ends[i] ?? 0 };
    open.word += chars[i];
    open.to = Math.max(open.to, ends[i] ?? open.to);
  }
  if (open) words.push(open);
  return words.map(w => ({ word: w.word, from: +w.from.toFixed(3), to: +w.to.toFixed(3) }));
}

// Those words as text layers, in OUTPUT frames, landing exactly on the voice. `at` is the frame the
// narration starts on, so captions move with the cue rather than being timed by hand.
//
// A line holds until the next one starts rather than fading on its own: a gap between captions reads as
// a dropped word, while a line that waits reads as someone still talking. The last line keeps a tail.
export function captionLayers(words, { at = 0, fps = 30, perLine = 4, style = 'caption', hold = 0.35 } = {}) {
  const lines = [];
  for (let i = 0; i < words.length; i += perLine) {
    const group = words.slice(i, i + perLine);
    lines.push({ text: group.map(w => w.word).join(' '), from: group[0].from, to: group.at(-1).to });
  }
  return lines.map((line, i) => {
    const next = lines[i + 1];
    const end = next ? Math.min(line.to + hold, next.from) : line.to + hold;
    return {
      type: 'text', style,
      from: at + Math.max(0, Math.round(line.from * fps)),
      to: at + Math.max(1, Math.round(end * fps)),
      text: line.text,
      in: 2, out: 2, enter: 'fade', exit: 'fade', align: 'center',
    };
  });
}
