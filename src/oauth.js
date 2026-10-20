// OAuth 2.1 authorization server for the MCP endpoint.
// ChatGPT, Claude (and other MCP clients) register dynamically, send the user to /authorize,
// the user signs in once (the owner with ADMIN_TOKEN, anyone else with the login made by
// `cli.js user add`), and the client receives its own short-lived access token plus a
// rotating refresh token. PKCE is verified by the SDK.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import {
  InvalidGrantError, InvalidClientMetadataError, InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';

// How long each thing lasts, in seconds: access tokens, refresh tokens, authorization codes and the
// sign-in transaction between /authorize and the login form.
const ACCESS_TTL = 60 * 60;
const REFRESH_TTL = 90 * 24 * 60 * 60;
const CODE_TTL = 5 * 60;
const TXN_TTL = 10 * 60;

const now = () => {
  return Math.floor(Date.now() / 1000);
};

const hash = token => {
  return createHash('sha256').update(token).digest('hex');
};

const secret = () => {
  return randomBytes(32).toString('base64url');
};

// Compares a secret in constant time, so how long a wrong guess takes says nothing about how close it was.
function safeEqual(given, expected) {
  const givenBytes = Buffer.from(given || '');
  const expectedBytes = Buffer.from(expected || '');
  return givenBytes.length === expectedBytes.length && timingSafeEqual(givenBytes, expectedBytes);
}

// Chrome enforces form-action on the 302 that follows the login POST, and on every redirect after it, so the
// client's callback origin must be allowed, and so must wherever that callback sends the browser next: Google's
// callback for Gemini passes it on to its own app, and a frozen "Redirecting…" page was the result. Any HTTPS
// address may follow; where the code goes is checked on the server against the client's registered callbacks.
const formAction = client => {
  const callbackOrigins = new Set((client?.redirect_uris || []).map(uri => new URL(uri).origin));
  return ["'self'", ...callbackOrigins, 'https:'].join(' ');
};

// The login form runs only its own inline script, and may post only to this server or the client's callback.
const loginPolicy = (nonce, client) => `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; `
  + `form-action ${formAction(client)}; frame-ancestors 'none'; base-uri 'none'`;

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const escapeHtml = text => {
  return String(text).replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
};

// Adds a column that databases created by older versions lack. Where it is already there, SQLite refuses and
// nothing changes.
function addColumn(db, table, column) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
  } catch {}
}

