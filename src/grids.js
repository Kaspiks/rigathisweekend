// Story grids: a day's event cards tiled into one 1080×1920 sheet, which the render service pulls out of
// the envelope. You choose the cards; the suggestion is only the starting point.
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readdir, rm } from 'node:fs/promises';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { eventsByDay, eventDate, weekendDays, WEEKEND_GRID, ZONE } from './domain.js';
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
  style: z.enum(['ticket', 'envelope', 'leaves', 'bag', 'book', 'mark', 'sketch', 'pinboard']).default('ticket'),
});

export const gridDay = date => date === WEEKEND_GRID ? 'WEEKEND' : DateTime.fromISO(date, { zone: ZONE }).setLocale('en').toFormat('cccc').toUpperCase();
// What the ticket prints: "18 SEPTEMBER", and a ticket number made of the month and day ("0918").
export const ticketText = date => {
  const d = DateTime.fromISO(date, { zone: ZONE }).setLocale('en');
  return { dateLabel: d.toFormat('d LLLL').toUpperCase(), number: d.toFormat('MMdd') };
};
// The same for any grid, the weekend one included: "25–27 SEPTEMBER", or "30 SEP – 2 OCT" across a month
// end, numbered after the Friday.
export function gridText(edition, date) {
  if (date !== WEEKEND_GRID) return ticketText(date);
  const [fri, , sun] = weekendDays(edition.weekend).map(d => DateTime.fromISO(d, { zone: ZONE }).setLocale('en'));
  const dateLabel = fri.month === sun.month ? `${fri.day}–${sun.toFormat('d LLLL')}` : `${fri.toFormat('d LLL')} – ${sun.toFormat('d LLL')}`;
  return { dateLabel: dateLabel.toUpperCase(), number: fri.toFormat('MMdd') };
}

// What the pinboard opener prints on its flyers: each picked card's title, "Sat, 26 Sep · 19:00", price,
// venue and languages. `index` lets the render service find the event's photo for the flyer's corner.
export const pinEvents = (edition, picks) => picks.map(index => {
  const e = edition.data.events[index];
  return { index, title: e.title, when: DateTime.fromISO(e.startsAt).setZone(ZONE).setLocale('en').toFormat('ccc, d LLL · HH:mm'), price: e.price, venue: e.venue, languages: e.languages };
});

// The day's events in the order they are chosen from: published ones only once approved.
// The weekend grid chooses from every day's events, in day order.
export function dayEvents(edition, date) {
  const selected = edition.approved ? edition.selected : null;
  const days = eventsByDay(edition.data, selected);
  if (date === WEEKEND_GRID) return days.flatMap(d => d.items);
  return days.find(d => d.date === date)?.items || [];
}

// Up to six of the day's events, earliest first, preferring the ones that have a real photo.
// The suggestion skips anything already used in a grid: those cards cannot be picked anyway.
export function suggestPicks(edition, date, hasPhoto = () => true, blocked = () => false) {
  const items = dayEvents(edition, date)
    .filter(x => !blocked(x.index))
    .map((x, order) => ({ ...x, order, photo: hasPhoto(x.index) }))
    .sort((a, b) => (b.photo - a.photo) || a.order - b.order)
    .slice(0, GRID_MAX)
    .sort((a, b) => a.order - b.order);
  return items.map(x => x.index);
}

// `blocked` names the events that may not go in a grid: ones already in a grid somewhere, and, once the
// edition is approved, ones left out of its carousels. It is checked here as well as in the page, so a stale
// tab cannot build a grid out of cards that have since been used.
export function checkPicks(edition, date, picks, blocked = () => null) {
  const allowed = new Set(dayEvents(edition, date).map(x => x.index));
  if (!allowed.size) throw new Error(`No events on ${date} in this edition`);
  const unique = [...new Set(picks)];
  if (unique.length !== picks.length) throw new Error('An event is picked twice');
  if (unique.some(i => !allowed.has(i))) throw new Error(`Only events on ${date} can go in its grid`);
  for (const i of unique) {
    const why = blocked(i);
    if (why) throw new Error(`${edition.data.events[i].title} cannot go in this story: ${why}`);
  }
  return unique;
}

