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
});
export const Submission = z.object({
  weekend: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  events: z.array(Event).min(1).max(8),
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
export function whatsappText(data) {
  return `RĪGA THIS WEEKEND · ${data.weekend}\n\n` + data.events.map((e,i) => `${i+1}. ${e.title}\n${eventTime(e)}\n${e.venue} · ${e.price}\n${e.summary}\n${e.sourceUrl}`).join('\n\n') + '\n\nCheck the organiser’s page for changes before heading out.';
}
export function caption(data) {
  const text = `Your Riga weekend, sorted.\n\n` + data.events.map((e,i) => `${i+1}. ${e.title}\n${eventTime(e)} · ${e.venue}\n${e.price}`).join('\n\n') + '\n\nSave this for the weekend. Check organisers for updates.\n#Riga #RigaEvents #Rīga';
  if (text.length > 2200) throw new Error('Instagram caption exceeds 2,200 characters');
  return text;
}
export function plannedJobs(data, now = DateTime.now()) {
  const friday = DateTime.fromISO(data.weekend, { zone: ZONE }).set({ hour: 9 });
  const at = t => DateTime.max(t, now).toUTC().toISO();
  return [{target:'instagram_feed',due:at(friday)}, {target:'whatsapp',due:at(friday)}, ...data.events.map((e,i) => ({target:`instagram_story:${i}`,due:at(DateTime.fromISO(e.startsAt).setZone(ZONE).startOf('day').set({hour:9}))}))];
}
