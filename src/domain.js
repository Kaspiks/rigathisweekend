import { z } from 'zod';
import { DateTime } from 'luxon';
import { createHash } from 'node:crypto';

export const ZONE = 'Europe/Riga';

// When an event starts, on Riga's clock.
const localStart = event => {
  return DateTime.fromISO(event.startsAt).setZone(ZONE);
};

// A calendar date (2025-06-13) as the start of that day in Riga.
const rigaDay = date => {
  return DateTime.fromISO(date, { zone: ZONE });
};

export const Event = z.object({
  title: z.string().trim().min(3).max(100),
  startsAt: z.string().datetime({ offset: true }),
  venue: z.string().trim().min(2).max(90),
  price: z.string().trim().min(1).max(60),
  summary: z.string().trim().min(5).max(220),
  sourceUrl: z.string().url().max(500).refine(v => /^https:\/\//.test(v), 'HTTPS source required'),
  // Optional: a specific organiser photo. Omitted, the renderer reads the sharing image off sourceUrl.
  imageUrl: z.string().url().max(500).refine(v => /^https:\/\//.test(v), 'HTTPS image required').optional(),
  // Which languages the event suits, shown as a tag on the card.
  languages: z.array(z.enum(['EN', 'LV', 'RU'])).min(1).max(3).optional(),
  // Other days the event is also on (an exhibition, a festival, a repeated show): any day from the Monday
  // to the Sunday of the weekend's week. It is listed once, on its first or main day; the other days only
  // appear in the day tag on its slides.
  alsoOn: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(6).optional(),
});

export const Submission = z.object({
  weekend: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // A special post (Researchers' Night, a festival day): your own heading, drawn on each cover above the
  // date and opening each caption. It is published alongside the regular post for the same day.
  headline: z.string().trim().min(3).max(40).optional(),
  // A submission is a candidate list to choose from, so it is deliberately generous.
  // What one post can actually show is enforced at approval instead.
  events: z.array(Event).min(1).max(60),
});

export function weekendFor(now = DateTime.now()) {
  const local = now.setZone(ZONE).startOf('day');
  return local.plus({ days: 5 - local.weekday }).toISODate();
}

export function validateSubmission(input) {
  const data = Submission.parse(input);
  const friday = rigaDay(data.weekend);

  if (!friday.isValid || friday.weekday !== 5) {
    throw new Error('Weekend must be a valid Friday date');
  }

  const end = friday.plus({ days: 3 });
  const seen = new Set();

  for (const event of data.events) {
    const date = localStart(event);

    if (date < friday || date >= end) {
      throw new Error(`Event outside Friday–Sunday: ${event.title}`);
    }

    if (event.alsoOn) {
      const days = checkAlsoOn(data.weekend, event, event.alsoOn);

      if (days.length) {
        event.alsoOn = days;
      } else {
        delete event.alsoOn;
      }
    }

    const key = `${event.title.toLocaleLowerCase()}|${date.toISO()}|${event.venue.toLocaleLowerCase()}`;

    if (seen.has(key)) {
      throw new Error(`Duplicate event: ${event.title}`);
    }

    seen.add(key);
  }

  data.events.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.title.localeCompare(b.title));
  return data;
}

export const digest = data => {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 24);
};

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = text => {
  return String(text).replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
};

export function eventTime(event) {
  return localStart(event).setLocale('en').toFormat('ccc, dd LLL · HH:mm');
}

// The grid puts every card of one day on screen at once, so its tiles carry the clock time alone.
export const eventClock = event => {
  return localStart(event).setLocale('en').toFormat('HH:mm');
};

// The weekend grid mixes days, so its tiles need the weekday as well: "Sun 10:00".
export const eventDayClock = event => {
  return localStart(event).setLocale('en').toFormat('ccc HH:mm');
};

// The story grid that draws from the whole weekend is stored and addressed under this key instead of a date.
export const WEEKEND_GRID = 'weekend';

