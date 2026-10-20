const $ = s => {
  return document.querySelector(s);
};

const esc = s =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(path, body) {
  const r = await fetch(
    path,
    body === undefined
      ? {}
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  );

  const data = await r.json();

  if (!r.ok) {
    throw Error(data.error || 'Request failed');
  }

  api.headers = r.headers;
  return data;
}

async function action(fn) {
  try {
    $('#status').textContent = 'Working…';
    $('#status').className = '';
    await fn();
    await load();
    $('#status').textContent = 'Done.';
  } catch (e) {
    $('#status').textContent = e.message;
    $('#status').className = 'error';
  }
}

const riga = t =>
  t
    ? new Date(t).toLocaleString('en-GB', {
        timeZone: 'Europe/Riga',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

let stamp = Date.now();
let postizUrl = null;
let ejuz = false;
let renderConfigured = false;
let showPast = false;
let families = [];
let tones = [];
const gridInfo = new Map();
const openGrids = new Set();

const media = (e, file) => {
  return `/media/${e.id}/${file}?v=${stamp}`;
};

// Thumbnails keep the review page light; every one links to the full-size image.
const thumb = (e, file) => {
  return `/thumb/${e.id}/${file}?v=${stamp}`;
};

const lazy = 'loading="lazy" decoding="async"';

// Organiser images stay; an event with none gets flagged so you can add your own before approving.
function photoRow(e, i) {
  const mine = e.uploads.includes(i);
  const organiser = e.organiserPhotos.includes(i);
  const locked = e.approved;

  const state = mine
    ? '<span class="tag ok">Your photo</span>'
    : organiser
      ? '<span class="tag ok">Organiser photo</span>'
      : '<span class="tag missing">No photo</span>';

  const add = locked
    ? ''
    : `<button class="secondary small" data-upload="${e.id}" data-index="${i}">`
      + `${mine ? 'Replace my photo' : organiser ? 'Use my own photo instead' : 'Add photo'}</button>`;

  const remove =
    mine && !locked
      ? `<button class="secondary small" data-unphoto="${e.id}" data-index="${i}">Remove my photo</button>`
      : '';

  const story = `<label class="story-tick"><input type="checkbox" data-story="${e.id}" `
    + `value="${i}"${e.stories.includes(i) ? ' checked' : ''}${locked ? ' disabled' : ''}> Story</label>`;

  return `<div class="photo-row${!mine && !organiser && !locked ? ' needs' : ''}">`
    + `<a href="${media(e, `feed-${i}.jpg`)}" target="_blank" rel="noopener">`
    + `<img ${lazy} src="${thumb(e, `feed-${i}.jpg`)}" alt="Slide for ${esc(e.data.events[i].title)}">`
    + `</a>${state}${add}${remove}${story}</div>`;
}

// Photo messages go on the event's own row: #status is at the top of the page, far from an event
// lower down. The row is looked up when the message is shown, in case the page was redrawn meanwhile.
function photoNote(id, i, text, error = false) {
  const row = document
    .querySelector(`[data-upload="${id}"][data-index="${i}"],[data-unphoto="${id}"][data-index="${i}"]`)
    ?.closest('.photo-row');

  if (!row) {
    return;
  }

  const note =
    row.querySelector('.photo-note')
    || row.appendChild(Object.assign(document.createElement('span'), { className: 'photo-note' }));

  note.textContent = text;
  note.classList.toggle('error', error);
  note.setAttribute('role', error ? 'alert' : 'status');
}

async function photoRequest(id, i, busy, send, fallback) {
  photoNote(id, i, busy);

  try {
    const r = await send();
    const d = await r.json().catch(() => ({}));

    if (!r.ok) {
      throw Error(d.error || fallback);
    }
  } catch (err) {
    photoNote(id, i, err.message, true);
    throw err;
  }
}

// Other days an event is also on, Monday to Sunday of the weekend's week. They only change the day tag on
// its slides: the event is still posted once, on its own day. Editable on drafts; shown as text once approved.
const weekday = d => {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
};

function alsoRow(e, i) {
  const x = e.data.events[i];
  const set = x.alsoOn || [];
  const days = e.tagDays || e.weekendDays;
  const own = e.eventDates[i];

  if (e.approved) {
    return set.length ? `<div class="also">Also on ${set.map(weekday).join(', ')}</div>` : '';
  }

  const choices = days.map(d => {
    if (d === own) {
      return `<span class="also-own">${weekday(d)}</span>`;
    }

    const weekdayClass = e.weekendDays.includes(d) ? '' : ' class="weekday"';
    const checked = set.includes(d) ? ' checked' : '';

    return `<label${weekdayClass}><input type="checkbox" data-also="${e.id}" data-index="${i}" value="${d}"${checked}> `
      + `${weekday(d)}</label>`;
  });

  return `<div class="also">Also on:${choices.join('')}</div>`;
}

function jobLabel(e, j) {
  if (j.target.startsWith('instagram_feed:')) {
    const [date, part] = j.target.slice(15).split('#');
    const p = e.posts.find(x => x.date === date && String(x.part) === part);
    return `Instagram post · ${esc(p ? p.name : date)}`;
  }

  if (j.target === 'instagram_feed') {
    return 'Instagram post · whole weekend';
  }

  if (j.target.startsWith('instagram_story:')) {
    const i = Number(j.target.split(':')[1]);
    return `Story · ${esc(e.data.events[i]?.title || `event ${i + 1}`)}`;
  }

  if (j.target.startsWith('instagram_reel:')) {
    return `Reel · ${esc(j.target.slice(15).split('#')[0])}`;
  }

  if (j.target.startsWith('instagram_grid_story:')) {
    return `Story video · ${esc(j.target.slice(21).split('#')[0])}`;
  }

  if (j.target.startsWith('whatsapp')) {
    return 'WhatsApp digest';
  }

  return esc(j.target);
}

function jobState(j) {
  let r = {};

  try {
    r = JSON.parse(j.result || '{}') || {};
  } catch {}

  const wa = j.target.startsWith('whatsapp');

  if (['queued', 'processing'].includes(j.status)) {
    return wa ? 'Sending…' : 'Handing over to Postiz…';
  }

  if (j.status === 'sent') {
    if (r.postiz === 'draft') {
      return 'Draft in Postiz: schedule or delete it there';
    }

    if (r.postiz === 'scheduled') {
      return `Scheduled in Postiz for ${riga(r.publishAt)}`;
    }

    return j.finished_at ? `Sent ${riga(j.finished_at)}` : 'Sent';
  }

  if (j.status === 'blocked') {
    return `Held back: ${esc(r.error || '')}`;
  }

  if (j.status === 'uncertain') {
    return `Needs checking: ${esc(r.error || '')}`;
  }

  return esc(j.status);
}

function jobItem(e, j) {
  const fix = ['uncertain', 'blocked'].includes(j.status)
    ? `<div><button class="secondary small" data-retry="${j.id}">Retry after checking</button>`
      + `<button class="secondary small" data-sent="${j.id}">Confirm it did go out</button></div>`
    : '';

  return `<li><strong>${jobLabel(e, j)}</strong><span class="job-state ${j.status}">${jobState(j)}</span>${fix}</li>`;
}

// After approval: Instagram lives in Postiz, WhatsApp waits for you.
function publishing(e) {
  if (e.demo || !e.approved) {
    return '';
  }

  const insta = e.jobs.filter(j => !j.target.startsWith('whatsapp'));
  const sends = e.jobs.filter(j => j.target.startsWith('whatsapp'));
  const last = sends[sends.length - 1];
  const busy = last && ['queued', 'processing'].includes(last.status);
  const sent = last?.status === 'sent';

  const calendar = postizUrl
    ? `<a class="button-link" href="${esc(postizUrl)}/launches" target="_blank" rel="noopener">Open Postiz calendar</a>`
    : '';

  const button = busy
    ? '<button disabled>Sending…</button>'
    : `<button data-whatsapp="${e.id}"${sent ? ' data-resend="1" class="secondary"' : ''}>`
      + `${sent ? 'Send the digest again' : 'Send WhatsApp digest now'}</button>`;

  const scheduleNote = 'Carousels are scheduled for the times below and stories wait as drafts. To change a time, '
    + 'or to schedule or delete a story, open the post in Postiz. Times shown here are the ones first scheduled.';

  return `<section class="publishing">
    <div class="publishing-head"><h4>Instagram, in Postiz</h4>${calendar}</div>
    <p>${scheduleNote}</p>
    <ul class="jobs">${insta.map(j => jobItem(e, j)).join('') || '<li>Nothing handed over yet.</li>'}</ul>
    <div class="publishing-head"><h4>WhatsApp</h4>${button}</div>
    <p>Sent to the group only when you press the button. It lists the chosen events that have not started yet.</p>
    ${sends.length ? `<ul class="jobs">${sends.map(j => jobItem(e, j)).join('')}</ul>` : ''}
  </section>`;
}

// Story grids: pick up to six cards per day, build the sheet, then render the envelope video on demand.
const GRID_MAX = 6;

function gridState(g) {
  const s = g.saved;

  if (!s) {
    return 'Not built yet. The ticks are a suggestion: earliest events with a real photo first.';
  }

  if (s.status === 'rendering') {
    return 'Rendering the video… this takes about a minute. The page updates when it is done.';
  }

  if (s.status === 'failed') {
    return `Render failed: ${esc(s.error || 'unknown error')}`;
  }

  if (g.video) {
    return 'Video ready.';
  }

  return renderConfigured
    ? 'Grid built. Render the video when you are happy with it.'
    : 'Grid built. The render service is not configured (RENDER_URL), so videos cannot be made here yet.';
}

function gridBlock(e, g) {
  const key = `${e.id}|${g.date}`;
  const s = g.saved;
  const picks = s ? s.picks : g.suggested;
  const busy = s?.status === 'rendering';
  gridInfo.set(key, g);

  // A card already used in a story, or left out of the weekend's posts, is greyed out and cannot be ticked.
  const cards = g.events
    .map(
      x =>
        `<label class="grid-pick${x.blocked ? ' used' : ''}" data-pick="${e.id}|${x.index}"`
          + `${x.blocked ? ' data-always-blocked="1"' : ''}><input type="checkbox" data-grid="${key}" `
          + `value="${x.index}"${picks.includes(x.index) && !x.blocked ? ' checked' : ''}`
          + `${busy || x.blocked ? ' disabled' : ''}><img ${lazy} src="${thumb(e, `feed-${x.index}.jpg`)}" alt="">`
          + `<span>${esc(x.title)}<small>${esc(x.time)}</small>`
          + `${x.blocked ? `<small class="why">${esc(x.blocked)}</small>` : ''}</span></label>`,
    )
    .join('');

  const preview = g.collage
    ? `<a href="${media(e, `grid-${g.date}.png`)}" target="_blank" rel="noopener">`
      + `<img ${lazy} class="grid-preview" src="${thumb(e, `grid-${g.date}.png`)}" alt="Grid for ${esc(g.name)}"></a>`
    : '';

  const sendState = k => {
    const j = (g.posts || []).filter(x => x.kind === k).pop();

    if (!j) {
      return '';
    }

    return `<span class="job-state ${j.status}">${jobState(j)}</span>`;
  };

  const sent = k => {
    return (g.posts || []).some(x => x.kind === k && x.status === 'sent');
  };

  const sendable = g.video && !busy && s?.status === 'ready';

  // A Reel or Story draft button, with the state of its last send beside it.
  const sendButton = (kind, label) => {
    const resend = sent(kind) ? ' data-resend="1"' : '';
    const text = sent(kind) ? `Send ${label} again` : `Send as ${label} draft`;

    return `<button class="secondary small" data-grid-send="${key}" data-kind="${kind}"${resend}>${text}</button>`
      + sendState(kind);
  };

  const send = sendable
    ? `<div class="grid-send">
      ${sendButton('reel', 'Reel')}
      ${sendButton('story', 'Story')}
    </div>`
    : '';

  const video =
    g.video && !busy
      ? `<div class="grid-video"><video controls playsinline preload="none" src="${media(e, `grid-${g.date}.mp4`)}">`
        + `</video><a class="button-link" href="${media(e, `grid-${g.date}.mp4`)}" `
        + `download="story-${g.date}.mp4">Download MP4</a></div>`
      : '';

  const disabled = busy ? ' disabled' : '';
  const count = `<span data-grid-count="${key}">${picks.length}</span> of ${GRID_MAX} cards`;
  const eventCount = `${g.events.length} ${g.events.length === 1 ? 'event' : 'events'}`;
  const when = g.date === 'weekend' ? 'across the weekend' : 'that day';
  const renderOff = !g.collage || busy || !renderConfigured ? ' disabled' : '';
  const renderLabel = busy ? 'Rendering…' : g.video ? 'Render video again' : 'Render story video';

  return `<section class="grid-day">
    <h4>${esc(g.name)} · ${count} · ${eventCount} ${when}</h4>
    <div class="grid-label">
      <label>Day <input value="${esc(g.day)}" disabled></label>
      <label>Kicker <input data-grid-kicker="${key}" maxlength="24"
        value="${esc(s?.kicker || 'Overview')}"${disabled}></label>
      <label>Category <input data-grid-category="${key}" maxlength="32"
        value="${esc(s?.category || 'Arts & Culture')}"${disabled}></label>
      <label>Hold (s) <input data-grid-hold="${key}" type="number" min="2" max="15" step="1"
        value="${s?.holdSeconds || 6}"${disabled}></label>
      <label>Opener <select data-grid-style="${key}"${disabled}>${[
        ['ticket', 'Event ticket'],
        ['envelope', 'Envelope'],
        ['leaves', 'Leaf gust'],
        ['bag', 'Harvest bag'],
        ['book', 'Pressed leaf'],
        ['mark', 'Leave your mark'],
        ['sketch', 'Sketchbook'],
        ['pinboard', 'Pinboard'],
      ]
        .map(([v, t]) => `<option value="${v}"${(s?.style || 'ticket') === v ? ' selected' : ''}>${t}</option>`)
        .join('')}</select></label>
    </div>
    <div class="grid-picks">${cards}</div>
    <div class="toolbar">
      <button class="secondary small" data-grid-suggest="${key}"${disabled}>Use suggestion</button>
      <button class="small" data-grid-build="${key}"${disabled}>${g.collage ? 'Rebuild grid' : 'Build grid'}</button>
      <button class="small" data-grid-render="${key}"${renderOff}>${renderLabel}</button>
    </div>
    <p class="hint${s?.status === 'failed' ? ' error' : ''}">${gridState(g)}</p>
    <div class="grid-output">${preview}${video}</div>
    ${send}
  </section>`;
}

function gridSection(e) {
  if (!e.grids?.length) {
    return '';
  }

  const open = openGrids.has(`grids-${e.id}`) ? ' open' : '';

  const later = e.approved
    ? 'Only events you approved are offered.'
    : 'Changing which events you publish later does not change a grid you already built.';

  const hint = `Tick up to ${GRID_MAX} cards for a day and build its grid. Cards already used in a story, or left out `
    + 'of this weekend\'s posts, are greyed out. The video opens with the day\'s ticket (or the envelope), reveals '
    + 'the grid and holds it full screen with the day on top. Changing the opener needs a rebuild. '
    + later;

  const summary = '<summary>Story grids · story video per day</summary>';

  return `<details class="grids" data-open-key="grids-${e.id}"${open}>${summary}
    <p class="hint">${hint}</p>
    ${e.grids.map(g => gridBlock(e, g)).join('')}
  </details>`;
}

// Colours: the week has a family (shared accent, so the week reads as one group) and each day a tone of it
// (so the days tell apart). One tone per day, so every part of a split day changes together; fixed once approved.
const familyName = k => {
  return families.find(f => f.key === k)?.name || k;
};

const toneName = k => {
  return tones.find(t => t.key === k)?.name || k;
};

function palettePicker(e) {
  if (e.approved) {
    return `<p class="palette"><span class="theme-now">Week colours: ${esc(familyName(e.palette))}</span></p>`;
  }

  const swatches = families.map(f => {
    return `<button class="swatch swatch-family-${esc(f.key)}" data-palette="${esc(f.key)}" `
      + `data-palette-edition="${e.id}" title="${esc(f.name)}" aria-label="${esc(f.name)}" `
      + `aria-pressed="${f.key === e.palette}"></button>`;
  }).join('');

  const current = `${esc(familyName(e.palette))}${e.paletteChosen ? '' : ' · this week’s default'}`;

  return '<div class="palette"><span class="palette-label">Week colours</span>'
    + `<div class="themes" role="group" aria-label="Colour family for this week">${swatches}`
    + `<span class="theme-now">${current}</span></div></div>`;
}

function themePicker(e, d) {
  if (e.approved) {
    return `<span class="theme-now">${esc(familyName(e.palette))} · ${esc(toneName(d.tone))}</span>`;
  }

  if (d.part > 1) {
    return '';
  }

  const swatches = tones.map(t => {
    return `<button class="swatch swatch-${esc(e.palette)}-${esc(t.key)}" data-tone="${esc(t.key)}" `
      + `data-theme-edition="${e.id}" data-theme-date="${d.date}" title="${esc(t.name)}" aria-label="${esc(t.name)}" `
      + `aria-pressed="${t.key === d.tone}"></button>`;
  }).join('');

  return `<div class="themes" role="group" aria-label="Tone for ${esc(d.name)}">${swatches}`
    + `<span class="theme-now">${esc(toneName(d.tone))}</span></div>`;
}

function edition(e) {
  const missing = e.data.events.length - new Set([...e.uploads, ...e.organiserPhotos]).size;

  const state = e.demo
    ? 'Demo content · fictional events'
    : e.approved
      ? 'Approved · Instagram is in Postiz, WhatsApp is sent on demand'
      : 'Ready for your review';

  const posts = e.posts.map(d => {
    const eventCount = `${d.indexes.length} ${d.indexes.length === 1 ? 'event' : 'events'}`;
    const cover = `cover-${d.date}-${d.part}.jpg`;

    const slides = d.indexes.map(i => {
      return `<a href="${media(e, `feed-${i}.jpg`)}" target="_blank" rel="noopener">`
        + `<img ${lazy} src="${thumb(e, `feed-${i}.jpg`)}" alt="Slide for event ${i + 1}"></a>`;
    }).join('');

    return '<section class="day">'
      + `<div class="day-head"><h4>${esc(d.name)} · ${eventCount} · one Instagram post</h4>${themePicker(e, d)}</div>`
      + `<div class="cards"><a class="cover" href="${media(e, cover)}" target="_blank" rel="noopener">`
      + `<img ${lazy} src="${thumb(e, cover)}" alt="${esc(d.name)} cover slide"></a>${slides}</div>`
      + `<details><summary>Caption for this post</summary><pre>${esc(d.caption)}</pre></details></section>`;
  }).join('');

  const rows = e.data.events.map((x, i) => {
    const checked = !e.approved || !e.selected || e.selected.includes(i) ? ' checked' : '';
    const disabled = e.approved || e.demo ? ' disabled' : '';

    const when = new Date(x.startsAt).toLocaleString('en-GB', {
      timeZone: 'Europe/Riga', dateStyle: 'medium', timeStyle: 'short',
    });

    const link = e.shortLinks?.[i];

    const short = link
      ? ` · <span class="short">${esc(link.url)} · ${link.clicks} ${link.clicks === 1 ? 'click' : 'clicks'}</span>`
      : '';

    return `<li><label><input type="checkbox" data-edition="${e.id}" value="${i}"${checked}${disabled}>`
      + `<span><strong>${esc(x.title)}</strong><br>${esc(when)} · ${esc(x.venue)} · ${esc(x.price)}<br>`
      + `${esc(x.summary)}<br><a href="${esc(x.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source</a>`
      + `${short}</span></label>${e.demo ? '' : alsoRow(e, i) + photoRow(e, i)}</li>`;
  }).join('');

  const special = e.headline ? '<span class="tag special">Special post</span>' : '';
  const title = `${e.headline ? `${esc(e.headline)} · ` : ''}Weekend of ${esc(e.weekend)}`;
  const approve = !e.demo && !e.approved ? `<button data-approve="${e.id}">Approve & send to Postiz</button>` : '';
  const head = `<div>${special}<h3>${title}</h3><p>${state} · ${e.data.events.length} picks</p></div>${approve}`;

  const stories = e.data.events.map((_, i) => {
    return `<a href="${media(e, `story-${i}.jpg`)}" target="_blank" rel="noopener">`
      + `<img ${lazy} src="${thumb(e, `story-${i}.jpg`)}" alt="Event ${i + 1} story image"></a>`;
  }).join('');

  const listOpen = e.approved || e.demo ? '' : 'open';
  const listTitle = e.approved ? 'Events in this edition' : 'Choose what to publish';
  const photoCount = e.demo ? '' : ` · ${missing} without a photo`;

  const specialHint = 'A special post has your own heading (such as Researchers’ Night) on its cover, above the '
    + 'date, and goes out as a separate carousel at noon, alongside the regular post for that day. It appears as its '
    + 'own edition below, for you to approve. Untick those events here if they should not also be in the regular post.';

  const toolbar = e.approved || e.demo
    ? ''
    : `<div class="toolbar"><button class="secondary" data-all="${e.id}">Select all</button>`
      + `<button class="secondary" data-none="${e.id}">Clear</button>`
      + `<button class="secondary" data-special="${e.id}">Make a special post from the ticked events…</button></div>
      <p class="hint">${specialHint}</p>`;

  return `<article class="edition">
    <div class="edition-head">${head}</div>
    ${publishing(e)}
    ${e.demo ? '' : palettePicker(e)}
    ${posts}
    ${gridSection(e)}
    <details><summary>Story previews</summary><div class="cards">${stories}</div></details>
    <details ${listOpen}><summary>${listTitle} · ${e.data.events.length} found${photoCount}</summary>
      ${e.approved || e.demo ? '' : `<p class="hint">Untick events to leave them out. Tick Story to also get a story `
        + `draft in Postiz for that event. Tick the other days an exhibition, festival or repeated show is also on, `
        + `Monday to Sunday, so its day tag shows them. It is still posted only on its own day. Photos must be final `
        + `before approving, because they go to Postiz then.`
        + `${ejuz ? ' Caption links become ej.uz links when you approve.' : ''}</p>`}
      <ol class="event-list picks">${rows}</ol>
      ${toolbar}
    </details>
    <div class="copy"><details><summary>WhatsApp digest preview</summary><pre>${esc(e.whatsapp)}</pre></details></div>
  </article>`;
}

async function load() {
  stamp = Date.now();

  const [status, editions] = await Promise.all([
    api('/api/status'),
    api(`/api/editions${showPast ? '?scope=all' : ''}`),
  ]);

  const past = Number(api.headers?.get('X-Past-Editions') || 0);
  postizUrl = status.postizUrl;
  ejuz = status.ejuz;
  renderConfigured = status.renderConfigured;
  families = status.families || [];
  tones = status.tones || [];
  $('#mode').textContent = status.live ? 'LIVE DELIVERY ENABLED' : 'PREVIEW MODE';

  $('#runs').textContent = status.runs.length
    ? status.runs.map(r => `${r.weekend} · ${r.status} · ${r.detail || ''}`).join('\n')
    : 'No scheduled research runs yet.';

  // Only the newest edition is open: older ones stay collapsed so their images are never fetched.
  $('#editions').innerHTML = editions.length
    ? editions
        .map((e, i) =>
          i === 0
            ? edition(e)
            : `<details class="older" data-open-key="edition-${e.id}"${openGrids.has(`edition-${e.id}`) ? ' open' : ''}`
              + `><summary>${e.headline ? `${esc(e.headline)} · ` : ''}Weekend of ${esc(e.weekend)} · `
              + `${e.data.events.length} picks${e.demo ? ' · demo' : e.approved ? ' · approved' : ''}`
              + `</summary>${edition(e)}</details>`,
        )
        .join('')
    : '<p class="empty">No editions yet. Find events, import your research, or run '
      + '<code>docker compose run --rm app node src/cli.js demo</code> to see a sample.</p>';

  // Weekends that are over are kept on the server but not listed, so the page stays light.
  if (past || showPast) {
    const hidden = `${past} past ${past === 1 ? 'weekend is' : 'weekends are'} hidden.`;
    const note = showPast ? 'Showing past weekends too.' : hidden;
    const toggleLabel = showPast ? 'Hide past weekends' : 'Show past weekends';
    const toggle = `<button class="secondary small" id="past">${toggleLabel}</button>`;
    $('#editions').insertAdjacentHTML('beforeend', `<p class="empty past-note">${note} ${toggle}</p>`);
  }

  if (editions.some(e => e.grids?.some(g => g.saved?.status === 'rendering'))) {
    watchRenders();
  }

  await loadFootage().catch(e => {
    $('#clips').innerHTML = `<p class="empty error">${esc(e.message)}</p>`;
  });
}

// While a story renders, check quietly and only redraw the page once it has finished, so ticks
// you are changing on another day are not reset every few seconds.
let watching = null;

function watchRenders() {
  if (watching) {
    return;
  }

  watching = setInterval(async () => {
    try {
      const editions = await api('/api/editions');

      if (!editions.some(e => e.grids?.some(g => g.saved?.status === 'rendering'))) {
        clearInterval(watching);
        watching = null;
        await load();
      }
    } catch {}
  }, 5000);
}

const gridKey = key => {
  const [id, date] = key.split('|');
  return { id, date };
};

const gridPicks = key =>
  [...document.querySelectorAll(`input[data-grid="${CSS.escape(key)}"]:checked`)].map(x => Number(x.value));

$('#refresh').onclick = () => {
  action(load);
};

$('#research').onclick = () => {
  action(async () => {
    const b = $('#research');
    b.disabled = true;

    try {
      await api('/api/research', {});
    } finally {
      b.disabled = false;
    }
  });
};

$('#import').onclick = () => {
  action(() => api('/api/editions', JSON.parse($('#json').value)));
};

document.addEventListener('click', ev => {
  const b = ev.target.closest('button');

  if (!b) {
    return;
  }

  if (footageClick(b)) {
    return;
  }

  if (b.dataset.upload) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    const { upload: id, index: i } = b.dataset;

    input.onchange = () => {
      const f = input.files[0];

      if (!f) {
        return;
      }

      action(() =>
        photoRequest(
          id,
          i,
          `Uploading ${f.name}…`,
          () =>
            fetch(`/api/editions/${id}/events/${i}/photo`, {
              method: 'POST',
              headers: { 'Content-Type': f.type || 'application/octet-stream' },
              body: f,
            }),
          'Upload failed',
        ),
      );
    };

    input.click();
    return;
  }

  if (b.dataset.unphoto) {
    const { unphoto: id, index: i } = b.dataset;

    action(() =>
      photoRequest(
        id,
        i,
        'Removing…',
        () => fetch(`/api/editions/${id}/events/${i}/photo`, { method: 'DELETE' }),
        'Could not remove the photo',
      ),
    );

    return;
  }

  if (b.dataset.tone || b.dataset.palette) {
    const row = b.closest('.themes');

    if (b.getAttribute('aria-pressed') === 'true' || document.querySelector('.themes.busy')) {
      return;
    }

    // Show the choice at once: redrawing takes a few seconds for a day, longer for the whole week, and the page
    // reloads after.
    row.querySelectorAll('.swatch').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    row.classList.add('busy');
    row.querySelector('.theme-now').textContent = `${b.title} · redrawing${b.dataset.palette ? ' every day' : ''}…`;

    const call = b.dataset.palette
      ? api(`/api/editions/${b.dataset.paletteEdition}/palette`, { palette: b.dataset.palette })
      : api(`/api/editions/${b.dataset.themeEdition}/themes/${b.dataset.themeDate}`, { tone: b.dataset.tone });

    action(() => call).finally(() => {
      row.classList.remove('busy');

      if ($('#status').className === 'error') {
        load();
      }
    });

    return;
  }

  if (b.dataset.special) {
    const id = b.dataset.special;
    const picks = [...document.querySelectorAll(`input[data-edition="${id}"]:checked`)].map(x => Number(x.value));

    if (!picks.length) {
      $('#status').textContent = 'Tick the events that go in the special post.';
      $('#status').className = 'error';
      return;
    }

    const headline = (
      prompt(
        `Heading for the special post with ${picks.length} event${picks.length === 1 ? '' : 's'} (3–40 characters), `
          + `for example: Researchers’ Night`,
      ) || ''
    ).trim();

    if (!headline) {
      return;
    }

    action(async () => {
      const e = await api(`/api/editions/${id}/special`, { headline, events: picks });
      openGrids.add(`edition-${e.id}`);
    });

    return;
  }

  if (b.dataset.all || b.dataset.none) {
    const on = !!b.dataset.all;

    document.querySelectorAll(`input[data-edition="${b.dataset.all || b.dataset.none}"]`).forEach(x => {
      x.checked = on;
    });

    return;
  }

  if (b.dataset.approve) {
    const id = b.dataset.approve;
    const picks = [...document.querySelectorAll(`input[data-edition="${id}"]:checked`)].map(x => Number(x.value));

    if (!picks.length) {
      $('#status').textContent = 'Tick at least one event to publish.';
      $('#status').className = 'error';
      return;
    }

    const stories = [...document.querySelectorAll(`input[data-story="${id}"]:checked`)]
      .map(x => Number(x.value))
      .filter(i => picks.includes(i));

    const storyNote = stories.length
      ? `${stories.length} ${stories.length === 1 ? 'story is' : 'stories are'} added as drafts for you to schedule.`
      : 'No stories are ticked.';

    const msg = `Send ${picks.length} event${picks.length === 1 ? '' : 's'} to Postiz?\n\n`
      + 'Carousels are scheduled at their default times, and you can move them in Postiz.\n'
      + `${storyNote}\nWhatsApp is not sent until you press its button.\n\n`
      + 'Photos can no longer be changed here after this.';

    if (confirm(msg)) {
      action(() => api(`/api/editions/${id}/approve`, { events: picks, stories }));
    }

    return;
  }

  if (b.dataset.whatsapp) {
    const resend = !!b.dataset.resend;

    if (
      confirm(
        resend
          ? 'The digest was already sent to the WhatsApp group. Send it again?'
          : 'Send the WhatsApp digest to the group now?',
      )
    ) {
      action(() => api(`/api/editions/${b.dataset.whatsapp}/whatsapp`, { resend }));
    }

    return;
  }

  if (b.id === 'past') {
    showPast = !showPast;
    action(load);
    return;
  }

  if (b.dataset.gridSuggest) {
    const g = gridInfo.get(b.dataset.gridSuggest);

    document.querySelectorAll(`input[data-grid="${CSS.escape(b.dataset.gridSuggest)}"]`).forEach(x => {
      x.checked = g.suggested.includes(Number(x.value));
    });

    $(`[data-grid-count="${CSS.escape(b.dataset.gridSuggest)}"]`).textContent = g.suggested.length;
    return;
  }

  if (b.dataset.gridBuild) {
    const key = b.dataset.gridBuild;
    const { id, date } = gridKey(key);
    const picks = gridPicks(key);

    const q = s => {
      return $(`[data-grid-${s}="${CSS.escape(key)}"]`);
    };

    if (!picks.length) {
      $('#status').textContent = 'Tick at least one card for the grid.';
      $('#status').className = 'error';
      return;
    }

    openGrids.add(`grids-${id}`);

    action(() =>
      api(`/api/editions/${id}/grids/${date}`, {
        events: picks,
        kicker: q('kicker').value,
        category: q('category').value,
        holdSeconds: Number(q('hold').value) || 6,
        style: q('style').value,
      }),
    );

    return;
  }

  if (b.dataset.gridSend) {
    const { id, date } = gridKey(b.dataset.gridSend);
    const kind = b.dataset.kind;
    const resend = !!b.dataset.resend;
    const what = kind === 'reel' ? 'Reel' : 'Story';

    const question = resend
      ? `Send this ${what} to Postiz again? A second draft will be created.`
      : `Send this ${what} to Postiz?`;

    const draftNote = 'It arrives as a DRAFT: watch it in Postiz and schedule it there. Nothing publishes by itself.';

    if (!confirm(`${question}\n\n${draftNote}`)) {
      return;
    }

    openGrids.add(`grids-${id}`);
    action(() => api(`/api/editions/${id}/grids/${date}/postiz`, { kind, resend }));
    return;
  }

  if (b.dataset.gridRender) {
    const { id, date } = gridKey(b.dataset.gridRender);
    openGrids.add(`grids-${id}`);
    action(() => api(`/api/editions/${id}/grids/${date}/render`, {}));
    return;
  }

  if (
    b.dataset.retry
    && confirm('Have you checked Postiz or WhatsApp and confirmed this did NOT go out? '
      + 'Retrying can create a duplicate.')
  ) {
    action(() => api(`/api/jobs/${b.dataset.retry}/resolve`, { action: 'retry' }));
  }

  if (b.dataset.sent) {
    action(() => api(`/api/jobs/${b.dataset.sent}/resolve`, { action: 'confirm_sent' }));
  }
});

document.addEventListener(
  'toggle',
  ev => {
    const d = ev.target;

    if (d.dataset?.openKey) {
      if (d.open) {
        openGrids.add(d.dataset.openKey);
      } else {
        openGrids.delete(d.dataset.openKey);
      }
    }
  },
  true,
);

document.addEventListener('change', ev => {
  const tick = ev.target.closest('input[data-grid]');

  if (tick) {
    const key = tick.dataset.grid;
    const picks = gridPicks(key);

    if (picks.length > GRID_MAX) {
      tick.checked = false;
      $('#status').textContent = `A grid holds at most ${GRID_MAX} cards.`;
      $('#status').className = 'error';
      return;
    }

    $(`[data-grid-count="${CSS.escape(key)}"]`).textContent = picks.length;
    return;
  }

  // Unticking an event for publishing greys its grid card at once: the server only learns the selection at approval.
  const pick = ev.target.closest('input[data-edition]');

  if (pick) {
    const card = document.querySelector(
      `.grid-pick[data-pick="${CSS.escape(pick.dataset.edition + '|' + pick.value)}"]`,
    );

    if (card && !card.dataset.alwaysBlocked) {
      const tick = card.querySelector('input');
      card.classList.toggle('used', !pick.checked);
      tick.disabled = !pick.checked;

      if (!pick.checked) {
        tick.checked = false;
      }

      const count = $(`[data-grid-count="${CSS.escape(tick.dataset.grid)}"]`);

      if (count) {
        count.textContent = gridPicks(tick.dataset.grid).length;
      }

      let why = card.querySelector('.why');

      if (!pick.checked && !why) {
        why = document.createElement('small');
        why.className = 'why';
        why.textContent = 'left out of this weekend’s posts';
        card.querySelector('span').append(why);
      }

      if (pick.checked && why) {
        why.remove();
      }
    }

    return;
  }

  const box = ev.target.closest('input[data-also]');

  if (!box) {
    return;
  }

  const { also: id, index } = box.dataset;

  const dates = [...document.querySelectorAll(`input[data-also="${id}"][data-index="${index}"]:checked`)].map(
    x => x.value,
  );

  action(() => api(`/api/editions/${id}/events/${index}/also-on`, { alsoOn: dates }));
});

// Your footage: clips ChatGPT animates through the app's MCP tools. The page shows each clip, the pictures an
// edit can use, and what has been rendered, for you to watch and download.
let footageRenderable = false;
let footageSig = '';
let footageWatch = null;

const depthBusy = c => {
  return ['queued', 'running'].includes(c.depthJob?.status);
};

const clipBusy = c => {
  return ['uploading', 'processing'].includes(c.status) || depthBusy(c);
};

const renderBusy = r => {
  return ['queued', 'rendering'].includes(r.status);
};

const clipFile = (c, file) => {
  return `/footage/${c.id}/${file}`;
};

function renderRow(c, r) {
  const what =
    r.kind === 'stills'
      ? `Preview stills · edit v${r.version}`
      : `${r.requested?.quality === 'final' ? 'Video' : 'Draft video, half size'} · edit v${r.version}`;

  const state =
    r.status === 'queued'
      ? 'Waiting for the renderer…'
      : r.status === 'rendering'
        ? 'Rendering…'
        : r.status === 'failed'
          ? `<span class="error">Failed: ${esc(r.error || '')}</span>`
          : esc(riga(r.updated));

  const file = r.status === 'ready' && r.file;

  const sheet = r.sheet
    ? `<a href="${clipFile(c, `renders/${r.sheet}`)}" target="_blank" rel="noopener">`
      + `<img loading="lazy" src="${clipFile(c, `renders/${r.sheet}`)}" alt="Frames from this video"></a>`
    : '';

  const download = `${esc(c.name.replace(/\.[^.]+$/, ''))}-v${r.version}.mp4`;

  const media = !file
    ? ''
    : r.kind === 'stills'
      ? `<a href="${clipFile(c, `renders/${file}`)}" target="_blank" rel="noopener">`
        + `<img loading="lazy" src="${clipFile(c, `renders/${file}`)}" alt="Preview stills"></a>`
      : `<video controls playsinline preload="none" src="${clipFile(c, `renders/${file}`)}"></video>${sheet}`
        + `<a class="button-link" href="${clipFile(c, `renders/${file}`)}" download="${download}">Download MP4</a>`;

  return `<li><strong>${what}</strong><span class="job-state ${r.status}">${state}</span>${media}</li>`;
}

function clipCard(c) {
  const busy = c.renders.some(renderBusy);
  const last = c.edits[c.edits.length - 1];
  const ready = c.status === 'ready';

  const state = ready
    ? ''
    : c.status === 'failed'
      ? `<span class="tag missing">Failed</span> ${esc(c.error || '')}`
      : `<span class="tag ok">${c.status === 'uploading' ? 'Uploading' : 'Processing'}`
        + `${c.progress ? ` ${Math.round(c.progress * 100)}%` : '…'}</span>`;

  const meta = ready
    ? `${c.blank ? 'Animation · ' : ''}${c.seconds.toFixed(1)} s · ${c.width}×${c.height} · ${c.frames} frames at 30 `
      + `fps${c.audio ? ' · with sound' : ''}${c.source?.hdr ? ' · HDR, converted' : ''}`
    : '';

  const poster = c.blank
    ? `<div class="blank canvas"><span>${c.width}×${c.height}</span></div>`
    : ready
      ? `<a href="${clipFile(c, 'work.mp4')}" target="_blank" rel="noopener">`
        + `<img src="${clipFile(c, 'poster.jpg')}" alt="${esc(c.name)}"></a>`
      : '<div class="blank"></div>';

  const edit = last
    ? `Edit version ${last.version}${last.note ? ` · ${esc(last.note)}` : ''} · saved ${esc(riga(last.created))}`
    : c.blank
      ? 'No edit yet. In ChatGPT, ask it to make the animation.'
      : 'No edit yet. In ChatGPT, ask it to animate this clip.';

  // Every version kept, newest first, so you can see how an animation got to where it is.
  const history =
    c.edits.length > 1
      ? `<details class="versions"><summary>${c.edits.length} versions</summary><ol reversed>${c.edits
          .slice()
          .reverse()
          .map(
            v =>
              `<li><strong>v${v.version}</strong> · ${esc(riga(v.created))}`
                + `${v.note ? `<br><span class="hint">${esc(v.note)}</span>` : ''}</li>`,
          )
          .join('')}</ol></details>`
      : '';

  const pictures = c.assets
    .map(
      a =>
        `<figure><a href="${clipFile(c, `assets/${a.name}.png`)}?v=${stamp}" target="_blank" rel="noopener">`
          + `<img loading="lazy" src="${clipFile(c, `assets/${a.name}.png`)}?v=${stamp}" alt="${esc(a.name)}"></a>`
          + `<span>${esc(a.name)} · ${a.width}×${a.height}</span><button class="secondary small" `
          + `data-unasset="${c.id}" data-name="${esc(a.name)}">Remove</button></figure>`,
    )
    .join('');

  const models = (c.models || [])
    .map(
      m =>
        `<li><strong>${esc(m.name)}</strong> · `
          + `${m.animations.length ? `animations: ${m.animations.map(a => esc(a.name)).join(', ')}` : 'no animations'} `
          + `· ${m.mb} MB <button class="secondary small" data-unmodel="${c.id}" data-name="`
          + `${esc(m.name)}">Remove</button></li>`,
    )
    .join('');

  const sounds = (c.sounds || [])
    .map(
      x =>
        `<li><strong>${esc(x.name)}</strong> · ${x.seconds.toFixed(1)} s `
          + `<audio controls preload="none" src="${clipFile(c, `sounds/${x.name}.wav`)}?v=${stamp}"></audio> `
          + `<button class="secondary small" data-unsound="${c.id}" data-name="${esc(x.name)}">Remove</button></li>`,
    )
    .join('');

  const job = c.depthJob;
  const mid = c.depth ? String(Math.floor(c.depth.frames / 2)).padStart(5, '0') : null;

  // Only called while depth is being made, when the job is there to read.
  const busyDepth = () => {
    const step = job.status === 'queued'
      ? 'Waiting to make depth…'
      : `Making depth… ${Math.round((job.progress || 0) * 100)}%`;

    return `<span class="tag ok">${step}</span> about ${Math.max(1, Math.round(job.estimateSeconds / 60))} min in all`;
  };

  const depthState = depthBusy(c)
    ? busyDepth()
    : job?.status === 'failed'
      ? `<span class="tag missing">Depth failed</span> ${esc(job.error || '')}`
      : '';

  const depthNote = depthState ? `<p class="hint">${depthState}</p>` : '';

  const depthButton = `<button class="secondary small" data-depth="${c.id}"${depthBusy(c) ? ' disabled' : ''}>`
    + `${c.depth ? 'Make depth again' : 'Make depth'}</button>`;

  const depth = `${c.depth ? `<div class="pictures"><figure><a href="${clipFile(c, `depth/${mid}.jpg`)}?v=${stamp}" `
    + `target="_blank" rel="noopener"><img loading="lazy" src="${clipFile(c, `depth/${mid}.jpg`)}?v=${stamp}" `
    + `alt="Depth of frame ${Number(mid)}"></a><span>Depth for all ${c.depth.frames} frames · `
    + `${c.depth.source === 'server' ? 'made here' : 'uploaded'}</span></figure></div>` : ''}
      ${depthNote}${depthButton}`;

  const off = !last || !footageRenderable || busy ? ' disabled' : '';

  const renderButtons = '<div class="toolbar">'
    + `<button class="small" data-clip-render="${c.id}" data-quality="final"${off}>Render video</button>`
    + `<button class="secondary small" data-clip-render="${c.id}" data-quality="draft"${off}>`
    + 'Quick draft (half size)</button></div>';

  const picturesHint = 'Images an edit can use by name: an illustrated frame to line up over the footage, a logo, '
    + 'a drawing. PNG keeps transparency.';

  const modelsHint = 'Animated models (.glb, textures embedded) an edit can place in the shot, e.g. a cat that walks '
    + 'and sits.';

  const soundsHint = 'Sound effects and music an edit can place on exact frames: steps, a whoosh, a poof. MP3, WAV, '
    + 'OGG, FLAC or M4A, up to 3 minutes.';

  const depthHint = 'How far away each part of the shot is (near is white), so animations can pass behind things and '
    + 'edits can blur or fog by distance. Made on this server in a few minutes.';

  const modelRow = `${models ? `<ul class="models">${models}</ul>` : ''}`
    + `<button class="secondary small" data-model="${c.id}">Add 3D model</button>`;

  const soundRow = `${sounds ? `<ul class="models sounds">${sounds}</ul>` : ''}`
    + `<button class="secondary small" data-sound="${c.id}">Add sound</button>`;

  const notRenderable = '<p class="hint">The render service is not configured (RENDER_URL), so edits cannot '
    + 'be rendered here yet.</p>';

  // Everything below the clip's name that only a ready clip has: its edit, renders and the material edits use.
  const workshop = !ready ? '' : `<h4>Edit</h4><p class="hint">${edit}</p>${history}
      ${renderButtons}
      ${footageRenderable ? '' : notRenderable}
      <h4>Pictures</h4><p class="hint">${picturesHint}</p>
      <div class="pictures">${pictures}<button class="secondary small" data-asset="${c.id}">Add picture</button></div>
      <h4>3D models</h4><p class="hint">${modelsHint}</p>
      ${modelRow}
      <h4>Sounds</h4><p class="hint">${soundsHint}</p>
      ${soundRow}
      ${c.blank ? '' : `<h4>Depth</h4><p class="hint">${depthHint}</p>
      ${depth}`}`;

  const retry = c.status === 'failed'
    ? `<button class="secondary small" data-clip-retry="${c.id}">Retry processing</button>`
    : '';

  const deleteOff = busy || clipBusy(c) ? ' disabled' : '';

  const deleteButton = `<button class="secondary small" data-clip-delete="${c.id}"${deleteOff}>`
    + `Delete ${c.blank ? 'animation' : 'clip'}</button>`;

  return `<article class="clip">
    <div class="clip-poster">${poster}</div>
    <div>
      <h3>${esc(c.name)}</h3>
      <p class="meta">${meta} ${state}</p>
      <div class="id">Clip id ${c.id}</div>
      ${workshop}
      ${c.renders.length ? `<h4>Renders</h4><ul class="renders">`
        + `${c.renders.map(r => renderRow(c, r)).join('')}</ul>` : ''}
      <div class="toolbar">${retry}${deleteButton}</div>
    </div>
  </article>`;
}

// Redraw only when something changed, so a video you are watching is not reset by the refresh.
// Everything ever rendered, newest first, whatever it came from. Separate from the cards above, which
// only show a clip's own recent renders.
let renderSig = '';

function historyRow(r) {
  const what =
    r.kind === 'stills'
      ? `Preview stills · edit v${r.version}`
      : `${r.requested?.quality === 'final' ? 'Video' : 'Draft video, half size'} · edit v${r.version}`;

  const from = r.gone
    ? '<span class="tag missing">deleted</span>'
    : `${esc(r.name || r.footage)}${r.blank ? ' <span class="tag ok">animation</span>' : ''}`;

  const state =
    r.status === 'queued'
      ? 'Waiting for the renderer…'
      : r.status === 'rendering'
        ? 'Rendering…'
        : r.status === 'failed'
          ? `<span class="error">Failed: ${esc(r.error || '')}</span>`
          : esc(riga(r.updated));

  const file = r.status === 'ready' && r.file && !r.gone ? `/footage/${r.footage}/renders/${r.file}` : null;

  const open = !file
    ? ''
    : r.kind === 'stills'
      ? `<a href="${file}" target="_blank" rel="noopener">Open stills</a>`
      : `<a href="${file}" target="_blank" rel="noopener">Watch</a> `
        + `<a href="${file}" download="${esc((r.name || 'render').replace(/\.[^.]+$/, ''))}-v`
        + `${r.version}.mp4">Download</a>`;

  return `<tr><td>${esc(riga(r.created))}</td><td>${from}</td><td>${what}</td>`
    + `<td class="job-state ${r.status}">${state}</td><td>${open}</td></tr>`;
}

async function loadRenders() {
  const d = await api('/api/renders?limit=200');
  const sig = JSON.stringify(d.renders.map(r => [r.render, r.status]));

  if (sig === renderSig) {
    return d;
  }

  renderSig = sig;

  $('#renders').innerHTML = d.renders.length
    ? `<table class="history-table"><thead><tr><th>Made</th><th>From</th><th>What</th><th>How it went</th><th></th>`
      + `</tr></thead><tbody>${d.renders.map(historyRow).join('')}</tbody></table>`
    : '<p class="empty">Nothing has been rendered yet.</p>';

  return d;
}

function showFootage(d) {
  footageRenderable = d.renderConfigured;

  const sig = JSON.stringify(
    d.footage.map(c => [
      c.id,
      c.status,
      c.progress,
      c.name,
      c.edits.length,
      c.assets,
      c.models,
      c.sounds,
      c.depth,
      c.depthJob,
      c.renders.map(r => [r.render, r.status]),
    ]),
  );

  if (sig === footageSig) {
    return;
  }

  footageSig = sig;

  $('#clips').innerHTML = d.footage.length
    ? d.footage.map(clipCard).join('')
    : `<p class="empty">No footage yet. Upload a clip (up to ${d.limits.mb} MB and `
      + `${Math.round(d.limits.seconds / 60)} minutes) to start.</p>`;
}

async function loadFootage() {
  footageSig = '';
  const d = await api('/api/footage');
  showFootage(d);
  loadRenders().catch(() => {});

  if (d.footage.some(c => clipBusy(c) || c.renders.some(renderBusy))) {
    watchFootage();
  }
}

function watchFootage() {
  if (footageWatch) {
    return;
  }

  footageWatch = setInterval(async () => {
    try {
      const d = await api('/api/footage');
      showFootage(d);

      if (!d.footage.some(c => clipBusy(c) || c.renders.some(renderBusy))) {
        clearInterval(footageWatch);
        footageWatch = null;
      }
    } catch {}
  }, 4000);
}

const pickFile = accept =>
  new Promise(ok => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;

    input.onchange = () => {
      ok(input.files[0] || null);
    };

    input.click();
  });

