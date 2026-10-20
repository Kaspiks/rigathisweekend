import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  WEEKEND_GRID, Submission, whatsappText, postCaptionPreview, weekendFor, postsFor, postName, checkAlsoOn,
  weekendDays, tagDays, eventDate, eventsByDay, eventTime, dayName, weekendOver,
} from './domain.js';
import {
  GridRequest, buildGrid, checkPicks, dayEvents, gridDay, gridFiles, suggestPicks, gridText, dropTiles, pinEvents,
} from './grids.js';
import { renderEdition, uploadPath } from './render.js';
import { ensureThumb } from './thumbs.js';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { mkdir, rm, copyFile, readdir } from 'node:fs/promises';
import { researchInto } from './research.js';
import { prepareLinks, captionLinker, linkSummary } from './shortlinks.js';
import { request, gridVideo, deliverAnimation } from './providers.js';
import { createOAuthProvider } from './oauth.js';
import { createAnimator, uploadLinkRoute } from './animate.js';
import { createRelay, RELAY_INSTRUCTIONS } from './relay.js';
import { THEMES, FAMILY_KEYS, TONES, TONE_KEYS, themeKey, weekFamily, dayTone, themeCss } from './themes.js';

// Compares a secret in constant time, so how long a wrong guess takes says nothing about how close it was.
function safeEqual(given, expected) {
  const givenBytes = Buffer.from(given || '');
  const expectedBytes = Buffer.from(expected || '');
  return givenBytes.length === expectedBytes.length && timingSafeEqual(givenBytes, expectedBytes);
}

// The credentials in an Authorization header: an OAuth bearer token, or the name and password of a Basic login.
function readAuthorization(header) {
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const basic = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString() : '';
  const colon = basic.indexOf(':');
  return { bearer, name: basic.slice(0, Math.max(colon, 0)), password: basic.slice(colon + 1) };
}

// Why a card cannot go in a grid, in the words shown beside it: the grid it is already in.
function alreadyIn(grid, editionId) {
  if (grid.edition !== editionId) {
    return `already in a story for the weekend of ${grid.weekend}`;
  }

  if (grid.date === WEEKEND_GRID) {
    return 'already in the whole-weekend story';
  }

  return `already in ${dayName(grid.date)}'s story`;
}

// Whether two events are the same listing, to find an event again after a new edition has re-sorted them.
const sameEvent = (a, b) => {
  return a.title === b.title && a.startsAt === b.startsAt && a.venue === b.venue;
};

const withoutTrailingSlash = url => {
  return url.replace(/\/$/, '');
};

// The dashboard loads nothing from anywhere else and cannot be framed.
const CONTENT_SECURITY_POLICY = "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; "
  + "frame-ancestors 'none'";

// The event a URL's :index points at, as a number; anything that is not one of the edition's events is refused.
function eventIndex(e, raw) {
  const i = Number(raw);

  if (!Number.isInteger(i) || i < 0 || i >= e.data.events.length) {
    throw new Error('That event is not in this edition');
  }

  return i;
}

