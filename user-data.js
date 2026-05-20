/**
 * Browser client for server-backed user settings (SQLite via /api/user/data).
 * Falls back to localStorage when the API is unavailable.
 */
(function initAetherUserData(global) {
  const cache = Object.create(null);
  let flushTimer = null;
  const pending = Object.create(null);
  let serverAvailable = false;

  function readLocalAetherKeys() {
    const out = Object.create(null);
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith('aether_')) {
          out[key] = localStorage.getItem(key);
        }
      }
    } catch {
      /* ignore */
    }
    return out;
  }

  function mirrorToLocalStorage(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* ignore quota / private mode */
    }
  }

  async function fetchStore() {
    const res = await fetch('/api/user/data');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    return body.data || {};
  }

  async function putStore(data) {
    const res = await fetch('/api/user/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function deleteStoreKeys(keys) {
    const res = await fetch('/api/user/data', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function init() {
    const local = readLocalAetherKeys();
    let remote = Object.create(null);

    try {
      remote = await fetchStore();
      serverAvailable = true;
    } catch (err) {
      serverAvailable = false;
      Object.assign(cache, local);
      console.warn('[AetherUserData] Using localStorage only:', err.message);
      return { source: 'localStorage', error: err.message };
    }

    const toUpload = Object.create(null);

    if (Object.keys(remote).length === 0 && Object.keys(local).length > 0) {
      Object.assign(cache, local);
      Object.assign(toUpload, local);
    } else {
      Object.assign(cache, remote);
      for (const [key, value] of Object.entries(local)) {
        if (!(key in remote)) {
          cache[key] = value;
          toUpload[key] = value;
        }
      }
    }

    for (const [key, value] of Object.entries(cache)) {
      mirrorToLocalStorage(key, value);
    }

    if (Object.keys(toUpload).length > 0) {
      try {
        await putStore(toUpload);
      } catch (err) {
        console.warn('[AetherUserData] Migration upload failed:', err.message);
      }
    }

    return { source: 'sqlite', keys: Object.keys(cache).length, serverAvailable };
  }

  function getItem(key) {
    if (key in cache) return cache[key];
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function setItem(key, value) {
    const stored = typeof value === 'string' ? value : JSON.stringify(value);
    cache[key] = stored;
    pending[key] = stored;
    mirrorToLocalStorage(key, stored);
    if (serverAvailable) scheduleFlush();
  }

  function removeItem(key) {
    delete cache[key];
    pending[key] = null;
    mirrorToLocalStorage(key, null);
    if (serverAvailable) scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush().catch((err) => console.warn('[AetherUserData] flush:', err.message));
    }, 200);
  }

  async function flush() {
    const batch = { ...pending };
    for (const key of Object.keys(batch)) delete pending[key];
    if (!Object.keys(batch).length) return;

    const data = Object.create(null);
    const deletes = [];

    for (const [key, value] of Object.entries(batch)) {
      if (value === null) deletes.push(key);
      else data[key] = value;
    }

    try {
      if (Object.keys(data).length) await putStore(data);
      if (deletes.length) await deleteStoreKeys(deletes);
    } catch (err) {
      Object.assign(pending, batch);
      throw err;
    }
  }

  global.AetherUserData = {
    init,
    getItem,
    setItem,
    removeItem,
    flush,
    isServerAvailable: () => serverAvailable,
  };
})(window);