export function createOAuthProvider(store, env) {
  const db = store.db;

  db.exec(`CREATE TABLE IF NOT EXISTS oauth_clients(id TEXT PRIMARY KEY, data TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_txns(id TEXT PRIMARY KEY, client TEXT NOT NULL, params TEXT NOT NULL,
      expires INTEGER NOT NULL, code TEXT);
    CREATE TABLE IF NOT EXISTS oauth_codes(code TEXT PRIMARY KEY, client TEXT NOT NULL, params TEXT NOT NULL,
      expires INTEGER NOT NULL, user TEXT NOT NULL DEFAULT 'admin');
    CREATE TABLE IF NOT EXISTS oauth_tokens(hash TEXT PRIMARY KEY, kind TEXT NOT NULL, client TEXT NOT NULL,
      scopes TEXT NOT NULL, resource TEXT, expires INTEGER NOT NULL, user TEXT NOT NULL DEFAULT 'admin');`);

  addColumn(db, 'oauth_txns', 'code TEXT'); // deployments created before the column existed

  // Who signed in, so removing a user removes their connection. Everything issued before users existed was the
  // owner's.
  for (const table of ['oauth_codes', 'oauth_tokens']) {
    addColumn(db, table, "user TEXT NOT NULL DEFAULT 'admin'");
  }

  const sweep = () => {
    const cutoff = now();

    for (const table of ['oauth_txns', 'oauth_codes', 'oauth_tokens']) {
      db.prepare(`DELETE FROM ${table} WHERE expires<?`).run(cutoff);
    }
  };

  const issue = (client, scopes, resource, user) => {
    const access = secret();
    const refresh = secret();
    const issuedAt = now();

    const insert = db.prepare(
      'INSERT INTO oauth_tokens(hash,kind,client,scopes,resource,expires,user) VALUES(?,?,?,?,?,?,?)',
    );

    const save = (token, kind, ttl) => {
      insert.run(hash(token), kind, client, JSON.stringify(scopes), resource || null, issuedAt + ttl, user);
    };

    save(access, 'access', ACCESS_TTL);
    save(refresh, 'refresh', REFRESH_TTL);

    return {
      access_token: access,
      token_type: 'bearer',
      expires_in: ACCESS_TTL,
      refresh_token: refresh,
      scope: scopes.join(' ') || undefined,
    };
  };

  // A code or token works only for the client it was issued to, and only until it expires.
  const unusable = (row, client) => {
    return !row || row.client !== client.client_id || row.expires < now();
  };

  const clientsStore = {
    getClient(id) {
      const row = db.prepare('SELECT data FROM oauth_clients WHERE id=?').get(id);
      return row ? JSON.parse(row.data) : undefined;
    },
    registerClient(client) {
      sweep();

      if (!client.redirect_uris?.length) {
        throw new InvalidClientMetadataError('redirect_uris required');
      }

      for (const uri of client.redirect_uris) {
        const url = URL.canParse(uri) ? new URL(uri) : null;
        const local = ['localhost', '127.0.0.1'].includes(url?.hostname);

        if (!url || !(url.protocol === 'https:' || local)) {
          throw new InvalidClientMetadataError(`redirect_uri must be HTTPS: ${uri}`);
        }
      }

      // Public client + PKCE: no client secret to leak or expire, exactly what OAuth 2.1 recommends for this flow.
      const info = {
        ...client,
        client_id: client.client_id || randomBytes(16).toString('hex'),
        client_id_issued_at: now(),
        token_endpoint_auth_method: 'none',
        client_secret: undefined,
        client_secret_expires_at: undefined,
      };

      db.prepare('INSERT INTO oauth_clients(id,data,created) VALUES(?,?,?)')
        .run(info.client_id, JSON.stringify(info), now());

      return info;
    },
  };

  const provider = {
    clientsStore,
    async authorize(client, params, res) {
      sweep();
      const id = secret();

      db.prepare('INSERT INTO oauth_txns(id,client,params,expires) VALUES(?,?,?,?)')
        .run(id, client.client_id, JSON.stringify({ ...params, resource: params.resource?.href }), now() + TXN_TTL);

      const nonce = secret();
      res.set('Content-Security-Policy', loginPolicy(nonce, client));
      // 'same-origin', not 'no-referrer': Chrome sends Origin: null on form posts under no-referrer, which would
      // fail the CSRF check.
      res.set('Referrer-Policy', 'same-origin');
      res.set('X-Frame-Options', 'DENY');
      res.type('html').send(loginPage({ client: client.client_name || client.client_id, txn: id, error: '', nonce }));
    },
    async challengeForAuthorizationCode(client, code) {
      const row = db.prepare('SELECT params,client,expires FROM oauth_codes WHERE code=?').get(hash(code));

      if (unusable(row, client)) {
        throw new InvalidGrantError('Invalid or expired authorization code');
      }

      return JSON.parse(row.params).codeChallenge;
    },
    async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
      // Deleted as it is read, so a code can be exchanged only once.
      const row = db.prepare('DELETE FROM oauth_codes WHERE code=? RETURNING params,client,expires,user')
        .get(hash(code));

      if (unusable(row, client)) {
        throw new InvalidGrantError('Invalid or expired authorization code');
      }

      const params = JSON.parse(row.params);

      if (redirectUri && redirectUri !== params.redirectUri) {
        throw new InvalidGrantError('redirect_uri mismatch');
      }

      if (resource && params.resource && resource.href !== params.resource) {
        throw new InvalidGrantError('resource mismatch');
      }

      return issue(client.client_id, params.scopes || [], params.resource, row.user);
    },
    async exchangeRefreshToken(client, refreshToken, scopes, resource) {
      // Refresh tokens rotate: the one presented is deleted here and a new pair is issued below.
      const row = db.prepare(`DELETE FROM oauth_tokens WHERE hash=? AND kind='refresh'
        RETURNING client,scopes,resource,expires,user`).get(hash(refreshToken));

      if (unusable(row, client)) {
        throw new InvalidGrantError('Invalid or expired refresh token');
      }

      const granted = JSON.parse(row.scopes);

      if (scopes?.some(scope => !granted.includes(scope))) {
        throw new InvalidGrantError('Requested scope exceeds grant');
      }

      if (resource && row.resource && resource.href !== row.resource) {
        throw new InvalidGrantError('resource mismatch');
      }

      return issue(client.client_id, scopes || granted, row.resource, row.user);
    },
    async verifyAccessToken(token) {
      // ADMIN_TOKEN also works directly as a bearer token, signed in as the owner.
      if (safeEqual(token, env.ADMIN_TOKEN)) {
        return { token, clientId: 'admin', scopes: [], expiresAt: now() + ACCESS_TTL };
      }

      const row = db
        .prepare("SELECT client,scopes,resource,expires FROM oauth_tokens WHERE hash=? AND kind='access'")
        .get(hash(token));

      if (!row || row.expires < now()) {
        throw new InvalidTokenError('Invalid or expired access token');
      }

      return {
        token,
        clientId: row.client,
        scopes: JSON.parse(row.scopes),
        expiresAt: row.expires,
        resource: row.resource ? new URL(row.resource) : undefined,
      };
    },
    async revokeToken(client, { token }) {
      db.prepare('DELETE FROM oauth_tokens WHERE hash=? AND client=?').run(hash(token), client.client_id);
    },
  };

  // The login step, once per client. The owner leaves the name empty (or types admin) and gives ADMIN_TOKEN;
  // anyone else gives the name and password made for them with `cli.js user add`.
  const attempts = new Map();

  const signsIn = (user, given) => {
    return user === 'admin' ? safeEqual(given, env.ADMIN_TOKEN) : store.checkUser(user, given);
  };

  // Five wrong logins in a row from one address lock it out for 15 minutes.
  const recordFailure = (ip, tries) => {
    tries.n++;

    if (tries.n >= 5) {
      tries.until = Date.now() + 15 * 60 * 1000;
      tries.n = 0;
    }

    attempts.set(ip, tries);
  };

  const login = express.Router();
  login.use(express.urlencoded({ extended: false, limit: '4kb' }));

  login.post('/', (req, res) => {
    const origin = env.APP_ORIGIN || 'http://localhost:3100';

    if (req.headers.origin && req.headers.origin !== origin) {
      return res.status(403).send('Origin not allowed');
    }

    const ip = req.ip || '';
    const tries = attempts.get(ip) || { n: 0, until: 0 };

    if (tries.until > Date.now()) {
      return res.status(429).send('Too many attempts; try again later');
    }

    const txn = db.prepare('SELECT client,params,expires,code FROM oauth_txns WHERE id=?')
      .get(String(req.body.txn || ''));

    if (!txn || txn.expires < now()) {
      res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
      return res.status(400).type('html').send(loginPage({ client: '', txn: '', error: '', expired: true }));
    }

    const client = clientsStore.getClient(txn.client);
    const user = String(req.body.name || '').trim().toLowerCase() || 'admin';
    const given = String(req.body.token || '');

    if (!signsIn(user, given)) {
      recordFailure(ip, tries);
      const nonce = secret();
      res.set('Content-Security-Policy', loginPolicy(nonce, client));

      return res.status(401).type('html').send(loginPage({
        client: client?.client_name || txn.client,
        txn: req.body.txn,
        name: req.body.name,
        error: user === 'admin' ? 'That token is not correct.' : 'That name and password do not match.',
        nonce,
      }));
    }

    attempts.delete(ip);
    const params = JSON.parse(txn.params);
    // A double click or Enter+click re-submits while ChatGPT's callback page is still loading; the second submit
    // must not cancel the first with an error. Keep the transaction for 60s and answer repeats with the same
    // redirect.
    let code = txn.code;

    if (!code) {
      code = secret();

      db.prepare('INSERT INTO oauth_codes(code,client,params,expires,user) VALUES(?,?,?,?,?)')
        .run(hash(code), txn.client, JSON.stringify(params), now() + CODE_TTL, user);

      db.prepare('UPDATE oauth_txns SET code=?,expires=? WHERE id=?').run(code, now() + 60, req.body.txn);
    }

    const url = new URL(params.redirectUri);
    url.searchParams.set('code', code);

    if (params.state) {
      url.searchParams.set('state', params.state);
    }

    res.redirect(302, url.href);
  });

  const issuer = new URL(env.APP_ORIGIN || 'http://localhost:3100');
  const router = express.Router();

  // Observability without secrets: one line per OAuth request, so a failing client can be diagnosed from the logs.
  router.use(['/authorize', '/token', '/register', '/revoke', '/oauth/login'], (req, res, next) => {
    const started = Date.now();
    const authType = (req.headers.authorization || '').split(' ')[0] || '-';

    res.on('finish', () => {
      const took = Date.now() - started;
      const grant = req.body?.grant_type || '-';
      const client = req.body?.client_id || req.query?.client_id || '-';
      const error = res.statusCode >= 400 && res.locals.oauthError ? ` error=${res.locals.oauthError}` : '';

      console.log(`oauth ${req.method} ${req.baseUrl || req.path} ${res.statusCode} ${took}ms `
        + `auth=${authType} grant=${grant} client=${client}${error}`);
    });

    // The SDK answers token and registration errors itself; keep what it said for the log line.
    if (req.path === '/token' || req.path === '/register') {
      const json = res.json.bind(res);

      res.json = body => {
        if (res.statusCode >= 400) {
          res.locals.oauthError = JSON.stringify(body);
        }

        return json(body);
      };
    }

    next();
  });

  // Some clients authenticate at the token endpoint with HTTP Basic (client_secret_basic) even for public clients;
  // the SDK only reads client_id from the body, so translate.
  router.post(['/token', '/revoke'], express.urlencoded({ extended: false }), (req, _res, next) => {
    const auth = req.headers.authorization || '';

    if (!req.body.client_id && auth.startsWith('Basic ')) {
      const [id, ...rest] = Buffer.from(auth.slice(6), 'base64').toString().split(':');

      if (id) {
        req.body.client_id = decodeURIComponent(id);
      }

      const clientSecret = rest.join(':');

      if (clientSecret) {
        req.body.client_secret = decodeURIComponent(clientSecret);
      }
    }

    next();
  });

  router.use(mcpAuthRouter({
    provider,
    issuerUrl: issuer,
    resourceServerUrl: new URL('/mcp', issuer),
    resourceName: 'Riga Weekend',
    clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
  }));

  router.use('/oauth/login', login);

  return {
    provider,
    router,
    resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', issuer).href,
  };
}

