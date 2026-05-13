// Phase E.5 — modal form for "Log Options Sent".
//
// Captures one or more products the user just sent to the customer in
// FB. On submit, the parent calls logManualOptionsSent() which appends
// to the lead's manualOptionsLog and flips status to options_sent.
// Server then injects "YOU PREVIOUSLY SENT THESE OPTIONS" on next gen.

import { useState } from 'react';

const PRODUCT_TYPES = ['wheel', 'tire', 'lift', 'leveling', 'accessory', 'other'];

function blankEntry() {
  return {
    product_type: 'wheel',
    brand: '',
    model: '',
    size: '',
    price: '',
    notes: ''
  };
}

export default function LogOptionsModal({ open, onClose, onSubmit, submitting }) {
  const [entries, setEntries] = useState([blankEntry()]);
  const [error, setError] = useState(null);

  if (!open) return null;

  function update(idx, field, value) {
    setEntries((prev) => {
      const next = prev.slice();
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  function addEntry() {
    setEntries((prev) => [...prev, blankEntry()]);
  }

  function removeEntry(idx) {
    setEntries((prev) => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  }

  function handleSubmit(e) {
    e.preventDefault();
    // Validate: at least one entry must have brand or model populated
    // (other fields can stay empty for terse logs).
    const cleaned = entries
      .map((entry) => ({
        product_type: entry.product_type || null,
        brand: entry.brand.trim() || null,
        model: entry.model.trim() || null,
        size: entry.size.trim() || null,
        price: entry.price.trim() || null,
        notes: entry.notes.trim() || null
      }))
      .filter((entry) => entry.brand || entry.model);

    if (cleaned.length === 0) {
      setError('Add at least one product with a brand or model');
      return;
    }
    setError(null);
    onSubmit(cleaned);
  }

  function handleClose() {
    if (submitting) return;
    setEntries([blankEntry()]);
    setError(null);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2 className="modal-title">Log Options Sent</h2>
          <button type="button" className="modal-close" onClick={handleClose} aria-label="Close">×</button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {entries.map((entry, idx) => (
              <div key={idx} className="log-entry">
                <div className="log-entry-head">
                  <span className="log-entry-title">Product {idx + 1}</span>
                  {entries.length > 1 && (
                    <button
                      type="button"
                      className="btn-mini btn-mini-err log-entry-remove"
                      onClick={() => removeEntry(idx)}
                      disabled={submitting}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="log-entry-grid">
                  <label className="log-field">
                    <span className="log-label">Type</span>
                    <select
                      value={entry.product_type}
                      onChange={(e) => update(idx, 'product_type', e.target.value)}
                      disabled={submitting}
                    >
                      {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                  <label className="log-field">
                    <span className="log-label">Brand</span>
                    <input
                      type="text"
                      value={entry.brand}
                      onChange={(e) => update(idx, 'brand', e.target.value)}
                      placeholder="Fuel"
                      disabled={submitting}
                    />
                  </label>
                  <label className="log-field">
                    <span className="log-label">Model</span>
                    <input
                      type="text"
                      value={entry.model}
                      onChange={(e) => update(idx, 'model', e.target.value)}
                      placeholder="Rebel"
                      disabled={submitting}
                    />
                  </label>
                  <label className="log-field">
                    <span className="log-label">Size</span>
                    <input
                      type="text"
                      value={entry.size}
                      onChange={(e) => update(idx, 'size', e.target.value)}
                      placeholder="20x10"
                      disabled={submitting}
                    />
                  </label>
                  <label className="log-field">
                    <span className="log-label">Price</span>
                    <input
                      type="text"
                      value={entry.price}
                      onChange={(e) => update(idx, 'price', e.target.value)}
                      placeholder="$1,499"
                      disabled={submitting}
                    />
                  </label>
                  <label className="log-field log-field-full">
                    <span className="log-label">Notes</span>
                    <input
                      type="text"
                      value={entry.notes}
                      onChange={(e) => update(idx, 'notes', e.target.value)}
                      placeholder="Set of 4, gloss black"
                      disabled={submitting}
                    />
                  </label>
                </div>
              </div>
            ))}

            <button
              type="button"
              className="btn-secondary log-add-btn"
              onClick={addEntry}
              disabled={submitting}
            >
              + Add Another Product
            </button>

            {error && <p className="log-error">{error}</p>}
          </div>

          <footer className="modal-footer">
            <button type="button" className="btn-secondary" onClick={handleClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Logging…' : 'Log Options'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
