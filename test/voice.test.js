// Generated sound: the narration board, what it costs, the captions a voice times for itself, and the
// shape of every request that leaves for ElevenLabs. Nothing here touches the network or a key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEUTRAL_VOICE, STYLES, STYLE_NAMES, capReading, captionLayers, estimateCredits, voiceSettings, wordsFromAlignment } from '../src/voice.js';
import { createEleven } from '../src/eleven.js';

// ---- the board -------------------------------------------------------------------------------------

test('every delivery on the board says what it is for and sets only knobs that exist', () => {
  assert.ok(STYLE_NAMES.length >= 8, 'a board worth reading');
  for (const name of STYLE_NAMES) {
    const style = STYLES[name];
    assert.match(style.about, /\w+ \w+ \w+/, `${name} needs a description a model can choose from`);
    for (const [k, v] of Object.entries(style.set)) {
      assert.ok(k in NEUTRAL_VOICE, `${name} sets an unknown knob ${k}`);
      assert.equal(typeof v, 'number', `${name}.${k} has to be a number to mix`);
    }
    assert.ok(style.set.stability >= 0 && style.set.stability <= 1, `${name}: stability is 0-1`);
  }
});

test('a delivery mixes in from plain at 0 to all of it at 1', () => {
  assert.deepEqual(voiceSettings('elegy', 0), NEUTRAL_VOICE, 'strength 0 is the voice as recorded');
  const full = voiceSettings('elegy', 1);
  assert.equal(full.speed, STYLES.elegy.set.speed);
  const half = voiceSettings('elegy', 0.5);
  assert.ok(half.speed > full.speed && half.speed < NEUTRAL_VOICE.speed, `half way, not ${half.speed}`);
  assert.equal(half.use_speaker_boost, true, 'a switch is not something to be half of');
});

test('an unknown delivery falls back to the plain voice rather than failing', () => {
  assert.deepEqual(voiceSettings('no-such-style'), NEUTRAL_VOICE);
});

test('the slow deliveries really are slower, and the pushed ones more expressive', () => {
  assert.ok(STYLES.elegy.set.speed < STYLES['cinematic-sad'].set.speed, 'an elegy is slower than sad');
  assert.ok(STYLES['news-brisk'].set.speed > 1, 'news reads fast');
  assert.ok(STYLES['epic-declaim'].set.style > STYLES['documentary-warm'].set.style, 'a trailer voice leans in further than a narrator');
});

// ---- what it costs ---------------------------------------------------------------------------------

test('an estimate is made before the call, because an unmade call is the only free one', () => {
  assert.equal(estimateCredits('speech', { text: 'a'.repeat(900) }), 900);
  assert.equal(estimateCredits('speech', { text: 'a'.repeat(900), model: 'eleven_flash_v2_5' }), 450, 'flash is half');
  assert.equal(estimateCredits('effect', { seconds: 3 }), 120, '40 credits a second');
  assert.equal(estimateCredits('effect', { seconds: 0 }), 20, 'and never less than half a second');
  assert.ok(estimateCredits('music', { seconds: 30 }) > estimateCredits('effect', { seconds: 30 }), 'music is assumed dearer than an effect');
  assert.equal(estimateCredits('nonsense', {}), 0);
});

// ---- captions from the voice's own timings ---------------------------------------------------------

const alignment = (text, per = 0.1) => ({
  characters: [...text],
  character_start_times_seconds: [...text].map((_, i) => +(i * per).toFixed(3)),
  character_end_times_seconds: [...text].map((_, i) => +((i + 1) * per).toFixed(3)),
});

test('characters are gathered back into words, with the punctuation kept on them', () => {
  const words = wordsFromAlignment(alignment('No lift.'));
  assert.deepEqual(words.map(w => w.word), ['No', 'lift.'], 'the full stop belongs to the word, not to a caption of its own');
  assert.equal(words[0].from, 0);
  assert.ok(Math.abs(words[0].to - 0.2) < 1e-6, `"No" ends when its second letter does, not ${words[0].to}`);
  assert.ok(Math.abs(words[1].from - 0.3) < 1e-6, 'and the next word starts after the space');
});

test('an empty or missing alignment gives no words rather than throwing', () => {
  assert.deepEqual(wordsFromAlignment(null), []);
  assert.deepEqual(wordsFromAlignment({ characters: [] }), []);
  assert.deepEqual(wordsFromAlignment(alignment('   ')), [], 'whitespace alone is not a word');
});

