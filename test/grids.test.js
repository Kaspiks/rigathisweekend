import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Store } from '../src/store.js';
import { createApp } from '../src/app.js';
import { gridLayout, suggestPicks, checkPicks, gridFiles, GRID_W, GRID_H, BAR_H } from '../src/grids.js';

const event = (n, day = 24) => ({ title: `Event number ${n}`, startsAt: `2099-10-${day}T${String(10 + n).padStart(2, '0')}:00:00+03:00`, venue: 'Rīga', price: '€5', summary: 'A test event.', sourceUrl: `https://example.com/e${n}` });
const submission = () => ({ weekend: '2099-10-23', events: [...Array.from({ length: 8 }, (_, n) => event(n)), event(9, 25)] });

async function setup(t, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'riga-grid-'));
  const store = new Store(dir);
  const e = store.submit(submission());
  await mkdir(join(dir, 'media', e.id), { recursive: true });
  for (let i = 0; i < e.data.events.length; i++)
    await sharp({ create: { width: 1080, height: 1350, channels: 3, background: { r: 20 * i, g: 60, b: 50 } } }).jpeg().toFile(join(dir, 'media', e.id, `feed-${i}.jpg`));
  const calls = [];
  let release; const gate = new Promise(r => { release = r; });
  if (!env.hold) release();
  const fetcher = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); await gate; return env.fail ? { ok: false, status: 500, json: async () => ({ error: 'Chrome crashed' }) } : { ok: true, json: async () => ({ file: 'x.mp4' }) }; };
  const token = 'g'.repeat(32);
  const app = createApp(store, { ADMIN_TOKEN: token, ...env.vars }, { fetcher });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { await new Promise(r => server.close(r)); store.close(); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const get = path => fetch(base + path, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
  return { dir, store, e, app, calls, post, get, release, token, base };
}

test('Grid layout fills the story sheet without overlaps for every card count', () => {
  for (let n = 1; n <= 6; n++) {
    const cells = gridLayout(n);
    assert.equal(cells.length, n);
    assert.equal(Math.max(...cells.map(c => c.top + c.height)), GRID_H - BAR_H, `${n} cards fill the card area and leave the stub strip clear`);
    for (const c of cells) assert.ok(c.left >= 0 && c.left + c.width <= GRID_W);
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      const x = cells[a], y = cells[b];
      assert.ok(x.left + x.width <= y.left || y.left + y.width <= x.left || x.top + x.height <= y.top || y.top + y.height <= x.top, `cards ${a} and ${b} overlap`);
    }
  }
  assert.equal(gridLayout(5)[4].width, GRID_W, 'the odd card out spans the row');
  assert.deepEqual(gridLayout(1)[0], { left: 0, top: 0, width: GRID_W, height: GRID_H - BAR_H });
  assert.throws(() => gridLayout(7), /1 to 6/);
});