// Uploads stream to the server, so a large clip shows its progress instead of a frozen page.
function sendFile(url, file) {
  return new Promise((ok, fail) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    x.upload.onprogress = e => {
      if (e.lengthComputable) {
        $('#status').textContent = `Uploading ${file.name}… ${Math.round((e.loaded / e.total) * 100)}%`;
      }
    };

    x.onload = () => {
      let d = {};

      try {
        d = JSON.parse(x.responseText);
      } catch {}

      if (x.status < 300) {
        ok(d);
      } else {
        fail(Error(d.error || `Upload failed (HTTP ${x.status})`));
      }
    };

    x.onerror = () => {
      fail(Error('Upload failed: the connection dropped'));
    };

    x.send(file);
  });
}

const removeAt = async url => {
  const r = await fetch(url, { method: 'DELETE' });
  const d = await r.json();

  if (!r.ok) {
    throw Error(d.error || 'Could not remove it');
  }
};

function footageClick(b) {
  if (b.id === 'upload-footage') {
    pickFile('video/*').then(f => {
      if (f) {
        action(() => sendFile(`/api/footage?name=${encodeURIComponent(f.name)}`, f));
      }
    });

    return true;
  }

  // An animation with no clip behind it: ChatGPT fills it in afterwards, like any other edit.
  if (b.id === 'new-animation') {
    const name = prompt('What is this animation? (a name for the dashboard)', 'Animation');

    if (!name) {
      return true;
    }

    const format = prompt('Shape: vertical, portrait, square or landscape', 'vertical');

    if (!format) {
      return true;
    }

    const seconds = Number(prompt('How many seconds?', '6'));

    action(() =>
      api('/api/animations', { name: name.trim(), format: format.trim(), seconds: seconds > 0 ? seconds : 6 }),
    );

    return true;
  }

  if (b.dataset.asset) {
    pickFile('image/png,image/jpeg,image/webp').then(f => {
      if (!f) {
        return;
      }

      const suggested =
        f.name
          .replace(/\.[^.]+$/, '')
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 32) || 'picture';

      const name = prompt(
        'Name for this picture (lowercase letters, digits and dashes). ChatGPT refers to it by this name.',
        suggested,
      );

      if (name) {
        action(() => sendFile(`/api/footage/${b.dataset.asset}/assets/${encodeURIComponent(name.trim())}`, f));
      }
    });

    return true;
  }

  if (b.dataset.model) {
    pickFile('.glb,model/gltf-binary').then(f => {
      if (!f) {
        return;
      }

      const suggested =
        f.name
          .replace(/\.[^.]+$/, '')
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 32) || 'model';

      const name = prompt(
        'Name for this model (lowercase letters, digits and dashes). ChatGPT refers to it by this name.',
        suggested,
      );

      if (name) {
        action(() => sendFile(`/api/footage/${b.dataset.model}/models/${encodeURIComponent(name.trim())}`, f));
      }
    });

    return true;
  }

  if (b.dataset.sound) {
    pickFile('audio/*,.mp3,.wav,.ogg,.flac,.m4a').then(f => {
      if (!f) {
        return;
      }

      const suggested =
        f.name
          .replace(/\.[^.]+$/, '')
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 32) || 'sound';

      const name = prompt(
        'Name for this sound (lowercase letters, digits and dashes). ChatGPT refers to it by this name.',
        suggested,
      );

      if (name) {
        action(() => sendFile(`/api/footage/${b.dataset.sound}/sounds/${encodeURIComponent(name.trim())}`, f));
      }
    });

    return true;
  }

  if (b.dataset.unsound) {
    if (confirm(`Remove the sound "${b.dataset.name}"? Edits that use it will not render until it is back.`)) {
      action(() => removeAt(`/api/footage/${b.dataset.unsound}/sounds/${b.dataset.name}`));
    }

    return true;
  }

  if (b.dataset.unmodel) {
    if (confirm(`Remove the model "${b.dataset.name}"? Edits that use it will not render until it is back.`)) {
      action(() => removeAt(`/api/footage/${b.dataset.unmodel}/models/${b.dataset.name}`));
    }

    return true;
  }

  if (b.dataset.unasset) {
    if (confirm(`Remove the picture "${b.dataset.name}"? Edits that use it will not render until it is back.`)) {
      action(() => removeAt(`/api/footage/${b.dataset.unasset}/assets/${b.dataset.name}`));
    }

    return true;
  }

  if (b.dataset.depth) {
    action(async () => {
      await api(`/api/footage/${b.dataset.depth}/depth`, {});
      watchFootage();
    });

    return true;
  }

  if (b.dataset.clipRender) {
    action(() => api(`/api/footage/${b.dataset.clipRender}/renders`, { quality: b.dataset.quality }));
    return true;
  }

  if (b.dataset.clipRetry) {
    action(() => api(`/api/footage/${b.dataset.clipRetry}/retry`, {}));
    return true;
  }

  if (b.dataset.clipDelete) {
    if (
      confirm(
        'Delete this clip with its edits, pictures, models, sounds and renders? Download '
          + 'anything you want to keep first.',
      )
    ) {
      action(() => removeAt(`/api/footage/${b.dataset.clipDelete}`));
    }

    return true;
  }

  return false;
}

