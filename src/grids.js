// Story grids: a day's event cards tiled into one 1080×1920 sheet, which the render service pulls out of
// the envelope. You choose the cards; the suggestion is only the starting point.
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readdir, rm } from 'node:fs/promises';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { eventsByDay, eventDate, ZONE } from './domain.js';
import { cardPhoto, drawCard } from './render.js';
import { themeFor, themeKey } from './themes.js';

export const GRID_MAX = 6, GRID_W = 1080, GRID_H = 1920, GUTTER = 12;
// The bottom strip is left clear for the story's footer bar (the ticket stub lands and becomes it).
export const BAR_H = 190;
const CARDS_H = GRID_H - BAR_H;

export const GridRequest = z.object({
  events: z.array(z.number().int().min(0)).min(1).max(GRID_MAX),
  kicker: z.string().trim().min(1).max(24).default('Overview'),
  category: z.string().trim().min(1).max(32).default('Arts & Culture'),
  holdSeconds: z.number().min(2).max(15).default(6),
  style: z.enum(['ticket', 'envelope']).default('ticket'),
});

export const gridDay = date => DateTime.fromISO(date, { zone: ZONE }).setLocale('en').toFormat('cccc').toUpperCase();
// What the ticket prints: "18 SEPTEMBER", and a ticket number made of the month and day ("0918").
export const ticketText = date => {
  const d = DateTime.fromISO(date, { zone: ZONE }).setLocale('en');
  return { dateLabel: d.toFormat('d LLLL').toUpperCase(), number: d.toFormat('MMdd') };
};

// The day's events in the order they are chosen from: published ones only once approved.
export function dayEvents(edition, date) {
  const selected = edition.approved ? edition.selected : null;
  return eventsByDay(edition.data, selected).find(d => d.date === date)?.items || [];
}

// Up to six of the day's events, earliest first, preferring the ones that have a real photo.
export function suggestPicks(edition, date, hasPhoto = () => true) {
  const items = dayEvents(edition, date)
    .map((x, order) => ({ ...x, order, photo: hasPhoto(x.index) }))
    .sort((a, b) => (b.photo - a.photo) || a.order - b.order)
    .slice(0, GRID_MAX)
    .sort((a, b) => a.order - b.order);
  return items.map(x => x.index);
}

export function checkPicks(edition, date, picks) {
  const allowed = new Set(dayEvents(edition, date).map(x => x.index));
  if (!allowed.size) throw new Error(`No events on ${date} in this edition`);
  const unique = [...new Set(picks)];
  if (unique.length !== picks.length) throw new Error('An event is picked twice');
  if (unique.some(i => !allowed.has(i))) throw new Error(`Only events on ${date} can go in its grid`);
  return unique;
}

// Two columns; rows share the height. An odd card out spans the last row, and a single card fills the sheet.
export function gridLayout(count) {
  if (count < 1 || count > GRID_MAX) throw new Error(`A grid takes 1 to ${GRID_MAX} cards`);
  const rows = Math.ceil(count / 2), h = Math.floor((CARDS_H - GUTTER * (rows - 1)) / rows), w = (GRID_W - GUTTER) / 2;
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / 2), last = i === count - 1 && count % 2 === 1;
    const top = row * (h + GUTTER), height = row === rows - 1 ? CARDS_H - top : h;
    return last ? { left: 0, top, width: GRID_W, height } : { left: (i % 2) * (w + GUTTER), top, width: w, height };
  });
}

// One tile per event per cell shape: a 2×3 grid and a single full-sheet card need different ones.
// The version moves when the tile's design changes, and the colour theme is in the name, so old ones are never reused.
const TILE_VERSION = 2;
export const tilePath = (dir, editionId, index, height, theme = 'forest') => join(dir, 'media', editionId, `tile${TILE_VERSION}-${index}-${height}${theme === 'forest' ? '' : `-${theme}`}.jpg`);
// Every tile of one event, whatever cell shape it was drawn for.
export async function dropTiles(dir, editionId, index) {
  const folder = join(dir, 'media', editionId);
  const files = await readdir(folder).catch(() => []);
  await Promise.all(files.filter(f => /^tile\d*-/.test(f) && f.split('-')[1] === String(index)).map(f => rm(join(folder, f), { force: true })));
}

export const gridFiles = (dir, editionId, date) => ({
  png: join(dir, 'media', editionId, `grid-${date}.png`),
  mp4: join(dir, 'media', editionId, `grid-${date}.mp4`),
});

// Grid tiles are the event's card without the carousel number, and with the clock time alone: in a grid
// every card of one day is on screen at once, so "3 of 5" and the date would both be noise. They are also drawn at the shape of the cell they go in, so the venue
// line at the foot of a card is never cropped away. Drawn on demand and kept next to the other media.
async function gridTile(dir, edition, index, cell) {
  const height = Math.round((GRID_W * cell.height) / cell.width);
  const event = edition.data.events[index], date = eventDate(event);
  const tile = tilePath(dir, edition.id, index, height, themeKey(edition, date));
  if (existsSync(tile)) return tile;
  if (!existsSync(join(dir, 'media', edition.id, `feed-${index}.jpg`))) throw new Error(`The card for event ${index + 1} has not been rendered yet`);
  await drawCard(tile, { event, weekend: edition.weekend, demo: edition.demo, height, timeOnly: true, photo: await cardPhoto(dir, edition.id, index), theme: themeFor(edition, date) });
  return tile;
}

export async function buildGrid(dir, edition, date, picks) {
  const layout = gridLayout(picks.length);
  const tiles = await Promise.all(picks.map(async (index, i) => {
    const { width, height, left, top } = layout[i];
    const card = await gridTile(dir, edition, index, layout[i]);
    return { input: await sharp(card).resize(Math.round(width), Math.round(height), { fit: 'cover' }).toBuffer(), left: Math.round(left), top: Math.round(top) };
  }));
  const { png } = gridFiles(dir, edition.id, date);
  await sharp({ create: { width: GRID_W, height: GRID_H, channels: 3, background: themeFor(edition, date).ink } }).composite(tiles).png().toFile(png);
  return png;
}
