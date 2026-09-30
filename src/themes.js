// Colour themes for the images. Every week has a colour family, and every day of it a tone of that family:
// the accent (pills, date line, number badge) stays the same all week, so a week reads as one group in the
// feed, while the background tone tells its days apart. A special post (Researchers' Night) takes the
// family's darkest tone, so it still belongs to its week. Families rotate by week number unless you pick one.
// `ink` is the background, `glow` the large circle, `shade` the photo scrim.
import { DateTime } from 'luxon';
import { ZONE } from './domain.js';

// Each family's mid tone is a complete, hand-picked palette; the other tones are derived from it.
const FAMILY_BASE = {
  forest:  { name: 'Forest',  ink: '#17352d', glow: '#264a3e', accent: '#d4ed86', paper: '#f4f0e6', muted: '#c1cbbb', shade: '#0c1c17' },
  cobalt:  { name: 'Cobalt',  ink: '#14245c', glow: '#233a85', accent: '#ffd23f', paper: '#f5f3ec', muted: '#b8c1dc', shade: '#0a1233' },
  crimson: { name: 'Crimson', ink: '#6b0f1a', glow: '#8a1c28', accent: '#ffb703', paper: '#fff4ea', muted: '#e6bcbc', shade: '#2a060b' },
  plum:    { name: 'Plum',    ink: '#3b1446', glow: '#55205f', accent: '#ff8fd1', paper: '#f8eefa', muted: '#cdb4d6', shade: '#1a0820' },
  teal:    { name: 'Teal',    ink: '#0b4f55', glow: '#146b72', accent: '#ffe066', paper: '#f0faf8', muted: '#a9d3cf', shade: '#04272a' },
  ember:   { name: 'Ember',   ink: '#2a2a2a', glow: '#3a3a3a', accent: '#ff5a36', paper: '#f5f5f0', muted: '#bdbdbd', shade: '#000000' },
  ocean:   { name: 'Ocean',   ink: '#0d3b66', glow: '#17507f', accent: '#7ae7c7', paper: '#f2f7fb', muted: '#a9c1d6', shade: '#051b30' },
  rust:    { name: 'Rust',    ink: '#5a2a12', glow: '#76391b', accent: '#ffcf70', paper: '#fbf2e8', muted: '#dcb99f', shade: '#261006' },
};
// Tones move the background's lightness, and turn its hue a little, so neighbouring days differ at a glance.
export const TONES = {
  light: { name: 'Light', dl: 0.09, dh: -8 },
  mid:   { name: 'Mid',   dl: 0,    dh: 0 },
  deep:  { name: 'Deep',  dl: -0.06, dh: 8 },
  night: { name: 'Night', dl: -0.11, dh: 0, floor: 0.06 },
};
export const FAMILY_KEYS = Object.keys(FAMILY_BASE), TONE_KEYS = Object.keys(TONES);
const DAY_TONES = { 5: 'light', 6: 'mid', 7: 'deep' }, SPECIAL_TONE = 'night';

const toHsl = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1)), h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
};
const toHex = (h, s, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
};
const shift = (hex, dl, dh, floor = 0.03) => { const [h, s, l] = toHsl(hex); return toHex((h + dh + 360) % 360, s, Math.min(0.45, Math.max(floor, l + dl))); };

// Every family × tone as a full palette, keyed "cobalt-light". The forest mid tone is the original look.
export const THEMES = {};
for (const [family, base] of Object.entries(FAMILY_BASE))
  for (const [tone, t] of Object.entries(TONES))
    THEMES[`${family}-${tone}`] = { ...base, family, tone, familyName: base.name, name: `${base.name} · ${t.name}`,
      ...(tone === 'mid' ? {} : { ink: shift(base.ink, t.dl, t.dh, t.floor), glow: shift(base.glow, t.dl, t.dh, (t.floor || 0.03) + 0.05), shade: shift(base.shade, Math.min(0, t.dl), t.dh, 0) }) };
export const THEME_KEYS = Object.keys(THEMES);
export const DEFAULT_THEME = 'forest-mid';

// The week's family: your choice for the edition, otherwise the one this week's number lands on.
export function weekFamily(edition) {
  const chosen = edition?.themes?.palette;
  if (FAMILY_BASE[chosen]) return chosen;
  const week = DateTime.fromISO(edition?.weekend || edition?.data?.weekend, { zone: ZONE }).weekNumber || 0;
  return FAMILY_KEYS[week % FAMILY_KEYS.length];
}
export function dayTone(edition, date) {
  const chosen = edition?.themes?.days?.[date];
  if (TONES[chosen]) return chosen;
  if (edition?.data?.headline) return SPECIAL_TONE;
  return DAY_TONES[DateTime.fromISO(date, { zone: ZONE }).weekday] || 'mid';
}
export const themeKey = (edition, date) => `${weekFamily(edition)}-${dayTone(edition, date)}`;
export const themeFor = (edition, date) => THEMES[themeKey(edition, date)];

// Swatch colours for the review page, served as a stylesheet because the page's CSP forbids inline styles.
export const themeCss = () => [
  ...FAMILY_KEYS.map(f => `.swatch-family-${f}{background:linear-gradient(135deg,${THEMES[`${f}-light`].ink} 0 33%,${THEMES[`${f}-mid`].ink} 33% 55%,${FAMILY_BASE[f].accent} 55%)}`),
  ...THEME_KEYS.map(k => `.swatch-${k}{background:linear-gradient(135deg,${THEMES[k].ink} 60%,${THEMES[k].accent} 60%)}`),
].join('\n');