load().catch(e => {
  $('#status').textContent = e.message;
});

// ---- Animations -------------------------------------------------------------------------------
// A separate panel with its own status line and its own poll loop: a clip render has nothing to do
// with an edition, and sharing load() would redraw every grid tick on the other tab while it runs.
const animStatus = (msg, bad) => {
  const el = $('#anim-status');
  el.textContent = msg || '';
  el.className = bad ? 'error' : '';
};

async function animAction(fn) {
  try {
    animStatus('Working…');
    await fn();
    await loadAnimations();
    animStatus('Done.');
  } catch (e) {
    animStatus(e.message, true);
  }
}

function animationCard(a) {
  const src = `/media/animations/${a.id}.mp4?v=${stamp}`;

  const state =
    a.status === 'ready'
      ? 'Ready'
      : a.status === 'rendering'
        ? 'Rendering…'
        : a.status === 'failed'
          ? `Failed — ${a.error || 'unknown error'}`
          : 'Not rendered yet';

  const ready = a.status === 'ready';

  const head = `<h3>${esc(a.name)}</h3><span class="tag">${esc(a.composition)}</span>`
    + `<span class="job-state">${esc(state)}</span>`;

  const renderOff = a.status === 'rendering' ? ' disabled' : '';
  const sendOff = ready ? '' : ' disabled';

  return `<article class="anim">
    <div class="anim-head">${head}</div>
    ${ready ? `<video class="grid-video" src="${src}" controls preload="metadata" playsinline></video>` : ''}
    ${a.caption ? `<div class="copy"><details><summary>Caption</summary><pre>`
      + `${esc(a.caption)}</pre></details></div>` : ''}
    ${a.postiz ? `<p class="hint">Sent to Postiz as a ${esc(a.postiz.kind)} `
      + `draft${postizUrl ? ` — <a href="${esc(postizUrl)}" target="_blank" rel="noopener">open Postiz</a>` : ''}. `
      + `Nothing publishes until you schedule it there.</p>` : ''}
    <div class="grid-send">
      <button data-anim-render="${esc(a.id)}"${renderOff}>${ready ? 'Render again' : 'Render'}</button>
      <button class="secondary" data-anim-postiz="${esc(a.id)}" data-kind="story"${sendOff}>Send as Story</button>
      <button class="secondary" data-anim-postiz="${esc(a.id)}" data-kind="reel"${sendOff}>Send as Reel</button>
      <button class="secondary small" data-anim-delete="${esc(a.id)}">Delete</button>
    </div>
  </article>`;
}

