import { useEffect, useState } from 'react';
import LeadCard from './LeadCard.jsx';
import {
  getAllLeads,
  clearUnviewedQualified,
  updateLeadStatus,
  deleteLead
} from '../lib/leads.js';

const FILTERS = [
  { id: 'qualified', label: 'New Qualified', match: (l) => l.status === 'qualified' },
  { id: 'all', label: 'All', match: () => true },
  { id: 'contacted', label: 'Contacted', match: (l) => l.status === 'contacted' },
  {
    id: 'closed',
    label: 'Closed',
    match: (l) => l.status === 'closed_won' || l.status === 'closed_lost' || l.status === 'stale'
  }
];

export default function LeadsTab() {
  const [leads, setLeads] = useState([]);
  const [filter, setFilter] = useState('qualified');
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const all = await getAllLeads();
    setLeads(all);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    function handler(changes, area) {
      if (area === 'local' && changes.leads) {
        refresh();
      }
    }
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, []);

  useEffect(() => {
    if (filter === 'qualified') {
      clearUnviewedQualified().catch((err) =>
        console.warn('[FB Reply Maker SP] clearUnviewedQualified failed:', err)
      );
    }
  }, [filter]);

  async function handleStatusChange(threadId, newStatus) {
    await updateLeadStatus(threadId, newStatus);
    await refresh();
  }

  async function handleDelete(threadId) {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Delete this lead? This cannot be undone.')) return;
    await deleteLead(threadId);
    await refresh();
  }

  function openThread(url) {
    if (!url) return;
    chrome.tabs.create({ url });
  }

  const counts = {};
  for (const f of FILTERS) counts[f.id] = leads.filter(f.match).length;

  const filterDef = FILTERS.find((f) => f.id === filter) || FILTERS[0];
  const visibleLeads = leads.filter(filterDef.match);

  let emptyMessage = null;
  if (!loading && visibleLeads.length === 0) {
    if (filter === 'qualified') {
      emptyMessage =
        "No qualified leads yet. Keep chatting with customers and they'll show up here once enough info is captured.";
    } else if (filter === 'all') {
      emptyMessage =
        'No leads tracked yet. Generate a reply on a Marketplace thread to start tracking.';
    } else {
      emptyMessage = 'No leads matching this filter.';
    }
  }

  return (
    <div className="leads-tab">
      <div className="filter-chips">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`filter-chip ${filter === f.id ? 'filter-chip-active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            <span className="filter-chip-label">{f.label}</span>
            <span className="filter-count">({counts[f.id]})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="leads-empty">Loading…</p>
      ) : emptyMessage ? (
        <p className="leads-empty">{emptyMessage}</p>
      ) : (
        <div className="leads-list">
          {visibleLeads.map((lead) => (
            <LeadCard
              key={lead.threadId}
              lead={lead}
              onOpenThread={() => openThread(lead.fbThreadUrl)}
              onStatusChange={(s) => handleStatusChange(lead.threadId, s)}
              onDelete={() => handleDelete(lead.threadId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
