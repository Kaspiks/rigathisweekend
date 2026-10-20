import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Store } from '../src/store.js';
import { createApp } from '../src/app.js';
import { partyOf, payloadChanges } from '../src/relay.js';

const TOKEN = 'r'.repeat(32);
const REDIRECTS = {
  ChatGPT: 'https://chatgpt.com/connector_platform_oauth_redirect',
  Claude: 'https://claude.ai/api/mcp/auth_callback',
  'Claude Code (riga)': 'http://localhost:54545/callback',
  Google: 'https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-1-riga',
};

async function serve(t) {
  const dir = await mkdtemp(join(tmpdir(), 'riga-relay-'));
  const store = new Store(dir);
  const app = createApp(store, { ADMIN_TOKEN: TOKEN }, { relay: { pollMs: 50 } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); store.close(); await rm(dir, { recursive: true, force: true }); });
  return { store, base: `http://127.0.0.1:${server.address().port}` };
}
// An MCP client signed in the way the assistant's plugin signs in: dynamic registration under its own client
// name, the owner's login, PKCE. With no name it uses the admin token directly, as a hand-configured client would.
async function connect(t, base, clientName = null) {
  let bearer = TOKEN;
  if (clientName) {
    const form = body => ({ method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
    const reg = await (await fetch(base + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: clientName, redirect_uris: [REDIRECTS[clientName]] }) })).json();
    const verifier = randomBytes(32).toString('base64url'), challenge = createHash('sha256').update(verifier).digest('base64url');
    const authz = new URL(base + '/authorize');
    for (const [k, v] of Object.entries({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECTS[clientName], code_challenge: challenge, code_challenge_method: 'S256' })) authz.searchParams.set(k, v);
    const txn = (await (await fetch(authz)).text()).match(/name="txn" value="([^"]+)"/)[1];
    const code = new URL((await fetch(base + '/oauth/login', form({ txn, token: TOKEN }))).headers.get('location')).searchParams.get('code');
    bearer = (await (await fetch(base + '/token', form({ grant_type: 'authorization_code', client_id: reg.client_id, code, code_verifier: verifier, redirect_uri: REDIRECTS[clientName] }))).json()).access_token;
  }
  const client = new Client({ name: clientName || 'by hand', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } }));
  t.after(() => client.close());
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(r.content[0].text);
    return JSON.parse(r.content[0].text);
  };
  call.client = client;
  call.bearer = bearer;
  return call;
}
const edit = () => ({ fps: 30, layers: [{ type: 'text', text: 'Best pasta in Rīga?', at: { x: 0.5, y: 0.2 } }] });

test('Each assistant is told apart by the name its plugin registered under', () => {
  assert.equal(partyOf('ChatGPT'), 'chatgpt');
  assert.equal(partyOf('Claude'), 'claude');
  assert.equal(partyOf('Claude Code (riga)'), 'claude');
  assert.equal(partyOf('Some other client'), null);
  assert.equal(partyOf(undefined), null);
});

test('Gemini signs in as "Google" and its sign-in may be passed on past its callback', async t => {
  assert.equal(partyOf('Google'), 'gemini');
  assert.equal(partyOf('Gemini CLI'), 'gemini');
  const { base } = await serve(t);
  const reg = await (await fetch(base + '/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Google', redirect_uris: [REDIRECTS.Google] }) })).json();
  const authz = new URL(base + '/authorize');
  const params = { response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECTS.Google, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' };
  for (const [k, v] of Object.entries(params)) authz.searchParams.set(k, v);
  const policy = (await fetch(authz)).headers.get('content-security-policy');
  // Chrome checks form-action on every redirect after the login post; Google's callback redirects on again.
  assert.match(policy, /form-action 'self' https:\/\/oauth-redirect\.googleusercontent\.com https:;/);
  const gemini = await connect(t, base, 'Google');
  assert.equal((await gemini('relay_inbox')).you, 'gemini');
});

