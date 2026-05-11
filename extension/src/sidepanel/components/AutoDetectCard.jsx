import { useState } from 'react';

export default function AutoDetectCard({ autoDetect, isManual, onUseThis, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const status = autoDetect?.status;
  const history = autoDetect?.conversationHistory || [];
  const latestIncoming = autoDetect?.latestIncoming || '';

  let badgeClass = 'badge-status badge-no-thread';
  let badgeLabel = 'NO THREAD';
  if (status === 'ok' && latestIncoming) {
    if (isManual) {
      badgeClass = 'badge-status badge-manual';
      badgeLabel = 'MANUAL';
    } else {
      badgeClass = 'badge-status badge-auto';
      badgeLabel = 'AUTO';
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  }

  const hasData = status === 'ok' && latestIncoming;

  return (
    <section className="auto-card">
      <div className="auto-card-head">
        <span className={badgeClass}>{badgeLabel}</span>
        <span className="label-mono">AUTO-DETECT</span>
        <button
          type="button"
          className="btn-mini"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? '…' : 'Refresh'}
        </button>
      </div>

      {hasData ? (
        <>
          <div className="auto-incoming">
            <span className="label-mono">LATEST INCOMING</span>
            <p className="auto-incoming-text">{latestIncoming}</p>
          </div>

          <div className="auto-actions">
            <button
              type="button"
              className="btn-mini btn-mini-accent"
              onClick={onUseThis}
            >
              Use this
            </button>
            {history.length > 0 && (
              <button
                type="button"
                className="btn-mini"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? 'Hide' : 'Show'} context ({history.length})
              </button>
            )}
          </div>

          {expanded && history.length > 0 && (
            <div className="auto-history">
              {history.map((m, i) => (
                <div key={i} className={`auto-history-msg auto-history-${m.sender}`}>
                  <span className="auto-history-tag">{m.sender === 'them' ? 'THEM' : 'ME'}</span>
                  <span className="auto-history-text">{m.text}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="auto-empty">
          {status === 'no_thread_detected'
            ? 'No FB Marketplace thread detected on the active tab. Open a thread or paste manually below.'
            : status === 'no_active_tab'
            ? 'No active tab — switch to your FB Marketplace tab.'
            : 'Waiting for the active tab — switch to a FB Marketplace thread.'}
        </p>
      )}
    </section>
  );
}