// The login page has no files of its own: its stylesheet and script are inline, allowed by loginPolicy.
const LOGIN_STYLE = [
  'body{margin:0;background:#f6f4ed;color:#17352d;font-family:Arial,Helvetica,sans-serif;display:grid;'
    + 'place-items:center;min-height:100vh}',
  'form,.box{background:#fff;border:1px solid #d9ded4;border-radius:12px;padding:36px;width:min(92vw,420px)}',
  'h1{font-family:Georgia,serif;font-weight:400;font-size:30px;margin:0 0 8px}',
  'p{color:#69736b;line-height:1.5;font-size:14px}',
  'label{display:block;font-size:12px;letter-spacing:2px;font-weight:bold;margin:22px 0 8px}',
  'input{width:100%;box-sizing:border-box;padding:14px;border:1px solid #d9ded4;border-radius:6px;font-size:15px}',
  'button{margin-top:20px;width:100%;border:0;background:#17352d;color:#fff;padding:14px;border-radius:6px;'
    + 'font-weight:600;font-size:15px;cursor:pointer}',
  'button:disabled{opacity:.6;cursor:wait}',
  '.err{color:#a13c2e;font-weight:600}',
  '.who{font-family:monospace;background:#f6f4ed;padding:2px 6px;border-radius:4px}',
].join('');

