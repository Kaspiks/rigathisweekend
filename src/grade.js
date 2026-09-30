// Colour grading: the named looks an edit can put over its pictures, and the arithmetic behind each one.
//
// A grade is the difference between "clips with words on" and something that reads as a film, and it is
// the part that is hardest to ask for in words. So the looks are a board, the way an editor keeps one:
// each has a short description of when it is right, the knobs it actually sets, and the handful of
// colours it pushes a picture towards. Those colours are what makes the board usable by a model rather
// than just by eye - `matchLooks` compares what a clip is already made of against each look's palette,
// so "which of these suits this shot" has an answer that can be worked out instead of guessed.
//
// Everything here is plain data and arithmetic; the renderer turns the knobs into an SVG filter.

// Knobs, all neutral at these values. A look is a set of them; an edit may then nudge any of them itself.
export const NEUTRAL = {
  exposure: 0,        // stops, -2…2
  contrast: 0,        // -1…1
  saturation: 0,      // -1 (grey) … 1
  temperature: 0,     // -1 (cold) … 1 (warm)
  tint: 0,            // -1 (green) … 1 (magenta)
  lift: '#808080',    // what black becomes: the shadow tint
  gain: '#808080',    // what white becomes: the highlight tint
  fade: 0,            // 0…1, milky lifted blacks, like an old print
  vignette: 0,        // 0…1, darkening towards the corners
  grain: 0,           // 0…1, film grain
  halation: 0,        // 0…1, warm bloom out of the highlights
  aberration: 0,      // 0…1, colour fringing, as a lens gives
  rolloff: 0,         // 0…1, how far the highlights bend over instead of clipping flat
};

// Highlight roll-off: the shoulder a film stock has and a sensor does not. Below the knee nothing
// changes; above it the highlights are squeezed into a smaller range and arrive at white with no slope
// left, so a blown sky or a headlight bends over instead of hitting a flat white wall.
//
// The exponent is not a taste number: it is whatever makes the slope exactly 1 where the straight part
// meets the curve, so there is no visible bright band at the knee. With the knee at 1 − 0.65r and white
// landing at 1 − 0.10r, that works out to (0.65r)/(0.55r) = 13/11 for every strength.
export function shoulder(x, rolloff) {
  const r = Math.max(0, Math.min(1, rolloff || 0));
  if (!r || x <= 1 - 0.65 * r) return x;
  const k = 1 - 0.65 * r, top = 1 - 0.1 * r, d = (x - k) / (1 - k);
  return k + (top - k) * (1 - (1 - d) ** (13 / 11));
}
// The same curve as a table for feComponentTransfer, which reads it as straight lines between samples.
export const shoulderTable = (rolloff, n = 17) => Array.from({ length: n }, (_, i) => +shoulder(i / (n - 1), rolloff).toFixed(4));

// The board. `palette` is what each look pulls a picture towards, darkest first; it is what matchLooks
// compares against, and what a model should read when deciding which look suits a shot.
export const LOOKS = {
  'teal-orange': {
    about: 'The blockbuster look: warm skin against cyan shadows. Wants a shot with people or warm subjects in it, and something cool behind them.',
    palette: ['#0b2a33', '#17505c', '#c97f45', '#f0c48a'],
    set: { contrast: 0.22, saturation: 0.12, temperature: 0.18, lift: '#6d7f88', gain: '#8e8574', vignette: 0.22, rolloff: 0.3 },
  },
  'bleach-bypass': {
    about: 'Silver retained: harsh contrast, colour drained but not gone. War films and grim city scenes.',
    palette: ['#14171a', '#5d6266', '#a3a59f', '#e6e3d8'],
    set: { contrast: 0.42, saturation: -0.45, exposure: 0.1, lift: '#7b7d80', gain: '#8f8d88', vignette: 0.3, grain: 0.18, rolloff: 0.2 },
  },
  noir: {
    about: 'Black and white with hard blacks and bright highlights. For a cut that should feel like an old thriller.',
    palette: ['#000000', '#3a3a3a', '#9a9a9a', '#ffffff'],
    set: { saturation: -1, contrast: 0.45, vignette: 0.35, grain: 0.22, rolloff: 0.15 },
  },
  'golden-hour': {
    about: 'Late afternoon sun: warm, soft and slightly hazy. Flatters food, faces and wood.',
    palette: ['#3a2a1c', '#8a5a2f', '#d9a05b', '#f6e0b4'],
    set: { temperature: 0.42, exposure: 0.18, contrast: -0.06, saturation: 0.16, lift: '#8a7f6e', gain: '#918872', fade: 0.1, vignette: 0.18, halation: 0.26, rolloff: 0.45 },
  },
  moonlight: {
    about: 'Night without blackness: cool blue, low key, everything a little under. For evening streets and windows.',
    palette: ['#070d1a', '#16263f', '#3d5d85', '#9fb6d0'],
    set: { temperature: -0.45, exposure: -0.22, contrast: 0.2, saturation: -0.18, lift: '#6f7a8c', gain: '#7d8797', vignette: 0.34, rolloff: 0.25 },
  },
  'vintage-film': {
    about: 'An old print: faded blacks, warm highlights, grain. For anything that should feel remembered rather than filmed.',
    palette: ['#33302a', '#6f6252', '#b49a78', '#e8d9bd'],
    set: { fade: 0.26, temperature: 0.22, saturation: -0.14, contrast: 0.08, lift: '#8d8577', gain: '#8f8877', grain: 0.3, vignette: 0.26, halation: 0.3, aberration: 0.16, rolloff: 0.5 },
  },
  'cold-thriller': {
    about: 'Drained cyan-green with hard shadows. Tension, hospitals, rain.',
    palette: ['#0d1614', '#24403c', '#54706a', '#b3c4bd'],
    set: { temperature: -0.3, tint: -0.2, saturation: -0.3, contrast: 0.3, lift: '#737d7a', gain: '#828a86', vignette: 0.3, rolloff: 0.2 },
  },
  'pastel-dream': {
    about: 'Lifted, soft and low contrast, with pink in the highlights. Gentle, romantic, unhurried.',
    palette: ['#4a4450', '#9d8f9e', '#d9bfc6', '#f6ebe6'],
    set: { fade: 0.3, contrast: -0.2, saturation: -0.05, tint: 0.14, exposure: 0.16, lift: '#8f8890', gain: '#8f8a88', vignette: 0.1, rolloff: 0.4 },
  },
  'sun-bleached': {
    about: 'Overexposed and washed out, yellow in the whites. Summer, heat, concrete.',
    palette: ['#5a5241', '#a89772', '#ddd0a5', '#fdf8e4'],
    set: { exposure: 0.4, contrast: -0.14, saturation: -0.2, temperature: 0.3, fade: 0.2, gain: '#948f79', rolloff: 0.55 },
  },
  'neon-night': {
    about: 'Crushed blacks with magenta and cyan in the lights. Bars, signs, late cities.',
    palette: ['#08060f', '#2a1040', '#b3319a', '#3fd0e0'],
    set: { contrast: 0.4, saturation: 0.35, temperature: -0.18, tint: 0.2, lift: '#6b6a80', gain: '#8f8496', vignette: 0.36, halation: 0.42, aberration: 0.2, rolloff: 0.35 },
  },
};
export const LOOK_NAMES = Object.keys(LOOKS);

