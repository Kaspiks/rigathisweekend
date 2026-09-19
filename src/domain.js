import { z } from 'zod';
import { DateTime } from 'luxon';
import { createHash } from 'node:crypto';

export const ZONE = 'Europe/Riga';
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
  languages: z.array(z.enum(['EN','LV','RU'])).min(1).max(3).optional(),
  // Other days this weekend the event is also on (an exhibition, a festival, a repeated show).
  // It is listed once, on its first or main day; the day tag on its slides shows all of them.
  alsoOn: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(2).optional(),
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
  const friday = DateTime.fromISO(data.weekend, { zone: ZONE });
  if (!friday.isValid || friday.weekday !== 5) throw new Error('Weekend must be a valid Friday date');
  const end = friday.plus({ days: 3 });
  const seen = new Set();
  for (const e of data.events) {
    const date = DateTime.fromISO(e.startsAt).setZone(ZONE);
    if (date < friday || date >= end) throw new Error(`Event outside Friday–Sunday: ${e.title}`);
    if (e.alsoOn) { const days = checkAlsoOn(data.weekend, e, e.alsoOn); if (days.length) e.alsoOn = days; else delete e.alsoOn; }
    const key = `${e.title.toLocaleLowerCase()}|${date.toISO()}|${e.venue.toLocaleLowerCase()}`;
    if (seen.has(key)) throw new Error(`Duplicate event: ${e.title}`);
    seen.add(key);
  }
  data.events.sort((a,b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.title.localeCompare(b.title));
  return data;
}
export const digest = data => createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0,24);
export const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function eventTime(e) { return DateTime.fromISO(e.startsAt).setZone(ZONE).setLocale('en').toFormat('ccc, dd LLL · HH:mm'); }
// The grid puts every card of one day on screen at once, so its tiles carry the clock time alone.
export const eventClock = e => DateTime.fromISO(e.startsAt).setZone(ZONE).setLocale('en').toFormat('HH:mm');
export const languageTag = e => (e.languages?.length ? e.languages.join(' · ') : null);
export const weekendDays = weekend => [0, 1, 2].map(n => DateTime.fromISO(weekend, { zone: ZONE }).plus({ days: n }).toISODate());
// Valid "also on" days are other days of the same Friday–Sunday, never the event's own day.
export function checkAlsoOn(weekend, event, dates) {
  if (dates == null) return [];
  const own = DateTime.fromISO(event.startsAt).setZone(ZONE).toISODate(), days = weekendDays(weekend);
  const clean = [...new Set(dates)].sort();
  for (const d of clean) {
    if (!days.includes(d)) throw new Error(`"Also on" must be another day of this weekend: ${d} is not`);
    if (d === own) throw new Error(`"Also on" cannot repeat the event's own day (${d})`);
  }
  return clean;
}
const joinDays = xs => xs.length < 2 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
export const alsoOnLabel = e => e.alsoOn?.length ? `Also on ${joinDays([...new Set(e.alsoOn)].sort().map(d => DateTime.fromISO(d, { zone: ZONE }).setLocale('en').toFormat('cccc')))}` : null;
export const multiDay = e => !!e.alsoOn?.length;
// The weekend days an event is on, for the day tag on its slides: "FRI · SAT · SUN".
export const dayTag = e => [...new Set([DateTime.fromISO(e.startsAt).setZone(ZONE).toISODate(), ...(e.alsoOn || [])])].sort()
  .map(d => DateTime.fromISO(d, { zone: ZONE }).setLocale('en').toFormat('ccc').toUpperCase()).join(' · ');
