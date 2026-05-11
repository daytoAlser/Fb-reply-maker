import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { loadAll, saveAll } from '../sidepanel/lib/storage.js';
import './options.css';

const CATEGORIES = [
  'auto',
  'availability',
  'fitment',
  'price_haggle',
  'location_hours',
  'delivery_shipping',
  'stock_check',
  'install_service',
  'trade_in',
  'other'
];

function Options() {
  const [state, setState] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadAll().then(setState).catch((err) => setError(err.message || String(err)));
  }, []);

  if (error) {
    return <div className="loading error">Failed to load settings: {error}</div>;
  }
  if (!state) {
    return <div className="loading">Loading…</div>;
  }

  function update(section, key, value) {
    setState({ ...state, [section]: { ...state[section], [key]: value } });
    setSaved(false);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await saveAll(state);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="page" onSubmit={handleSave}>
      <header className="page-header">
        <h1>FB Reply Maker</h1>
        <span className="mono">SETTINGS</span>
      </header>

      <section className="card">
        <h2>API</h2>
        <label className="field">
          <span className="mono">ENDPOINT</span>
          <input
            type="url"
            value={state.config.endpoint}
            onChange={(e) => update('config', 'endpoint', e.target.value)}
            spellCheck={false}
            required
          />
        </label>
        <label className="field">
          <span className="mono">SHARED SECRET</span>
          <input
            type="password"
            value={state.config.secret}
            onChange={(e) => update('config', 'secret', e.target.value)}
            placeholder="paste the SHARED_SECRET set in netlify env"
            autoComplete="new-password"
            spellCheck={false}
            required
          />
          <span className="field-hint">Stored encrypted at rest by Chrome (chrome.storage.sync). Never logged.</span>
        </label>
      </section>

      <section className="card">
        <h2>Business Context</h2>
        <label className="field">
          <span className="mono">NAME</span>
          <input
            type="text"
            value={state.context.name}
            onChange={(e) => update('context', 'name', e.target.value)}
          />
        </label>
        <label className="field">
          <span className="mono">LOCATIONS</span>
          <textarea
            rows={5}
            value={state.context.locations}
            onChange={(e) => update('context', 'locations', e.target.value)}
            placeholder="One location per line, or comma-separated."
          />
        </label>
        <label className="field">
          <span className="mono">PHONE</span>
          <input
            type="text"
            value={state.context.phone}
            onChange={(e) => update('context', 'phone', e.target.value)}
            placeholder="Optional"
          />
        </label>
        <label className="field">
          <span className="mono">HOURS</span>
          <input
            type="text"
            value={state.context.hours}
            onChange={(e) => update('context', 'hours', e.target.value)}
          />
        </label>
        <label className="field">
          <span className="mono">CUSTOM NOTES</span>
          <textarea
            rows={4}
            value={state.context.customNotes}
            onChange={(e) => update('context', 'customNotes', e.target.value)}
          />
        </label>
      </section>

      <section className="card">
        <h2>Preferences</h2>
        <label className="field">
          <span className="mono">DEFAULT CATEGORY</span>
          <select
            value={state.preferences.defaultCategory}
            onChange={(e) => update('preferences', 'defaultCategory', e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </section>

      <div className="actions">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="saved-flash">Saved</span>}
      </div>
    </form>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>
);
