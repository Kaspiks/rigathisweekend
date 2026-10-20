# How weekend editions are made and published

The detail behind the **Weekend editions** tab: what an edition holds, how the cards and captions are built, and what happens from approval to Instagram and WhatsApp. Setting up the accounts is in [go-live.md](go-live.md).

## From submission to review

- A submission is a **candidate list** of up to 60 events for one Friday–Sunday (Europe/Riga). It comes from the ChatGPT task through MCP, the server's research worker, the dashboard's JSON import, or `POST /api/editions`.
- The review page lists every event with a checkbox. Tick the ones worth publishing, tick **Story** on any that should also get a story, add photos where one is missing, then approve. Covers, captions and the WhatsApp digest are redrawn around your choice. Unticked events are rendered for review but never published.
- Submissions are de-duplicated by content. To change an unapproved edition, submit an updated one. An approved edition cannot be edited or replaced.
- Approval claims each of the edition's days, so two editions can never publish the same day twice. A later edition can still cover a day nothing has claimed yet.

## Research: choose one owner

| Owner | How | Cost |
| --- | --- | --- |
| **ChatGPT scheduled task** (default) | The prompt in [chatgpt-task.md](chatgpt-task.md) calls `submit_weekend_events` | Your ChatGPT plan |
| **Server worker** | `OPENAI_API_KEY`, a model with Responses `web_search` in `OPENAI_MODEL`, `RESEARCH_SCHEDULE_ENABLED=true`. Runs Thursday 18:00 Riga time, with a catch-up before Friday 09:00 | Separate OpenAI API charges |

Never enable both. The worker keeps the consulted source URLs and the response ID. Each event's source must appear in the web-search evidence, which is a check on where it came from, not proof that it is correct. A failed scheduled run is not retried automatically, so a fault cannot turn into a loop of paid calls. Rerun it from the dashboard or with `node src/cli.js research [YYYY-MM-DD]`.

## The cards

- **Photos.** Each card uses the organiser's own sharing image (`og:image` of the cited page) or an explicit `imageUrl`. It is cropped to Instagram size under a dark scrim, with the organiser's domain credited. Nothing is ever substituted from elsewhere.
- **Your own photos.** An event with no organiser image shows **No photo** with an **Add photo** button. Uploads (JPEG, PNG or WebP, at least 400 px on the short side, up to 15 MB) are turned upright, stripped of all metadata including GPS, and used without a credit line. You can also replace an organiser image or remove your photo again. With no usable image, the card falls back to the typographic design.
- **Image fetches** are HTTPS-only, refuse private addresses and redirects into them, cap size and time, and re-encode through sharp.
- **Credit is not a licence.** Crediting and linking the organiser is normal for event listings. If an organiser objects, use your own photo or let the card fall back.
- **Layout.** Name first, then date and price at equal weight, then the venue, with a large number counted within the post. A language tag (`EN`, `LV`, `RU`) sits in the corner, and a day tag (`FRI · SAT · SUN`, or `WED–SUN` for four or more days in a row) under it.
- **Titles** are in English. The original Latvian name opens the description so the event stays findable on Latvian ticket sites.

## Posts per day

- Instagram gets **one carousel per day that has events**: a date cover, then one slide per event.
- Meta caps a carousel at 10 slides, so a day with more than 9 events is split into parts, each cover marked "part 1 of 2" and so on.
- Every cover carries the note "Exhibitions may run several days · check the caption for dates".

## Events on more than one day

An exhibition, festival or repeated show is listed once, on its first or main day. `alsoOn` names its other days, anywhere from that week's Monday to Sunday. The extra days only change the day tag; the event is not posted on them. You can tick or correct the days on the review page until approval.

## Captions and short links

- For each event the caption gives the number, title, description (including age limits and door times) and a **short link** to the organiser's page. Price, date and venue are on the image. WhatsApp keeps full links, since WhatsApp makes them tappable.
- **The app's own short links** (`/k7m2x`) are public, redirect only to organiser URLs the server stored, count clicks, and keep the same code whenever the same page appears again. They use `SHORT_LINK_BASE` when set to a short domain you own, otherwise the dashboard's host.
- **ej.uz links** (optional, `EJUZ_API_KEY`) are created at approval, and only for events that will actually be published. The selection is checked first, then links are made, then the edition is approved and handed to Postiz. A refused approval or an unticked event never produces a link.
- **ej.uz limits.** Requests stay under the limits ej.uz's developer set (30 a minute, 100 an hour, 500 a day; adjustable with `EJUZ_PER_MINUTE`, `EJUZ_PER_HOUR`, `EJUZ_PER_DAY`). If ej.uz refuses a URL, rejects the key, rate-limits, or fails three times in a row, captions fall back to the app's own link.
- **ej.uz clicks.** Pulling ej.uz click totals back is off unless `EJUZ_CLICK_REFRESH=true`. The worker then does it every six hours, never on start-up. `node src/cli.js links` fills in ej.uz links for approved editions only.
- **Over 2,200 characters.** Captions shorten in this order: the event titles (the slide already shows them), then the closing line, then the hashtags, and only then the descriptions. Without short links, descriptions shorten first and full links shrink to hostnames last.