test('Suggestion takes six of the day in time order, preferring real photos, and picks stay on their day', async t => {
  const { e } = await setup(t);
  assert.deepEqual(suggestPicks(e, '2099-10-24'), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(suggestPicks(e, '2099-10-24', i => i >= 3), [0, 3, 4, 5, 6, 7], 'events with photos are chosen first, then shown in time order');
  assert.deepEqual(suggestPicks(e, '2099-10-25'), [8]);
  assert.throws(() => checkPicks(e, '2099-10-24', [0, 8]), /Only events on 2099-10-24/);
  assert.throws(() => checkPicks(e, '2099-10-24', [1, 1]), /twice/);
  assert.throws(() => checkPicks(e, '2099-10-26', [0]), /No events/);
});

test('Building a grid writes the sheet, and rendering goes to the render service only when asked', async t => {
  const { dir, store, e, app, calls, post, get, release } = await setup(t, { hold: true, vars: { RENDER_URL: 'http://render:3200/' } });
  const listed = (await get('/api/editions'))[0].grids;
  assert.deepEqual(listed.map(g => [g.date, g.day, g.suggested.length, g.collage]), [['2099-10-24', 'SATURDAY', 6, false], ['2099-10-25', 'SUNDAY', 1, false]]);

  assert.equal((await post(`/api/editions/${e.id}/grids/2099-10-24/render`, {})).status, 400, 'no render before a grid exists');
  assert.equal((await post(`/api/editions/${e.id}/grids/2099-10-24`, { events: [0, 1, 2, 3, 4, 5, 6] })).status, 400, 'at most six cards');
  const built = await post(`/api/editions/${e.id}/grids/2099-10-24`, { events: [2, 0, 5], category: 'Music' });
  assert.equal(built.status, 200);
  assert.deepEqual((await built.json()).picks, [2, 0, 5], 'your order is kept');
  const meta = await sharp(gridFiles(dir, e.id, '2099-10-24').png).metadata();
  assert.deepEqual([meta.width, meta.height], [1080, 1920]);
  assert.equal(calls.length, 0, 'building never renders');

  const started = await post(`/api/editions/${e.id}/grids/2099-10-24/render`, {});
  assert.equal(started.status, 202);
  assert.equal((await started.json()).status, 'rendering');
  assert.equal((await post(`/api/editions/${e.id}/grids/2099-10-24/render`, {})).status, 400, 'a second click does not start a second render');
  assert.equal((await post(`/api/editions/${e.id}/grids/2099-10-24`, { events: [1] })).status, 400, 'the grid is locked while it renders');
  release();
  await Promise.all(app.locals.renders);
  assert.equal(calls[0].url, 'http://render:3200/render');
  assert.deepEqual(calls[0].body, { style: 'ticket', edition: e.id, date: '2099-10-24', day: 'SATURDAY', dateLabel: '24 OCTOBER', number: '1024', count: 3, kicker: 'Overview', category: 'Music', holdSeconds: 6 });
  assert.equal(store.grid(e.id, '2099-10-24').status, 'ready');
  assert.equal(calls.length, 1);

  // Rebuilding replaces the grid and drops the video that no longer matches it.
  await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } }).png().toFile(gridFiles(dir, e.id, '2099-10-24').mp4);
  assert.equal((await post(`/api/editions/${e.id}/grids/2099-10-24`, { events: [1] })).status, 200);
  assert.equal(existsSync(gridFiles(dir, e.id, '2099-10-24').mp4), false);
  assert.equal(store.grid(e.id, '2099-10-24').status, 'built');
});

test('A failed or interrupted render is reported, and nothing renders without a render service', async t => {
  const { store, e, app, post } = await setup(t, { fail: true, vars: { RENDER_URL: 'http://render:3200' } });
  assert.equal((await post(`/api/editions/${e.id}/grids/2099-10-25`, { events: [8], style: 'envelope' })).status, 200);
  assert.equal(store.grid(e.id, '2099-10-25').style, 'envelope');
  assert.equal((await post(`/api/editions/${e.id}/grids/2099-10-25`, { events: [8], style: 'confetti' })).status, 400, 'only known openers');
  assert.equal(store.grid(e.id, '2099-10-25').style, 'envelope', 'a refused request changes nothing');
  await post(`/api/editions/${e.id}/grids/2099-10-25/render`, {});
  await Promise.all(app.locals.renders);
  assert.deepEqual([store.grid(e.id, '2099-10-25').status, store.grid(e.id, '2099-10-25').error], ['failed', 'Chrome crashed']);

  store.startGridRender(e.id, '2099-10-25');
  store.recoverGrids();
  assert.match(store.grid(e.id, '2099-10-25').error, /interrupted/);

  const other = await setup(t);
  await other.post(`/api/editions/${other.e.id}/grids/2099-10-24`, { events: [0] });
  const res = await other.post(`/api/editions/${other.e.id}/grids/2099-10-24/render`, {});
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /RENDER_URL/);
});