export const languageTag = event => {
  return event.languages?.length ? event.languages.join(' · ') : null;
};

export const weekendDays = weekend => {
  return [0, 1, 2].map(n => rigaDay(weekend).plus({ days: n }).toISODate());
};

// The days a day tag can name: Monday to Sunday of the weekend's week. Seven days, so each weekday is unambiguous.
export const tagDays = weekend => {
  return [-4, -3, -2, -1, 0, 1, 2].map(n => rigaDay(weekend).plus({ days: n }).toISODate());
};

// Valid "also on" days are other days of the same Monday–Sunday week, never the event's own day.
export function checkAlsoOn(weekend, event, dates) {
  if (dates == null) {
    return [];
  }

  const own = localStart(event).toISODate();
  const days = tagDays(weekend);
  const clean = [...new Set(dates)].sort();

  for (const date of clean) {
    if (!days.includes(date)) {
      throw new Error(`"Also on" must be another day of this week, Monday to Sunday: ${date} is not`);
    }

    if (date === own) {
      throw new Error(`"Also on" cannot repeat the event's own day (${date})`);
    }
  }

  return clean;
}

// "Friday", "Friday and Sunday", "Thursday, Friday and Sunday".
const joinDays = names => {
  if (names.length < 2) {
    return names[0];
  }

  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

export const alsoOnLabel = event => {
  if (!event.alsoOn?.length) {
    return null;
  }

  const weekdays = [...new Set(event.alsoOn)].sort().map(date => rigaDay(date).setLocale('en').toFormat('cccc'));
  return `Also on ${joinDays(weekdays)}`;
};

export const multiDay = event => {
  return !!event.alsoOn?.length;
};

// The days an event is on, for the day tag on its slides: "FRI · SAT · SUN", or "THU · SAT". Four or more
// days in a row shorten to a range ("WED–SUN"), so the tag never grows wider than the corner it sits in.
export function dayTag(event) {
  const days = [...new Set([localStart(event).toISODate(), ...(event.alsoOn || [])])].sort().map(rigaDay);

  const name = day => {
    return day.setLocale('en').toFormat('ccc').toUpperCase();
  };

  const runs = [];

  for (const day of days) {
    const run = runs[runs.length - 1];

    if (run && day.diff(run[run.length - 1], 'days').days === 1) {
      run.push(day);
    } else {
      runs.push([day]);
    }
  }

  return runs
    .map(run => run.length >= 4 ? `${name(run[0])}–${name(run[run.length - 1])}` : run.map(name).join(' · '))
    .join(' · ');
}

export const eventDate = event => {
  return localStart(event).toISODate();
};

// A weekend is over once its Sunday has passed in Riga; those editions are kept but no longer listed.
export const weekendOver = (weekend, now = DateTime.now()) => {
  return rigaDay(weekend).plus({ days: 3 }) <= now;
};

export const dayName = date => {
  return rigaDay(date).setLocale('en').toFormat('cccc d LLLL');
};

// Instagram gets one post per day of the weekend, so events are grouped by their Riga date.
// The original index is carried along because rendered files are named by it.
// `selected` is an optional list of event indexes chosen at approval; null means every event.
// Indexes are kept alongside each event because rendered files are named by them.
export function chosen(data, selected = null) {
  const all = data.events.map((event, index) => ({ event, index }));
  return selected ? all.filter(item => selected.includes(item.index)) : all;
}

export function eventsByDay(data, selected = null) {
  const days = new Map();

  for (const item of chosen(data, selected)) {
    const date = eventDate(item.event);

    if (!days.has(date)) {
      days.set(date, []);
    }

    days.get(date).push(item);
  }

  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({ date, items }));
}

export function eventsOn(data, date, selected = null) {
  const day = eventsByDay(data, selected).find(d => d.date === date);

  if (!day) {
    throw new Error(`No events on ${date}`);
  }

  return day;
}

export const isSpecial = data => {
  return !!data.headline;
};

