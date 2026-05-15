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

// CCAW locations — mirrors netlify/functions/lib/inventory/client.js
// LOCATIONS. The `name` field is what the backend's
// homeLocationKeyFromName() uses to resolve the inventory sort key.
// Keep names byte-identical to the client.js array.
const CCAW_LOCATIONS = [
  { name: 'Red Deer',       short: 'RD',  key: 'custitem_red_deer_int_ecomm_inv' },
  { name: 'Calgary',        short: 'CAL', key: 'custitem_calgary_int_ecomm_inv' },
  { name: 'Edmonton',       short: 'EDM', key: 'custitem_edmonton_int_ecomm_inv' },
  { name: 'Airdrie',        short: 'AIR', key: 'custitem_airdrie_int_ecomm_inv' },
  { name: 'Fort Sask',      short: 'FTS', key: 'custitem_ft_sask_int_ecomm_inv' },
  { name: 'Grande Prairie', short: 'GP',  key: 'custitem_grande_prairie_int_ecomm_inv' },
  { name: 'Lloydminster',   short: 'LLD', key: 'custitem_lloydminster_int_ecomm_inv' },
  { name: 'Regina',         short: 'REG', key: 'custitem_regina_int_ecomm_inv' },
  { name: 'Saskatoon',      short: 'SAS', key: 'custitem_saskatoon_int_ecomm_inv' },
  { name: 'Spruce Grove',   short: 'SG',  key: 'custitem_spruce_grove_int_ecomm_inv' },
  { name: 'Kelowna',        short: 'KEL', key: 'custitem_westbank_int_ecomm_inv' },
  { name: 'Kamloops',       short: 'KAM', key: 'custitem_kamloops_int_ecomm_inv' },
  { name: 'Lethbridge',     short: 'LTH', key: 'custitem_lethbridge_int_ecomm_inv' },
  { name: 'Medicine Hat',   short: 'MH',  key: 'custitem_medicine_hat_int_ecomm_inv' },
  { name: 'Fedco',          short: 'FED', key: 'custitem_fedco_int_ecomm_inv' }
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

  function updateTop(key, value) {
    setState({ ...state, [key]: value });
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
        <h2>You</h2>
        <label className="field">
          <span className="mono">YOUR NAME</span>
          <input
            type="text"
            value={state.userName || ''}
            onChange={(e) => updateTop('userName', e.target.value)}
            placeholder="e.g. Dayton"
            spellCheck={false}
          />
          <span className="field-hint">
            Used in every reply opener (e.g. "Hey @John, Dayton here, happy to help you out today!"). Leave blank if you want generic openers.
          </span>
        </label>
      </section>

      <section className="card">
        <h2>Location</h2>
        <label className="field">
          <span className="mono">YOUR CCAW LOCATION</span>
          <select
            value={state.location?.name || ''}
            onChange={(e) => {
              const picked = CCAW_LOCATIONS.find((l) => l.name === e.target.value);
              setState({
                ...state,
                location: {
                  ...state.location,
                  name: picked ? picked.name : '',
                  short: picked ? picked.short : '',
                  key: picked ? picked.key : ''
                }
              });
              setSaved(false);
            }}
            required
          >
            <option value="" disabled>Pick a location…</option>
            {CCAW_LOCATIONS.map((l) => (
              <option key={l.key} value={l.name}>{l.name}</option>
            ))}
          </select>
          <span className="field-hint">
            Drives inventory ranking — picks at YOUR location land first in every recommendation, with "ready to rock at {state.location?.name || '[location]'}" framing. Required.
          </span>
        </label>
        <label className="field">
          <span className="mono">ADDRESS</span>
          <input
            type="text"
            value={state.location?.address || ''}
            onChange={(e) => update('location', 'address', e.target.value)}
            placeholder="e.g. 1234 Macleod Trail SE, Calgary AB"
            spellCheck={false}
          />
          <span className="field-hint">
            Used when a customer asks where you are or you invite them in.
          </span>
        </label>
        <label className="field">
          <span className="mono">PHONE</span>
          <input
            type="tel"
            value={state.location?.phone || ''}
            onChange={(e) => update('location', 'phone', e.target.value)}
            placeholder="e.g. 403-555-0100"
            spellCheck={false}
          />
          <span className="field-hint">
            Used in "give us a call with a CC" closes.
          </span>
        </label>
        <label className="field">
          <span className="mono">E-TRANSFER EMAIL</span>
          <input
            type="email"
            value={state.location?.etransferEmail || ''}
            onChange={(e) => update('location', 'etransferEmail', e.target.value)}
            placeholder="e.g. deposits@ccaw.ca"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="field-hint">
            Used when closing with payment paths (deposit / final).
          </span>
        </label>
      </section>

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
