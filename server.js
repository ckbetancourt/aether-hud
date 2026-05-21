/**
 * Serves the static HUD and bridges chat to Hermes Agent by default.
 * Keeps API keys on the server (dotenv: .env then .env.local overrides).
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '.env.local'), override: true });

const http = require('http');
const Database = require('better-sqlite3');

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
const HERMES_DASHBOARD_URL = (process.env.HERMES_DASHBOARD_URL || 'http://127.0.0.1:9119').replace(
  /\/$/,
  ''
);
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

async function fetchHermesDashboardJson(pathOrUrl, options = {}) {
  const url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${HERMES_DASHBOARD_URL}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
  const init = {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  };
  if (options.body !== undefined) {
    init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }
  if (!res.ok) {
    const err = new Error(data.detail || data.error || `HTTP ${res.status} from ${url}`);
    err.statusCode = res.status;
    throw err;
  }
  return data;
}

async function resolveHermesModel(sessionId) {
  if (HERMES_MODEL_OVERRIDE) return HERMES_MODEL_OVERRIDE;
  const configModel = readHermesConfigModel();
  if (configModel?.model) {
    cachedHermesModel = configModel.model;
    return configModel.model;
  }
  if (cachedHermesModel && cachedHermesModel !== HERMES_MODEL_FALLBACK) {
    return cachedHermesModel;
  }
  const probe = await fetchHermesModelsPayload();
  const discovered = probe.ok ? pickFirstHermesModel(probe.data) : null;
  cachedHermesModel = discovered || HERMES_MODEL_FALLBACK;
  return cachedHermesModel;
}

function readConfiguredHermesModelFields() {
  const configModel = readHermesConfigModel();
  return {
    model: configModel?.model || '',
    provider: configModel?.provider || '',
  };
}

function buildFallbackModelOptions(status) {
  const configured = readConfiguredHermesModelFields();
  const modelList = Array.isArray(status?.models)
    ? status.models.map((entry) => modelIdFromEntry(entry)).filter(Boolean)
    : [];
  const currentModel =
    configured.model || status?.model || cachedHermesModel || HERMES_MODEL_FALLBACK;
  if (currentModel && !modelList.includes(currentModel)) {
    modelList.unshift(currentModel);
  }
  const providerSlug = configured.provider || status?.provider || 'hermes';
  return {
    model: currentModel,
    provider: providerSlug,
    providers: [
      {
        slug: providerSlug,
        name: providerSlug === 'hermes' ? 'Hermes Gateway' : providerSlug,
        models: modelList.length ? modelList : [currentModel],
        total_models: modelList.length || 1,
        is_current: true,
        warning: 'Limited model list — install Hermes CLI or run `hermes dashboard` for full picker.',
      },
    ],
    source: 'status-fallback',
    hint: 'Run `hermes dashboard` or ensure Hermes Python env is available for full provider lists.',
  };
}

async function fetchHermesModelOptions() {
  if (!IS_HERMES_BACKEND) {
    return {
      available: false,
      model: '',
      provider: '',
      providers: [],
      reason: 'AETHER_BACKEND is not set to hermes.',
    };
  }

  try {
    const payload = await fetchHermesDashboardJson('/api/model/options');
    return {
      ...payload,
      available: true,
      source: 'dashboard',
    };
  } catch (dashboardErr) {
    try {
      const payload = fetchHermesModelOptionsViaPython();
      if (payload?.providers?.length) {
        return {
          ...payload,
          available: true,
          source: 'hermes-cli',
          dashboardError: dashboardErr.message || 'Hermes dashboard unreachable.',
        };
      }
    } catch (pythonErr) {
      /* fall through to status fallback */
    }

    const status = await probeHermesStatus();
    if (!status.connected) {
      return {
        available: false,
        model: status.model || '',
        provider: status.provider || '',
        providers: [],
        source: 'unavailable',
        error: dashboardErr.message || 'Hermes model options unavailable.',
        hint: 'Start hermes gateway and ensure Hermes CLI is installed, then retry.',
      };
    }
    return {
      ...buildFallbackModelOptions(status),
      available: true,
      dashboardError: dashboardErr.message || 'Hermes dashboard unreachable.',
    };
  }
}

