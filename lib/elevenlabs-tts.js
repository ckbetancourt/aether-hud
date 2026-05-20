/**
 * ElevenLabs TTS proxy helpers (API key stays server-side).
 */

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';
const ELEVENLABS_API_KEY = (process.env.ELEVENLABS_API_KEY || '').trim();
const ELEVENLABS_MODEL_ID = (process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2_5').trim();
const ELEVENLABS_DEFAULT_VOICE_ID = (process.env.ELEVENLABS_DEFAULT_VOICE_ID || '').trim();
const MAX_SPEECH_CHARS = 5000;

function isElevenLabsConfigured() {
  return Boolean(ELEVENLABS_API_KEY);
}

function elevenLabsHeaders(extra = {}) {
  return {
    'xi-api-key': ELEVENLABS_API_KEY,
    Accept: 'application/json',
    ...extra,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function speedToStability(speed) {
  const parsed = Number(speed);
  const rate = Number.isFinite(parsed) ? parsed : 1.0;
  return clamp(1.1 - rate, 0.3, 0.85);
}

function truncateText(text) {
  const trimmed = String(text || '').trim();
  if (trimmed.length <= MAX_SPEECH_CHARS) {
    return trimmed;
  }
  console.warn(
    `[elevenlabs] Text truncated from ${trimmed.length} to ${MAX_SPEECH_CHARS} characters`
  );
  return trimmed.slice(0, MAX_SPEECH_CHARS);
}

async function parseElevenLabsError(res) {
  const raw = await res.text().catch(() => '');
  try {
    const data = JSON.parse(raw);
    const detail = data.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
    if (detail?.message) return detail.message;
    if (data.message) return data.message;
  } catch {
    /* use raw */
  }
  return raw || `ElevenLabs HTTP ${res.status}`;
}

function assertConfigured() {
  if (!isElevenLabsConfigured()) {
    const err = new Error('ElevenLabs is not configured. Set ELEVENLABS_API_KEY in .env.local');
    err.statusCode = 503;
    throw err;
  }
}

async function fetchElevenLabsVoices() {
  assertConfigured();

  const res = await fetch(`${ELEVENLABS_API_BASE}/voices`, {
    method: 'GET',
    headers: elevenLabsHeaders(),
  });

  if (!res.ok) {
    const message = await parseElevenLabsError(res);
    const err = new Error(message);
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  const data = await res.json();
  const list = Array.isArray(data?.voices) ? data.voices : [];
  return list.map((v) => ({
    id: v.voice_id,
    name: v.name,
    category: v.category || null,
    labels: v.labels || {},
  }));
}

async function synthesizeElevenLabsSpeech({ text, voiceId, speed }) {
  assertConfigured();

  const resolvedVoiceId = (voiceId || ELEVENLABS_DEFAULT_VOICE_ID || '').trim();
  if (!resolvedVoiceId) {
    const err = new Error('voiceId is required (set in Settings or ELEVENLABS_DEFAULT_VOICE_ID)');
    err.statusCode = 400;
    throw err;
  }

  const cleanText = truncateText(text);
  if (!cleanText) {
    const err = new Error('text is required');
    err.statusCode = 400;
    throw err;
  }

  const res = await fetch(
    `${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(resolvedVoiceId)}`,
    {
      method: 'POST',
      headers: elevenLabsHeaders({
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      }),
      body: JSON.stringify({
        text: cleanText,
        model_id: ELEVENLABS_MODEL_ID,
        voice_settings: {
          stability: speedToStability(speed),
          similarity_boost: 0.75,
        },
      }),
    }
  );

  if (!res.ok) {
    const message = await parseElevenLabsError(res);
    const err = new Error(message);
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType: res.headers.get('content-type') || 'audio/mpeg' };
}

module.exports = {
  isElevenLabsConfigured,
  fetchElevenLabsVoices,
  synthesizeElevenLabsSpeech,
  ELEVENLABS_DEFAULT_VOICE_ID,
};
