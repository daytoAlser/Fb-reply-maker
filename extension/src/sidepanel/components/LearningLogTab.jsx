import { useCallback, useEffect, useState } from 'react';
import { fetchRecent, updateFlag } from '../lib/learningLog.js';

const FILTERS = [
  { id: 'all',        label: 'All' },
  { id: 'edited',     label: 'Edited only' },
  { id: 'never_sent', label: 'Never sent' },
  { id: 'flagged',    label: 'Flagged only' }
];

function formatRelative(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}

function statusFor(record) {
  if (record.superseded_by) return { glyph: '↻', label: 'superseded', cls: 'learning-status-superseded' };
  if (record.send_timeout) return { glyph: '⊝', label: 'never sent', cls: 'learning-status-timeout' };
  if (record.final_sent_message === null || record.final_sent_message === undefined) return { glyph: '…', label: 'pending', cls: 'learning-status-pending' };
  if (record.was_edited) return { glyph: '✏', label: 'edited', cls: 'learning-status-edited' };
  return { glyph: '✓', label: 'unchanged', cls: 'learning-status-unchanged' };
}

function truncate(s, max = 120) {
  if (typeof s !== 'string') return '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function ConversationHistory({ messages, partnerName }) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return <div className="learning-history-empty">No prior history captured.</div>;
  }
  return (
    <div className="learning-history">
      {messages.map((m, i) => {
        const isMe = m?.sender === 'me';
        const label = isMe ? 'ME' : (m?.senderName || partnerName || 'THEM').toString().toUpperCase();
        return (
          <div key={i} className={`learning-history-row ${isMe ? 'learning-history-row-me' : 'learning-history-row-them'}`}>
            <span className="learning-history-sender">{label}</span>
            <span className="learning-history-text">{typeof m?.text === 'string' ? m.text : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

function DiffView({ diff }) {
  if (!diff || !Array.isArray(diff.sentences)) {
    return <div className="learning-diff-empty">No structured diff available.</div>;
  }
  return (
    <div className="learning-diff-block">
      {diff.sentences.map((s, i) => {
        if (s.type === 'added') {
          return (
            <div key={i} className="learning-diff-sentence learning-diff-sentence-added">
              <span className="learning-diff-sentence-marker">+</span>
              <span>{s.final_raw}</span>
            </div>
          );
        }
        if (s.type === 'removed') {
          return (
            <div key={i} className="learning-diff-sentence learning-diff-sentence-removed">
              <span className="learning-diff-sentence-marker">−</span>
              <span>{s.original_raw}</span>
            </div>
          );
        }
        // matched
        return (
          <div key={i} className="learning-diff-sentence learning-diff-sentence-matched">
            {Array.isArray(s.tokens) && s.tokens.length > 0 ? (
              s.tokens.map((t, j) => (
                <span key={j} className={`learning-diff-token learning-diff-token-${t.type}`}>
                  {t.text}
                </span>
              ))
            ) : (
              <span>{s.original_raw || s.final_raw}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LearningCard({ record, onFlagToggle }) {
  const [expanded, setExpanded] = useState(false);
  const status = statusFor(record);
  const isFlagged = !!record.flagged_for_review;
  return (
    <article className={`learning-card ${expanded ? 'learning-card-expanded' : ''}`}>
      <header className="learning-card-header" onClick={() => setExpanded((e) => !e)}>
        <div className="learning-card-meta">
          <span className="learning-kind-badge">{(record.variant_kind || '?').toUpperCase()}</span>
          <span className={`learning-status-icon ${status.cls}`} title={status.label}>{status.glyph}</span>
          {isFlagged && <span className="learning-flag-icon" title="Flagged for prompt review">{'\u{1F6A9}'}</span>}
          <span className="learning-card-time">{formatRelative(record.inserted_at)}</span>
        </div>
        <div className="learning-card-preview">{truncate(record.customer_message || '(no customer message)')}</div>
      </header>
      {expanded && (
        <div className="learning-card-body">
          <div className="learning-card-section">
            <div className="learning-card-section-label">
              Conversation history
              <span className="learning-card-section-label-meta">
                {Array.isArray(record.conversation_history) ? `${record.conversation_history.length} msg` : 'none'}
              </span>
            </div>
            <ConversationHistory
              messages={record.conversation_history}
              partnerName={record.partner_name}
            />
          </div>
          <div className="learning-card-divider" aria-hidden="true">
            <span>CONTEXT ABOVE · AI EVALUATION BELOW</span>
          </div>
          <div className="learning-card-section">
            <div className="learning-card-section-label">Customer message (latest)</div>
            <div className="learning-card-section-content">{record.customer_message || '—'}</div>
          </div>
          <div className="learning-card-section">
            <div className="learning-card-section-label">Variant shown</div>
            <div className="learning-card-section-content">{record.variant_shown}</div>
          </div>
          <div className="learning-card-section">
            <div className="learning-card-section-label">Final sent message</div>
            <div className="learning-card-section-content">
              {record.final_sent_message
                ? record.final_sent_message
                : <em className="learning-card-empty">{record.superseded_by ? 'superseded by a later INSERT' : record.send_timeout ? 'never sent (60s timeout)' : 'pending'}</em>}
            </div>
          </div>
          {record.final_sent_message && record.was_edited && (
            <div className="learning-card-section">
              <div className="learning-card-section-label">Diff (variant → sent)</div>
              <DiffView diff={record.edit_diff} />
              {typeof record.char_distance === 'number' && (
                <div className="learning-card-section-foot">{`char delta: ${record.char_distance}`}</div>
              )}
            </div>
          )}
          <div className="learning-card-footer">
            <button
              type="button"
              className={`learning-flag-btn ${isFlagged ? 'learning-flag-btn-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onFlagToggle(record, !isFlagged); }}
            >
              {isFlagged ? `${'\u{1F6A9}'} Flagged ✓` : `${'\u{1F6A9}'} Flag for prompt update`}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export default function LearningLogTab() {
  const [records, setRecords] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (nextFilter = filter) => {
    setLoading(true);
    setError(null);
    const resp = await fetchRecent({ filter: nextFilter });
    if (!resp.ok) {
      setError(resp.error || 'Failed to load');
      setRecords([]);
    } else {
      setRecords(resp.records);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(filter); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  const onFlagToggle = useCallback(async (record, flagged) => {
    // Optimistic update.
    setRecords((rs) => rs.map((r) => (r.id === record.id ? { ...r, flagged_for_review: flagged } : r)));
    const resp = await updateFlag({ id: record.id, flagged });
    if (!resp.ok) {
      // Rollback.
      setRecords((rs) => rs.map((r) => (r.id === record.id ? { ...r, flagged_for_review: !flagged } : r)));
      setError('Flag update failed: ' + (resp.error || 'unknown'));
    }
  }, []);

  const editedCount = records.filter((r) => r.was_edited === true).length;
  const totalCount = records.length;

  return (
    <section className="panel learning-log-panel" role="tabpanel">
      <header className="learning-log-header">
        <div className="learning-log-title">LEARNING LOG</div>
        <div className="learning-log-counter">
          <strong>{editedCount}</strong> edited / <strong>{totalCount}</strong> total in last 20
        </div>
        <button
          type="button"
          className="learning-log-refresh"
          onClick={() => load(filter)}
          aria-label="Refresh"
          title="Re-fetch the latest 20 records"
        >
          {'⟳'}
        </button>
      </header>
      <div className="learning-log-filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`learning-filter-chip ${filter === f.id ? 'learning-filter-chip-active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && (
        <div className="learning-log-error">
          <div className="learning-log-error-text">{error}</div>
          <button type="button" className="learning-log-error-retry" onClick={() => load(filter)}>Retry</button>
        </div>
      )}
      {loading && !error && (
        <div className="learning-log-skeleton">
          <div className="learning-log-skeleton-card" />
          <div className="learning-log-skeleton-card" />
          <div className="learning-log-skeleton-card" />
        </div>
      )}
      {!loading && !error && records.length === 0 && (
        <div className="learning-log-empty">No records yet. Click INSERT on a variant in the Auto Response panel to start capturing.</div>
      )}
      {!loading && !error && records.length > 0 && (
        <div className="learning-log-list">
          {records.map((r) => (
            <LearningCard key={r.id} record={r} onFlagToggle={onFlagToggle} />
          ))}
        </div>
      )}
    </section>
  );
}
