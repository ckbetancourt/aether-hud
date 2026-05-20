/**
 * Serves the static HUD and bridges chat to Hermes Agent by default.
 * Keeps API keys on the server (dotenv: .env then .env.local overrides).
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '.env.local'), override: true });

const http = require('http');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8787;
const AETHER_BACKEND = (process.env.AETHER_BACKEND || 'hermes').toLowerCase();
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const HERMES_API_BASE_URL = (process.env.HERMES_API_BASE_URL || 'http://127.0.0.1:8000/v1').replace(/\/$/, '');
const HERMES_MODEL = process.env.HERMES_MODEL || 'hermes';
const HERMES_API_KEY = process.env.HERMES_API_KEY || '';
const HERMES_PROFILE = process.env.HERMES_PROFILE || '';
const HERMES_PROFILES_URL = (process.env.HERMES_PROFILES_URL || '').trim();
const HERMES_SESSIONS_URL = (process.env.HERMES_SESSIONS_URL || '').trim();
const IS_HERMES_BACKEND = AETHER_BACKEND === 'hermes';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const {
  buildAetherSystemPrompt,
} = require('./aether-config.js');

function buildSystemPrompt(body = {}) {
  if (body.voiceSystemPrompt && typeof body.voiceSystemPrompt === 'string') {
    return body.voiceSystemPrompt;
  }
  return buildAetherSystemPrompt();
}

function runtimeTemperature() {
  const parsed = Number(process.env.AETHER_TEMPERATURE);
  return Number.isFinite(parsed) ? parsed : 0.7;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function openAiHeaders(apiKey, extra = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extra,
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function chatCompletionsUrl(baseUrl) {
  return `${baseUrl.replace(/\/$/, '')}/chat/completions`;
}

function normalizeMessages(messages) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? ''),
  }));
}

function parseUpstreamError(status, text) {
  let detail = text;
  try {
    const j = JSON.parse(text);
    detail = j.error?.message || j.message || text;
  } catch {
    /* keep text */
  }
  const err = new Error(detail || `Upstream HTTP ${status}`);
  err.statusCode = status >= 400 && status < 600 ? status : 502;
  return err;
}

async function callChatCompletions({ baseUrl, model, apiKey, messages, temperature, maxTokens, extraHeaders = {} }) {
  const res = await fetch(chatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: openAiHeaders(apiKey, extraHeaders),
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    throw parseUpstreamError(res.status, await res.text());
  }

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content;
  if (!reply || typeof reply !== 'string') {
    const err = new Error('Empty or invalid completion from model');
    err.statusCode = 502;
    throw err;
  }
  return { reply, raw: data };
}

async function handleOpenAiChat(body) {
  const { messages } = body;
  if (!messages || !Array.isArray(messages)) {
    const err = new Error('Invalid body: expected { messages: [...] }');
    err.statusCode = 400;
    throw err;
  }

  if (process.env.AETHER_DEBUG === '1') {
    console.log('[api/chat] ->', `${OPENAI_BASE_URL}/chat/completions`, 'model:', OPENAI_MODEL);
  }

  const sys = buildSystemPrompt(body);
  const openaiMessages = [
    { role: 'system', content: sys },
    ...normalizeMessages(messages),
  ];
  const result = await callChatCompletions({
    baseUrl: OPENAI_BASE_URL,
    model: OPENAI_MODEL,
    apiKey: OPENAI_API_KEY,
    messages: openaiMessages,
    temperature: runtimeTemperature(),
    maxTokens: 2048,
  });
  return { reply: result.reply, backend: 'openai' };
}

function hermesSystemPrompt(body) {
  const base = buildSystemPrompt(body);
  return [
    base,
    '',
    '---',
    '',
    '## Hermes Agent bridge',
    'You are operating through Hermes Agent as the runtime behind the Aether voice HUD.',
    'Use Hermes tools, APIs, memory, sessions, and profile context when the runtime provides them.',
    'Keep responses voice-first and report tool or agent state in concise spoken language.',
  ].join('\n');
}

