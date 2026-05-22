/**
 * Proxy Hermes gateway Jobs API (/api/jobs) for scheduled agent work.
 */
function jobsBaseUrl(apiBaseUrl) {
  return String(apiBaseUrl || '').replace(/\/v1\/?$/, '');
}

function authHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

async function jobsFetch(apiBaseUrl, apiKey, pathname, options = {}) {
  const url = `${jobsBaseUrl(apiBaseUrl)}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: authHeaders(apiKey),
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || data.error || data.message || `HTTP ${res.status}`);
    err.statusCode = res.status === 404 ? 404 : res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }
  return data;
}

function listJobs(apiBaseUrl, apiKey) {
  return jobsFetch(apiBaseUrl, apiKey, '/api/jobs');
}

function getJob(apiBaseUrl, apiKey, jobId) {
  return jobsFetch(apiBaseUrl, apiKey, `/api/jobs/${encodeURIComponent(jobId)}`);
}

function createJob(apiBaseUrl, apiKey, body) {
  return jobsFetch(apiBaseUrl, apiKey, '/api/jobs', { method: 'POST', body });
}

function updateJob(apiBaseUrl, apiKey, jobId, body) {
  return jobsFetch(apiBaseUrl, apiKey, `/api/jobs/${encodeURIComponent(jobId)}`, { method: 'PATCH', body });
}

function deleteJob(apiBaseUrl, apiKey, jobId) {
  return jobsFetch(apiBaseUrl, apiKey, `/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
}

function pauseJob(apiBaseUrl, apiKey, jobId) {
  return jobsFetch(apiBaseUrl, apiKey, `/api/jobs/${encodeURIComponent(jobId)}/pause`, { method: 'POST', body: {} });
}

function resumeJob(apiBaseUrl, apiKey, jobId) {
  return jobsFetch(apiBaseUrl, apiKey, `/api/jobs/${encodeURIComponent(jobId)}/resume`, { method: 'POST', body: {} });
}

function runJobNow(apiBaseUrl, apiKey, jobId) {
  return jobsFetch(apiBaseUrl, apiKey, `/api/jobs/${encodeURIComponent(jobId)}/run`, { method: 'POST', body: {} });
}

module.exports = {
  listJobs,
  getJob,
  createJob,
  updateJob,
  deleteJob,
  pauseJob,
  resumeJob,
  runJobNow,
};