async function handleHermesModelSwitch(body) {
  if (!IS_HERMES_BACKEND) {
    const err = new Error('Hermes backend is disabled.');
    err.statusCode = 400;
    throw err;
  }

  const provider = String(body?.provider || '').trim();
  const model = String(body?.model || '').trim();
  const sessionIds = collectHermesSessionIds(body);
  const previousModel = readHermesConfigModel()?.model || cachedHermesModel || '';

  if (!provider || !model) {
    const err = new Error('provider and model are required.');
    err.statusCode = 400;
    throw err;
  }
  if (/\s/.test(model)) {
    const err = new Error('Model IDs cannot contain spaces.');
    err.statusCode = 400;
    throw err;
  }

  let resolvedModel = model;
  let resolvedProvider = provider;
  let switchWarning = '';
  let dashboardError = null;

  try {
    await fetchHermesDashboardJson('/api/model/set', {
      method: 'POST',
      body: { scope: 'main', provider, model },
    });
  } catch (err) {
    dashboardError = err;
  }

  try {
    // Always validate + persist through Hermes CLI so config.yaml is authoritative.
    const switched = applyHermesModelSwitch(provider, model, true);
    resolvedModel = switched.model || model;
    resolvedProvider = switched.provider || provider;
    switchWarning = switched.warning || '';
  } catch (pythonErr) {
    const err = new Error(
      dashboardError
        ? `Model switch failed. Dashboard: ${dashboardError.message || 'unreachable'}. CLI: ${pythonErr.message || 'unavailable'}.`
        : pythonErr.message || 'Hermes model switch failed.'
    );
    err.statusCode = 503;
    err.hint = 'Run `hermes dashboard` or ensure Hermes CLI is installed at ~/.hermes/hermes-agent.';
    throw err;
  }

  const cfg = readHermesConfigModel();
  if (cfg?.model) resolvedModel = cfg.model;
  if (cfg?.provider) resolvedProvider = cfg.provider;
  cachedHermesModel = resolvedModel;

  const sessionRefresh = forceRefreshHermesSessionsForModelSwitch({
    sessionIds,
    model: resolvedModel,
    provider: resolvedProvider,
    previousModel,
  });

  return {
    ok: true,
    model: resolvedModel,
    provider: resolvedProvider,
    scope: 'global',
    sessionInvalidated: sessionRefresh.cleared > 0,
    sessionsCleared: sessionRefresh.cleared,
    switchNotesAdded: sessionRefresh.notes,
    warning: switchWarning || null,
  };
}