## Special posts

To give one occasion its own carousel (Researchers' Night, a festival day), tick its events, press **Make a special post from the ticked events…** and type the heading. This creates a separate edition. Its covers carry the heading above the date, and its captions and WhatsApp digest open with it.

A special post is published alongside that day's regular post, at 12:00 instead of 09:00 and still at least an hour before its first event. Untick its events in the regular edition if they should not appear twice. A submission can also carry `"headline": "Researchers' Night"` (3–40 characters) directly.

## Colours

Every day has a colour theme for its cover, slides, stories and story grid. The defaults are Friday Cobalt, Saturday Forest, Sunday Crimson, and Ember for special posts. Pick another with the swatches beside each post and the images are redrawn. Colours are fixed at approval, because the images are in Postiz by then. The palettes are in `src/themes.js`, and `public/style.css` mirrors the swatch colours.

## Approval and Postiz

- **Approving hands Instagram to Postiz, and Postiz decides when it publishes.** Each carousel is created as a scheduled post at 09:00 on its day, with later parts half an hour apart, and always at least an hour before its own first event. Each ticked Story is created as a draft.
- **A slot that has already passed** is scheduled ten minutes out, so there is still time to move it.
- **Move or schedule posts in Postiz's calendar.** The server checks that an event has not started only at hand-over. A post you move past its event in Postiz will still publish.
- **Photos are locked at approval,** because they are uploaded to Postiz then.
- **"Scheduled" or "draft" on the dashboard means Postiz accepted it.** Whether it later published is shown in Postiz. Story link stickers are not supported by Postiz's API.

## WhatsApp

The digest is sent only when you press **Send WhatsApp digest** on an approved edition. It lists the chosen events that have not started yet, and is held back if none are left. Pressing it again after a successful send asks for confirmation and is recorded as a separate send.

WAHA is an unofficial WhatsApp client. Sessions can disconnect and the account can be restricted, so use a dedicated number where practical. Groups (`…@g.us`) are the tested path; channels (`…@newsletter`) depend on the WAHA engine. The WAHA image is pinned to a digest and is x86-only: it runs under emulation on an ARM Mac and natively on an x86 VPS.

## Story grids (story video)

Each edition has a **Story grids** section with one block per day:

1. Tick up to six of the day's cards. The first suggestion is the earliest events with a real photo.
2. Set the envelope label's kicker and category and how long the grid holds.
3. Press **Build grid**, which writes `media/<edition>/grid-<date>.png`.
4. Press **Render story video**. The render service plays the opener, reveals the grid and holds it under a day band. Pick the opener per day: Event ticket (default), Envelope, Leaf gust, Harvest bag, Pressed leaf, Leave your mark, Sketchbook or Pinboard. The video is saved as `grid-<date>.mp4` beside the grid, and rebuilding the grid removes it.
5. Press **Send as Reel draft** or **Send as Story draft** to hand it to Postiz through the delivery queue. Drafts never publish by themselves. A Reel carries a caption with that day's events and short links; a Story carries none.

Once the edition is approved, only published events are offered.

## The delivery queue

- `LIVE_PUBLISH=false` means nothing is delivered, even for approved editions. When you switch it on, queued items still send if their events are in the future, so enable it only when those are meant to go out.
- `AUTO_APPROVE=true` approves the server worker's own research automatically. It never approves MCP imports. For the ChatGPT path, approval is a tool call in the task's prompt.
- Jobs are claimed atomically, and exactly **one worker replica** may run.
- A Postiz rate limit (HTTP 429) means nothing was created, so that item waits ten minutes and tries again.
- A timeout or interrupted send becomes **uncertain** and is not retried automatically, because the provider may have accepted it. Check the provider, then press **Confirm already sent** or **Retry after checking provider**.
- Fix the configuration first for **blocked** jobs.
- Exactly-once delivery across an external API cannot be promised. The queue prevents ordinary repeats and makes unclear outcomes visible.

## Import format

```json
{
  "weekend": "2026-09-18",
  "events": [
    {
      "title": "Replace with a verified real event",
      "startsAt": "2026-09-19T18:00:00+03:00",
      "venue": "Verified Riga venue",
      "price": "Price not confirmed",
      "summary": "A short description grounded in the organiser's listing.",
      "sourceUrl": "https://example.com/replace-with-real-source",
      "imageUrl": "https://example.com/optional-organiser-photo.jpg",
      "languages": ["EN", "LV"],
      "alsoOn": ["2026-09-19", "2026-09-20"]
    }
  ]
}
```

Field limits: title 100 characters, venue 90, price 60, summary 220. `startsAt` needs an explicit timezone offset, and `sourceUrl` must be the HTTPS page actually checked. `headline` is optional (see special posts). Imports keep the sources they are given but do not browse them; the review is the factual check.
