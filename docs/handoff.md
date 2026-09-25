# Handoff: Riga weekend publishing system (state as of 2026-09-14)

Paste into a new chat: "Read docs/handoff.md, then help me with …"

## What the system does
ChatGPT (MCP plugin, single-user OAuth 2.1) researches Riga weekend events → submits an edition to a
Node app on a Hetzner VPS → app renders Instagram carousels and stories → review dashboard (choose
events, stories, upload own photos) → approval hands posts to Postiz (Instagram @rigathisweekend) and
a separate button sends a WhatsApp digest through WAHA.

## Infrastructure
- VPS: SSH alias `riga-travel` (62.238.108.18), deploy dir `/opt/riga-weekend`, deploy with `scripts/remote.sh deploy`.
- Docker Compose: app, worker, Postiz (+ Postgres, Redis, Temporal, Elasticsearch), WAHA, Caddy.
- Domains: `riga.petalsforher.com` (dashboard, MCP, short links), `social.petalsforher.com` (Postiz).
- WhatsApp group: `120363411066498936@g.us`.
- Stack: Node 24, Express 5, node:sqlite, sharp (SVG→JPEG), luxon (Europe/Riga), zod, MCP SDK.

## Code map (all changes since commit c812d34 are uncommitted)
- `src/domain.js` — Event/Submission schemas (max 60 events; languages EN/LV/RU; alsoOn dates), per-day posts
  (9 events + cover per carousel, busy days split into parts 30 min apart, ≥1 h before first event), captions
  (title + description + short link; price/date/venue live on the image; 2200-char degrade ladder), planned jobs.
- `src/render.js` — cover (weekday, date, event count, part, "Exhibitions may run several days · check the caption
  for dates" box) and cards (language pill + FRI/SAT/SUN pill, number, title/date/price/venue). Footer raised
  150 px to clear Instagram carousel dots.
- `src/photos.js` — only organiser imageUrl or og:image (SSRF-guarded). Never stock/Pinterest substitutes; missing
  photos are uploaded by hand on the review page.
- `src/store.js` — editions, jobs, short links (own 5-char codes + ej.uz), ej.uz call log, planApproval/approve.
- `src/shortlinks.js` — ej.uz client per official docs; paced 25/min, 90/h, 450/day; links only for URLs being
  published; click polling off unless `EJUZ_CLICK_REFRESH=true`.
- `src/providers.js` — Postiz: carousels `schedule`, stories `draft`; 429 → requeue in 10 min. WhatsApp: upcoming events only.
- `src/app.js`, `src/oauth.js`, `src/cli.js`, `public/app.js`, `public/style.css`, `test/system.test.js` (42 tests pass).
- Docs: `docs/chatgpt-task.md` (ChatGPT prompt), `docs/go-live.md`, `README.md`.
- Animated edits over your own footage (docs/chatgpt-video.md): `src/footage.js` (upload streaming, ffprobe, 30 fps
  working copy, contact sheets, gridded frames), `src/edits.js` (edit JSON schema, output↔source timeline, the guide
  ChatGPT reads), `src/animate.js` (dashboard routes, serial processing and render queues, the footage MCP tools),
  `remotion/src/FootageEdit.tsx` + `remotion/src/edit/` (composition, SVG drawing filters, stickers, text),
  `remotion/server.mjs` POST /clip, `test/footage.test.js`.

## Current live state
- Edition `a2db1e9d4f2c9b50e2d45b65` (weekend of 2026-09-18) approved.
- Postiz: 7 scheduled carousels (Fri 08:00, 09:00, 10:00, 10:30; Sat 09:00, 09:30; Sun 09:00) + 46 story drafts.
  Times can be moved inside Postiz.
- Captions use 48 ej.uz links. WhatsApp digest for this edition NOT sent yet.

## Constraints and preferences learned
- ej.uz (developer Ēriks): generated links 30/min, 100/h, 500/day; don't create links that are never published;
  no polling bursts; don't probe undocumented endpoints.
- Postiz `API_LIMIT` is 1000/h; when replacing posts, create new before deleting old.
- No "Also on" lines in captions; the cover note + day pill cover multi-day events.
- Only organiser posters or the user's own uploaded photos.
- Brand: dark green #17352d, lime #d4ed86, paper #f4f0e6, DejaVu Sans-like type.
- Confirm before publishing/editing anything public. Never type passwords or secrets into forms.

## Open items
- Animated edits: check in ChatGPT Work that the footage tools appear after refreshing the plugin and that Astra can
  see the contact sheets they return (docs/chatgpt-video.md, "Check these first").
- Rotate secrets that were pasted in chat (Instagram app secret, Postiz API key, ej.uz key).
- Commit the uncommitted work.
- Send WhatsApp digest for the 18–20 Sep edition when ready.
- Ideas not started: Canva weekend collage story (grid template, 4–6 events), ej.uz UTM/OG previews,
  link-in-bio page, custom domain (e.g. kurejam.lv / rtw.lv).