function collectHermesSessionIds(body) {
  const ids = new Set();
  const add = (value) => {
    const id = String(value || '').trim();
    if (id) ids.add(id);
  };
  add(body?.sessionId);
  add(body?.hermesSessionId);
  add(body?.activeSessionId);
  add(body?.lastHermesSessionId);
  if (Array.isArray(body?.sessionIds)) {
    for (const value of body.sessionIds) add(value);
  }
  return [...ids];
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

const HERMES_STATE_DB_PATH = path.join(process.env.HOME || '/Users/friday', '.hermes', 'state.db');

/** Open Hermes state.db for direct session reads (read-only, no WAL lock issues) */
const hermesStateDb = (() => {
  try {
    const db = new Database(HERMES_STATE_DB_PATH, { readonly: true, fileMustExist: true });
    db.pragma('journal_mode = WAL');
    db.pragma('query_only = true');
    console.log(`Hermes state.db opened: ${HERMES_STATE_DB_PATH}`);
    return db;
  } catch (e) {
    console.warn(`Hermes state.db not available at ${HERMES_STATE_DB_PATH}: ${e.message}`);
    return null;
  }
})();

/** Writable handle for model-switch session cache invalidation */
const hermesStateDbWrite = (() => {
  try {
    const db = new Database(HERMES_STATE_DB_PATH, { fileMustExist: true });
    db.pragma('journal_mode = WAL');
    return db;
  } catch (e) {
    console.warn(`Hermes state.db write handle unavailable: ${e.message}`);
    return null;
  }
})();

function invalidateHermesSessionForModelSwitch(sessionId, model) {
  if (!hermesStateDbWrite || !sessionId) return false;
  try {
    const result = hermesStateDbWrite
      .prepare(
        `UPDATE sessions
         SET model = ?, system_prompt = NULL
         WHERE id = ?`
      )
      .run(String(model), String(sessionId));
    return result.changes > 0;
  } catch (e) {
    console.warn('[hermes/model/switch] failed to invalidate session cache:', e.message);
    return false;
  }
}

function appendHermesModelSwitchNote(sessionId, newModel, provider, previousModel) {
  if (!hermesStateDbWrite || !sessionId || !newModel) return false;
  try {
    const exists = hermesStateDbWrite.prepare('SELECT 1 AS ok FROM sessions WHERE id = ?').get(String(sessionId));
    if (!exists) return false;

    const note = `[Note: model was just switched from ${previousModel || 'previous model'} to ${newModel} via ${provider || 'provider'}. Adjust your self-identification accordingly.]`;
    const ts = Date.now() / 1000;
    hermesStateDbWrite
      .prepare(
        `INSERT INTO messages (session_id, role, content, timestamp)
         VALUES (?, 'user', ?, ?)`
      )
      .run(String(sessionId), note, ts);
    hermesStateDbWrite
      .prepare(
        `UPDATE sessions
         SET message_count = COALESCE(message_count, 0) + 1
         WHERE id = ?`
      )
      .run(String(sessionId));
    return true;
  } catch (e) {
    console.warn('[hermes/model/switch] failed to append switch note:', e.message);
    return false;
  }
}

function forceRefreshHermesSessionsForModelSwitch({ sessionIds, model, provider, previousModel }) {
  let cleared = 0;
  let notes = 0;

  for (const sessionId of sessionIds) {
    if (invalidateHermesSessionForModelSwitch(sessionId, model)) cleared += 1;
    if (appendHermesModelSwitchNote(sessionId, model, provider, previousModel)) notes += 1;
  }

  if (hermesStateDbWrite && model && sessionIds.length > 0) {
    try {
      const placeholders = sessionIds.map(() => '?').join(', ');
      const result = hermesStateDbWrite
        .prepare(
          `UPDATE sessions
           SET model = ?, system_prompt = NULL
           WHERE id IN (${placeholders})
             AND system_prompt IS NOT NULL
             AND system_prompt != ''
             AND system_prompt NOT LIKE ?`
        )
        .run(String(model), ...sessionIds, `%Model: ${model}%`);
      cleared += result.changes;
    } catch (e) {
      console.warn('[hermes/model/switch] stale prompt sweep failed:', e.message);
    }
  }

  return { cleared, notes };
}

/** Clear stale cached system prompts when config.yaml and session row disagree. */
function syncHermesSessionModelWithConfig(sessionId) {
  if (!hermesStateDbWrite || !hermesStateDb || !sessionId) return false;
  const config = readHermesConfigModel();
  const configModel = String(config?.model || '').trim();
  if (!configModel) return false;

  try {
    const row = hermesStateDb
      .prepare('SELECT model, system_prompt FROM sessions WHERE id = ?')
      .get(String(sessionId));
    if (!row) return false;

    const sessionModel = String(row.model || '').trim();
    const cachedPrompt = row.system_prompt;
    const hasCachedPrompt = cachedPrompt != null && cachedPrompt !== '';
    if (!hasCachedPrompt) return false;

    const modelMismatch = sessionModel && sessionModel !== configModel;
    const promptMismatch =
      cachedPrompt.includes('Model:') && !cachedPrompt.includes(`Model: ${configModel}`);

    if (!modelMismatch && !promptMismatch) return false;

    const result = hermesStateDbWrite
      .prepare('UPDATE sessions SET model = ?, system_prompt = NULL WHERE id = ?')
      .run(configModel, String(sessionId));

    if (result.changes > 0 && process.env.AETHER_DEBUG === '1') {
      console.log(
        `[hermes/chat] cleared stale session prompt for ${sessionId}: ` +
          `session=${sessionModel || '(unset)'} config=${configModel}`
      );
    }
    return result.changes > 0;
  } catch (e) {
    console.warn('[hermes/chat] session model sync failed:', e.message);
    return false;
  }
}

function hermesSessionsList(limit = 25) {
  if (!hermesStateDb) return [];
  const rows = hermesStateDb.prepare(
    `SELECT id, title, started_at, model, message_count, input_tokens, output_tokens
     FROM sessions
     ORDER BY started_at DESC
     LIMIT ?`
  ).all(limit);
  return rows.map(r => ({
    id: r.id,
    title: r.title || `Session ${r.id.slice(0, 8)}`,
    model: r.model || '',
    startedAt: r.started_at,
    messageCount: r.message_count || 0,
    inputTokens: r.input_tokens || 0,
    outputTokens: r.output_tokens || 0,
  }));
}

function hermesSessionMessages(sessionId, limit = 200) {
  if (!hermesStateDb) return [];
  const rows = hermesStateDb.prepare(
    `SELECT id, role, content, timestamp, tool_calls, tool_name, finish_reason
     FROM messages
     WHERE session_id = ?
     ORDER BY timestamp ASC
     LIMIT ?`
  ).all(sessionId, limit);
  return rows.map(r => ({
    id: r.id,
    role: r.role,
    content: String(r.content || ''),
    timestamp: r.timestamp,
    tool_calls: r.tool_calls,
    tool_name: r.tool_name,
    finish_reason: r.finish_reason,
  }));
}

const userStore = require('./lib/user-store');
const {
  readHermesConfigModel,
  fetchHermesModelOptionsViaPython,
  applyHermesModelSwitch,
} = require('./lib/hermes-model');

/**
 * Fetch Hermes profiles by running `hermes profile list` and parsing the output table.
 * Returns an array of { id, name, model, alias, running } objects.
 */
async function fetchHermesProfiles() {
  const { execSync } = require('child_process');
  try {
    const output = execSync('hermes profile list 2>&1', {
      timeout: 10000,
      encoding: 'utf-8',
      maxBuffer: 1024 * 64,
    });
    const lines = output.split('\n').filter(l => l.trim());
    const profiles = [];
    // Skip header lines (─ separator, ─────────────── header)
    let started = false;
    for (const line of lines) {
      // Detect data row: starts with " ◆" (current profile) or "  " (non-current)
      if (/^ [◆ ] /.test(line) || /^[◆ ]/.test(line) && !line.includes('───────────────')) {
        // Parse columns by position: Profile, Model, Gateway, Alias, Distribution
        const parts = line.trim().split(/\s{2,}/);
        if (parts.length >= 2) {
          const id = parts[0].replace('◆', '').trim();
          profiles.push({
            id,
            name: id,
            model: parts[1] || '',
            alias: parts[3] || '',
            running: parts[2] === 'running' || parts[2] === 'running,',
            isCurrent: line.includes('◆'),
          });
        }
      }
    }
    return profiles;
  } catch (e) {
    console.warn('Failed to list Hermes profiles:', e.message);
    return [];
  }
}

const {
  buildAetherTtsPrompt,
} = require('./aether-config.js');

const {
  isElevenLabsConfigured,
  fetchElevenLabsVoices,
  synthesizeElevenLabsSpeech,
} = require('./lib/elevenlabs-tts.js');

const {
  isOmniVoiceConfigured,
  probeOmniVoiceHealth,
  fetchOmniVoiceSamples,
  synthesizeOmniVoiceSpeech,
  OMNIVOICE_BASE_URL,
} = require('./lib/omnivoice-tts.js');

const ttsReplayCache = require('./lib/tts-replay-cache.js');

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

function normalizeHermesListItems(data) {
  return Array.isArray(data) ? data : data?.data || data?.items || data?.sessions || [];
}

function probeHermesSessionsList() {
  if (hermesStateDb) {
    return { ok: true, url: 'state.db (direct)' };
  }
  return {
    ok: false,
    url: HERMES_STATE_DB_PATH,
    error: 'Hermes state.db not available',
  };
}

function chatCompletionsUrl(baseUrl) {
  return `${baseUrl.replace(/\/$/, '')}/chat/completions`;
}

function normalizeMessageContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') return null;
        if (part.type === 'text' && part.text != null) {
          return { type: 'text', text: String(part.text) };
        }
        if (part.type === 'image_url' && part.image_url?.url) {
          return {
            type: 'image_url',
            image_url: { url: String(part.image_url.url) },
          };
        }
        return null;
      })
      .filter(Boolean);
  }
  return String(content);
}

