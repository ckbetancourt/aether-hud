/**
 * Serves the static HUD and proxies chat to an OpenAI-compatible /v1/chat/completions endpoint.
 * Keeps API keys on the server (dotenv: .env then .env.local overrides — LM Studio users often use .env.local).
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '.env.local'), override: true });

const http = require('http');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8787;
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

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
  AETHER_PROFILES,
  resolveProfileId,
  buildAetherSystemPrompt,
} = require('./aether-config.js');

function buildSystemPrompt(body) {
  const profileId = body.profile && body.profile.id;
  const id = resolveProfileId(profileId || 'general');
  const profile = AETHER_PROFILES[id] || AETHER_PROFILES.general;
  return buildAetherSystemPrompt(profile);
}

function temperatureForProfile(profile) {
  if (profile && typeof profile.temperature === 'number') {
    return profile.temperature;
  }
  const id = profile && profile.id;
  if (id === 'creative') return 0.9;
  if (id === 'systems') return 0.2;
  if (id === 'analyst') return 0.5;
  return 0.7;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function handleChat(body) {
  const { messages, profile, personality } = body;
  if (!messages || !Array.isArray(messages)) {
    const err = new Error('Invalid body: expected { messages: [...] }');
    err.statusCode = 400;
    throw err;
  }

  if (process.env.AETHER_DEBUG === '1') {
    console.log('[api/chat] ->', `${OPENAI_BASE_URL}/chat/completions`, 'model:', OPENAI_MODEL);
  }

  const sys = buildSystemPrompt({ profile, personality });
  const openaiMessages = [
    { role: 'system', content: sys },
    ...messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content ?? ''),
    })),
  ];

  const headers = {
    'Content-Type': 'application/json',
  };
  if (OPENAI_API_KEY) {
    headers.Authorization = `Bearer ${OPENAI_API_KEY}`;
  }

  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: openaiMessages,
      temperature: temperatureForProfile(profile),
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || j.message || text;
    } catch {
      /* keep text */
    }
    const err = new Error(detail || `Upstream HTTP ${res.status}`);
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content;
  if (!reply || typeof reply !== 'string') {
    const err = new Error('Empty or invalid completion from model');
    err.statusCode = 502;
    throw err;
  }
  return reply;
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

  if (req.method === 'OPTIONS' && pathname === '/api/chat') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    try {
      const body = await readBody(req);
      const reply = await handleChat(body || {});
      sendJson(res, 200, { reply });
    } catch (e) {
      const status = e.statusCode || (e instanceof SyntaxError ? 400 : 500);
      console.error('[api/chat]', e.message || e);
      sendJson(res, status, { error: e.message || 'Server error' });
    }
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (pathname === '/api/chat') {
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
  console.log(`Aether HUD + LLM proxy at http://localhost:${PORT}`);
  console.log(`Model: ${OPENAI_MODEL} via ${OPENAI_BASE_URL}`);
  const hasLocal = fs.existsSync(path.join(__dirname, '.env.local'));
  const hasEnv = fs.existsSync(path.join(__dirname, '.env'));
  console.log(`Env files: ${hasEnv ? '.env' : '(no .env)'}${hasLocal ? ' + .env.local (overrides)' : ''}`);
  if (!OPENAI_API_KEY && OPENAI_BASE_URL.includes('api.openai.com')) {
    console.warn('OPENAI_API_KEY is unset — set it in .env or the OpenAI API will reject requests.');
  }
});