function hermesHeaders(body) {
  const sessionId = body.hermesSessionId || body.sessionId || '';
  const profile = body.hermesProfile || HERMES_PROFILE || '';
  const headers = {};
  if (sessionId) headers['X-Hermes-Session-Id'] = String(sessionId);
  if (profile) headers['X-Hermes-Profile'] = String(profile);
  headers['X-Hermes-Use-Tools'] = 'true';
  return headers;
}

async function handleHermesChat(body) {
  const { messages } = body;
  if (!messages || !Array.isArray(messages)) {
    const err = new Error('Invalid body: expected { messages: [...] }');
    err.statusCode = 400;
    throw err;
  }

  if (process.env.AETHER_DEBUG === '1') {
    console.log('[api/chat] -> Hermes', chatCompletionsUrl(HERMES_API_BASE_URL), 'model:', HERMES_MODEL);
  }

  let result;
  try {
    result = await callChatCompletions({
      baseUrl: HERMES_API_BASE_URL,
      model: HERMES_MODEL,
      apiKey: HERMES_API_KEY,
      messages: [
        { role: 'system', content: hermesSystemPrompt(body) },
        ...normalizeMessages(messages),
      ],
      temperature: runtimeTemperature(),
      maxTokens: 2048,
      extraHeaders: hermesHeaders(body),
    });
  } catch (e) {
    if (e.statusCode) throw e;
    const err = new Error(`Hermes API is unreachable at ${HERMES_API_BASE_URL}. ${e.message}`);
    err.statusCode = 503;
    throw err;
  }

  return {
    reply: result.reply,
    backend: 'hermes',
    hermes: {
      sessionId:
        result.raw.session_id ||
        result.raw.sessionId ||
        result.raw.conversation_id ||
        result.raw.conversationId ||
        body.hermesSessionId ||
        null,
      profile: body.hermesProfile || HERMES_PROFILE || null,
      model: HERMES_MODEL,
    },
  };
}

async function handleChat(body) {
  if (IS_HERMES_BACKEND) {
    return handleHermesChat(body);
  }
  return handleOpenAiChat(body);
}

async function probeHermesStatus() {
  if (!IS_HERMES_BACKEND) {
    return {
      enabled: false,
      backend: AETHER_BACKEND,
      connected: false,
      reason: 'AETHER_BACKEND is not set to hermes.',
    };
  }

  const modelsUrl = `${HERMES_API_BASE_URL}/models`;
  try {
    const res = await fetch(modelsUrl, {
      method: 'GET',
      headers: openAiHeaders(HERMES_API_KEY),
    });
    if (!res.ok) {
      return {
        enabled: true,
        backend: 'hermes',
        connected: false,
        baseUrl: HERMES_API_BASE_URL,
        model: HERMES_MODEL,
        profile: HERMES_PROFILE || null,
        error: `Hermes status probe failed with HTTP ${res.status}.`,
      };
    }
    const data = await res.json().catch(() => ({}));
    return {
      enabled: true,
      backend: 'hermes',
      connected: true,
      baseUrl: HERMES_API_BASE_URL,
      model: HERMES_MODEL,
      profile: HERMES_PROFILE || null,
      capabilities: {
        chat: true,
        profiles: Boolean(HERMES_PROFILES_URL || HERMES_PROFILE),
        sessions: Boolean(HERMES_SESSIONS_URL),
        streaming: false,
      },
      models: Array.isArray(data.data) ? data.data.slice(0, 12) : [],
    };
  } catch (e) {
    return {
      enabled: true,
      backend: 'hermes',
      connected: false,
      baseUrl: HERMES_API_BASE_URL,
      model: HERMES_MODEL,
      profile: HERMES_PROFILE || null,
      error: `Hermes API is unreachable at ${HERMES_API_BASE_URL}. ${e.message}`,
    };
  }
}