test('A rendered story video goes to Postiz as a Reel or Story draft, once unless asked again', async t => {
  const { dir, store, e, post } = await setup(t, { vars: { RENDER_URL: 'http://render:3200', LIVE_PUBLISH: 'true' } });
  const { deliver, gridVideo, gridCaption } = await import('../src/providers.js');
  assert.deepEqual(gridVideo('instagram_reel:2099-10-24'), { kind: 'reel', date: '2099-10-24' });
  assert.deepEqual(gridVideo('instagram_grid_story:2099-10-24#2'), { kind: 'story', date: '2099-10-24' });
  assert.equal(gridVideo('instagram_story:3'), null, 'per-event stories are a different job');

  await post(`/api/editions/${e.id}/grids/2099-10-24`, { events: [0, 1, 2] });
  assert.equal((await post(`/api/editions/${e.id}/grids/2099-10-24/postiz`, { kind: 'reel' })).status, 400, 'nothing to send before the video is rendered');
  store.finishGridRender(e.id, '2099-10-24');
  await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } }).png().toFile(gridFiles(dir, e.id, '2099-10-24').mp4);

  const queued = await post(`/api/editions/${e.id}/grids/2099-10-24/postiz`, { kind: 'reel' });
  assert.equal(queued.status, 202);
  assert.equal((await queued.json()).target, 'instagram_reel:2099-10-24');
  assert.equal((await post(`/api/editions/${e.id}/grids/2099-10-24/postiz`, { kind: 'story' })).status, 202, 'a Story draft is a separate job');

  // Delivery: one video upload, then a draft post of the right kind.
  const calls = [];
  const fetcher = async (url, opts) => {
    calls.push({ url, body: opts.body });
    return { ok: true, json: async () => url.endsWith('/upload') ? { id: 'm1', path: 'https://postiz/uploads/m1.mp4' } : [{ postId: 'p1' }] };
  };
  const env = { LIVE_PUBLISH: 'true', POSTIZ_API_URL: 'http://postiz/api/public/v1', POSTIZ_API_KEY: 'k', INSTAGRAM_INTEGRATION_ID: 'int-1' };
  const job = store.jobs(e.id).find(j => j.target === 'instagram_reel:2099-10-24');
  const result = await deliver(job, store.get(e.id), dir, env, fetcher, url => `https://s.rt/${url.length}`);
  assert.deepEqual([result.postiz, result.kind, result.postId], ['draft', 'reel', 'p1']);
  assert.equal(calls[0].url, 'http://postiz/api/public/v1/upload');
  assert.equal(calls[0].body.get('file').type, 'video/mp4');
  const payload = JSON.parse(calls[1].body);
  assert.equal(payload.type, 'draft', 'never scheduled without you');
  assert.equal(payload.posts[0].settings.post_type, 'post', 'a single video post is a Reel');
  assert.match(payload.posts[0].value[0].content, /Event number 0/);
  const storyJob = store.jobs(e.id).find(j => j.target === 'instagram_grid_story:2099-10-24');
  const storyResult = await deliver(storyJob, store.get(e.id), dir, env, fetcher);
  assert.equal(storyResult.kind, 'story');
  const storyPayload = JSON.parse(calls[3].body);
  assert.equal(storyPayload.posts[0].settings.post_type, 'story');
  assert.equal(storyPayload.posts[0].value[0].content, '', 'a Story carries no caption');

  store.finish(job.id, 'sent', result);
  const again = await post(`/api/editions/${e.id}/grids/2099-10-24/postiz`, { kind: 'reel' });
  assert.equal(again.status, 409, 'asking twice is refused');
  assert.equal((await post(`/api/editions/${e.id}/grids/2099-10-24/postiz`, { kind: 'reel', resend: true })).status, 202);
  assert.equal(store.jobs(e.id).filter(j => j.target.startsWith('instagram_reel:')).length, 2);
  assert.match(gridCaption(store.get(e.id), '2099-10-24', url => `https://s.rt/x`), /Event number 1/);
});

test('Review-page thumbnails are small, cached and limited to rendered slides', async t => {
  const { dir, e } = await setup(t);
  const { ensureThumb, THUMB_W } = await import('../src/thumbs.js');
  const file = await ensureThumb(dir, e.id, 'feed-0.jpg');
  const thumb = await sharp(file).metadata();
  assert.equal(thumb.width, THUMB_W);
  const full = (await import('node:fs')).statSync(join(dir, 'media', e.id, 'feed-0.jpg')).size;
  assert.ok((await import('node:fs')).statSync(file).size < full / 2, 'a thumbnail is much smaller than the slide');
  assert.equal(await ensureThumb(dir, e.id, 'feed-0.jpg'), file, 'built once, then reused');
  await assert.rejects(ensureThumb(dir, e.id, '../../riga.sqlite'), /Not a thumbnail/);
  await assert.rejects(ensureThumb(dir, 'not-an-edition', 'feed-0.jpg'), /Not a thumbnail/);
  await assert.rejects(ensureThumb(dir, e.id, 'feed-99.jpg'), /No such image/);
});

