// Colour themes for the images. Each day of an edition has one, used for its cover, its slides and its
// stories, so Friday, Saturday and Sunday look different as they come through the feed. Every theme is a
// dark background with a bright accent: the copy is always light, and over a photo the scrim is the
// theme's own shade. `ink` is the background, `glow` the large circle, `shade` the photo scrim.
import { DateTime } from 'luxon';
import { ZONE } from './domain.js';

export const THEMES = {
  forest:  { name: 'Forest',  ink: '#17352d', glow: '#264a3e', accent: '#d4ed86', paper: '#f4f0e6', muted: '#c1cbbb', shade: '#0c1c17' },
  cobalt:  { name: 'Cobalt',  ink: '#14245c', glow: '#233a85', accent: '#ffd23f', paper: '#f5f3ec', muted: '#b8c1dc', shade: '#0a1233' },
  crimson: { name: 'Crimson', ink: '#6b0f1a', glow: '#8a1c28', accent: '#ffb703', paper: '#fff4ea', muted: '#e6bcbc', shade: '#2a060b' },
  plum:    { name: 'Plum',    ink: '#3b1446', glow: '#55205f', accent: '#ff8fd1', paper: '#f8eefa', muted: '#cdb4d6', shade: '#1a0820' },
  teal:    { name: 'Teal',    ink: '#0b4f55', glow: '#146b72', accent: '#ffe066', paper: '#f0faf8', muted: '#a9d3cf', shade: '#04272a' },
  ember:   { name: 'Ember',   ink: '#161616', glow: '#2b2b2b', accent: '#ff5a36', paper: '#f5f5f0', muted: '#bdbdbd', shade: '#000000' },
  ocean:   { name: 'Ocean',   ink: '#0d3b66', glow: '#17507f', accent: '#7ae7c7', paper: '#f2f7fb', muted: '#a9c1d6', shade: '#051b30' },
  rust:    { name: 'Rust',    ink: '#5a2a12', glow: '#76391b', accent: '#ffcf70', paper: '#fbf2e8', muted: '#dcb99f', shade: '#261006' },
};
export const THEME_KEYS = Object.keys(THEMES);
export const DEFAULT_THEME = 'forest';
// Unless you choose otherwise, each weekday gets its own colour, and special posts stand apart from all three.
const WEEKDAY_THEMES = { 5: 'cobalt', 6: 'forest', 7: 'crimson' };
export const SPECIAL_THEME = 'ember';

export function themeKey(edition, date) {
  const chosen = edition?.themes?.[date];
  if (chosen && THEMES[chosen]) return chosen;
  if (edition?.data?.headline) return SPECIAL_THEME;
  return WEEKDAY_THEMES[DateTime.fromISO(date, { zone: ZONE }).weekday] || DEFAULT_THEME;
}
export const themeFor = (edition, date) => THEMES[themeKey(edition, date)];