async function loadAnimations() {
  stamp = Date.now();
  const list = await api('/api/animations');

  if (!renderConfigured) {
    animStatus('The render service is not configured (RENDER_URL); clips cannot be rendered here.', true);
  }

  $('#animations').innerHTML = list.length
    ? list.map(animationCard).join('')
    : '<p class="empty">No animations yet. Add one above — the composition must match an ID registered in '
      + '<code>remotion/src/Root.tsx</code>, such as <code>PressStory</code>.</p>';

  if (list.some(a => a.status === 'rendering')) {
    watchAnimations();
  }
}

let animWatch = null;

function watchAnimations() {
  if (animWatch) {
    return;
  }

  animWatch = setInterval(async () => {
    try {
      const l = await api('/api/animations');

      if (!l.some(a => a.status === 'rendering')) {
        clearInterval(animWatch);
        animWatch = null;
        await loadAnimations();
      }
    } catch {}
  }, 4000);
}

function showPanel(name) {
  for (const p of ['editions', 'animations', 'relay']) {
    document.getElementById(`panel-${p}`).hidden = p !== name;
    document.getElementById(`tab-btn-${p}`).setAttribute('aria-selected', String(p === name));
  }

  if (name === 'animations') {
    loadAnimations().catch(e => animStatus(e.message, true));
  }

  if (name === 'relay') {
    relaySig = '';
    loadRelay().catch(e => relayStatus(e.message, true));
    watchRelay();
  }
}