export const eventDate = e => DateTime.fromISO(e.startsAt).setZone(ZONE).toISODate();
// A weekend is over once its Sunday has passed in Riga; those editions are kept but no longer listed.
export const weekendOver = (weekend, now = DateTime.now()) => DateTime.fromISO(weekend, { zone: ZONE }).plus({ days: 3 }) <= now;
export const dayName = date => DateTime.fromISO(date, { zone: ZONE }).setLocale('en').toFormat('cccc d LLLL');
// Instagram gets one post per day of the weekend, so events are grouped by their Riga date.
// The original index is carried along because rendered files are named by it.
// `selected` is an optional list of event indexes chosen at approval; null means every event.
// Indexes are kept alongside each event because rendered files are named by them.
export function chosen(data, selected = null) {
  const all = data.events.map((event, index) => ({ event, index }));
  return selected ? all.filter(x => selected.includes(x.index)) : all;
}
export function eventsByDay(data, selected = null) {
  const days = new Map();
  for (const item of chosen(data, selected)) {
    const date = eventDate(item.event);
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(item);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({ date, items }));
}
export function eventsOn(data, date, selected = null) {
  const day = eventsByDay(data, selected).find(d => d.date === date);
  if (!day) throw new Error(`No events on ${date}`);
  return day;
}
export const isSpecial = data => !!data.headline;
export function whatsappText(data, selected = null) {
  return `${data.headline ? `${data.headline.toUpperCase()} · RĪGA` : 'RĪGA THIS WEEKEND'} · ${data.weekend}\n\n` + chosen(data, selected).map(({event: e}, i) => `${i+1}. ${e.title}\n${eventTime(e)}\n${e.venue} · ${e.price}${languageTag(e) ? ` · ${languageTag(e)}` : ''}\n${e.summary}\n${e.sourceUrl}`).join('\n\n') + '\n\nCheck the organiser’s page for changes before heading out.';
}
// Instagram caps captions at 2,200 characters, so organiser links degrade to bare hostnames,
// and then drop out entirely, rather than making an otherwise valid edition unpublishable.
function buildCaption(head, events, shorten = null) {
  const tails = { full: '\n\nSave this for the weekend. Check organisers for updates.\n#Riga #RigaEvents #Rīga', tags: '\n\n#Riga #RigaEvents #Rīga', none: '' };
  const host = url => { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return null; } };
  const trim = (text, n) => text.length <= n ? text : text.slice(0, n - 1).replace(/[\s,;:.\u2013-]+$/, '') + '\u2026';
  // The slide already shows the title, date, venue, price and languages, and carries the same
  // number as its caption entry. With short links, whole descriptions come first: on a very busy
  // post the titles go, then the closing line, then the hashtags, and only then is any description
  // shortened. Without short links, full organiser links are kept and descriptions give way instead.
  const short = e => shorten(e.sourceUrl);
  const ladder = shorten ? [
    { title: true,  detail: 220, link: short, tail: 'full' },
    { title: false, detail: 220, link: short, tail: 'full' },
    { title: false, detail: 220, link: short, tail: 'tags' },
    { title: false, detail: 220, link: short, tail: 'none' },
    { title: false, detail: 140, link: short, tail: 'none' },
    { title: false, detail: 0,   link: short, tail: 'none' },
  ] : [
    { title: true,  detail: 220, link: e => e.sourceUrl, tail: 'full' },
    { title: false, detail: 220, link: e => e.sourceUrl, tail: 'full' },
    { title: false, detail: 140, link: e => e.sourceUrl, tail: 'full' },
    { title: false, detail: 90,  link: e => e.sourceUrl, tail: 'full' },
    { title: false, detail: 0,   link: e => e.sourceUrl, tail: 'full' },
    { title: false, detail: 0,   link: e => host(e.sourceUrl), tail: 'full' },
  ];
  for (const step of ladder) {
    const text = head + events.map((e, i) => {
      const link = step.link(e), detail = step.detail ? trim(e.summary, step.detail) : '';
      const lines = [step.title ? `${i+1}. ${e.title}` : `${i+1}.${detail ? ` ${detail}` : ''}`, step.title && detail ? detail : null, link].filter(Boolean);
      return lines.join('\n');
    }).join('\n\n') + tails[step.tail];
    if (text.length <= 2200) return text;
  }
  throw new Error('Instagram caption exceeds 2,200 characters');
}
// The whole-weekend caption is the longest one an edition can produce, so validating it
// on submit also guarantees every per-day caption fits.
export const caption = data => buildCaption(`${data.headline ? `${data.headline} · ` : ''}Your Riga weekend, sorted.\n\n`, data.events);
const captionHead = (data, post) => `${data.headline ? `${data.headline} · ` : ''}${postName(post)} in Rīga.\n\n`;
// `shorten` turns an organiser URL into its short link; omit it to print full links.
export const postCaption = (data, post, shorten = null) => buildCaption(captionHead(data, post), post.items.map(i => i.event), shorten);
// Reviewing a long candidate list must never fail. Publishing still uses the strict caption,
// so an unpublishable post is reported on the review page rather than blocking the import.
export function postCaptionPreview(data, post, shorten = null) {
  try { return postCaption(data, post, shorten); }
  catch (err) { return `${captionHead(data, post)}[${post.items.length} events. ${err.message}. Untick some before approving.]`; }
}
// Meta's content publishing API caps a carousel at 10 slides and the date cover takes one,
// so a busy day is split across several posts rather than forcing events to be dropped.
export const SLIDES_PER_POST = 9, POST_GAP_MINUTES = 30, LEAD_MINUTES = 60;
// Regular posts go out from 09:00; a special post goes out at noon, so it does not land on top of the day's own post.
export const POST_HOUR = 9, SPECIAL_POST_HOUR = 12;
export function postsFor(data, selected = null) {
  const posts = [];
  for (const day of eventsByDay(data, selected)) {
    const parts = Math.max(1, Math.ceil(day.items.length / SLIDES_PER_POST));
    for (let p = 0; p < parts; p++)
      posts.push({ date: day.date, part: p + 1, parts, dayTotal: day.items.length, items: day.items.slice(p * SLIDES_PER_POST, (p + 1) * SLIDES_PER_POST) });
  }
  return posts;
}
export function postOn(data, date, part, selected = null) {
  const post = postsFor(data, selected).find(p => p.date === date && p.part === part);
  if (!post) throw new Error(`No post ${part} on ${date}`);
  return post;
}
export const postTarget = post => `instagram_feed:${post.date}#${post.part}`;
export const postName = post => `${dayName(post.date)}${post.parts > 1 ? `, post ${post.part} of ${post.parts}` : ''}`;
// What is actually going out has to fit: checked when you approve a selection, not on submit.
export function validatePublication(data, selected = null) {
  const posts = postsFor(data, selected);
  if (!posts.length) throw new Error('Select at least one event to publish');
  for (const post of posts) postCaption(data, post);
  return posts;
}
// The intended publish time of each Instagram item. Approval hands them to Postiz straight away:
// carousels scheduled for these times, stories as drafts, and you move either in Postiz.
// WhatsApp is not planned here; it is sent when you press its button.
export function plannedJobs(data, now = DateTime.now(), selected = null, stories = []) {
  const at = t => DateTime.max(t, now).toUTC().toISO();
  const nine = date => DateTime.fromISO(date, { zone: ZONE }).set({ hour: POST_HOUR });
  const opening = date => DateTime.fromISO(date, { zone: ZONE }).set({ hour: data.headline ? SPECIAL_POST_HOUR : POST_HOUR });
  const before = (t, events) => DateTime.min(t, ...events.map(e => DateTime.fromISO(e.startsAt).setZone(ZONE).minus({ minutes: LEAD_MINUTES })));
  const wanted = new Set(stories || []);
  return [
    // Parts of a busy day go out half an hour apart from 09:00, and always at least an hour before
    // their own first event: a post is never published once one of its events has begun.
    ...postsFor(data, selected).map(p => {
      const spaced = opening(p.date).plus({ minutes: (p.part - 1) * POST_GAP_MINUTES });
      const first = DateTime.min(...p.items.map(x => DateTime.fromISO(x.event.startsAt).setZone(ZONE))).minus({ minutes: LEAD_MINUTES });
      return {target:postTarget(p), due:at(DateTime.min(spaced, first))};
    }),
    // Stories are opt-in per event, dated for that event's morning or an hour before it.
    ...chosen(data, selected).filter(({index}) => wanted.has(index))
      .map(({event, index}) => ({target:`instagram_story:${index}`, due:at(before(nine(eventDate(event)), [event]))})),
  ];
}