test('captions land on the voice, in output frames, offset by where the cue was placed', () => {
  const words = wordsFromAlignment(alignment('one two three four five six'));
  const lines = captionLayers(words, { at: 90, fps: 30, perLine: 3 });
  assert.equal(lines.length, 2, 'six words, three to a line');
  assert.equal(lines[0].text, 'one two three');
  assert.equal(lines[1].text, 'four five six');
  assert.ok(lines[0].from >= 90, 'nothing starts before the narration does');
  assert.equal(lines[0].from, 90 + Math.round(words[0].from * 30));
  for (const l of lines) assert.ok(l.to > l.from, 'a caption has to last');
});

test('one caption holds until the next arrives, so no gap reads as a dropped word', () => {
  const words = wordsFromAlignment(alignment('alpha beta gamma delta'));
  const lines = captionLayers(words, { at: 0, fps: 30, perLine: 2 });
  assert.equal(lines[0].to, lines[1].from, 'the first hands straight over to the second');
  const last = lines.at(-1);
  assert.ok(last.to > Math.round(words.at(-1).to * 30), 'and the last one keeps a tail after the final word');
});

test('moving the cue moves every caption with it', () => {
  const words = wordsFromAlignment(alignment('a bb ccc'));
  const a = captionLayers(words, { at: 0, fps: 30 }), b = captionLayers(words, { at: 45, fps: 30 });
  a.forEach((l, i) => { assert.equal(b[i].from - l.from, 45); assert.equal(b[i].to - l.to, 45); });
});

// ---- what actually goes to ElevenLabs --------------------------------------------------------------
// The request shapes are checked against the published API, because a wrong field name is the failure
// that costs a key, a deploy and a confusing 422 to find.

const spy = (reply) => { const calls = []; return { calls, fetcher: async (url, opts) => { calls.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : null }); return reply(url, opts); } }; };
const audio = () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('ID3fake').buffer });
const env = { ELEVENLABS_API_KEY: 'k-123' };

test('speech goes to the voice with the model, the settings and a format the pipeline can read', async () => {
  const { calls, fetcher } = spy(audio);
  const buf = await createEleven(env, fetcher).speech('voice-9', 'Hello', voiceSettings('poem-narrative'));
  assert.ok(Buffer.isBuffer(buf) && buf.length);
  assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/text-to-speech/voice-9');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['xi-api-key'], 'k-123');
  assert.equal(calls[0].body.text, 'Hello');
  assert.equal(calls[0].body.model_id, 'eleven_multilingual_v2');
  assert.equal(calls[0].body.output_format, 'mp3_44100_128');
  assert.equal(calls[0].body.voice_settings.speed, STYLES['poem-narrative'].set.speed);
});

test('a voice id with something odd in it cannot reshape the URL', async () => {
  const { calls, fetcher } = spy(audio);
  await createEleven(env, fetcher).speech('../../user/subscription', 'hi', NEUTRAL_VOICE);
  assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/text-to-speech/..%2F..%2Fuser%2Fsubscription');
});

test('the timestamps call unpacks the audio and the alignment out of one answer', async () => {
  const { fetcher } = spy(async () => ({ ok: true, status: 200, json: async () => ({
    audio_base64: Buffer.from('fake-mp3').toString('base64'), normalized_alignment: alignment('hi there') }) }));
  const got = await createEleven(env, fetcher).speechWithTimings('v', 'hi there', NEUTRAL_VOICE);
  assert.equal(got.buffer.toString(), 'fake-mp3');
  assert.deepEqual(wordsFromAlignment(got.alignment).map(w => w.word), ['hi', 'there']);
});

test('a sound effect carries its length, its literalness and whether it loops', async () => {
  const { calls, fetcher } = spy(audio);
  await createEleven(env, fetcher).effect('tyres on gravel', 3, 0.6, true);
  assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/sound-generation');
  assert.deepEqual(calls[0].body, { text: 'tyres on gravel', model_id: 'eleven_text_to_sound_v2', prompt_influence: 0.6, duration_seconds: 3, loop: true });
  const second = spy(audio);
  await createEleven(env, second.fetcher).effect('a door', undefined, 0.3, false);
  assert.ok(!('duration_seconds' in second.calls[0].body), 'no length given means ElevenLabs picks one, not that it is zero');
  assert.ok(!('loop' in second.calls[0].body));
});

test('music asks in milliseconds, which is what the endpoint takes', async () => {
  const { calls, fetcher } = spy(audio);
  await createEleven(env, fetcher).music('slow piano, sparse', 42000);
  assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/music');
  assert.deepEqual(calls[0].body, { prompt: 'slow piano, sparse', music_length_ms: 42000 });
});