function normalizeMessages(messages) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: normalizeMessageContent(m.content),
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
 * Hermes streams OpenAI-compatible chunks plus custom lifecycle events:
 *   data: {"choices":[{"delta":{"content":"Hello"}}]}
 *   event: hermes.tool.progress
 *   data: {"tool":"search_files","label":"…","status":"running",...}
 *   data: [DONE]
 */
async function parseSseStream(res, signal, onStreamProgress) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finalRaw = null;
  let latestToolIndex = -1;

  const dispatchSseBlock = (block) => {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith(':')) return;

    const lines = block.split('\n');
    let eventName = 'message';
    let dataLine = '';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLine += line.slice(5).trim();
      }
    }
    if (!dataLine || dataLine === '[DONE]') return;

    if (eventName === 'hermes.tool.progress') {
      try {
        const parsed = JSON.parse(dataLine);
        if (parsed.status === 'running' && parsed.tool && onStreamProgress) {
          onStreamProgress({
            name: parsed.tool,
            label: parsed.label || parsed.tool,
            emoji: parsed.emoji || '',
            status: 'running',
            toolCallId: parsed.toolCallId || null,
          });
        }
      } catch {
        /* skip malformed Hermes events */
      }
      return;
    }

    try {
      const chunk = JSON.parse(dataLine);
      finalRaw = chunk;
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) {
        content += delta.content;
      }
      if (delta?.tool_calls) {
        if (!finalRaw.tool_calls) finalRaw.tool_calls = [];
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? finalRaw.tool_calls.length;
          if (!finalRaw.tool_calls[idx]) {
            finalRaw.tool_calls[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
          }
          if (tc.id) finalRaw.tool_calls[idx].id = tc.id;
          if (tc.function?.name) {
            finalRaw.tool_calls[idx].function.name += tc.function.name;
            latestToolIndex = idx;
            if (onStreamProgress) {
              onStreamProgress({
                name: finalRaw.tool_calls[idx].function.name,
                label: finalRaw.tool_calls[idx].function.name,
                status: 'running',
                index: idx,
              });
            }
          }
          if (tc.function?.arguments) finalRaw.tool_calls[idx].function.arguments += tc.function.arguments;
        }
      }
    } catch {
      /* skip malformed chunks */
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let splitAt;
    while ((splitAt = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, splitAt);
      buffer = buffer.slice(splitAt + 2);
      dispatchSseBlock(block);
    }
  }

  if (buffer.trim()) dispatchSseBlock(buffer);

  if (onStreamProgress && latestToolIndex >= 0 && finalRaw?.tool_calls?.[latestToolIndex]?.function?.name) {
    onStreamProgress({
      name: finalRaw.tool_calls[latestToolIndex].function.name,
      label: finalRaw.tool_calls[latestToolIndex].function.name,
      status: 'running',
      index: latestToolIndex,
      final: true,
    });
  }

  return { content, raw: finalRaw || {} };
}

