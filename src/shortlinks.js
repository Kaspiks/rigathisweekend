// Caption short links. Every organiser URL always gets this app's own code, which redirects from
// the dashboard host (or SHORT_LINK_BASE). When EJUZ_API_KEY is set, published events also get an
// ej.uz link through the account owner's API key, and captions prefer it. If ej.uz refuses a URL,
// is down, or the key stops working, captions quietly fall back to the app's own link.
import { shortBase } from './store.js';

const API = 'https://ej.uz/api/v1';
const TIMEOUT = 15000;
const RETRY_REJECTED_MS = 24 * 3600 * 1000;
const CLICK_WINDOW_DAYS = 45;

// ej.uz's developer allows generated links at 30 a minute, 100 an hour and 500 a day (September 2026,
// "may change either way"). The defaults stay a little under that; each can be set in the environment.
export function ejuzLimits(env = process.env) {
  const positive = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  };

  const minute = positive(env.EJUZ_PER_MINUTE, 25);

  return {
    minute,
    hour: positive(env.EJUZ_PER_HOUR, 90),
    day: positive(env.EJUZ_PER_DAY, 450),
    pauseMs: Math.ceil(60000 / minute) + 100,
  };
}

class EjuzError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

// Error handling follows the ej.uz API documentation (Beta): decisions use the HTTP status only, since
// message text may change; `message` can be a string or an { en, ja, lv } object; and a Retry-After
// header on 429 is honoured.
const messageText = message => (message && typeof message === 'object'
  ? message.lv || message.en || Object.values(message)[0]
  : message) || '';