document.querySelectorAll('.tab').forEach(b => {
  b.onclick = () => {
    showPanel(b.dataset.panel);
  };
});

$('#anim-new').addEventListener('submit', ev => {
  ev.preventDefault();

  animAction(async () => {
    await api('/api/animations', {
      name: $('#anim-name').value.trim(),
      composition: $('#anim-comp').value.trim(),
      caption: $('#anim-caption').value,
      holdSeconds: Number($('#anim-hold').value) || 5,
    });

    $('#anim-name').value = '';
    $('#anim-caption').value = '';
  });
});

document.addEventListener('click', ev => {
  const b = ev.target.closest('button');

  if (!b) {
    return;
  }

  if (b.dataset.animRender) {
    return void animAction(() => api(`/api/animations/${b.dataset.animRender}/render`, {}));
  }

  if (b.dataset.animPostiz) {
    return void animAction(() => api(`/api/animations/${b.dataset.animPostiz}/postiz`, { kind: b.dataset.kind }));
  }

  if (b.dataset.animDelete) {
    if (!confirm('Delete this animation and its rendered file?')) {
      return;
    }

    return void animAction(async () => {
      const r = await fetch(`/api/animations/${b.dataset.animDelete}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));

      if (!r.ok) {
        throw Error(d.error || 'Delete failed');
      }
    });
  }
});

// ---- ChatGPT ↔ Claude ---------------------------------------------------------------------------
// The relay threads, checked every few seconds while this tab is open. The list is only redrawn when a
// thread moved on, and never while an answer box holds text, so nothing you are typing is lost.
const PARTY = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', owner: 'You' };

const VERDICT = {
  ask: 'asks',
  answer: 'answers',
  revise: 'revised it',
  accept: 'accepts',
  reject: 'rejects',
  note: 'note',
};

let relaySig = '';
let relayWatch = null;
let relayFirst = true;

const relayStatus = (msg, bad) => {
  const el = $('#relay-status');
  el.textContent = msg || '';
  el.className = bad ? 'error' : '';
};

async function relayAction(fn) {
  try {
    relayStatus('Sending…');
    await fn();
    relaySig = '';
    await loadRelay();
    relayStatus('Sent.');
  } catch (e) {
    relayStatus(e.message, true);
  }
}

const refsText = r =>
  [r.edition && `edition ${r.edition}`, r.footage && `clip ${r.footage}${r.version ? ` v${r.version}` : ''}`]
    .filter(Boolean)
    .join(' · ');

function relayMessage(m) {
  const payload =
    m.payload === undefined
      ? ''
      : `<details><summary>${m.changes ? 'The revised payload' : 'The payload'}</summary>`
        + `<pre>${esc(typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload, null, 2))}</pre></details>`;

  const refs = m.refs ? `<span class="short">${esc(refsText(m.refs))}</span>` : '';

  const meta = `<strong>${PARTY[m.from] || esc(m.from)}</strong>`
    + `<span class="tag">${esc(VERDICT[m.verdict] || m.verdict)}</span>`
    + `<span class="job-state">${esc(riga(m.at))}</span>${refs}`;

  return `<li class="relay-msg from-${esc(m.from)}"><div class="relay-meta">${meta}</div>
    <p class="relay-text">${esc(m.text)}</p>${m.changes?.length ? `<ul class="relay-changes">`
      + `${m.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}${payload}</li>`;
}

function relayThread(t) {
  const state =
    t.status === 'closed'
      ? '<span class="tag">Closed</span>'
      : t.turn === 'owner'
        ? '<span class="tag missing">Waiting for you</span>'
        : `<span class="tag ok">${PARTY[t.turn]}’s turn</span>`;

  const key = `relay-${t.thread}`;
  const open = openGrids.has(key) ? ' open' : '';
  const messageCount = `${t.messages.length} ${t.messages.length === 1 ? 'message' : 'messages'}`;
  const details = `${esc(t.want)} · opened by ${PARTY[t.openedBy]} · ${messageCount} · ${esc(riga(t.updated))}`;
  const summary = `#${t.thread} · ${esc(t.title)} ${state} <span class="job-state">${details}</span>`;

  const answer = `<textarea rows="3" data-relay-text="${t.thread}" aria-label="Your answer in thread ${t.thread}" `
    + 'placeholder="Step in: an answer, a decision or an instruction"></textarea>';

  const close = t.status === 'open'
    ? `<button class="secondary small" data-relay-close="${t.thread}">Close the thread</button>`
    : '';

  const buttons = `<button class="small" data-relay-send="${t.thread}" data-to="chatgpt">Send to ChatGPT</button>`
    + `<button class="small" data-relay-send="${t.thread}" data-to="claude">Send to Claude</button>`
    + `<button class="small" data-relay-send="${t.thread}" data-to="gemini">Send to Gemini</button>`
    + `<button class="secondary small" data-relay-send="${t.thread}" data-to="">Add a note</button>${close}`;

  return `<details class="older relay-thread" data-open-key="${key}"${open}><summary>${summary}</summary>
    <ol class="relay-msgs">${t.messages.map(relayMessage).join('')}</ol>
    <div class="relay-answer">${answer}
    <div class="grid-send">${buttons}</div></div></details>`;
}

async function loadRelay() {
  const d = await api('/api/relay');

  if (relayFirst && d.threads[0]) {
    openGrids.add(`relay-${d.threads[0].thread}`);
    relayFirst = false;
  }

  const sig = JSON.stringify(d.threads.map(t => [t.thread, t.status, t.turn, t.messages.length]));

  if (sig === relaySig || [...document.querySelectorAll('[data-relay-text]')].some(x => x.value.trim())) {
    return;
  }

  relaySig = sig;

  $('#relay').innerHTML = d.threads.length
    ? d.threads.map(relayThread).join('')
    : '<p class="empty">No threads yet. Connect Claude to this app as well as ChatGPT (see <code>docs/claude-relay.md'
      + '</code>), then ask either one to get the other’s review of something.</p>';
}

function watchRelay() {
  if (relayWatch) {
    return;
  }

  relayWatch = setInterval(() => {
    if ($('#panel-relay').hidden) {
      clearInterval(relayWatch);
      relayWatch = null;
      return;
    }

    loadRelay().catch(() => {});
  }, 5000);
}

document.addEventListener('click', ev => {
  const b = ev.target.closest('button');

  if (!b) {
    return;
  }

  if (b.dataset.relaySend) {
    const id = b.dataset.relaySend;
    const box = document.querySelector(`[data-relay-text="${id}"]`);
    const text = box.value.trim();

    if (!text) {
      return void relayStatus('Write something to send first.', true);
    }

    return void relayAction(async () => {
      await api(`/api/relay/${id}`, { text, ...(b.dataset.to ? { to: b.dataset.to } : {}) });
      box.value = '';
    });
  }

  if (b.dataset.relayClose) {
    return void relayAction(() => api(`/api/relay/${b.dataset.relayClose}`, { close: true }));
  }
});