async function callChatCompletions({
  baseUrl,
  model,
  apiKey,
  messages,
  temperature,
  maxTokens,
  extraHeaders = {},
  stream = false,
  onStreamProgress,
}) {
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
    const { content, raw } = await parseSseStream(res, abort.signal, onStreamProgress);
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
  const sessionId = body.sessionId || body.hermesSessionId || '';
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

function writeSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function handleHermesChat(body, emitProgress) {
  const { messages, stream: requestStream } = body;
  if (!messages || !Array.isArray(messages)) {
    const err = new Error('Invalid body: expected { messages: [...] }');
    err.statusCode = 400;
    throw err;
  }

  let sessionId = body.sessionId || body.hermesSessionId || null;
  if (sessionId) {
    syncHermesSessionModelWithConfig(sessionId);
  }
  const model = await resolveHermesModel(sessionId);
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
  const extraHeaders = hermesHeaders(body);

  const reportTool = (info) => {
    if (!emitProgress) return;
    if (typeof info === 'string') {
      if (!info) return;
      emitProgress('tool', { name: info, label: info, status: 'running' });
      return;
    }
    const name = info?.name || info?.tool;
    if (!name) return;
    emitProgress('tool', {
      name: String(name),
      label: String(info?.label || name),
      emoji: info?.emoji ? String(info.emoji) : '',
      status: info?.status || 'running',
    });
  };

  if (emitProgress) {
    reportTool({ name: '_thinking', label: 'Thinking…', status: 'thinking' });
  }

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
        onStreamProgress: (info) => reportTool(info?.name),
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
        reportTool(tcName);

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
      provider: readHermesConfigModel()?.provider || null,
      streaming: useStream,
    },
  };
}

