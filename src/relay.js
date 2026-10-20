// The relay: ChatGPT, Claude and Gemini, each connected to this server as a plugin, hand work to each other here.
// The server cannot wake any assistant, so the relay is a shared mailbox with turns. One side opens a thread for
// another, saying what it wants (a review, reasoning, guidance or an edit), usually with a payload such as an edit
// spec, a submission or a caption; that side reads it, answers, revises the payload and passes it back, for as
// many rounds as it takes. relay_wait lets a side that is not on turn sit inside one tool call until it is, so
// with the chats open the assistants can go back and forth without the owner relaying.
import { z } from 'zod';

const AGENTS = ['chatgpt', 'claude', 'gemini'];
const NAMES = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', owner: 'the owner' };
const WANTS = {
  review: 'accept it as it is, or change it and send it back',
  reasoning: 'think the question through and say what follows',
  guidance: 'advise how to go on',
  edit: 'make the change yourself and send back the result',
};
const VERDICTS = ['ask', 'answer', 'revise', 'accept', 'reject', 'note'];
const MAX_PAYLOAD = 200_000;

const fail = (message, httpStatus = 400) => {
  return Object.assign(new Error(message), { httpStatus });
};

const sleep = ms => {
  return new Promise(r => setTimeout(r, ms));
};

// Who ChatGPT and Claude hand a new thread to when they do not say: each other, as when they were the only two.
// Gemini came later and always names who it is asking.
const PARTNER = { chatgpt: 'claude', claude: 'chatgpt' };

const nameList = parties => {
  const names = parties.map(p => NAMES[p]);
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
};

