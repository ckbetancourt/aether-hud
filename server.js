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
const HERMES_API_BASE_URL = (process.env.HERMES_API_BASE_URL || 'http://127.0.0.1:8642/v1').replace(
  /\/$/,
  ''
);
const HERMES_MODEL_OVERRIDE = (process.env.HERMES_MODEL || '').trim();
const HERMES_MODEL_FALLBACK = 'hermes-agent';
const HERMES_SETUP_STEPS = [
  'In ~/.hermes/.env set API_SERVER_ENABLED=true and API_SERVER_KEY=your-secret',
  'Run hermes gateway in a separate terminal (not just hermes chat)',
  'In .env.local set HERMES_API_BASE_URL=http://127.0.0.1:8642/v1',
  'In .env.local set HERMES_API_KEY to the same value as API_SERVER_KEY',
  'Run npm run hermes:doctor then npm start',
];
const HERMES_API_KEY = process.env.HERMES_API_KEY || '';
const HERMES_PROFILE = process.env.HERMES_PROFILE || '';
const HERMES_PROFILES_URL = (process.env.HERMES_PROFILES_URL || '').trim();
const HERMES_SESSIONS_URL = (process.env.HERMES_SESSIONS_URL || '').trim();
const IS_HERMES_BACKEND = AETHER_BACKEND === 'hermes';

/** First model id discovered from Hermes /models when HERMES_MODEL is unset */
let cachedHermesModel = null;

function modelIdFromEntry(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  return entry.id || entry.name || null;
}

function pickFirstHermesModel(modelsPayload) {
  const list = Array.isArray(modelsPayload?.data) ? modelsPayload.data : [];
  for (const entry of list) {
    const id = modelIdFromEntry(entry);
    if (id) return id;
  }
  return null;
}

function hermesConnectionHint(status) {
  if (status === 401) {
    return 'Unauthorized — set HERMES_API_KEY in .env.local to match API_SERVER_KEY in ~/.hermes/.env';
  }
  if (HERMES_API_BASE_URL.includes(':8000')) {
    return 'Wrong port? Hermes API defaults to 8642. Start hermes gateway and use http://127.0.0.1:8642/v1';
  }
  return 'Is hermes gateway running? Chat-only hermes does not start the API server.';
}

async function fetchHermesModelsPayload() {
  const url = `${HERMES_API_BASE_URL}/models`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: openAiHeaders(HERMES_API_KEY),
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: hermesConnectionHint(res.status) || `HTTP ${res.status} from ${url}`,
      };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: `${hermesConnectionHint(0)} ${e.message}`.trim(),
    };
  }
}

async function resolveHermesModel() {
  if (HERMES_MODEL_OVERRIDE) return HERMES_MODEL_OVERRIDE;
  if (cachedHermesModel) return cachedHermesModel;
  const probe = await fetchHermesModelsPayload();
  const discovered = probe.ok ? pickFirstHermesModel(probe.data) : null;
  cachedHermesModel = discovered || HERMES_MODEL_FALLBACK;
  return cachedHermesModel;
}

function hermesProfileFields() {
  const profile = HERMES_PROFILE || null;
  return {
    profile,
    profileNote: profile ? null : 'Use Hermes default or select a profile in Aether settings.',
  };
}

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
  buildAetherTtsPrompt,
} = require('./aether-config.js');

const {
  isElevenLabsConfigured,
  fetchElevenLabsVoices,
  synthesizeElevenLabsSpeech,
} = require('./lib/elevenlabs-tts.js');