async function fetchOptionalHermesList(kind, url, fallbackItem) {
  if (!IS_HERMES_BACKEND) {
    return { available: false, items: [], reason: 'Hermes backend is disabled.' };
  }
  if (!url) {
    const items = fallbackItem ? [fallbackItem] : [];
    return {
      available: Boolean(fallbackItem),
      items,
      reason: fallbackItem
        ? `${kind} listing is not configured; showing the configured default.`
        : `${kind} listing URL is not configured.`,
    };
  }

  const res = await fetch(url, {
    method: 'GET',
    headers: openAiHeaders(HERMES_API_KEY),
  });
  if (!res.ok) {
    throw parseUpstreamError(res.status, await res.text());
  }
  const data = await res.json();
  const items = Array.isArray(data) ? data : data.data || data.items || [];
  return { available: true, items };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...corsHeaders(),
    ...extraHeaders,
  });
  res.end(body);
}

function serveStatic(urlPath, res) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') {
    rel = '/index.html';
  }

  const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, '');
  if (safe.startsWith('..')) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  const filePath = path.join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  let u;
  try {
    u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    sendJson(res, 400, { error: 'Bad URL' });
    return;
  }

  const pathname = u.pathname;

  if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    try {
      const body = await readBody(req);
      const result = await handleChat(body || {});
      sendJson(res, 200, result);
    } catch (e) {
      const status = e.statusCode || (e instanceof SyntaxError ? 400 : 500);
      console.error('[api/chat]', e.message || e);
      sendJson(res, status, { error: e.message || 'Server error' });
    }
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (pathname === '/api/hermes/status') {
      const status = await probeHermesStatus();
      sendJson(res, status.connected || !status.enabled ? 200 : 503, status);
      return;
    }

    if (pathname === '/api/hermes/profiles') {
      try {
        const data = await fetchOptionalHermesList(
          'Hermes profile',
          HERMES_PROFILES_URL,
          HERMES_PROFILE ? { id: HERMES_PROFILE, name: HERMES_PROFILE } : null
        );
        sendJson(res, 200, data);
      } catch (e) {
        const status = e.statusCode || 502;
        console.error('[api/hermes/profiles]', e.message || e);
        sendJson(res, status, { available: false, items: [], error: e.message || 'Hermes profiles unavailable' });
      }
      return;
    }

    if (pathname === '/api/hermes/sessions') {
      try {
        const data = await fetchOptionalHermesList('Hermes session', HERMES_SESSIONS_URL, null);
        sendJson(res, 200, data);
      } catch (e) {
        const status = e.statusCode || 502;
        console.error('[api/hermes/sessions]', e.message || e);
        sendJson(res, status, { available: false, items: [], error: e.message || 'Hermes sessions unavailable' });
      }
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    serveStatic(pathname, res);
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Run: npm start (auto-frees the port) or kill $(lsof -t -i :${PORT})`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`Aether HUD + ${IS_HERMES_BACKEND ? 'Hermes bridge' : 'LLM proxy'} at http://localhost:${PORT}`);
  console.log(
    IS_HERMES_BACKEND
      ? `Hermes model: ${HERMES_MODEL} via ${HERMES_API_BASE_URL}${HERMES_PROFILE ? ` profile: ${HERMES_PROFILE}` : ''}`
      : `Model: ${OPENAI_MODEL} via ${OPENAI_BASE_URL}`
  );
  const hasLocal = fs.existsSync(path.join(__dirname, '.env.local'));
  const hasEnv = fs.existsSync(path.join(__dirname, '.env'));
  console.log(`Env files: ${hasEnv ? '.env' : '(no .env)'}${hasLocal ? ' + .env.local (overrides)' : ''}`);
  if (!IS_HERMES_BACKEND && !OPENAI_API_KEY && OPENAI_BASE_URL.includes('api.openai.com')) {
    console.warn('OPENAI_API_KEY is unset — set it in .env or the OpenAI API will reject requests.');
  }
  if (IS_HERMES_BACKEND && !HERMES_API_BASE_URL) {
    console.warn('HERMES_API_BASE_URL is unset — set it to your running Hermes API server.');
  }
});