const clip = (s, n) => {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

export const RELAY_INSTRUCTIONS = 'ChatGPT, Claude and Gemini can all be connected to this server. The relay_* tools '
  + 'are how they hand work to each other: relay_start opens a thread with what you want from another assistant and '
  + 'the thing itself as a payload, relay_wait waits for the answer, relay_reply answers and passes the turn back, '
  + 'relay_inbox shows what is waiting for you. Nothing in the relay publishes anything.';

// Which assistant a connection belongs to, from the name its client registered under: ChatGPT registers as
// "ChatGPT", claude.ai as "Claude", Claude Code as "Claude Code (…)", Gemini as "Google". Every client has signed in
// with the owner's or a user's login, so the name is trusted for this; a connection with any other name, or the
// admin token used directly, says who it is with `as`.
export function partyOf(clientName) {
  if (/claude|anthropic/i.test(clientName || '')) {
    return 'claude';
  }

  if (/chatgpt|openai/i.test(clientName || '')) {
    return 'chatgpt';
  }

  if (/gemini|google/i.test(clientName || '')) {
    return 'gemini';
  }

  return null;
}

// What changed between two payloads, one line per path: `layers[2].at.x: 0.4 → 0.45`. Arrays compare by
// position, which reads right for edits (layers keep their order) and event lists. Values are shortened, and
// past `limit` lines the rest is counted rather than listed.
export function payloadChanges(before, after, limit = 60) {
  const lines = [];
  let more = 0;

  const show = v => {
    return clip(JSON.stringify(v) ?? 'nothing', 160);
  };

  const add = line => {
    if (lines.length < limit) {
      lines.push(line);
    } else {
      more++;
    }
  };

  const walk = (a, b, path) => {
    if (JSON.stringify(a) === JSON.stringify(b)) {
      return;
    }

    const list = Array.isArray(a) && Array.isArray(b);

    const object = !list && a && b && typeof a === 'object' && typeof b === 'object'
      && !Array.isArray(a) && !Array.isArray(b);

    if (!list && !object) {
      return add(`${path || '(the whole payload)'}: ${show(a)} → ${show(b)}`);
    }

    const keys = list
      ? [...Array(Math.max(a.length, b.length)).keys()]
      : [...new Set([...Object.keys(a), ...Object.keys(b)])];

    for (const k of keys) {
      const at = list ? `${path}[${k}]` : path ? `${path}.${k}` : k;

      if (!Object.hasOwn(a, k)) {
        add(`${at}: added ${show(b[k])}`);
      } else if (!Object.hasOwn(b, k)) {
        add(`${at}: removed (was ${show(a[k])})`);
      } else {
        walk(a[k], b[k], at);
      }
    }
  };

  walk(before, after, '');

  if (more) {
    lines.push(`…and ${more} more ${more === 1 ? 'change' : 'changes'}`);
  }

  return lines;
}

const Id = z.number().int().min(1).describe('Thread number');

const As = z.enum(AGENTS).optional()
  .describe('Who you are. Only needed when the server says it cannot tell from your connection; '
    + 'otherwise it is checked against it');

const Payload = z.union([z.string(), z.array(z.any()), z.record(z.string(), z.any())])
  .describe('The thing itself, so the other side can change it and send it back: an object (an edit spec, an event '
    + 'submission), a list, or text (a caption, a script). Up to 200 KB');

const Refs = z.object({
  edition: z.string().regex(/^[a-f0-9]{24}$/).optional().describe('A weekend edition id from list_weekend_editions'),
  footage: z.string().regex(/^[a-f0-9]{24}$/).optional().describe('A clip or animation id from list_footage'),
  version: z.number().int().min(1).optional().describe('An edit version of that footage, as get_edit reads it'),
}).strict().describe('What this is about, so the other side can open it with the other tools');
const To = z.enum([...AGENTS, 'owner']).optional();

export function createRelay(app, store, { clientName = () => null, pollMs = 1000 } = {}) {
  const db = store.db;

  db.exec(`CREATE TABLE IF NOT EXISTS relay_threads(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
      want TEXT NOT NULL, opened_by TEXT NOT NULL, turn TEXT, status TEXT NOT NULL DEFAULT 'open',
      created TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS relay_messages(thread INTEGER NOT NULL, n INTEGER NOT NULL, author TEXT NOT NULL,
      verdict TEXT NOT NULL, text TEXT NOT NULL, payload TEXT, refs TEXT, created TEXT NOT NULL,
      PRIMARY KEY(thread, n));`);

  const row = id => {
    const t = db.prepare('SELECT * FROM relay_threads WHERE id=?').get(id);

    if (!t) {
      throw fail(`There is no relay thread ${id}`, 404);
    }

    return t;
  };

  const summary = t => {
    const last = db
      .prepare('SELECT n, author, verdict, text, created FROM relay_messages WHERE thread=? ORDER BY n DESC LIMIT 1')
      .get(t.id);

    return {
      thread: t.id, title: t.title, want: t.want, openedBy: t.opened_by, status: t.status, turn: t.turn,
      updated: t.updated, messages: last?.n ?? 0,
      last: last && {
        n: last.n, from: last.author, verdict: last.verdict, at: last.created, text: clip(last.text, 200),
      },
    };
  };

  // Every message, with the changes a payload made to the one before it in the thread, so a revision can
  // be read as what was changed rather than compared by eye.
  const messages = (id, since = 0) => {
    let previous;
    const out = [];

    for (const m of db.prepare('SELECT * FROM relay_messages WHERE thread=? ORDER BY n').all(id)) {
      const payload = m.payload == null ? undefined : JSON.parse(m.payload);
      const changes = payload !== undefined && previous !== undefined ? payloadChanges(previous, payload) : undefined;

      if (payload !== undefined) {
        previous = payload;
      }

      if (m.n > since) {
        out.push({
          n: m.n, from: m.author, verdict: m.verdict, at: m.created, text: m.text,
          ...(m.refs ? { refs: JSON.parse(m.refs) } : {}),
          ...(payload !== undefined ? { payload } : {}),
          ...(changes ? { changes } : {}),
        });
      }
    }

    return out;
  };

  // Everyone who has written in a thread, notes included.
  const participants = id => {
    return db.prepare('SELECT DISTINCT author FROM relay_messages WHERE thread=?').all(id).map(r => r.author);
  };

  // Who an answer goes back to when it does not say: whoever last handed the thread on, other than you and
  // the owner. In a thread between two assistants that is always the other one.
  const lastOther = (id, by) => {
    return db.prepare(`SELECT author FROM relay_messages WHERE thread=? AND verdict!='note' AND author!=?
      AND author!='owner' ORDER BY n DESC LIMIT 1`).get(id, by)?.author ?? null;
  };

  const checkRefs = refs => {
    if (!refs || !Object.keys(refs).length) {
      return null;
    }

    if (refs.version != null && !refs.footage) {
      throw fail('`version` is an edit version, so it needs the `footage` it belongs to');
    }

    if (refs.edition) {
      store.get(refs.edition);
    }

    if (refs.footage) {
      store.footage(refs.footage);
    }

    if (refs.version != null) {
      store.edit(refs.footage, refs.version);
    }

    return refs;
  };

  const checkPayload = payload => {
    if (payload === undefined) {
      return null;
    }

    const json = JSON.stringify(payload);

    if (json.length > MAX_PAYLOAD) {
      throw fail(`The payload is ${Math.round(json.length / 1000)} KB; keep it under ${MAX_PAYLOAD / 1000} KB, `
        + 'or save it with its own tool and point at it with refs');
    }

    return json;
  };

  const insert = (id, by, { verdict, text, payload, refs }, now) => {
    const n = (db.prepare('SELECT max(n) n FROM relay_messages WHERE thread=?').get(id).n || 0) + 1;

    db.prepare(`INSERT INTO relay_messages(thread, n, author, verdict, text, payload, refs, created)
      VALUES(?,?,?,?,?,?,?,?)`)
      .run(id, n, by, verdict, text, checkPayload(payload), refs ? JSON.stringify(refs) : null, now);

    return n;
  };

  function start(by, { title, want, text, payload, refs, to }) {
    if (to === by) {
      throw fail('Open the thread for another assistant or the owner, not for yourself');
    }

    const first = to ?? PARTNER[by];

    if (!first) {
      throw fail(`Say who should answer first with \`to\`: ${nameList(AGENTS.filter(a => a !== by))}, or the owner`);
    }

    const checked = checkRefs(refs);
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');

    try {
      const id = Number(db.prepare(`INSERT INTO relay_threads(title, want, opened_by, turn, created, updated)
        VALUES(?,?,?,?,?,?)`)
        .run(title, want, by, first, now, now).lastInsertRowid);

      insert(id, by, { verdict: 'ask', text, payload, refs: checked }, now);
      db.exec('COMMIT');
      return id;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // A note adds to the thread without moving the turn, so it can be sent at any time. Anything else is an
  // answer that hands the turn on: to `to`, or by default back to whoever handed it to you. An answer while it is
  // another assistant's turn is refused, so two can never both be editing the same payload at once.
  // Answering a closed thread opens it again; `close` ends it whoever's turn it was.
  function post(by, id, { verdict, text, payload, refs, to, close = false }) {
    const t = row(id);

    if (to === by) {
      throw fail('Hand the turn to another assistant or to the owner, not to yourself');
    }

    if (by === 'owner' && verdict !== 'note' && !to && !close) {
      throw fail(`Say who should answer: ${nameList(AGENTS)}`);
    }

    if (verdict === 'revise' && payload === undefined) {
      throw fail('A revision carries the whole revised payload, so '
        + 'the other side can see what changed');
    }

    if (verdict !== 'note' && t.status === 'open' && by !== 'owner' && t.turn && t.turn !== by && t.turn !== 'owner') {
      throw fail(`It is ${NAMES[t.turn]}'s turn in thread ${id}. Wait for the answer with relay_wait, or send verdict `
        + `"note" to add something without taking the turn`);
    }

    const checked = checkRefs(refs);
    const now = new Date().toISOString();

    const next = close || verdict === 'note' ? null : to ?? lastOther(id, by) ?? PARTNER[by];

    if (!close && verdict !== 'note' && !next) {
      throw fail(`Say who should answer with \`to\`: ${nameList(AGENTS.filter(a => a !== by))}, or the owner`);
    }

    const [status, turn] = close
      ? ['closed', null]
      : verdict === 'note' ? [t.status, t.turn] : ['open', next];

    db.exec('BEGIN IMMEDIATE');

    try {
      const n = insert(id, by, { verdict, text, payload, refs: checked }, now);
      db.prepare('UPDATE relay_threads SET status=?, turn=?, updated=? WHERE id=?').run(status, turn, now, id);
      db.exec('COMMIT');
      return n;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const list = (limit = 30) => db.prepare('SELECT * FROM relay_threads ORDER BY updated DESC, id DESC LIMIT ?')
    .all(limit);

  // The open threads waiting for `party`, oldest first so nothing waits behind a newer thread.
  const waitingFor = (party, id = null) => db
    .prepare(`SELECT * FROM relay_threads WHERE status='open' AND turn=?${id ? ' AND id=?' : ''} ORDER BY updated`)
    .all(...(id ? [party, id] : [party]));

  // What the waiting side has not seen yet: everything after its own last message.
  const unseen = (party, id) => messages(
    id,
    db.prepare('SELECT max(n) n FROM relay_messages WHERE thread=? AND author=?').get(id, party).n || 0,
  );

  // Dashboard: the owner follows the threads and can step in. Behind the dashboard login like every /api route.
  app.get('/api/relay', (_req, res) => res.json({
    threads: list().map(t => ({ ...summary(t), messages: messages(t.id) })),
  }));

  app.post('/api/relay/:id', (req, res) => {
    const body = z.object({
      text: z.string().trim().max(20000).default(''),
      to: z.enum(AGENTS).optional(),
      close: z.boolean().default(false),
    }).parse(req.body || {});

    if (!body.text && !body.close) {
      throw fail('Write something to send, or close the thread');
    }

    const id = Number(req.params.id);

    post('owner', id, {
      verdict: body.to ? 'answer' : 'note', text: body.text || 'Closed by the owner.', to: body.to, close: body.close,
    });

    res.json(summary(row(id)));
  });

  function register(server) {
    const text = data => {
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    };

    const read = { readOnlyHint: true, openWorldHint: false };
    const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

    const who = (extra, as) => {
      const id = extra?.authInfo?.clientId;
      const known = id && id !== 'admin' ? partyOf(clientName(id)) : null;

      if (known && as && as !== known) {
        throw fail(`This connection belongs to ${NAMES[known]}, so it cannot write as ${NAMES[as]}`);
      }

      if (known || as) {
        return known || as;
      }

      throw fail(`The server cannot tell from this connection whether you are ${nameList(AGENTS)}. Call again with \`as\``);
    };

    const yourTurn = (t, you) => {
      return t.status === 'open' && t.turn === you;
    };

    // Open threads you are part of that wait for another assistant.
    const theirTurn = (t, you) => {
      return t.status === 'open' && AGENTS.includes(t.turn) && t.turn !== you && participants(t.id).includes(you);
    };

    server.registerTool('relay_start', {
      description: 'Hands something to another assistant connected to this server (ChatGPT, Claude or Gemini) and '
        + 'opens a thread for you. Use it when the owner asks for another assistant\'s review, reasoning, guidance or '
        + 'edits, or for you to work something out together. Name who in `to`. Put the thing itself in `payload` so '
        + 'they can change it and send it back, and point at what it belongs to with `refs`. Then call relay_wait '
        + 'for the answer. Nothing in the relay publishes anything.',
      inputSchema: {
        title: z.string().trim().min(3).max(120)
          .describe('What the thread is about, e.g. "Pasta reel v4: pacing of the freeze"'),
        want: z.enum(Object.keys(WANTS)).describe(Object.entries(WANTS).map(([k, v]) => `${k}: ${v}`).join('; ')),
        text: z.string().trim().min(1).max(20000)
          .describe('What you are asking and the context they need: what the owner wants, what you tried, '
            + 'what you are unsure of'),
        payload: Payload.optional(), refs: Refs.optional(),
        to: To.describe('Who answers first: chatgpt, claude, gemini, or owner when the owner must decide something '
          + 'first. ChatGPT and Claude may leave it out to ask each other; Gemini always names who'),
        as: As,
      }, annotations: write,
    }, async ({ as, ...input }, extra) => {
      const you = who(extra, as);
      const id = start(you, input);
      const t = row(id);

      return text({
        thread: id, you, turn: t.turn,
        next: `Call relay_wait with thread ${id} for the answer. If ${NAMES[t.turn]} does not answer within a few `
          + `waits, tell the owner to ask ${NAMES[t.turn]} to check the relay (thread ${id}).`,
      });
    });

    server.registerTool('relay_reply', {
      description: 'Answers in a relay thread and passes the turn back. `verdict` says what you did: accept (fine as '
        + 'it is), revise (you changed it: send the whole revised payload, the other side is shown exactly what '
        + 'changed), reject (it should not go ahead: say why), answer (the reasoning or guidance that was asked for), '
        + 'ask (a question back), note (adds to the thread without taking the turn, usable any time). The turn goes '
        + 'back to whoever handed it to you unless `to` names another assistant. Set close when nothing more is '
        + 'needed. Send it to "owner" when a decision is the owner\'s, such as anything that would publish or spend '
        + 'money. Answering a closed thread opens it again.',
      inputSchema: {
        thread: Id, verdict: z.enum(VERDICTS),
        text: z.string().trim().min(1).max(20000)
          .describe('Your answer: what you decided and why, what you changed, what you need from them'),
        payload: Payload.optional(), refs: Refs.optional(),
        to: To.describe('Who acts next; by default whoever handed the thread to you'),
        close: z.boolean().default(false).describe('End the thread: nothing more is needed from anyone'),
        as: As,
      }, annotations: write,
    }, async ({ thread, as, ...input }, extra) => {
      const you = who(extra, as);
      const n = post(you, thread, input);
      const t = row(thread);

      return text({
        thread, message: n, status: t.status, turn: t.turn,
        next: t.status === 'closed' ? 'The thread is closed.'
          : t.turn === 'owner' ? 'The thread waits for the owner: tell them what needs deciding.'
          : input.verdict === 'note' ? 'Noted; the turn did not change.'
          : `Call relay_wait with thread ${thread} for ${NAMES[t.turn]}'s answer.`,
      });
    });

    server.registerTool('relay_inbox', {
      description: 'Relay threads between ChatGPT, Claude and Gemini: what is waiting for you, what you are waiting '
        + 'on, what waits for the owner, and recently closed ones. Check it at the start of a session or when the '
        + 'owner says another assistant has answered.',
      inputSchema: { as: As }, annotations: read,
    }, async ({ as }, extra) => {
      const you = who(extra, as);
      const all = list(50);

      const pick = test => {
        return all.filter(test).map(summary);
      };

      return text({ you,
        waitingForYou: pick(t => yourTurn(t, you)),
        waitingForThem: pick(t => theirTurn(t, you)),
        waitingForOwner: pick(t => t.status === 'open' && t.turn === 'owner'),
        recentlyClosed: pick(t => t.status === 'closed').slice(0, 10),
        next: 'relay_read a thread for its messages and payload; relay_reply to answer one that is waiting for you.' });
    });

    server.registerTool('relay_read', {
      description: 'A relay thread in full: every message with its verdict, text, payload and refs, and for each '
        + 'revision the changes it made to the payload before it. `since` returns only the messages after that number.',
      inputSchema: { thread: Id, since: z.number().int().min(0).default(0)
        .describe('Only messages after this number'), as: As }, annotations: read,
    }, async ({ thread, since, as }, extra) => {
      const t = row(thread);
      let you = null;

      try {
        you = who(extra, as);
      } catch {}

      return text({
        ...summary(t), ...(you ? { you, yourTurn: yourTurn(t, you) } : {}), messages: messages(thread, since),
      });
    });

    server.registerTool('relay_wait', {
      description: 'Waits until it is your turn in a relay thread (the one given, or any), then returns what you have '
        + 'not seen yet. Call it right after relay_start or relay_reply. If it comes back empty, call it again; after '
        + 'a few empty waits, stop and tell the owner to ask the assistant you are waiting for to check the relay. '
        + '`seconds` '
        + 'defaults to 40; raise it only if your client allows long tool calls.',
      inputSchema: {
        thread: Id.optional().describe('Wait for this thread only; it also returns when the thread is closed'),
        seconds: z.number().int().min(1).max(120).default(40),
        as: As,
      }, annotations: read,
    }, async ({ thread, seconds, as }, extra) => {
      const you = who(extra, as);

      if (thread) {
        row(thread);
      }

      const started = Date.now();
      const until = started + seconds * 1000;

      for (;;) {
        const t = thread ? row(thread) : null;
        const ready = t ? (yourTurn(t, you) || t.status === 'closed' ? t : null) : waitingFor(you)[0];

        if (ready) {
          return text({
            ready: true, you, ...summary(ready), yourTurn: yourTurn(ready, you), messages: unseen(you, ready.id),
            next: yourTurn(ready, you)
              ? `Your turn in thread ${ready.id}: do what it asks, then relay_reply.`
              : `Thread ${ready.id} is closed.`,
          });
        }

        if (Date.now() >= until || extra?.signal?.aborted) {
          break;
        }

        await sleep(Math.min(pollMs, until - Date.now()));
      }

      const t = thread ? row(thread) : null;

      return text({
        ready: false, you, waited: Math.round((Date.now() - started) / 1000),
        ...(t ? { thread: t.id, turn: t.turn } : {
          waitingForThem: list(50).filter(x => theirTurn(x, you)).map(x => x.id),
          waitingForOwner: waitingFor('owner').map(x => x.id),
        }),
        next: t?.turn === 'owner'
          ? 'This thread waits for the owner.'
          : 'Nothing yet. Call relay_wait again, or after a few empty waits tell the owner to ask the assistant '
            + 'you are waiting for to check the relay.',
      });
    });
  }

  return { register, start, post, messages, summary: id => summary(row(id)) };
}