function retryAfterMs(value) {
  if (!value) {
    return null;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

async function call(path, key, fetcher, options = {}) {
  let res;

  try {
    res = await fetcher(`${API}${path}`, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'User-Agent': 'RigaWeekend/0.1',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch (err) {
    throw new EjuzError('unavailable', `ej.uz did not answer: ${err.message}`);
  }

  if (res.status === 204) {
    return null; // successful delete: no body
  }

  let body = {};

  try {
    body = await res.json();
  } catch {}

  const text = messageText(body?.message);

  if (res.status === 429) {
    const err = new EjuzError('limited', 'ej.uz rate limit reached');
    err.retryAfterMs = retryAfterMs(res.headers?.get?.('retry-after'));
    throw err;
  }

  if (res.status === 401) {
    throw new EjuzError('auth', 'ej.uz rejected the API key');
  }

  if (res.status === 403) {
    const detail = text ? ` (${text})` : '';
    throw new EjuzError('auth', `ej.uz refused this key: missing permission or access requirement${detail}`);
  }

  if (res.status === 404) {
    throw new EjuzError('missing', 'ej.uz has no such short link for this account');
  }

  if (res.status === 400 || res.status === 413 || res.status === 422) {
    throw new EjuzError('rejected', text || 'ej.uz refused this link');
  }

  if (!res.ok) {
    throw new EjuzError('unavailable', `ej.uz returned HTTP ${res.status}`);
  }

  return body?.result ?? body;
}

// Create answers 201 for a new link and 200 when a matching link already exists; both are success.
// `smurl` addresses the link in later API calls, `displaySmurl` is how it is shown, so captions use the latter.
export async function ejuzCreate(url, key, fetcher = fetch) {
  const result = await call('/smurls', key, fetcher, { method: 'POST', body: JSON.stringify({ url }) });

  const usable = value => {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,50}$/.test(value);
  };

  if (!usable(result?.smurl)) {
    throw new EjuzError('unavailable', 'ej.uz returned no usable short link');
  }

  if (result.shortUrl && !String(result.shortUrl).startsWith('https://ej.uz/')) {
    throw new EjuzError('unavailable', 'ej.uz returned a short link on another domain');
  }

  return { smurl: result.smurl, display: usable(result.displaySmurl) ? result.displaySmurl : result.smurl };
}

// Click statistics sit at the top level of the response, not inside `result`.
export async function ejuzClicks(smurl, key, fetcher = fetch) {
  const result = await call(`/smurls/${encodeURIComponent(smurl)}/clicks`, key, fetcher);
  return Number.isFinite(result?.total) ? result.total : 0;
}

// Make sure these URLs have links. Own codes always; ej.uz ones only when a key is configured.
// Only pass URLs that are about to be published: ej.uz asks that no link is made that nobody sees.
// Requests go one at a time, paced to the per-minute limit, and the run stops (falling back to the
// app's own links) once the hourly or daily budget is used, on a bad key, a rate limit, or outages.
export async function prepareLinks(store, urls, env = process.env, fetcher = fetch, {
  limits = ejuzLimits(env),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = () => Date.now(),
} = {}) {
  const unique = [...new Set(urls)];

  for (const url of unique) {
    store.shortCode(url);
  }

  const key = env.EJUZ_API_KEY;

  if (!key) {
    return { created: 0, fellBack: 0, stopped: null };
  }

  let created = 0;
  let fellBack = 0;
  let outages = 0;
  let stopped = null;
  let last = 0;
  const pending = unique.filter(url => !store.linkRow(url).ejuz);

  // Every request counts against the limits, and the next one is paced from it.
  const logCall = () => {
    last = now();
    store.logEjuzCall(new Date(last));
  };

  // A short Retry-After is waited out once; anything longer ends the run.
  const createLink = async url => {
    try {
      return await ejuzCreate(url, key, fetcher);
    } catch (err) {
      if (err.kind !== 'limited' || err.retryAfterMs == null || err.retryAfterMs > 60000) {
        throw err;
      }

      await sleep(err.retryAfterMs);
      logCall();
      return ejuzCreate(url, key, fetcher);
    }
  };

  for (const [n, url] of pending.entries()) {
    const row = store.linkRow(url);

    if (row.ejuz_error && now() - Date.parse(row.ejuz_tried) < RETRY_REJECTED_MS) {
      fellBack++;
      continue;
    }

    if (store.ejuzCallsSince(86400000, now()) >= limits.day) {
      stopped = 'daily limit';
    } else if (store.ejuzCallsSince(3600000, now()) >= limits.hour) {
      stopped = 'hourly limit';
    }

    if (stopped) {
      fellBack += pending.length - n;
      break;
    }

    const wait = Math.max(
      last ? limits.pauseMs - (now() - last) : 0,
      store.ejuzCallsSince(60000, now()) >= limits.minute ? limits.pauseMs : 0,
    );

    if (wait > 0) {
      await sleep(wait);
    }

    logCall();

    try {
      const made = await createLink(url);
      store.setEjuz(url, made.smurl, null, made.display);
      created++;
      outages = 0;
    } catch (err) {
      fellBack++;
      console.error(`ej.uz link for ${url}: ${err.message}`);

      if (err.kind === 'rejected') {
        store.setEjuz(url, null, err.message);
      }

      if (err.kind === 'auth' || err.kind === 'limited' || (err.kind === 'unavailable' && ++outages >= 3)) {
        stopped = err.kind === 'limited' ? 'rate limited by ej.uz' : err.message;
        fellBack += pending.length - n - 1;
        break;
      }
    }
  }

  return { created, fellBack, stopped };
}

// Deleting a link that is already gone counts as done.
export async function ejuzDelete(smurl, key, fetcher = fetch) {
  try {
    await call(`/smurls/${encodeURIComponent(smurl)}`, key, fetcher, { method: 'DELETE' });
  } catch (err) {
    if (err.kind !== 'missing') {
      throw err;
    }
  }
}

const ejuzLink = row => {
  return `ej.uz/${row.ejuz_display || row.ejuz}`;
};

// What a caption prints for a URL: its ej.uz link if one exists, otherwise this app's own.
export function captionLinker(store, env = process.env) {
  const base = shortBase(env);

  return url => {
    const code = store.shortCode(url);
    const row = store.linkRow(url);
    return row?.ejuz ? ejuzLink(row) : `${base}/${code}`;
  };
}

export function linkSummary(store, url, env = process.env) {
  const row = store.linkRow(url);

  if (!row) {
    return null;
  }

  return {
    url: row.ejuz ? ejuzLink(row) : `${shortBase(env)}/${row.code}`,
    via: row.ejuz ? 'ej.uz' : 'own',
    clicks: row.clicks + (row.ejuz_clicks || 0),
  };
}

// Optional: refresh ej.uz click totals for recent links. Off unless EJUZ_CLICK_REFRESH=true, and then
// only a few times a day, one request at a time, so a small free service is never polled in bursts.
export async function refreshClicks(store, env = process.env, fetcher = fetch, { pauseMs = 0 } = {}) {
  const key = env.EJUZ_API_KEY;

  if (!key) {
    return 0;
  }

  const since = new Date(Date.now() - CLICK_WINDOW_DAYS * 86400000).toISOString();
  let updated = 0;

  const recent = store.db.prepare('SELECT url, ejuz FROM short_links WHERE ejuz IS NOT NULL AND created >= ?')
    .all(since);

  for (const row of recent) {
    if (pauseMs && updated) {
      await new Promise(resolve => setTimeout(resolve, pauseMs));
    }

    try {
      store.setEjuzClicks(row.url, await ejuzClicks(row.ejuz, key, fetcher));
      updated++;
    } catch (err) {
      console.error(`ej.uz clicks for ${row.ejuz}: ${err.message}`);

      if (!['rejected', 'missing'].includes(err.kind)) {
        break;
      }
    }
  }

  return updated;
}