// Once the form is sent, the button is disabled and says it is redirecting while the client's callback loads.
const LOGIN_SCRIPT = "document.querySelector('form').addEventListener('submit',function(){"
  + "var b=this.querySelector('button');b.disabled=true;b.textContent='Redirecting…';});";

function loginPage({ client, txn, error, nonce = '', expired = false, name = '' }) {
  const head = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>Riga Weekend · Authorize</title><style>${LOGIN_STYLE}</style></head><body>`;

  if (expired) {
    return `${head}<div class="box"><h1>Link expired</h1><p>This authorization link is no longer valid. `
      + 'Close this window and connect Riga Weekend again from ChatGPT or Claude.</p></div></body></html>';
  }

  const errorLine = error ? `<p class="err">${escapeHtml(error)}</p>` : '';

  return `${head}<form method="post" action="/oauth/login"><h1>Authorize access</h1>`
    + `<p><span class="who">${escapeHtml(client)}</span> wants to submit and review Riga weekend editions on your `
    + 'behalf. Sign in to allow it. The owner leaves the name empty and enters the admin token from the server\'s '
    + 'private configuration.</p>\n'
    + `${errorLine}<input type="hidden" name="txn" value="${escapeHtml(txn)}">`
    + '<label for="name">NAME</label>'
    + '<input id="name" name="name" type="text" autocomplete="username" autocapitalize="none" maxlength="32" '
    + `value="${escapeHtml(name || '')}" autofocus>`
    + '<label for="token">PASSWORD OR ADMIN TOKEN</label>'
    + '<input id="token" name="token" type="password" autocomplete="current-password" required>'
    + '<button type="submit">Allow</button></form>\n'
    + `<script nonce="${escapeHtml(nonce)}">${LOGIN_SCRIPT}</script></body></html>`;
}