// What a failed request answers: each problem with the request body by its field, or the error's own message.
function errorMessage(err) {
  if (!(err instanceof z.ZodError)) {
    return err.message;
  }

  return err.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

export function createApp(
  store,
  env = process.env,
  { fetcher = fetch, animator: animatorOptions = {}, relay: relayOptions = {} } = {},
) {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 24) {
    throw new Error('ADMIN_TOKEN must be at least 24 characters');
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  store.recoverGrids();
  store.recoverAnimations();
  app.locals.renders = new Set(); // in-flight story renders, so tests (and shutdown) can wait for them
  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // Short links are public: anyone reading a caption can follow one. A code only ever maps to an
  // organiser URL this server stored itself, so the redirect cannot be pointed anywhere else.
  app.get(/^\/([a-hj-km-np-z2-9]{5})$/, (req, res, next) => {
    const code = req.params[0];
    const url = store.follow(code);

    if (!url) {
      // Generated codes always contain a digit, so a digit-free path like /media is left to the real routes.
      if (!/\d/.test(code)) {
        return next();
      }

      return res.status(404).type('text').send('This link does not exist or has expired.');
    }

    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.redirect(302, url);
  });

  // One-time upload links for pictures ChatGPT sends from its sandbox: the token is the permission.
  app.use(uploadLinkRoute(store, env));
  const link = captionLinker(store, env);

  const eventIndexes = e => {
    return e.data.events.map((_, i) => i);
  };

  const organiserPhoto = (e, i) => {
    return resolve(store.dir, 'media', e.id, `photo-${i}.jpg`);
  };

  const hasPhoto = (e, i) => {
    return existsSync(uploadPath(store.dir, e.id, i)) || existsSync(organiserPhoto(e, i));
  };

  // Why an event may not go in this day's grid: it is already in a grid somewhere. A card that is in THIS
  // day's own saved grid is fine, or you could never rebuild that day. Returns the reason to show beside the
  // card, or null when it is free to use. Events left out of an approved edition need no reason here: they
  // are not among its published events at all, so they never reach the picker.
  const blockedIn = (e, date) => {
    const usage = store.gridUsage();

    // The whole-weekend grid is a round-up of the same weekend, so it may repeat the day stories' cards and
    // they may repeat it; only day grids exclude each other, and every grid excludes earlier weekends' stories.
    const mayShareWith = grid => grid.edition === e.id
      && (grid.date === date || grid.date === WEEKEND_GRID || date === WEEKEND_GRID);

    return index => {
      const event = e.data.events[index];
      const elsewhere = (usage.get(event.sourceUrl) || []).filter(grid => !mayShareWith(grid));
      return elsewhere.length ? alreadyIn(elsewhere[0], e.id) : null;
    };
  };

  // One grid per day, and when the edition spans more than one day, a whole-weekend grid after them that
  // can take cards from any day.
  const gridsFor = e => {
    const days = eventsByDay(e.data, e.approved ? e.selected : null);
    const slots = days.map(({ date, items }) => ({ date, items, name: dayName(date) }));

    if (days.length > 1) {
      slots.push({ date: WEEKEND_GRID, items: days.flatMap(day => day.items), name: 'The whole weekend' });
    }

    return slots.map(gridSlot(e));
  };

  const gridSlot = e => ({ date, items, name }) => {
    const files = gridFiles(store.dir, e.id, date);
    const blocked = blockedIn(e, date);

    return {
      date,
      day: gridDay(date),
      name,
      suggested: suggestPicks(e, date, i => hasPhoto(e, i), i => !!blocked(i)),
      events: items.map(({ event, index }) => ({
        index, title: event.title, time: eventTime(event), blocked: blocked(index),
      })),
      saved: store.grid(e.id, date),
      collage: existsSync(files.png),
      video: existsSync(files.mp4),
      posts: store.jobs(e.id)
        .filter(job => gridVideo(job.target)?.date === date)
        .map(job => ({ ...job, kind: gridVideo(job.target).kind })),
    };
  };

  // OAuth endpoints are public by design: /.well-known/*, /authorize, /token, /register, /revoke, /oauth/login.
  const oauth = createOAuthProvider(store, env);
  app.use(oauth.router);

  app.use(async (req, res, next) => {
    const { bearer, name, password } = readAuthorization(req.headers.authorization || '');
    // The owner signs in as admin with ADMIN_TOKEN, anyone added with `cli.js user add` under their own name.
    // They share the one workspace, so either login opens the same dashboard and API.
    let signedIn = name === 'admin' ? safeEqual(password, env.ADMIN_TOKEN) : !!name && store.checkUser(name, password);

    if (bearer) {
      try {
        const info = await oauth.provider.verifyAccessToken(bearer);

        if (info.expiresAt > Date.now() / 1000) {
          req.auth = info;
          signedIn = info.clientId === 'admin';
        }
      } catch {} // a token that does not verify signs nobody in
    }

    // OAuth clients (ChatGPT) may only use the MCP endpoint; the dashboard and API need a login.
    if (!signedIn && !(req.auth && req.path === '/mcp')) {
      if (req.path === '/mcp') {
        res.set('WWW-Authenticate', `Bearer resource_metadata="${oauth.resourceMetadataUrl}"`);

        return res.status(401).json({
          error: 'invalid_token',
          error_description: 'Authorize this MCP server via OAuth or use the admin token',
        });
      }

      res.set('WWW-Authenticate', 'Basic realm="Riga Weekend"');
      return res.status(401).send('Authentication required');
    }

    if (req.headers.origin && req.headers.origin !== (env.APP_ORIGIN || 'http://localhost:3100')) {
      return res.status(403).send('Origin not allowed');
    }

    // Rendered media never changes under the same name within a visit; the dashboard adds ?v= when it does.
    res.set('Cache-Control', /^\/(media|thumb|footage)\//.test(req.path) ? 'private, max-age=86400' : 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    next();
  });

  // A full 60-event submission runs to ~92KB at maximum field lengths, and Latvian diacritics
  // are multibyte, so the limit sits well clear of the largest submission the schema allows.
  app.use(express.json({ limit: '512kb' }));

  // Animated edits over your own footage: uploads, renders and the MCP tools that drive them.
  const animator = createAnimator(app, store, env, { fetcher, ...animatorOptions });

  // ChatGPT and Claude handing work to each other, each through its own plugin connection to /mcp.
  const relay = createRelay(app, store, {
    clientName: id => oauth.provider.clientsStore.getClient(id)?.client_name,
    ...relayOptions,
  });

  const submit = async input => {
    const e = store.submit(input);
    await renderEdition(e, store.dir, fetch, { link });
    return e;
  };

  // The MCP endpoint keeps no sessions: every request gets its own server and transport, closed with the response.
  app.post('/mcp', async (req, res) => {
    const server = new McpServer({ name: 'riga-weekend', version: '0.1.0' }, { instructions: RELAY_INSTRUCTIONS });

    const result = data => {
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    };

    server.registerTool('submit_weekend_events', {
      description: 'Submit source-verified Riga events for a Friday–Sunday weekend. Generates Instagram images and a '
        + 'WhatsApp digest. Saves for review; does not publish. Set headline (e.g. "Researchers\' Night") for a '
        + 'special post that publishes alongside the regular day posts.',
      inputSchema: Submission.shape,
    }, async input => result(await submit(input)));

    server.registerTool('list_weekend_editions', {
      description: 'List prepared editions and delivery status.',
      inputSchema: {},
    }, async () => result(store.list().map(e => ({ ...e, jobs: store.jobs(e.id) }))));

    animator.register(server);
    relay.register(server);

    server.registerTool('approve_weekend_edition', {
      description: 'Approve a reviewed edition and queue Instagram and WhatsApp publication. Requires explicit user '
        + 'authorization to publish. Live dispatch also requires server LIVE_PUBLISH=true.',
      inputSchema: { id: z.string().regex(/^[a-f0-9]{24}$/) },
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, async ({ id }) => result(store.approve(id)));

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.all('/mcp', (_req, res) => res.status(405).send('Use POST'));

  app.get('/themes.css', (_req, res) => res.type('css').send(themeCss()));

  app.get('/api/status', (_req, res) => res.json({
    live: env.LIVE_PUBLISH === 'true',
    postizUrl: env.POSTIZ_PUBLIC_URL || null,
    ejuz: !!env.EJUZ_API_KEY,
    researchEnabled: env.RESEARCH_SCHEDULE_ENABLED === 'true',
    weekend: weekendFor(),
    postizConfigured: !!env.POSTIZ_API_KEY,
    whatsappConfigured: !!env.WAHA_CHAT_ID,
    researchConfigured: !!env.OPENAI_API_KEY,
    families: FAMILY_KEYS.map(key => ({ key, name: THEMES[`${key}-mid`].familyName })),
    tones: TONE_KEYS.map(key => ({ key, name: TONES[key].name })),
    renderConfigured: !!env.RENDER_URL,
    runs: store.db.prepare('SELECT * FROM runs ORDER BY weekend DESC').all(),
  }));

  // An edition as the dashboard shows it: what is stored, plus everything the review page works out from it.
  const editionView = e => ({
    ...e,
    jobs: store.jobs(e.id),
    whatsapp: whatsappText(e.data, e.selected),
    weekendDays: weekendDays(e.weekend),
    tagDays: tagDays(e.weekend),
    eventDates: e.data.events.map(eventDate),
    uploads: eventIndexes(e).filter(i => existsSync(uploadPath(store.dir, e.id, i))),
    organiserPhotos: eventIndexes(e).filter(i => existsSync(organiserPhoto(e, i))),
    headline: e.data.headline || null,
    palette: weekFamily(e),
    paletteChosen: !!e.themes.palette,
    posts: postsFor(e.data, e.selected).map(post => ({
      date: post.date,
      part: post.part,
      parts: post.parts,
      name: postName(post),
      theme: themeKey(e, post.date),
      tone: dayTone(e, post.date),
      indexes: post.items.map(item => item.index),
      caption: postCaptionPreview(e.data, post, link),
    })),
    shortLinks: e.demo
      ? {}
      : Object.fromEntries(e.data.events.map((event, i) => [i, linkSummary(store, event.sourceUrl, env)])),
    grids: gridsFor(e),
  });

  // Past weekends stay on disk but are not listed: the page stays small and the current weekend is
  // what you work on. ?scope=all brings them back when you need to look something up.
  app.get('/api/editions', (req, res) => {
    const all = store.list();
    const show = req.query.scope === 'all' ? all : all.filter(e => !weekendOver(e.weekend));
    res.set('X-Past-Editions', String(all.length - show.length));
    res.json(show.map(editionView));
  });

  app.post('/api/editions', async (req, res) => res.status(201).json(await submit(req.body)));

  // Hand-overs that must not go out twice by mistake. One already sent answers 409 with alreadySent, and
  // goes again only when the request says resend.
  const queueOnce = (res, queue) => {
    try {
      res.status(202).json(queue());
    } catch (err) {
      if (err.alreadySent) {
        return res.status(409).json({ error: err.message, alreadySent: true });
      }

      throw err;
    }
  };

  // Renders run in the render service and can take minutes, so the request answers at once and the job
  // carries on here. `body` is built inside the job, so a failure there is reported like any other, and
  // `finish` records the outcome: null when it worked, otherwise the reason it did not.
  const startRender = (path, body, finish) => {
    const job = (async () => {
      try {
        const response = await fetcher(`${withoutTrailingSlash(env.RENDER_URL)}/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(15 * 60000),
          body: JSON.stringify(body()),
        });

        const reply = await response.json().catch(() => ({}));
        finish(response.ok ? null : (reply.error || `Render service returned HTTP ${response.status}`));
      } catch (err) {
        finish(err.name === 'TimeoutError' ? 'Rendering took too long' : `Render service unreachable: ${err.message}`);
      }
    })();

    app.locals.renders.add(job);
    job.finally(() => app.locals.renders.delete(job));
  };

  // Story grids: one per day of the edition. You pick the cards (a suggestion is offered), build the
  // sheet here, and only a separate press renders the video, in the render service.
  const gridDate = (e, date) => {
    if ((date !== WEEKEND_GRID && !/^\d{4}-\d{2}-\d{2}$/.test(date)) || !dayEvents(e, date).length) {
      throw new Error(`No events on ${date} in this edition`);
    }

    return date;
  };

  app.post('/api/editions/:id/grids/:date', async (req, res) => {
    const e = store.get(req.params.id);
    const date = gridDate(e, req.params.date);
    const body = GridRequest.parse(req.body || {});
    const picks = checkPicks(e, date, body.events, blockedIn(e, date));

    if (store.grid(e.id, date)?.status === 'rendering') {
      throw new Error('This story is rendering; wait for it to finish before changing the grid');
    }

    await buildGrid(store.dir, e, date, picks);
    await rm(gridFiles(store.dir, e.id, date).mp4, { force: true }); // the old video no longer matches the grid

    res.json(store.saveGrid(e.id, date, {
      picks, kicker: body.kicker, category: body.category, holdSeconds: body.holdSeconds, style: body.style,
    }));
  });

  app.post('/api/editions/:id/grids/:date/postiz', (req, res) => {
    const kind = z.enum(['reel', 'story']).parse(req.body?.kind);
    const e = store.get(req.params.id);
    const date = gridDate(e, req.params.date);
    queueOnce(res, () => store.queueGridVideo(e.id, date, kind, req.body?.resend === true));
  });

  app.post('/api/editions/:id/grids/:date/render', async (req, res) => {
    if (!env.RENDER_URL) {
      throw new Error('The render service is not configured (RENDER_URL)');
    }

    const e = store.get(req.params.id);
    const date = gridDate(e, req.params.date);

    if (!existsSync(gridFiles(store.dir, e.id, date).png)) {
      throw new Error('Build the grid first');
    }

    const grid = store.startGridRender(e.id, date);

    const body = () => ({
      style: grid.style,
      edition: e.id,
      date,
      day: gridDay(date),
      ...gridText(e, date),
      count: grid.picks.length,
      kicker: grid.kicker,
      category: grid.category,
      holdSeconds: grid.holdSeconds,
      ...(grid.style === 'pinboard' ? { events: pinEvents(e, grid.picks) } : {}),
    });

    startRender('render', body, failure => store.finishGridRender(e.id, date, failure));
    res.status(202).json(store.grid(e.id, date));
  });

  // Standalone animations. Deliberately outside the edition flow: a one-off clip has no weekend, no
  // day to lock and no events to caption from, and forcing it through that machinery would mean
  // inventing an edition for it just to satisfy the foreign keys.
  const AnimationBody = z.object({
    name: z.string().trim().min(1).max(60),
    composition: z.string().trim()
      .regex(/^[A-Za-z][A-Za-z0-9_-]{0,40}$/, 'Composition must be a Remotion composition ID'),
    caption: z.string().max(2200).default(''),
    holdSeconds: z.number().min(1).max(30).default(5),
  });

  const animationFile = id => {
    return resolve(store.dir, 'media', 'animations', `${id}.mp4`);
  };

  app.get('/api/animations', (_req, res) => res.json(store.animations()));

  app.post('/api/animations', (req, res) => {
    const body = AnimationBody.parse(req.body || {});
    res.status(201).json(store.saveAnimation(body));
  });

  app.post('/api/animations/:id', (req, res) => {
    const { id } = store.animation(req.params.id);
    res.json(store.saveAnimation({ id, ...AnimationBody.parse(req.body || {}) }));
  });

  app.delete('/api/animations/:id', async (req, res) => {
    const animation = store.animation(req.params.id);
    await rm(animationFile(animation.id), { force: true });
    store.deleteAnimation(animation.id);
    res.json({ ok: true });
  });

  app.post('/api/animations/:id/render', async (req, res) => {
    if (!env.RENDER_URL) {
      throw new Error('The render service is not configured (RENDER_URL)');
    }

    const animation = store.startAnimationRender(store.animation(req.params.id).id);

    const body = () => {
      return { id: animation.id, composition: animation.composition, holdSeconds: animation.holdSeconds };
    };

    startRender('animation', body, failure => store.finishAnimationRender(animation.id, failure));
    res.status(202).json(animation);
  });

  // Uploads to Postiz as a DRAFT and stops there, exactly like the grid videos: nothing is published
  // from this app, you schedule it in Postiz once you have watched it back.
  app.post('/api/animations/:id/postiz', async (req, res) => {
    const kind = z.enum(['reel', 'story']).parse(req.body?.kind);
    const animation = store.animation(req.params.id);

    if (animation.status !== 'ready') {
      throw new Error('Render the animation before sending it to Postiz');
    }

    if (!existsSync(animationFile(animation.id))) {
      throw new Error('The rendered file is missing; render it again');
    }

    res.json(store.setAnimationPostiz(animation.id, await deliverAnimation(store.dir, animation, kind, env, fetcher)));
  });

  // Approving with a list of event indexes publishes only those; the covers, slides, captions and
  // WhatsApp digest are redrawn to match before any job can run.
  app.post('/api/editions/:id/approve', async (req, res) => {
    const picks = req.body?.events == null ? null : z.array(z.number().int().min(0)).min(1).parse(req.body.events);
    const stories = req.body?.stories == null ? [] : z.array(z.number().int().min(0)).parse(req.body.stories);
    // Check the selection first, make ej.uz links only for the events that will publish, and only then
    // approve: approval queues the hand-over to Postiz, so the captions must already have their links.
    const plan = store.planApproval(req.params.id, undefined, picks, stories);

    if (!plan.e.approved) {
      await prepareLinks(store, plan.urls, env, fetcher, env.EJUZ_TEST_NO_WAIT ? { sleep: async () => {} } : {});
      // Draw the selection before approving, not after. The hand-over is due the moment approval commits,
      // and the worker uploads whatever slides are on disk: drawn afterwards, a worker that got there first
      // sent the slides numbered for every event, so leaving out the third went 1, 2, 4.
      await renderEdition({ ...plan.e, selected: plan.picks }, store.dir, fetch, { link });
    }

    res.json(store.approve(req.params.id, undefined, picks, stories));
  });

  // Mark the other weekend days an event is on; the cover and caption are redrawn to match.
  app.post('/api/editions/:id/events/:index/also-on', async (req, res) => {
    const e = store.get(req.params.id);
    const i = eventIndex(e, req.params.index);
    const alsoOn = z.array(z.string()).max(6).parse(req.body?.alsoOn ?? []);
    const dates = checkAlsoOn(e.weekend, e.data.events[i], alsoOn);
    const updated = store.updateEvent(e.id, i, { alsoOn: dates });
    await dropTiles(store.dir, e.id, i); // grid tiles carry the day tag too
    await renderEdition(updated, store.dir, fetch, { link });
    res.json({ alsoOn: dates });
  });

  // Colours. The week's family changes every day's images; a day's tone only that day's cover, slides,
  // stories and grid tiles, which is why it redraws just the one day.
  app.post('/api/editions/:id/palette', async (req, res) => {
    const palette = z.enum(FAMILY_KEYS).parse(req.body?.palette);
    await renderEdition(store.setPalette(req.params.id, palette), store.dir, fetch, { link });
    res.json({ palette });
  });

  app.post('/api/editions/:id/themes/:date', async (req, res) => {
    const tone = z.enum(TONE_KEYS).parse(req.body?.tone);

    await renderEdition(store.setTone(req.params.id, req.params.date, tone), store.dir, fetch, {
      link, date: req.params.date,
    });

    res.json({ date: req.params.date, tone });
  });

  // A special post: some of an edition's events under your own heading (Researchers' Night), as a separate
  // edition that publishes alongside the regular post for the same day. Photos come along with the events.
  const SpecialBody = z.object({
    headline: z.string().trim().min(3).max(40),
    events: z.array(z.number().int().min(0)).min(1).max(60),
  });

  app.post('/api/editions/:id/special', async (req, res) => {
    const from = store.get(req.params.id);
    const body = SpecialBody.parse(req.body || {});
    const picks = [...new Set(body.events)].sort((a, b) => a - b);

    if (picks.some(i => !from.data.events[i])) {
      throw new Error('That event is not in this edition');
    }

    const events = picks.map(i => structuredClone(from.data.events[i]));
    let e = store.submit({ weekend: from.weekend, headline: body.headline, events }, !!from.demo);

    // Same week, same colour family: a family you chose for the regular edition carries over.
    if (from.themes.palette && !e.approved && !e.themes.palette) {
      e = store.setPalette(e.id, from.themes.palette);
    }

    // Submission sorts the events by time, so each photo is matched to its event rather than to its position.
    const src = resolve(store.dir, 'media', from.id);
    const dest = resolve(store.dir, 'media', e.id);
    await mkdir(dest, { recursive: true });
    const names = new Set(await readdir(src).catch(() => []));

    for (const oldIndex of picks) {
      const newIndex = e.data.events.findIndex(event => sameEvent(event, from.data.events[oldIndex]));

      for (const [oldName, newName] of [
        [`upload-${oldIndex}.jpg`, `upload-${newIndex}.jpg`],
        [`photo-${oldIndex}.jpg`, `photo-${newIndex}.jpg`],
        [`photo-${oldIndex}.label`, `photo-${newIndex}.label`],
        [`photo-${oldIndex}.none`, `photo-${newIndex}.none`],
      ]) {
        if (names.has(oldName)) {
          await copyFile(resolve(src, oldName), resolve(dest, newName));
        }
      }
    }

    await renderEdition(e, store.dir, fetch, { link });
    res.status(201).json(store.get(e.id));
  });

  // The WhatsApp digest is sent only when you ask, never on a schedule.
  app.post('/api/editions/:id/whatsapp', (req, res) => {
    queueOnce(res, () => store.queueWhatsApp(req.params.id, req.body?.resend === true));
  });

  // Your own photo for an event. It replaces whatever the organiser page offered, on the feed
  // slide and the story, and is the only way a picture from anywhere else reaches a card.
  const photoEvent = req => {
    const e = store.get(req.params.id);
    const i = eventIndex(e, req.params.index);

    if (e.approved) {
      throw new Error('This edition is approved, so its images are already in Postiz. Change the photo there');
    }

    return { e, i };
  };

  const redrawPhoto = async (e, i) => {
    await dropTiles(store.dir, e.id, i); // the grid tiles are redrawn from the new photo
    await renderEdition(e, store.dir, fetch, { only: i, link });
  };

  const imageBody = express.raw({ type: ['image/*', 'application/octet-stream'], limit: '15mb' });

  app.post('/api/editions/:id/events/:index/photo', imageBody, async (req, res) => {
    const { e, i } = photoEvent(req);

    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      throw new Error('Choose an image to upload');
    }

    let meta;

    try {
      meta = await sharp(req.body).metadata();
    } catch {
      throw new Error('That file is not an image this server can read. Export it as JPEG or PNG and try again');
    }

    const shorterSide = Math.min(meta.width || 0, meta.height || 0);

    if (shorterSide < 400) {
      throw new Error('That image is too small: it needs at least 400 pixels on its shorter side, '
        + `and this one has ${shorterSide}`);
    }

    const file = uploadPath(store.dir, e.id, i);
    await mkdir(dirname(file), { recursive: true });

    // Re-encoding applies the phone's rotation and drops every piece of metadata, including GPS location.
    await sharp(req.body)
      .rotate()
      .resize(2160, 2160, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toFile(file);

    await redrawPhoto(e, i);
    res.status(201).json({ ok: true });
  });

  app.delete('/api/editions/:id/events/:index/photo', async (req, res) => {
    const { e, i } = photoEvent(req);
    await rm(uploadPath(store.dir, e.id, i), { force: true });
    await redrawPhoto(e, i);
    res.json({ ok: true });
  });

  let researching = false;

  app.post('/api/research', async (req, res) => {
    if (researching) {
      return res.status(409).json({ error: 'Research is already running' });
    }

    researching = true;

    try {
      res.json(await researchInto(store, req.body.weekend || weekendFor(), env));
    } finally {
      researching = false;
    }
  });

  app.post('/api/jobs/:id/resolve', (req, res) => {
    const action = z.enum(['retry', 'confirm_sent']).parse(req.body.action);
    store.resolve(Number(req.params.id), action);
    res.json({ ok: true });
  });

  app.get('/api/integrations', async (_req, res) => {
    if (!env.POSTIZ_API_URL || !env.POSTIZ_API_KEY) {
      throw new Error('Configure Postiz first');
    }

    const url = `${withoutTrailingSlash(env.POSTIZ_API_URL)}/integrations`;
    res.json(await request(url, { headers: { Authorization: env.POSTIZ_API_KEY } }));
  });

  // Small copies for the review page; the full image is one click away.
  app.get('/thumb/:id/:file', async (req, res, next) => {
    try {
      res.type('jpeg').sendFile(await ensureThumb(store.dir, req.params.id, req.params.file));
    } catch (err) {
      if (err.code === 'ENOENT') {
        return next();
      }

      throw err;
    }
  });

  app.use('/media', express.static(resolve(store.dir, 'media'), { dotfiles: 'deny' }));
  app.use(express.static(resolve('public')));

  app.use((err, _req, res, _next) => {
    console.error(err.message);

    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'That file is too large; keep uploads under 15 MB' });
    }

    res.status(err.httpStatus || 400).json({ error: errorMessage(err) });
  });

  return app;
}
