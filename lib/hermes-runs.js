/**
 * Hermes /v1/runs API — server-side agent execution with cancel + event streaming.
 */
function gatewayRoot(baseUrl) {
  return String(baseUrl || '').replace(/\/v1\/?$/, '');
}

function authHeaders(apiKey, extra = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', ...extra };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

async function fetchHermesCapabilities(baseUrl, apiKey) {
  const url = `${String(baseUrl).replace(/\/$/, '')}/capabilities`;
  try {
    const res = await fetch(url, { headers: authHeaders(apiKey) });
    if (!res.ok) return { available: false, features: {} };
    const data = await res.json().catch(() => ({}));
    const features = data?.features || {};
    return {
      available: true,
      features,
      runSubmission: !!features.run_submission,
      runEvents: !!features.run_events_sse,
      runStop: !!features.run_stop,
    };
  } catch {
    return { available: false, features: {} };
  }
}

async function createHermesRun({ baseUrl, apiKey, payload, extraHeaders = {} }) {
  const url = `${String(baseUrl).replace(/\/$/, '')}/runs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(apiKey, extraHeaders),
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data.error?.message || data.error || data.message || text || `HTTP ${res.status}`);
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }
  return data;
}

async function stopHermesRun({ baseUrl, apiKey, runId }) {
  const url = `${String(baseUrl).replace(/\/$/, '')}/runs/${encodeURIComponent(runId)}/stop`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || data.error || data.message || `HTTP ${res.status}`);
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }
  return data;
}

async function getHermesRun({ baseUrl, apiKey, runId }) {
  const url = `${String(baseUrl).replace(/\/$/, '')}/runs/${encodeURIComponent(runId)}`;
  const res = await fetch(url, { headers: authHeaders(apiKey) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || data.error || data.message || `HTTP ${res.status}`);
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }
  return data;
}

/**
 * Stream run events from GET /v1/runs/{id}/events (SSE).
 * Invokes onEvent(eventName, parsedData) for each block.
 */
async function streamHermesRunEvents({ baseUrl, apiKey, runId, signal, onEvent }) {
  const url = `${String(baseUrl).replace(/\/$/, '')}/runs/${encodeURIComponent(runId)}/events`;
  const res = await fetch(url, {
    headers: authHeaders(apiKey, { Accept: 'text/event-stream' }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || `HTTP ${res.status}`);
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatchBlock = (block) => {
    const trimmed = block.trim();
    if (!trimmed) return;
    let eventName = 'message';
    let dataLine = '';
    for (const line of trimmed.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
    }
    if (!dataLine || dataLine === '[DONE]') return;
    let parsed;
    try {
      parsed = JSON.parse(dataLine);
    } catch {
      parsed = { raw: dataLine };
    }
    onEvent(eventName, parsed);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let splitAt;
    while ((splitAt = buffer.indexOf('\n\n')) !== -1) {
      dispatchBlock(buffer.slice(0, splitAt));
      buffer = buffer.slice(splitAt + 2);
    }
  }
  if (buffer.trim()) dispatchBlock(buffer);
}

function extractTextFromRunOutput(output) {
  if (!output) return '';
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    return output
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        if (item.type === 'message') {
          const content = item.content;
          if (typeof content === 'string') return content;
          if (Array.isArray(content)) {
            return content
              .map((part) => part?.text || part?.output_text || '')
              .filter(Boolean)
              .join('');
          }
        }
        if (item.type === 'output_text' && item.text) return item.text;
        return item.text || item.output || '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return String(output.message || output.text || '');
}

module.exports = {
  gatewayRoot,
  fetchHermesCapabilities,
  createHermesRun,
  stopHermesRun,
  getHermesRun,
  streamHermesRunEvents,
  extractTextFromRunOutput,
};