export function whatsappText(data, selected = null) {
  const heading = data.headline ? `${data.headline.toUpperCase()} · RĪGA` : 'RĪGA THIS WEEKEND';

  const entries = chosen(data, selected).map(({ event }, i) => {
    const languages = languageTag(event) ? ` · ${languageTag(event)}` : '';

    return `${i + 1}. ${event.title}\n${eventTime(event)}\n${event.venue} · ${event.price}${languages}\n`
      + `${event.summary}\n${event.sourceUrl}`;
  });

  return `${heading} · ${data.weekend}\n\n` + entries.join('\n\n')
    + '\n\nCheck the organiser’s page for changes before heading out.';
}

// Instagram caps captions at 2,200 characters, so organiser links degrade to bare hostnames,
// and then drop out entirely, rather than making an otherwise valid edition unpublishable.
function buildCaption(head, events, shorten = null) {
  const tails = {
    full: '\n\nSave this for the weekend. Check organisers for updates.\n#Riga #RigaEvents #Rīga',
    tags: '\n\n#Riga #RigaEvents #Rīga',
    none: '',
  };

  const host = url => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  };

  const trim = (text, n) => {
    return text.length <= n ? text : text.slice(0, n - 1).replace(/[\s,;:.\u2013-]+$/, '') + '\u2026';
  };

  // The slide already shows the title, date, venue, price and languages, and carries the same
  // number as its caption entry. With short links, whole descriptions come first: on a very busy
  // post the titles go, then the closing line, then the hashtags, and only then is any description
  // shortened. Without short links, full organiser links are kept and descriptions give way instead.
  const short = event => {
    return shorten(event.sourceUrl);
  };

  const ladder = shorten ? [
    { title: true,  detail: 220, link: short, tail: 'full' },
    { title: false, detail: 220, link: short, tail: 'full' },
    { title: false, detail: 220, link: short, tail: 'tags' },
    { title: false, detail: 220, link: short, tail: 'none' },
    { title: false, detail: 140, link: short, tail: 'none' },
    { title: false, detail: 0,   link: short, tail: 'none' },
  ] : [
    { title: true,  detail: 220, link: event => event.sourceUrl, tail: 'full' },
    { title: false, detail: 220, link: event => event.sourceUrl, tail: 'full' },
    { title: false, detail: 140, link: event => event.sourceUrl, tail: 'full' },
    { title: false, detail: 90,  link: event => event.sourceUrl, tail: 'full' },
    { title: false, detail: 0,   link: event => event.sourceUrl, tail: 'full' },
    { title: false, detail: 0,   link: event => host(event.sourceUrl), tail: 'full' },
  ];

  for (const step of ladder) {
    const text = head + events.map((event, i) => {
      const link = step.link(event);
      const detail = step.detail ? trim(event.summary, step.detail) : '';

      const lines = [
        step.title ? `${i + 1}. ${event.title}` : `${i + 1}.${detail ? ` ${detail}` : ''}`,
        step.title && detail ? detail : null,
        link,
      ].filter(Boolean);

      return lines.join('\n');
    }).join('\n\n') + tails[step.tail];

    if (text.length <= 2200) {
      return text;
    }
  }

  throw new Error('Instagram caption exceeds 2,200 characters');
}

// The whole-weekend caption is the longest one an edition can produce, so validating it
// on submit also guarantees every per-day caption fits.
export const caption = data => {
  return buildCaption(`${headlinePrefix(data)}Your Riga weekend, sorted.\n\n`, data.events);
};

const headlinePrefix = data => {
  return data.headline ? `${data.headline} · ` : '';
};

const captionHead = (data, post) => {
  return `${headlinePrefix(data)}${postName(post)} in Rīga.\n\n`;
};

// `shorten` turns an organiser URL into its short link; omit it to print full links.
export const postCaption = (data, post, shorten = null) =>
  buildCaption(captionHead(data, post), post.items.map(item => item.event), shorten);

