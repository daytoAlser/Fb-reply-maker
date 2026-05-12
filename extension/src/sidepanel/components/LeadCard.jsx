import { useEffect, useRef, useState } from 'react';

const STATUS_LABELS = {
  new: 'New',
  qualifying: 'Qualifying',
  qualified: 'Qualified',
  contacted: 'Contacted',
  closed_won: 'Won',
  closed_lost: 'Lost',
  stale: 'Stale'
};

const STATUS_CLASSES = {
  new: 'status-gray',
  qualifying: 'status-gray',
  qualified: 'status-amber',
  contacted: 'status-green',
  closed_won: 'status-blue',
  closed_lost: 'status-red',
  stale: 'status-slate'
};

const FIELD_LABELS = {
  vehicle: 'VEHICLE',
  lookPreference: 'LOOK',
  rideHeight: 'HEIGHT',
  tireSize: 'TIRE',
  intent: 'INTENT'
};

function formatRelative(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

function isMeaningful(v) {
  return v !== null && v !== undefined && v !== '';
}

export default function LeadCard({ lead, onOpenThread, onStatusChange, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickAway(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [menuOpen]);

  const captured = lead.capturedFields || {};
  const fieldEntries = Object.entries(captured).filter(([, v]) => isMeaningful(v));

  function handleMenuAction(action) {
    setMenuOpen(false);
    if (action === 'delete') onDelete();
    else onStatusChange(action);
  }

  return (
    <article className="lead-card">
      <header className="lead-card-head">
        <h3 className="lead-name">{lead.partnerName || 'Unknown'}</h3>
        <div className="lead-head-right">
          <span className={`status-pill ${STATUS_CLASSES[lead.status] || 'status-gray'}`}>
            {STATUS_LABELS[lead.status] || lead.status}
          </span>
          <div className="lead-menu" ref={menuRef}>
            <button
              type="button"
              className="lead-menu-trigger"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="More actions"
              aria-haspopup="true"
              aria-expanded={menuOpen}
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="lead-menu-dropdown" role="menu">
                <button type="button" role="menuitem" onClick={() => handleMenuAction('closed_won')}>
                  Mark Closed Won
                </button>
                <button type="button" role="menuitem" onClick={() => handleMenuAction('closed_lost')}>
                  Mark Closed Lost
                </button>
                <button type="button" role="menuitem" onClick={() => handleMenuAction('stale')}>
                  Mark Stale
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="lead-menu-danger"
                  onClick={() => handleMenuAction('delete')}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {lead.listingTitle && (
        <p className="lead-listing">{lead.listingTitle}</p>
      )}

      {fieldEntries.length > 0 && (
        <div className="lead-fields">
          {fieldEntries.map(([k, v]) => (
            <span key={k} className="lead-field-chip">
              <span className="lead-field-label">{FIELD_LABELS[k] || k.toUpperCase()}:</span>
              <span className="lead-field-value">{String(v)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="lead-card-foot">
        <span className="lead-timestamp">Captured: {formatRelative(lead.lastUpdated)}</span>
      </div>

      <div className="lead-actions">
        <button
          type="button"
          className="lead-btn lead-btn-outline"
          onClick={onOpenThread}
          disabled={!lead.fbThreadUrl}
        >
          Open Thread
        </button>
        {lead.status !== 'contacted' && (
          <button
            type="button"
            className="lead-btn lead-btn-primary"
            onClick={() => onStatusChange('contacted')}
          >
            Mark Contacted
          </button>
        )}
      </div>
    </article>
  );
}
