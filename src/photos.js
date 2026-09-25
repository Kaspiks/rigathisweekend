// Fetches the organiser's own sharing image (og:image) from the event page we already cite.
// It deliberately never substitutes a picture from anywhere else: a stand-in that merely resembles
// the event does not fit. Events with no organiser image get a photo you upload, or the plain card.
// Event pages publish that image precisely so listings can show it, which keeps provenance
// attached to the source URL. URLs arrive from an untrusted model, so every request is
// guarded: HTTPS only, no private address ranges, capped redirects, capped bytes, hard timeout.
import { lookup } from 'node:dns/promises';
import sharp from 'sharp';

const TIMEOUT = 10000, MAX_HTML = 2 * 1024 * 1024, MAX_IMAGE = 10 * 1024 * 1024, MAX_HOPS = 3, MIN_EDGE = 400;

function privateAddress(ip, family) {
  if (family === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (/^f[cd]/.test(v) || /^fe[89ab]/.test(v)) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? privateAddress(mapped[1], 4) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
async function assertPublic(url) {
  if (url.protocol !== 'https:') throw new Error('HTTPS required');
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length) throw new Error('No address');
  for (const { address, family } of addresses) if (privateAddress(address, family)) throw new Error('Non-public address');
}
// Redirects are followed by hand so each hop is re-validated instead of trusting the first check.
async function get(url, accept, maxBytes, fetcher) {
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    await assertPublic(current);
    const res = await fetcher(current.href, {
      redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT),
      headers: { Accept: accept, 'User-Agent': 'RigaWeekend/0.1 (+event listing preview)' },
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Redirect without location');
      current = new URL(location, current); continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error('Too large');
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error('Too large');
    return { buffer, type: res.headers.get('content-type') || '', url: current };
  }
  throw new Error('Too many redirects');
}
// The same guarded download serves pictures handed over for animated edits (src/animate.js).
export { get as fetchPublic };
export function pictureUrl(html, pageUrl) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const found = html.match(pattern);
    if (!found) continue;
    try { const resolved = new URL(found[1].replace(/&amp;/g, '&'), pageUrl); if (resolved.protocol === 'https:') return resolved.href; } catch {}
  }
  return null;
}
// Returns {buffer,label} or null. Never throws: a missing picture must not cost us the card.
export async function eventPhoto(event, fetcher = fetch) {
  const page = event.imageUrl || event.sourceUrl;
  try {
    let source = event.imageUrl;
    if (!source) {
      const { buffer, type } = await get(event.sourceUrl, 'text/html', MAX_HTML, fetcher);
      if (!/html/i.test(type)) throw new Error('Source page is not HTML');
      source = pictureUrl(buffer.toString('utf8'), event.sourceUrl);
      if (!source) throw new Error('Source page has no sharing image');
    }
    const image = await get(source, 'image/*', MAX_IMAGE, fetcher);
    if (!/^image\//i.test(image.type)) throw new Error('Not an image');
    // Re-encoding through sharp drops any payload hiding in the original container.
    const meta = await sharp(image.buffer).metadata();
    if (!meta.width || !meta.height || Math.min(meta.width, meta.height) < MIN_EDGE) throw new Error('Image too small');
    return { buffer: image.buffer, label: `PHOTO: ${image.url.hostname.replace(/^www\./,'')}` };
  } catch (err) {
    console.error(`Photo lookup failed for ${page}: ${err.message}`);
  }
  // Only the event's own poster or organiser image is ever used. Anything else is uploaded by hand.
  return null;
}
