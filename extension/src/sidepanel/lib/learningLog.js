// Side-panel helpers for the Learning Log tab. Wraps the SW message
// proxy so the React component can stay free of chrome.runtime
// plumbing.

function sendMessage(type, payload = {}) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, payload }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        if (!resp) {
          resolve({ ok: false, error: 'no response from service worker' });
          return;
        }
        resolve(resp);
      });
    } catch (err) {
      resolve({ ok: false, error: err?.message || String(err) });
    }
  });
}

export async function fetchRecent({ filter = 'all' } = {}) {
  const resp = await sendMessage('FETCH_LEARNING_RECENT', { filter });
  if (!resp || !resp.ok) {
    return { ok: false, error: resp?.error || resp?.reason || 'fetch failed', records: [] };
  }
  return { ok: true, records: Array.isArray(resp.records) ? resp.records : [], filter: resp.filter || filter };
}

export async function updateFlag({ id, flagged }) {
  const resp = await sendMessage('UPDATE_LEARNING_FLAG', { id, flagged: !!flagged });
  if (!resp || !resp.ok) {
    return { ok: false, error: resp?.error || resp?.reason || 'update failed' };
  }
  return { ok: true, row: resp.row };
}