test('Finished weekends stay on disk but drop out of the listing', async t => {
  const { store, e, get, token, base } = await setup(t);
  const { weekendOver } = await import('../src/domain.js');
  assert.equal(weekendOver('2099-10-23'), false, 'a weekend still to come is listed');
  assert.equal(weekendOver('2020-01-03'), true, 'a weekend long past is not');

  // 3 January 2020 was a Friday: a finished weekend alongside the fixture's 2099 one.
  const old = store.submit({ weekend: '2020-01-03', events: [{ title: 'Old year concert', startsAt: '2020-01-04T19:00:00+02:00', venue: 'Rīga', price: '€5', summary: 'A finished event.', sourceUrl: 'https://example.com/old' }] });
  const listed = await get('/api/editions');
  assert.deepEqual(listed.map(x => x.id), [e.id], 'the finished weekend is not listed');
  const res = await fetch(base + '/api/editions', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.headers.get('X-Past-Editions'), '1', 'the page is told how many are hidden');
  const all = await get('/api/editions?scope=all');
  assert.equal(all.length, 2, 'they come back on request');
  assert.ok(all.some(x => x.id === old.id));
  assert.ok(store.get(old.id), 'nothing is deleted');
});

test('Grid tiles are the cards without the carousel number, drawn to fit their cell', async t => {
  const { dir, e, post } = await setup(t);
  const { tilePath, gridLayout, GRID_W } = await import('../src/grids.js');
  const { cardSvg } = await import('../src/render.js');
  const fs = await import('node:fs');

  // The number badge is what separates a carousel slide from a grid tile.
  assert.match(cardSvg(e.data.events[0], 2, 9, e.weekend), /OF 9/);
  assert.doesNotMatch(cardSvg(e.data.events[0], 0, 0, e.weekend), /OF /);

  const cell = gridLayout(2)[0], cellHeight = Math.round((GRID_W * cell.height) / cell.width);
  assert.equal(existsSync(tilePath(dir, e.id, 0, cellHeight)), false);
  assert.equal((await post(`/api/editions/${e.id}/grids/2099-10-24`, { events: [0, 1] })).status, 200);
  assert.ok(existsSync(tilePath(dir, e.id, 0, cellHeight)), 'building a grid draws the tiles it needs');
  assert.equal(existsSync(tilePath(dir, e.id, 7, cellHeight)), false, 'and only those');

  // The tile has its cell's shape, so nothing of the card is cropped away in the grid.
  const meta = await sharp(tilePath(dir, e.id, 0, cellHeight)).metadata();
  assert.equal(meta.width, GRID_W);
  assert.equal(meta.height, cellHeight);
  assert.ok(Math.abs(meta.width / meta.height - cell.width / cell.height) < 0.01, 'tile matches the cell aspect');

  // A tile already drawn is reused rather than redrawn.
  const stamp = fs.statSync(tilePath(dir, e.id, 0, cellHeight)).mtimeMs;
  assert.equal((await post(`/api/editions/${e.id}/grids/2099-10-24`, { events: [0, 1] })).status, 200);
  assert.equal(fs.statSync(tilePath(dir, e.id, 0, cellHeight)).mtimeMs, stamp);

  // A different card count means a different cell shape, and its own tile.
  assert.equal((await post(`/api/editions/${e.id}/grids/2099-10-24`, { events: [0, 1, 2, 3, 4, 5] })).status, 200);
  const six = gridLayout(6)[0], sixHeight = Math.round((GRID_W * six.height) / six.width);
  assert.ok(existsSync(tilePath(dir, e.id, 0, sixHeight)));
  assert.notEqual(sixHeight, cellHeight);
});
