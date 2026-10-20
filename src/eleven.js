// The ElevenLabs client: speech, sound effects and music, plus what the account has left.
//
// Everything here is one host and one key, so none of the SSRF machinery that guards `fetchPublic`
// applies - and none of its protection either, which is why the key never leaves this file and the URL
// is never built from anything a caller supplied. ChatGPT asks for "a whoosh"; it cannot ask for a URL.
//
// The fetcher is injected so the tests can run the whole path without a network or a key.
const API = 'https://api.elevenlabs.io/v1';
const MAX_AUDIO = 60 * 1048576;

const fail = (message, httpStatus = 400) => Object.assign(new Error(message), { httpStatus });

// ElevenLabs' own errors are JSON with a detail object; its status codes are worth translating, because
// "422" tells the owner nothing and "that voice id is not on your account" tells them what to do.
function explain(status, body) {
  const detail = body?.detail;
  const said = typeof detail === 'string' ? detail : detail?.message || body?.message || '';
  if (status === 401) return fail('ElevenLabs refused the API key. Check ELEVENLABS_API_KEY on the server.', 502);
  if (status === 403) return fail(`ElevenLabs refused this request${said ? `: ${said}` : ''}. The plan may not include it.`, 502);
  if (status === 404) return fail(`ElevenLabs has no such voice or model${said ? `: ${said}` : ''}`, 400);
  if (status === 422) return fail(`ElevenLabs would not accept that${said ? `: ${said}` : ''}`, 400);
  if (status === 429) return fail('ElevenLabs is rate limiting, or too many generations are running at once. Try again in a moment.', 503);
  return fail(`ElevenLabs returned HTTP ${status}${said ? `: ${said}` : ''}`, 502);
}

export function createEleven(env = process.env, fetcher = fetch) {
  const key = (env.ELEVENLABS_API_KEY || '').trim();
  const model = env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
  const needKey = () => { if (!key) throw fail('Generated sound is not set up on this server: ELEVENLABS_API_KEY is not set. Ask the owner to add it.', 503); };

  async function call(path, { method = 'GET', body = null, json = true, timeout = 180000 } = {}) {
    needKey();
    let res;
    try {
      res = await fetcher(`${API}${path}`, {
        method,
        headers: { 'xi-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}), accept: json ? 'application/json' : 'audio/*' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      throw fail(err.name === 'TimeoutError' ? 'ElevenLabs took too long to answer' : `Could not reach ElevenLabs (${err.message})`, 502);
    }
    if (!res.ok) throw explain(res.status, await res.json().catch(() => null));
    if (json) return res.json();
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) throw fail('ElevenLabs answered with no audio', 502);
    if (buffer.length > MAX_AUDIO) throw fail('ElevenLabs answered with more audio than this server will take', 502);
    return buffer;
  }

  return {
    configured: () => !!key,
    model,

    // The account's own count of what it has spent, which is what the cap is enforced against: an
    // estimate made here could drift from the truth, and a cap that drifts is not a cap.
    async subscription() {
      const s = await call('/user/subscription');
      return {
        used: Number(s.character_count) || 0,
        limit: Number(s.character_limit) || 0,
        resets: s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000).toISOString() : null,
        tier: s.tier || null,
      };
    },

    // The speech models this account may use, with what each costs per character as ElevenLabs itself
    // reports it, and whether it listens to the `style` knob. Both matter: the cost decides the estimate
    // the cap is checked against, and can_use_style decides whether a delivery is sent as a knob or
    // written into the text as a tag.
    async models() {
      const got = await call('/models');
      return (got || []).filter(m => m.can_do_text_to_speech).map(m => ({
        model: m.model_id, name: m.name, about: m.description || null,
        rate: m.model_rates?.character_cost_multiplier ?? 1,
        canStyle: m.can_use_style !== false, canSpeakerBoost: m.can_use_speaker_boost !== false,
        maxCharacters: m.max_characters_request_subscribed_user ?? null,
        languages: (m.languages || []).length,
      }));
    },

    async voices() {
      const got = await call('/voices');
      return (got.voices || []).map(v => ({ voice: v.voice_id, name: v.name, about: v.description || v.labels?.description || null,
        labels: v.labels ?? {}, preview: v.preview_url || null }));
    },

    speech: (voice, text, settings, use = model, extra = {}) =>
      call(`/text-to-speech/${encodeURIComponent(voice)}`, { method: 'POST', json: false,
        body: { text, model_id: use, voice_settings: settings, output_format: 'mp3_44100_128', ...extra } }),

    // The same read, with the start and end of every character it spoke, so captions can land on the
    // voice rather than being timed by hand. The audio comes back inside the JSON, base64.
    async speechWithTimings(voice, text, settings, use = model, extra = {}) {
      const got = await call(`/text-to-speech/${encodeURIComponent(voice)}/with-timestamps`, { method: 'POST',
        body: { text, model_id: use, voice_settings: settings, output_format: 'mp3_44100_128', ...extra } });
      if (!got.audio_base64) throw fail('ElevenLabs answered without any audio', 502);
      return { buffer: Buffer.from(got.audio_base64, 'base64'), alignment: got.normalized_alignment || got.alignment || null };
    },

    effect: (text, seconds, influence, loop) =>
      call('/sound-generation', { method: 'POST', json: false,
        body: { text, model_id: 'eleven_text_to_sound_v2', prompt_influence: influence, ...(seconds ? { duration_seconds: seconds } : {}), ...(loop ? { loop: true } : {}) } }),

    music: (prompt, ms) =>
      call('/music', { method: 'POST', json: false, timeout: 300000, body: { prompt, music_length_ms: ms } }),
  };
}