async function handleChat(body, emitProgress) {
  if (IS_HERMES_BACKEND) {
    return handleHermesChat(body, emitProgress);
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
    const configured = readConfiguredHermesModelFields();
    const discovered = pickFirstHermesModel(data);
    if (!HERMES_MODEL_OVERRIDE && configured.model) {
      cachedHermesModel = configured.model;
    } else if (!HERMES_MODEL_OVERRIDE && discovered) {
      cachedHermesModel = discovered;
    }
    const model =
      HERMES_MODEL_OVERRIDE ||
      configured.model ||
      discovered ||
      cachedHermesModel ||
      HERMES_MODEL_FALLBACK;
    const modelSource = HERMES_MODEL_OVERRIDE
      ? 'env'
      : configured.model
        ? 'config'
        : discovered
          ? 'hermes'
          : 'fallback';
    const sessionsProbe = await probeHermesSessionsList();

    return {
      enabled: true,
      backend: 'hermes',
      connected: true,
      baseUrl: HERMES_API_BASE_URL,
      sessionsListUrl: sessionsProbe.url,
      model,
      provider: configured.provider || null,
      modelSource,
      ...profileFields,
      capabilities: {
        chat: true,
        profiles: true,
        sessions: sessionsProbe.ok,
        streaming: true,
        toolCalling: true,
      },
      sessionsProbe: sessionsProbe.ok
        ? null
        : {
            error: sessionsProbe.error,
            hint: 'Hermes state.db not found — sessions won\'t sync. Make sure Hermes has been used at least once to create ~/.hermes/state.db.',
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

async function fetchOptionalHermesList(kind, url, fallbackItem, options = {}) {
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

  const data = options.useDashboardAuth
    ? await fetchHermesDashboardJson(url)
    : await (async () => {
        const res = await fetch(url, {
          method: 'GET',
          headers: openAiHeaders(HERMES_API_KEY),
        });
        if (!res.ok) {
          throw parseUpstreamError(res.status, await res.text());
        }
        return res.json();
      })();
  const items = normalizeHermesListItems(data);
  return { available: true, items, sourceUrl: url };
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

function injectStaticAssetVersions(html, version) {
  const stamp = encodeURIComponent(String(version));
  return html
    .replace(/href="styles\.css(?:\?[^"]*)?"/g, `href="styles.css?v=${stamp}"`)
    .replace(/src="app\.js(?:\?[^"]*)?"/g, `src="app.js?v=${stamp}"`);
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
    const headers = { 'Content-Type': type };
    if (['.html', '.js', '.css'].includes(ext)) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    }

    if (ext === '.html') {
      fs.readFile(filePath, 'utf8', (readErr, html) => {
        if (readErr) {
          sendJson(res, 500, { error: 'Failed to read file' });
          return;
        }
        const body = injectStaticAssetVersions(html, Math.floor(st.mtimeMs));
        headers['Content-Type'] = 'text/html; charset=utf-8';
        headers['Content-Length'] = Buffer.byteLength(body);
        res.writeHead(200, headers);
        res.end(body);
      });
      return;
    }

    res.writeHead(200, headers);
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

  if (pathname === '/api/user/data') {
    if (req.method === 'GET') {
      try {
        sendJson(res, 200, { data: userStore.getAll() });
      } catch (e) {
        console.error('[api/user/data GET]', e.message || e);
        sendJson(res, 500, { error: e.message || 'User store read failed' });
      }
      return;
    }
    if (req.method === 'PUT') {
      try {
        const body = await readBody(req);
        const count = userStore.setMany(body?.data || {});
        sendJson(res, 200, { ok: true, updated: count });
      } catch (e) {
        console.error('[api/user/data PUT]', e.message || e);
        sendJson(res, 500, { error: e.message || 'User store write failed' });
      }
      return;
    }
    if (req.method === 'DELETE') {
      try {
        const body = await readBody(req);
        const count = userStore.deleteKeys(body?.keys || []);
        sendJson(res, 200, { ok: true, deleted: count });
      } catch (e) {
        console.error('[api/user/data DELETE]', e.message || e);
        sendJson(res, 500, { error: e.message || 'User store delete failed' });
      }
      return;
    }
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/hermes/model/switch') {
    try {
      const body = await readBody(req);
      const result = await handleHermesModelSwitch(body || {});
      sendJson(res, 200, result);
    } catch (e) {
      const status = e.statusCode || (e instanceof SyntaxError ? 400 : 500);
      console.error('[api/hermes/model/switch]', e.message || e);
      sendJson(res, status, {
        ok: false,
        error: e.message || 'Model switch failed',
        hint: e.hint || null,
      });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    try {
      const body = await readBody(req);
      if (body?.progressStream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          ...corsHeaders(),
        });
        const emitProgress = (event, data) => writeSseEvent(res, event, data);
        try {
          const result = await handleChat(body, emitProgress);
          writeSseEvent(res, 'done', result);
        } catch (e) {
          const status = e.statusCode || (e instanceof SyntaxError ? 400 : 500);
          console.error('[api/chat]', e.message || e);
          writeSseEvent(res, 'error', { error: e.message || 'Server error', status });
        }
        res.end();
        return;
      }

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
      const cached = ttsReplayCache.addEntry({
        provider: 'elevenlabs',
        buffer,
        contentType,
        text: body?.text,
      });
      sendBinary(res, 200, buffer, contentType, { 'X-Aether-Replay-Id': cached.id });
    } catch (e) {
      const status = e.statusCode || (e instanceof SyntaxError ? 400 : 500);
      console.error('[api/tts/elevenlabs/speak]', e.message || e);
      sendJson(res, status, { error: e.message || 'Server error' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/tts/omnivoice/speak') {
    try {
      const body = await readBody(req);
      const { buffer, contentType } = await synthesizeOmniVoiceSpeech({
        text: body?.text,
        sample: body?.sample,
        instruct: body?.instruct,
        speed: body?.speed,
      });
      const cached = ttsReplayCache.addEntry({
        provider: 'omnivoice',
        buffer,
        contentType,
        text: body?.text,
      });
      sendBinary(res, 200, buffer, contentType, { 'X-Aether-Replay-Id': cached.id });
    } catch (e) {
      const status = e.statusCode || (e instanceof SyntaxError ? 400 : 500);
      console.error('[api/tts/omnivoice/speak]', e.message || e);
      sendJson(res, status, { error: e.message || 'Server error' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/tts/replay-cache/register') {
    try {
      const body = await readBody(req);
      const text = body?.text ? String(body.text).trim() : '';
      if (!text) {
        sendJson(res, 400, { error: 'text is required' });
        return;
      }
      const cached = ttsReplayCache.addEntry({
        provider: body?.provider || 'browser',
        text,
      });
      sendJson(res, 200, { id: cached.id });
    } catch (e) {
      console.error('[api/tts/replay-cache/register]', e.message || e);
      sendJson(res, 500, { error: e.message || 'Server error' });
    }
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (pathname === '/api/hermes/status') {
      const status = await probeHermesStatus();
      sendJson(res, status.connected || !status.enabled ? 200 : 503, status);
      return;
    }

    if (pathname === '/api/hermes/model/options') {
      try {
        const options = await fetchHermesModelOptions();
        sendJson(res, options.available ? 200 : 503, options);
      } catch (e) {
        console.error('[api/hermes/model/options]', e.message || e);
        sendJson(res, 502, {
          available: false,
          providers: [],
          error: e.message || 'Hermes model options unavailable',
        });
      }
      return;
    }

    if (pathname === '/api/hermes/profiles') {
      try {
        const items = await fetchHermesProfiles();
        sendJson(res, 200, { available: true, items });
      } catch (e) {
        const status = e.statusCode || 502;
        console.error('[api/hermes/profiles]', e.message || e);
        sendJson(res, status, { available: false, items: [], error: e.message || 'Hermes profiles unavailable' });
      }
      return;
    }

    const hermesSessionMessagesMatch = pathname.match(/^\/api\/hermes\/sessions\/([^/]+)\/messages$/);
    if (hermesSessionMessagesMatch) {
      const sessionId = decodeURIComponent(hermesSessionMessagesMatch[1]);
      try {
        const messages = hermesSessionMessages(sessionId);
        sendJson(res, 200, { available: true, messages, source: 'hermes-state-db' });
      } catch (e) {
        const status = e.statusCode || 502;
        console.error('[api/hermes/sessions/:id/messages]', e.message || e);
        sendJson(res, status, {
          available: false,
          messages: [],
          error: e.message || 'Hermes session messages unavailable',
        });
      }
      return;
    }

    if (pathname === '/api/hermes/sessions') {
      try {
        const items = hermesSessionsList();
        sendJson(res, 200, { available: true, items, source: 'hermes-state-db' });
      } catch (e) {
        const status = e.statusCode || 502;
        console.error('[api/hermes/sessions]', e.message || e);
        sendJson(res, status, { available: false, items: [], error: e.message || 'Hermes sessions unavailable', source: 'hermes-state-db' });
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

    if (pathname === '/api/tts/omnivoice/status') {
      const configured = isOmniVoiceConfigured();
      const health = configured ? await probeOmniVoiceHealth() : { ready: false };
      sendJson(res, 200, {
        configured,
        ready: Boolean(health.ready),
        baseUrl: configured ? OMNIVOICE_BASE_URL : null,
        error: health.error || null,
      });
      return;
    }

    if (pathname === '/api/tts/omnivoice/samples') {
      try {
        const samples = await fetchOmniVoiceSamples();
        sendJson(res, 200, { samples });
      } catch (e) {
        const status = e.statusCode || 502;
        console.error('[api/tts/omnivoice/samples]', e.message || e);
        sendJson(res, status, { samples: [], error: e.message || 'OmniVoice samples unavailable' });
      }
      return;
    }

    if (pathname === '/api/tts/replay-cache/status') {
      try {
        sendJson(res, 200, ttsReplayCache.listStatus());
      } catch (e) {
        console.error('[api/tts/replay-cache/status]', e.message || e);
        sendJson(res, 500, { error: e.message || 'Server error' });
      }
      return;
    }

    const replayCacheMatch = pathname.match(/^\/api\/tts\/replay-cache\/([^/]+)$/);
    if (replayCacheMatch) {
      const replayId = decodeURIComponent(replayCacheMatch[1]);
      try {
        const entry = ttsReplayCache.getEntry(replayId);
        if (!entry) {
          sendJson(res, 404, { error: 'Replay entry not found' });
          return;
        }
        const audio = ttsReplayCache.readEntryBuffer(replayId);
        if (audio) {
          sendBinary(res, 200, audio.buffer, audio.contentType, {
            'X-Aether-Replay-Id': replayId,
          });
          return;
        }
        sendJson(res, 200, {
          id: entry.id,
          provider: entry.provider,
          hasAudio: false,
          text: entry.text || '',
        });
      } catch (e) {
        console.error('[api/tts/replay-cache/:id]', e.message || e);
        sendJson(res, 500, { error: e.message || 'Server error' });
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
  console.log(`User data SQLite: ${userStore.dbPath}`);
});
