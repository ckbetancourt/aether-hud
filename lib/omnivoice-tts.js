/**
 * OmniVoice local TTS proxy (OmniVoice-local REST API on OMNIVOICE_BASE_URL).
 */

const OMNIVOICE_BASE_URL = (process.env.OMNIVOICE_BASE_URL || 'http://127.0.0.1:8000')
  .trim()
  .replace(/\/$/, '');
const OMNIVOICE_API_KEY = (process.env.OMNIVOICE_API_KEY || '').trim();
const OMNIVOICE_DEFAULT_SAMPLE = (process.env.OMNIVOICE_DEFAULT_SAMPLE || '').trim();
const OMNIVOICE_DEFAULT_INSTRUCT = (process.env.OMNIVOICE_DEFAULT_INSTRUCT || '').trim();
const MAX_SPEECH_CHARS = 5000;
const FETCH_TIMEOUT_MS = 180_000;

function isOmniVoiceConfigured() {
  return Boolean(OMNIVOICE_BASE_URL);
}

function omniVoiceHeaders(extra = {}) {
  const headers = {
    Accept: 'application/json',
    ...extra,
  };
  if (OMNIVOICE_API_KEY) {
    headers.Authorization = `Bearer ${OMNIVOICE_API_KEY}`;
  }
  return headers;
}

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

function truncateText(text) {
  const trimmed = String(text || '').trim();
  if (trimmed.length <= MAX_SPEECH_CHARS) {
    return trimmed;
  }
  console.warn(
    `[omnivoice] Text truncated from ${trimmed.length} to ${MAX_SPEECH_CHARS} characters`
  );
  return trimmed.slice(0, MAX_SPEECH_CHARS);
}

async function parseOmniVoiceError(res) {
  const raw = await res.text().catch(() => '');
  try {
    const data = JSON.parse(raw);
    const detail = data.detail;
    if (typeof detail === 'string') return detail;
    if (detail?.error) return detail.error;
    if (detail?.message) return detail.message;
    if (data.message) return data.message;
    if (data.error) return typeof data.error === 'string' ? data.error : data.error?.message;
  } catch {
    /* use raw */
  }
  return raw || `OmniVoice HTTP ${res.status}`;
}

function assertConfigured() {
  if (!isOmniVoiceConfigured()) {
    const err = new Error(
      'OmniVoice is not configured. Set OMNIVOICE_BASE_URL in .env.local'
    );
    err.statusCode = 503;
    throw err;
  }
}

function isModelReady(healthData) {
  if (!healthData || typeof healthData !== 'object') return false;
  if (healthData.ready === true) return true;
  if (healthData.status === 'ready') return true;
  if (healthData.model_loaded === true) return true;
  return false;
}

async function probeOmniVoiceHealth() {
  if (!isOmniVoiceConfigured()) {
    return { ready: false, error: 'OMNIVOICE_BASE_URL is not set' };
  }

  try {
    const res = await fetchWithTimeout(`${OMNIVOICE_BASE_URL}/health`, {
      method: 'GET',
      headers: omniVoiceHeaders(),
    });

    if (!res.ok) {
      const message = await parseOmniVoiceError(res);
      return { ready: false, error: message };
    }

    const data = await res.json().catch(() => ({}));
    if (!isModelReady(data)) {
      return {
        ready: false,
        error: data.message || data.detail || 'Model not loaded yet',
      };
    }
    return { ready: true };
  } catch (e) {
    const message =
      e.name === 'AbortError'
        ? 'OmniVoice health check timed out'
        : e.message || 'Cannot reach OmniVoice server';
    return { ready: false, error: message };
  }
}

async function fetchOmniVoiceSamples() {
  assertConfigured();

  const health = await probeOmniVoiceHealth();
  if (!health.ready) {
    const err = new Error(health.error || 'OmniVoice model not ready');
    err.statusCode = 503;
    throw err;
  }

  const res = await fetchWithTimeout(`${OMNIVOICE_BASE_URL}/samples`, {
    method: 'GET',
    headers: omniVoiceHeaders(),
  });

  if (!res.ok) {
    const message = await parseOmniVoiceError(res);
    const err = new Error(message);
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  const data = await res.json();
  const list = Array.isArray(data) ? data : [];
  return list.map((s) => ({
    id: s.name,
    name: s.name,
    hasTranscript: Boolean(s.has_transcript),
    audioFile: s.audio_file || null,
  }));
}

async function synthesizeOmniVoiceSpeech({ text, sample, instruct, speed }) {
  assertConfigured();

  const health = await probeOmniVoiceHealth();
  if (!health.ready) {
    const err = new Error(health.error || 'OmniVoice model not ready');
    err.statusCode = 503;
    throw err;
  }

  const cleanText = truncateText(text);
  if (!cleanText) {
    const err = new Error('text is required');
    err.statusCode = 400;
    throw err;
  }

  const resolvedSample = (sample || OMNIVOICE_DEFAULT_SAMPLE || '').trim();
  const resolvedInstruct = (instruct || OMNIVOICE_DEFAULT_INSTRUCT || '').trim();

  const body = {
    text: cleanText,
    output_format: 'wav',
  };

  if (resolvedSample) {
    body.sample = resolvedSample;
  } else if (resolvedInstruct) {
    body.instruct = resolvedInstruct;
  }

  const parsedSpeed = Number(speed);
  if (Number.isFinite(parsedSpeed) && parsedSpeed > 0 && parsedSpeed !== 1) {
    body.speed = parsedSpeed;
  }

  const res = await fetchWithTimeout(`${OMNIVOICE_BASE_URL}/tts`, {
    method: 'POST',
    headers: omniVoiceHeaders({
      'Content-Type': 'application/json',
      Accept: 'audio/wav',
    }),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const message = await parseOmniVoiceError(res);
    const err = new Error(message);
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType: res.headers.get('content-type') || 'audio/wav' };
}

module.exports = {
  isOmniVoiceConfigured,
  probeOmniVoiceHealth,
  fetchOmniVoiceSamples,
  synthesizeOmniVoiceSpeech,
  OMNIVOICE_BASE_URL,
  OMNIVOICE_DEFAULT_SAMPLE,
  OMNIVOICE_DEFAULT_INSTRUCT,
};