test('the account\'s own count is what a cap can be enforced against', async () => {
  const { fetcher } = spy(async () => ({ ok: true, status: 200, json: async () => ({
    character_count: 4200, character_limit: 121000, next_character_count_reset_unix: 1790000000, tier: 'creator' }) }));
  const sub = await createEleven(env, fetcher).subscription();
  assert.equal(sub.used, 4200);
  assert.equal(sub.limit, 121000);
  assert.equal(sub.tier, 'creator');
  assert.match(sub.resets, /^\d{4}-\d{2}-\d{2}T/);
});

test('without a key nothing is attempted, and the message says whose job it is', async () => {
  const { calls, fetcher } = spy(audio);
  const none = createEleven({}, fetcher);
  assert.equal(none.configured(), false);
  await assert.rejects(() => none.speech('v', 'hi', NEUTRAL_VOICE), /ELEVENLABS_API_KEY/);
  assert.equal(calls.length, 0, 'and no request went out');
});

test('ElevenLabs\' own refusals are turned into something the owner can act on', async () => {
  const cases = [
    [401, {}, /API key/i],
    [403, { detail: { message: 'not on your plan' } }, /plan/i],
    [404, { detail: 'voice not found' }, /no such voice/i],
    [422, { detail: [{ msg: 'too long' }] }, /would not accept/i],
    [429, {}, /rate limiting|too many/i],
    [500, {}, /HTTP 500/],
  ];
  for (const [status, body, expected] of cases) {
    const { fetcher } = spy(async () => ({ ok: false, status, json: async () => body }));
    await assert.rejects(() => createEleven(env, fetcher).speech('v', 'hi', NEUTRAL_VOICE), expected, `HTTP ${status}`);
  }
});

test('an answer with no audio in it is a failure, not an empty sound', async () => {
  const { fetcher } = spy(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }));
  await assert.rejects(() => createEleven(env, fetcher).speech('v', 'hi', NEUTRAL_VOICE), /no audio/);
});

test('a network failure says it could not reach ElevenLabs, not that the request was bad', async () => {
  const fetcher = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  await assert.rejects(() => createEleven(env, fetcher).speech('v', 'hi', NEUTRAL_VOICE), /Could not reach ElevenLabs/);
});

// ---- the cap, against a counter that lags -----------------------------------------------------------
// Measured on the server: a 19-character generation moved ElevenLabs' own character_count by nothing,
// and it had still not moved a minute later. A cap that trusts only that number does not stop a burst.

test('with nothing spent yet, the cap sees exactly what the account says', () => {
  assert.deepEqual(capReading({ accountUsed: 294, seen: null }), { used: 294, unreflected: 0, remember: true });
});

test('while the account counter has not moved, this server\'s own spend still counts', () => {
  const seen = { used: 294, at: '2026-10-03T10:00:00.000Z' };
  const r = capReading({ accountUsed: 294, seen, spentSince: 1200 });
  assert.equal(r.used, 1494, 'the cap is measured against the counter plus what it has not caught up with');
  assert.equal(r.unreflected, 1200);
  assert.equal(r.remember, false, 'and the mark stays where it was');
});

test('when the counter catches up the mark resets, so nothing is counted twice', () => {
  const seen = { used: 294, at: '2026-10-03T10:00:00.000Z' };
  const r = capReading({ accountUsed: 1494, seen, spentSince: 1200 });
  assert.equal(r.used, 1494, 'not 2694: the ledger is not added on top of a counter that has caught up');
  assert.equal(r.unreflected, 0);
  assert.equal(r.remember, true, 'and the mark moves to the new number');
});

test('spending somewhere else shows up as a jump and is caught the same way', () => {
  const seen = { used: 294, at: '2026-10-03T10:00:00.000Z' };
  const r = capReading({ accountUsed: 9000, seen, spentSince: 0 });
  assert.equal(r.used, 9000, 'the owner generating in the ElevenLabs app counts against the cap too');
  assert.equal(r.remember, true);
});

test('a burst cannot outrun the cap while the account is still lagging', () => {
  const cap = 1000, seen = { used: 0, at: '2026-10-03T10:00:00.000Z' };
  let ledger = 0, made = 0;
  // Twenty requests of 120 credits each, with the account counter frozen the whole way through.
  for (let i = 0; i < 20; i++) {
    const { used } = capReading({ accountUsed: 0, seen, spentSince: ledger });
    if (used + 120 > cap) break;
    ledger += 120; made++;
  }
  assert.equal(made, 8, `the cap stops it at eight, not twenty: ${made}`);
  assert.ok(ledger <= cap, `and never goes past the cap: ${ledger}`);
});