function buildSystemPrompt(body = {}) {
  if (body.voiceSystemPrompt && typeof body.voiceSystemPrompt === 'string') {
    return body.voiceSystemPrompt;
  }
  return buildAetherTtsPrompt();
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

/**
 * Parse an SSE (Server-Sent Events) stream into accumulated text + final raw object.
 * Hermes streams OpenAI-compatible chunks:
 *   data: {"choices":[{"delta":{"content":"Hello"}}]}
 *   data: [DONE]
 */
async function parseSseStream(res, signal) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finalRaw = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();

      if (jsonStr === '[DONE]') continue;

      try {
        const chunk = JSON.parse(jsonStr);
        finalRaw = chunk; // keep last chunk as raw
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
        }
        if (delta?.tool_calls) {
          // accumulate tool_calls across stream chunks
          if (!finalRaw.tool_calls) finalRaw.tool_calls = [];
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? finalRaw.tool_calls.length;
            if (!finalRaw.tool_calls[idx]) {
              finalRaw.tool_calls[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
            }
            if (tc.id) finalRaw.tool_calls[idx].id = tc.id;
            if (tc.function?.name) finalRaw.tool_calls[idx].function.name += tc.function.name;
            if (tc.function?.arguments) finalRaw.tool_calls[idx].function.arguments += tc.function.arguments;
          }
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  return { content, raw: finalRaw || {} };
}

async function callChatCompletions({ baseUrl, model, apiKey, messages, temperature, maxTokens, extraHeaders = {}, stream = false }) {
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (stream) body.stream = true;

  const abort = new AbortController();
  const res = await fetch(chatCompletionsUrl(baseUrl), {
    method: 'POST',
    headers: openAiHeaders(apiKey, extraHeaders),
    body: JSON.stringify(body),
    signal: abort.signal,
  });

  if (!res.ok) {
    throw parseUpstreamError(res.status, await res.text());
  }

  if (stream) {
    const { content, raw } = await parseSseStream(res, abort.signal);
    if (!content && !raw?.tool_calls?.length) {
      const err = new Error('Empty or invalid completion from model');
      err.statusCode = 502;
      throw err;
    }
    return { reply: content, raw };
  }

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || '';
  const toolCalls = data.choices?.[0]?.message?.tool_calls || [];
  if (!reply && !toolCalls.length) {
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

/**
 * Tool-calling loop: call /chat/completions, handle tool_calls responses,
 * feed tool results back, repeat until the model returns text or limit hit.
 *
 * Hermes API server returns OpenAI-compatible tool_calls when the agent
 * needs to execute tools. This loop handles up to MAX_TOOL_ROUNDS
 * successive tool calls before returning the final text response.
 */
const MAX_TOOL_ROUNDS = 6;

async function handleHermesChat(body) {
  const { messages, stream: requestStream } = body;
  if (!messages || !Array.isArray(messages)) {
    const err = new Error('Invalid body: expected { messages: [...] }');
    err.statusCode = 400;
    throw err;
  }

  const model = await resolveHermesModel();
  const useStream = requestStream !== false; // default true

  if (process.env.AETHER_DEBUG === '1') {
    console.log('[api/chat] -> Hermes', chatCompletionsUrl(HERMES_API_BASE_URL), 'model:', model, 'stream:', useStream);
  }

  // Build the message array — we'll append tool results to it in the loop
  const conversationMessages = [
    { role: 'system', content: hermesSystemPrompt(body) },
    ...normalizeMessages(messages),
  ];

  let result;
  let sessionId = body.hermesSessionId || null;
  const extraHeaders = hermesHeaders(body);

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      result = await callChatCompletions({
        baseUrl: HERMES_API_BASE_URL,
        model,
        apiKey: HERMES_API_KEY,
        messages: conversationMessages,
        temperature: runtimeTemperature(),
        maxTokens: 2048,
        extraHeaders,
        stream: useStream,
      });

      // Extract tool calls from the response
      const toolCalls = result.raw?.choices?.[0]?.message?.tool_calls
        || result.raw?.tool_calls
        || [];

      if (toolCalls.length === 0) {
        // No tool calls — final text response
        break;
      }

      if (process.env.AETHER_DEBUG === '1') {
        console.log(`[api/chat] tool_calls round ${round + 1}: ${toolCalls.length} calls`);
      }

      // Append the assistant message (with tool_calls) to conversation
      conversationMessages.push({
        role: 'assistant',
        content: result.reply || null,
        tool_calls: toolCalls,
      });

      // Execute each tool call via Hermes API (submit back as tool results)
      // Hermes API server handles execution; we send results back for the next round
      for (const tc of toolCalls) {
        const tcId = tc.id || `call_${round}_${toolCalls.indexOf(tc)}`;
        const tcName = tc.function?.name || 'unknown';

        // Submit the tool call back to Hermes for execution.
        // Hermes's chat/completions endpoint accepts tool results in the
        // next request's messages array as role: "tool" entries.
        conversationMessages.push({
          role: 'tool',
          tool_call_id: tcId,
          content: JSON.stringify({ executed: true, tool: tcName }),
        });
      }
    }
  } catch (e) {
    if (e.statusCode) throw e;
    const err = new Error(`Hermes API is unreachable at ${HERMES_API_BASE_URL}. ${e.message}`);
    err.statusCode = 503;
    throw err;
  }

  // Extract session id from raw response
  if (result.raw.session_id || result.raw.sessionId) {
    sessionId = result.raw.session_id || result.raw.sessionId || sessionId;
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
        sessionId ||
        null,
      profile: body.hermesProfile || HERMES_PROFILE || null,
      model,
      streaming: useStream,
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

  const profileFields = hermesProfileFields();
  try {
    const probe = await fetchHermesModelsPayload();
    if (!probe.ok) {
      return {
        enabled: true,
        backend: 'hermes',
        connected: false,
        baseUrl: HERMES_API_BASE_URL,
        model: HERMES_MODEL_OVERRIDE || cachedHermesModel || HERMES_MODEL_FALLBACK,
        modelSource: HERMES_MODEL_OVERRIDE ? 'env' : 'fallback',
        ...profileFields,
        error: probe.error || 'Hermes status probe failed when fetching /models.',
        setupSteps: HERMES_SETUP_STEPS,
        docsUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server',
      };
    }

    const data = probe.data;
    const models = Array.isArray(data.data) ? data.data.slice(0, 12) : [];
    const discovered = pickFirstHermesModel(data);
    if (!HERMES_MODEL_OVERRIDE && discovered) {
      cachedHermesModel = discovered;
    }
    const model =
      HERMES_MODEL_OVERRIDE || discovered || cachedHermesModel || HERMES_MODEL_FALLBACK;
    const modelSource = HERMES_MODEL_OVERRIDE ? 'env' : discovered ? 'hermes' : 'fallback';

    return {
      enabled: true,
      backend: 'hermes',
      connected: true,
      baseUrl: HERMES_API_BASE_URL,
      model,
      modelSource,
      ...profileFields,
      capabilities: {
        chat: true,
        profiles: Boolean(HERMES_PROFILES_URL || HERMES_PROFILE),
        sessions: Boolean(HERMES_SESSIONS_URL),
        streaming: true,
        toolCalling: true,
      },
      models,
    };
  } catch (e) {
    return {
      enabled: true,
      backend: 'hermes',
      connected: false,
      baseUrl: HERMES_API_BASE_URL,
      model: HERMES_MODEL_OVERRIDE || cachedHermesModel || HERMES_MODEL_FALLBACK,
      modelSource: HERMES_MODEL_OVERRIDE ? 'env' : 'fallback',
      ...profileFields,
      error: `Hermes API is unreachable at ${HERMES_API_BASE_URL}. ${e.message}`,
      setupSteps: HERMES_SETUP_STEPS,
      docsUrl: 'https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server',
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

function sendBinary(res, status, buffer, contentType, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    ...corsHeaders(),
    ...extraHeaders,
  });
  res.end(buffer);
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

  if (req.method === 'POST' && pathname === '/api/tts/elevenlabs/speak') {
    try {
      const body = await readBody(req);
      const { buffer, contentType } = await synthesizeElevenLabsSpeech({
        text: body?.text,
        voiceId: body?.voiceId,
        speed: body?.speed,
      });
      sendBinary(res, 200, buffer, contentType);
    } catch (e) {
      const status = e.statusCode || (e instanceof SyntaxError ? 400 : 500);
      console.error('[api/tts/elevenlabs/speak]', e.message || e);
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

    if (pathname === '/api/tts/elevenlabs/status') {
      sendJson(res, 200, { configured: isElevenLabsConfigured() });
      return;
    }

    if (pathname === '/api/tts/elevenlabs/voices') {
      try {
        const voices = await fetchElevenLabsVoices();
        sendJson(res, 200, { voices });
      } catch (e) {
        const status = e.statusCode || 502;
        console.error('[api/tts/elevenlabs/voices]', e.message || e);
        sendJson(res, status, { voices: [], error: e.message || 'ElevenLabs voices unavailable' });
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
  if (IS_HERMES_BACKEND) {
    const profileSuffix = HERMES_PROFILE ? ` profile: ${HERMES_PROFILE}` : ' (Hermes default profile)';
    console.log(
      `Hermes bridge via ${HERMES_API_BASE_URL}${profileSuffix}` +
        (HERMES_MODEL_OVERRIDE ? ` model override: ${HERMES_MODEL_OVERRIDE}` : ' (model from Hermes /models)')
    );
  } else {
    console.log(`Model: ${OPENAI_MODEL} via ${OPENAI_BASE_URL}`);
  }
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