// A look's knobs, mixed `strength` of the way from neutral. 0 is the untouched picture, 1 the full look.
const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = c => `#${c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mixHex = (a, b, t) => rgbToHex(hexToRgb(a).map((v, i) => v + (hexToRgb(b)[i] - v) * t));
export function lookKnobs(name, strength = 1) {
  const look = LOOKS[name];
  if (!look) return { ...NEUTRAL };
  const t = Math.max(0, Math.min(1, strength));
  const out = { ...NEUTRAL };
  for (const [k, v] of Object.entries(look.set)) out[k] = typeof v === 'string' ? mixHex(NEUTRAL[k], v, t) : NEUTRAL[k] + (v - NEUTRAL[k]) * t;
  return out;
}

// ---- Matching a look to a picture ------------------------------------------------------------------
// Colours are compared in a rough perceptual space rather than as raw RGB: two greens a human would call
// the same can be far apart in RGB, and two RGB neighbours can look quite different.
const toLab = ([r, g, b]) => {
  const f = v => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; };
  const [R, G, B] = [f(r), f(g), f(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const k = v => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const [fx, fy, fz] = [k(x), k(y), k(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const distance = (a, b) => { const p = toLab(a), q = toLab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

// How well each look suits a set of colours taken from the picture, best first. Every colour is matched
// to its nearest in the look's palette and the distances averaged, weighted by how much of the frame that
// colour covers, so a look is judged on what the shot is mostly made of.
export function matchLooks(colours, limit = 4) {
  const weights = colours.map(c => c.share ?? 1 / colours.length);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const scored = LOOK_NAMES.map(name => {
    let sum = 0;
    for (const [i, c] of colours.entries()) {
      const rgb = Array.isArray(c) ? c : c.rgb;
      sum += (weights[i] / total) * Math.min(...LOOKS[name].palette.map(p => distance(rgb, hexToRgb(p))));
    }
    // 0–100, where 100 is a picture already made of this look's colours.
    return { look: name, fit: Math.max(0, Math.round(100 - sum * 0.85)), about: LOOKS[name].about, palette: LOOKS[name].palette };
  });
  return scored.sort((a, b) => b.fit - a.fit).slice(0, limit);
}

export { hexToRgb, rgbToHex };

// A grade layer's final knobs: the look it names, then anything the edit set itself on top. Worked out
// when the edit is saved and stored with it, so the renderer needs no copy of the board, and tuning a
// look later cannot quietly change an edit that was already approved.
export function gradeKnobs(layer) {
  const out = layer.look ? lookKnobs(layer.look, layer.strength ?? 1) : { ...NEUTRAL };
  for (const k of Object.keys(NEUTRAL)) if (layer[k] != null) out[k] = layer[k];
  for (const k of ['exposure', 'contrast', 'saturation', 'temperature', 'tint', 'fade', 'vignette', 'grain', 'halation', 'aberration', 'rolloff']) out[k] = +Number(out[k]).toFixed(4);
  return out;
}

// ---- Matching one clip to another ------------------------------------------------------------------
// Cutting between a phone clip and stock footage, the giveaway is never the colours a model would name:
// it is that the blacks sit at different heights and the highlights clip at different points. Those are
// measurable, so matching them is arithmetic rather than taste.
//
// `readLevels` measures; this turns two measurements into the knobs that carry the second towards the
// first. Both are {black, white, mid, r, g, b} in 0–1: the dark and bright ends of the picture, its
// middle, and the mean of each colour channel.
//
// Exposure and contrast are solved exactly against the filter's own arithmetic (y = e·c·x + (1−c)/2,
// which is what GradeFilter builds from those two knobs), so black lands on black and white on white.
// When the answer is past what a knob allows it is clamped and the leftover black offset becomes a
// lift, which is the knob for exactly that. Temperature and tint come from channel RATIOS, so they do
// not care what exposure did.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function matchKnobs(reference, clip) {
  const spread = Math.max(0.02, clip.white - clip.black);
  const S = clamp((reference.white - reference.black) / spread, 0.2, 5);
  const I = reference.black - S * clip.black;
  // y = e·c·x + (0.5 − 0.5c): the intercept fixes c, and the slope then fixes the exposure.
  const c = clamp(1 - 2 * I, 0.15, 3);
  const contrast = clamp(c >= 1 ? (c - 1) / 1.2 : (c - 1) / 0.85, -1, 1);
  const exposure = clamp(Math.log2(Math.max(0.05, S / c)), -2, 2);
  // What the clamped pair actually leaves the black point at, made up with a lift.
  const cUsed = 1 + (contrast >= 0 ? contrast * 1.2 : contrast * 0.85), eUsed = 2 ** exposure;
  const landed = eUsed * cUsed * clip.black + (0.5 - 0.5 * cUsed);
  const lift = clamp(reference.black - landed, -0.24, 0.24);
  // Colour is solved from RATIOS - red against blue is temperature, green against the two of them is
  // tint - so what the exposure did does not leak into it. It is solved against the channels as the
  // levels LEAVE them, not as they arrived: exposure and contrast carry an intercept, and an intercept
  // moves one channel's ratio to another. Solving both stages against the raw means was wrong in a way
  // that only showed up on a clip whose contrast needed a large correction.
  const levelled = (x) => Math.max(0.004, eUsed * cUsed * (1 - lift) * x + (0.5 - 0.5 * cUsed) * (1 - lift) + lift);
  const ratio = (m) => ({ rb: m.r / Math.max(0.004, m.b), gm: m.g / Math.max(0.004, Math.sqrt(m.r * m.b)) });
  const a = ratio(reference), b = ratio({ r: levelled(clip.r), g: levelled(clip.g), b: levelled(clip.b) });
  const q = clamp(a.rb / Math.max(0.01, b.rb), 0.3, 3.3);
  const temperature = clamp((q - 1) / (0.22 * (q + 1)), -1, 1);
  const tint = clamp((1 - clamp(a.gm / Math.max(0.01, b.gm), 0.4, 2.5)) / 0.16, -1, 1);
  const grey = Math.round(255 * clamp(0.5 + 2 * lift, 0, 1));
  // Two clips can be further apart than the knobs reach - a cold blue shot against a golden-hour one
  // needs more than temperature has to give. Saying which knob ran out is more use than quietly handing
  // back a number at its limit and letting it look like a match.
  const limited = [];
  if (Math.abs(exposure) >= 2) limited.push('exposure');
  if (Math.abs(contrast) >= 1) limited.push('contrast');
  if (Math.abs(temperature) >= 1) limited.push('temperature');
  if (Math.abs(tint) >= 1) limited.push('tint');
  return {
    knobs: {
      exposure: +exposure.toFixed(3), contrast: +contrast.toFixed(3),
      temperature: +temperature.toFixed(3), tint: +tint.toFixed(3),
      ...(grey === 128 ? {} : { lift: rgbToHex([grey, grey, grey]) }),
    },
    limited,
  };
}

// What a picture is made of, as numbers a grade can be matched against: where its blacks and whites
// actually sit, where its middle is, and the mean of each colour channel. Percentiles rather than the
// darkest and brightest pixel, because one specular highlight or one crushed pixel would otherwise
// decide the answer for the whole frame.
export function levelsFrom(data, channels) {
  const n = Math.floor(data.length / channels);
  if (!n) return { black: 0, mid: 0, white: 0, r: 0, g: 0, b: 0 };
  const luma = new Float32Array(n);
  let r = 0, g = 0, b = 0;
  for (let p = 0, i = 0; p < n; p++, i += channels) {
    const R = data[i] / 255, G = data[i + 1] / 255, B = data[i + 2] / 255;
    r += R; g += G; b += B;
    luma[p] = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }
  luma.sort();
  const at = q => luma[Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))))];
  const round = v => +v.toFixed(4);
  return { black: round(at(0.01)), mid: round(at(0.5)), white: round(at(0.99)), r: round(r / n), g: round(g / n), b: round(b / n) };
}