// Two columns; rows share the height. An odd card out spans the last row, and a single card fills the sheet.
// Two cards are the exception: side by side they would each be a sliver three times taller than wide,
// cropping every photo to a strip, so they stack instead, each full width and close to a post's own shape.
export function gridLayout(count) {
  if (count < 1 || count > GRID_MAX) throw new Error(`A grid takes 1 to ${GRID_MAX} cards`);
  if (count === 2) {
    const h = Math.floor((CARDS_H - GUTTER) / 2);
    return [{ left: 0, top: 0, width: GRID_W, height: h }, { left: 0, top: h + GUTTER, width: GRID_W, height: CARDS_H - h - GUTTER }];
  }
  const rows = Math.ceil(count / 2), h = Math.floor((CARDS_H - GUTTER * (rows - 1)) / rows), w = (GRID_W - GUTTER) / 2;
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / 2), last = i === count - 1 && count % 2 === 1;
    const top = row * (h + GUTTER), height = row === rows - 1 ? CARDS_H - top : h;
    return last ? { left: 0, top, width: GRID_W, height } : { left: (i % 2) * (w + GUTTER), top, width: w, height };
  });
}

// One tile per event per cell shape: a 2×3 grid and a single full-sheet card need different ones.
// The version moves when the tile's design changes, and the colour theme is in the name, so old ones are never reused.
const TILE_VERSION = 4; // 4: one text size per grid, and copy shrinks to fit its tile
export const tilePath = (dir, editionId, index, height, theme) => join(dir, 'media', editionId, `tile${TILE_VERSION}-${index}-${height}-${theme}.jpg`);
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
// A weekend grid's tiles also print the weekday ("Sun 10:00"), so they are drawn and cached separately.
// `ui` is the text scale that makes this tile's copy match the grid's smallest tile (see buildGrid).
async function gridTile(dir, edition, index, cell, withDay = false, ui = 1) {
  const height = Math.round((GRID_W * cell.height) / cell.width);
  const event = edition.data.events[index], date = eventDate(event);
  const scaleTag = ui < 0.999 ? `-u${Math.round(ui * 100)}` : '';
  const tile = tilePath(dir, edition.id, index, height, `${themeKey(edition, date)}${withDay ? '-d' : ''}${scaleTag}`);
  if (existsSync(tile)) return tile;
  if (!existsSync(join(dir, 'media', edition.id, `feed-${index}.jpg`))) throw new Error(`The card for event ${index + 1} has not been rendered yet`);
  await drawCard(tile, { event, weekend: edition.weekend, demo: edition.demo, height, timeOnly: withDay ? 'day' : true, photo: await cardPhoto(dir, edition.id, index), theme: themeFor(edition, date), ui });
  return tile;
}

export async function buildGrid(dir, edition, date, picks) {
  const layout = gridLayout(picks.length);
  // Every tile is drawn 1080 wide and shrunk into its cell, so a half-width cell's text comes out half size.
  // To give the whole grid one text size, each tile draws its copy at (smallest cell / its own cell) scale.
  const smallest = Math.min(...layout.map(c => c.width));
  const tiles = await Promise.all(picks.map(async (index, i) => {
    const { width, height, left, top } = layout[i];
    const card = await gridTile(dir, edition, index, layout[i], date === WEEKEND_GRID, smallest / layout[i].width);
    return { input: await sharp(card).resize(Math.round(width), Math.round(height), { fit: 'cover' }).toBuffer(), left: Math.round(left), top: Math.round(top) };
  }));
  const { png } = gridFiles(dir, edition.id, date);
  await sharp({ create: { width: GRID_W, height: GRID_H, channels: 3, background: themeFor(edition, date).ink } }).composite(tiles).png().toFile(png);
  return png;
}