test('Three assistants: a reply goes back to whoever handed it over, and Gemini names who it asks', async t => {
  const { base } = await serve(t);
  const chatgpt = await connect(t, base, 'ChatGPT'), claude = await connect(t, base, 'Claude'), gemini = await connect(t, base, 'Google');
  await assert.rejects(gemini('relay_start', { title: 'No one named', want: 'reasoning', text: 'Hm?' }), /Say who should answer first with `to`: ChatGPT or Claude, or the owner/);
  const { thread } = await chatgpt('relay_start', { title: 'Second opinion on the river', want: 'review', text: 'Gemini, have a look.', to: 'gemini' });
  await assert.rejects(claude('relay_reply', { thread, verdict: 'answer', text: 'Me?' }), /It is Gemini's turn/);
  assert.deepEqual((await chatgpt('relay_inbox')).waitingForThem.map(x => x.thread), [thread]);
  assert.deepEqual((await claude('relay_inbox')).waitingForThem, [], 'not Claude\'s thread to wait on');
  const back = await gemini('relay_reply', { thread, verdict: 'answer', text: 'Looks right; ask Claude about the water.' });
  assert.equal(back.turn, 'chatgpt', 'back to whoever handed it over');
  assert.equal((await chatgpt('relay_reply', { thread, verdict: 'ask', text: 'Claude, the water?', to: 'claude' })).turn, 'claude');
  assert.equal((await claude('relay_reply', { thread, verdict: 'answer', text: 'Calmer ripples.' })).turn, 'chatgpt');
  const owner = { Authorization: `Basic ${Buffer.from(`admin:${TOKEN}`).toString('base64')}`, 'Content-Type': 'application/json' };
  const handed = await (await fetch(`${base}/api/relay/${thread}`, { method: 'POST', headers: owner, body: JSON.stringify({ text: 'Gemini, last look.', to: 'gemini' }) })).json();
  assert.equal(handed.turn, 'gemini');
  assert.equal((await gemini('relay_wait', { thread, seconds: 1 })).yourTurn, true);
});

test('A revision is described by what it changed', () => {
  const before = edit(), after = edit();
  after.layers[0].at.x = 0.45;
  after.layers.push({ type: 'sticker', name: 'steam' });
  delete after.fps;
  assert.deepEqual(payloadChanges(before, after), ['fps: removed (was 30)', 'layers[0].at.x: 0.5 → 0.45', 'layers[1]: added {"type":"sticker","name":"steam"}']);
  assert.deepEqual(payloadChanges('Caption one', 'Caption two'), ['(the whole payload): "Caption one" → "Caption two"']);
  assert.deepEqual(payloadChanges({ a: [1] }, { a: { b: 1 } }), ['a: [1] → {"b":1}'], 'a list turned into an object is one change, not a walk');
  assert.deepEqual(payloadChanges(edit(), edit()), []);
  const many = payloadChanges(Array.from({ length: 70 }, (_, i) => i), Array.from({ length: 70 }, (_, i) => i + 1), 60);
  assert.equal(many.length, 61);
  assert.equal(many.at(-1), '…and 10 more changes');
});

test('ChatGPT hands an edit to Claude, Claude revises it, and ChatGPT sees exactly what changed', async t => {
  const { base } = await serve(t);
  const chatgpt = await connect(t, base, 'ChatGPT'), claude = await connect(t, base, 'Claude');
  const tools = (await chatgpt.client.listTools()).tools.map(x => x.name);
  for (const name of ['relay_start', 'relay_reply', 'relay_inbox', 'relay_read', 'relay_wait']) assert.ok(tools.includes(name), name);
  assert.match(chatgpt.client.getInstructions(), /relay_start/);

  const opened = await chatgpt('relay_start', { title: 'Pasta reel: title placement', want: 'review', text: 'Is the title too high? Change it if so.', payload: edit() });
  assert.equal(opened.you, 'chatgpt');
  assert.equal(opened.turn, 'claude');
  const thread = opened.thread;
  await assert.rejects(chatgpt('relay_reply', { thread, verdict: 'ask', text: 'Well?' }), /Claude's turn/, 'no answering your own question while the other side has the turn');
  const noted = await chatgpt('relay_reply', { thread, verdict: 'note', text: 'The owner wants it under 20 seconds.' });
  assert.equal(noted.turn, 'claude', 'a note leaves the turn where it was');

  assert.deepEqual((await claude('relay_inbox')).waitingForYou.map(x => x.thread), [thread]);
  assert.deepEqual((await chatgpt('relay_inbox')).waitingForThem.map(x => x.thread), [thread]);
  const arrived = await claude('relay_wait', { seconds: 1 });
  assert.equal(arrived.ready, true);
  assert.equal(arrived.yourTurn, true);
  assert.deepEqual(arrived.messages.map(m => [m.n, m.from, m.verdict]), [[1, 'chatgpt', 'ask'], [2, 'chatgpt', 'note']]);
  assert.deepEqual(arrived.messages[0].payload, edit());

  await assert.rejects(claude('relay_reply', { thread, verdict: 'revise', text: 'Lowered it.' }), /whole revised payload/);
  const revised = edit();
  revised.layers[0].at.y = 0.32;
  const replied = await claude('relay_reply', { thread, verdict: 'revise', text: 'Lowered it out of the status bar area.', payload: revised });
  assert.equal(replied.turn, 'chatgpt');

  const back = await chatgpt('relay_wait', { thread, seconds: 1 });
  assert.equal(back.ready, true);
  assert.deepEqual(back.messages.map(m => m.n), [3], 'only what ChatGPT has not seen: its own note is not repeated');
  assert.deepEqual(back.messages[0].changes, ['layers[0].at.y: 0.2 → 0.32']);
  assert.deepEqual(back.messages[0].payload, revised);

  const closed = await chatgpt('relay_reply', { thread, verdict: 'accept', text: 'Taking it.', close: true });
  assert.deepEqual([closed.status, closed.turn], ['closed', null]);
  const ended = await claude('relay_wait', { thread, seconds: 1 });
  assert.equal(ended.ready, true, 'waiting on a thread also ends when it is closed');
  assert.equal(ended.status, 'closed');
  assert.equal(ended.yourTurn, false);
  assert.deepEqual((await claude('relay_inbox')).recentlyClosed.map(x => x.thread), [thread]);

  const reopened = await claude('relay_reply', { thread, verdict: 'ask', text: 'One more thing: the font?' });
  assert.deepEqual([reopened.status, reopened.turn], ['open', 'chatgpt'], 'answering a closed thread opens it again');
  const read = await chatgpt('relay_read', { thread, since: 3 });
  assert.equal(read.yourTurn, true);
  assert.deepEqual(read.messages.map(m => m.verdict), ['accept', 'ask']);
});

test('relay_wait wakes as soon as the other side answers, and gives up quietly when nobody does', async t => {
  const { base } = await serve(t);
  const chatgpt = await connect(t, base, 'ChatGPT'), claude = await connect(t, base, 'Claude Code (riga)');
  const { thread } = await chatgpt('relay_start', { title: 'Which opener for Saturday?', want: 'reasoning', text: 'Ticket or envelope?' });
  const started = Date.now();
  const waiting = chatgpt('relay_wait', { thread, seconds: 20 });
  await new Promise(r => setTimeout(r, 300));
  await claude('relay_reply', { thread, verdict: 'answer', text: 'Ticket: the day has one headline event.' });
  const answer = await waiting;
  assert.equal(answer.ready, true);
  assert.ok(Date.now() - started < 5000, 'woke on the answer, not at the end of the wait');
  assert.equal(answer.messages[0].from, 'claude', 'Claude Code counts as Claude');

  const nothing = await claude('relay_wait', { seconds: 1 });
  assert.equal(nothing.ready, false);
  assert.deepEqual(nothing.waitingForThem, [thread]);
  assert.match(nothing.next, /call relay_wait again/i);
});

test('A connection that does not say who it is has to, and cannot speak for the other assistant', async t => {
  const { base } = await serve(t);
  const byHand = await connect(t, base), chatgpt = await connect(t, base, 'ChatGPT');
  await assert.rejects(byHand('relay_inbox'), /cannot tell .* `as`/);
  assert.equal((await byHand('relay_inbox', { as: 'claude' })).you, 'claude');
  await assert.rejects(chatgpt('relay_start', { title: 'Pretending', want: 'review', text: 'Hi', as: 'claude' }), /belongs to ChatGPT/);
  await assert.rejects(chatgpt('relay_start', { title: 'To myself', want: 'review', text: 'Hi', to: 'chatgpt' }), /not for yourself/);
  await assert.rejects(chatgpt('relay_start', { title: 'A missing edition', want: 'review', text: 'Hi', refs: { edition: 'a'.repeat(24) } }), /Edition not found/);
  await assert.rejects(chatgpt('relay_start', { title: 'A loose version', want: 'review', text: 'Hi', refs: { version: 2 } }), /needs the `footage`/);
  await assert.rejects(chatgpt('relay_start', { title: 'Too big', want: 'review', text: 'Hi', payload: 'x'.repeat(200_001) }), /under 200 KB/);
  await assert.rejects(chatgpt('relay_read', { thread: 99 }), /no relay thread 99/);
});

test('The owner follows the threads on the dashboard and can hand the turn or close one', async t => {
  const { base } = await serve(t);
  const chatgpt = await connect(t, base, 'ChatGPT'), claude = await connect(t, base, 'Claude');
  const { thread } = await chatgpt('relay_start', { title: 'Caption for Friday', want: 'edit', text: 'Tighten this.', payload: 'A long caption' });
  await claude('relay_reply', { thread, verdict: 'revise', text: 'Shorter, and should this go out today? Owner to decide.', payload: 'A caption', to: 'owner' });
  const owner = { Authorization: `Basic ${Buffer.from(`admin:${TOKEN}`).toString('base64')}`, 'Content-Type': 'application/json' };
  const listed = await (await fetch(base + '/api/relay', { headers: owner })).json();
  assert.equal(listed.threads[0].turn, 'owner');
  assert.deepEqual(listed.threads[0].messages[1].changes, ['(the whole payload): "A long caption" → "A caption"']);
  assert.equal((await fetch(base + '/api/relay', { headers: { Authorization: `Bearer ${chatgpt.bearer}` } })).status, 401, 'an assistant\'s token reaches the relay only through its tools');

  const say = body => fetch(`${base}/api/relay/${thread}`, { method: 'POST', headers: owner, body: JSON.stringify(body) });
  assert.equal((await say({})).status, 400, 'nothing to send');
  const handed = await (await say({ text: 'Yes, today. ChatGPT, schedule it.', to: 'chatgpt' })).json();
  assert.equal(handed.turn, 'chatgpt');
  assert.equal((await chatgpt('relay_wait', { thread, seconds: 1 })).messages.at(-1).from, 'owner');
  const closed = await (await say({ close: true })).json();
  assert.deepEqual([closed.status, closed.turn], ['closed', null]);
  assert.equal((await fetch(`${base}/api/relay/42`, { method: 'POST', headers: owner, body: JSON.stringify({ text: 'Hello?' }) })).status, 404);
});