// Reviewing a long candidate list must never fail. Publishing still uses the strict caption,
// so an unpublishable post is reported on the review page rather than blocking the import.
export function postCaptionPreview(data, post, shorten = null) {
  try {
    return postCaption(data, post, shorten);
  } catch (err) {
    return `${captionHead(data, post)}[${post.items.length} events. ${err.message}. Untick some before approving.]`;
  }
}

// Meta's content publishing API caps a carousel at 10 slides and the date cover takes one,
// so a busy day is split across several posts rather than forcing events to be dropped.
export const SLIDES_PER_POST = 9;
export const POST_GAP_MINUTES = 30;
export const LEAD_MINUTES = 60;
// Regular posts go out from 09:00; a special post goes out at noon, so it does not land on top of the day's own post.
export const POST_HOUR = 9;
export const SPECIAL_POST_HOUR = 12;

export function postsFor(data, selected = null) {
  const posts = [];

  for (const day of eventsByDay(data, selected)) {
    const parts = Math.max(1, Math.ceil(day.items.length / SLIDES_PER_POST));

    for (let i = 0; i < parts; i++) {
      posts.push({
        date: day.date,
        part: i + 1,
        parts,
        dayTotal: day.items.length,
        items: day.items.slice(i * SLIDES_PER_POST, (i + 1) * SLIDES_PER_POST),
      });
    }
  }

  return posts;
}

export function postOn(data, date, part, selected = null) {
  const post = postsFor(data, selected).find(p => p.date === date && p.part === part);

  if (!post) {
    throw new Error(`No post ${part} on ${date}`);
  }

  return post;
}

export const postTarget = post => {
  return `instagram_feed:${post.date}#${post.part}`;
};

export const postName = post => {
  return `${dayName(post.date)}${post.parts > 1 ? `, post ${post.part} of ${post.parts}` : ''}`;
};

// What is actually going out has to fit: checked when you approve a selection, not on submit.
export function validatePublication(data, selected = null) {
  const posts = postsFor(data, selected);

  if (!posts.length) {
    throw new Error('Select at least one event to publish');
  }

  for (const post of posts) {
    postCaption(data, post);
  }

  return posts;
}

// The intended publish time of each Instagram item. Approval hands them to Postiz straight away:
// carousels scheduled for these times, stories as drafts, and you move either in Postiz.
// WhatsApp is not planned here; it is sent when you press its button.
export function plannedJobs(data, now = DateTime.now(), selected = null, stories = []) {
  const at = time => {
    return DateTime.max(time, now).toUTC().toISO();
  };

  const nine = date => {
    return rigaDay(date).set({ hour: POST_HOUR });
  };

  const opening = date => {
    return rigaDay(date).set({ hour: data.headline ? SPECIAL_POST_HOUR : POST_HOUR });
  };

  const leadIn = event => {
    return localStart(event).minus({ minutes: LEAD_MINUTES });
  };

  const before = (time, events) => {
    return DateTime.min(time, ...events.map(leadIn));
  };

  const wanted = new Set(stories || []);

  return [
    // Parts of a busy day go out half an hour apart from 09:00, and always at least an hour before
    // their own first event: a post is never published once one of its events has begun.
    ...postsFor(data, selected).map(post => {
      const spaced = opening(post.date).plus({ minutes: (post.part - 1) * POST_GAP_MINUTES });
      const first = DateTime.min(...post.items.map(item => localStart(item.event))).minus({ minutes: LEAD_MINUTES });
      return { target: postTarget(post), due: at(DateTime.min(spaced, first)) };
    }),
    // Stories are opt-in per event, dated for that event's morning or an hour before it.
    ...chosen(data, selected)
      .filter(({ index }) => wanted.has(index))
      .map(({ event, index }) => ({
        target: `instagram_story:${index}`,
        due: at(before(nine(eventDate(event)), [event])),
      })),
  ];
}
