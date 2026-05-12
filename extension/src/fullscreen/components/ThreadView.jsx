import { useEffect, useRef, useState } from 'react';
import MultiProductChips from '../../sidepanel/components/MultiProductChips.jsx';
import ReturningCustomerBanner from '../../sidepanel/components/ReturningCustomerBanner.jsx';

function vehicleSummary(lead) {
  const v = lead?.captured_fields?.vehicle;
  return v && String(v).trim() ? String(v).trim() : null;
}

export default function ThreadView({
  lead,
  history,
  historyLoading,
  historyError,
  onRefreshHistory,
  onOpenInFb
}) {
  const scrollRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, autoScroll]);

  if (!lead) {
    return (
      <section className="pane-thread pane-thread-empty">
        <p className="pane-thread-empty-msg">Select a lead from the list to view the thread.</p>
      </section>
    );
  }

  const vehicle = vehicleSummary(lead);
  const products = Array.isArray(lead.products_of_interest) ? lead.products_of_interest : [];
  const readyForOptions = Array.isArray(lead.open_flags) && lead.open_flags.includes('ready_for_options');
  const isReturning = lead.conversation_mode === 'returning';

  return (
    <section className="pane-thread">
      <header className="pane-thread-head">
        <div className="pane-thread-head-left">
          <h2 className="pane-thread-title">{lead.partner_name || 'Unknown'}</h2>
          <p className="pane-thread-subtitle">
            {lead.listing_title || '—'}{vehicle ? ` · ${vehicle}` : ''}
          </p>
        </div>
        <div className="pane-thread-head-right">
          <button type="button" className="btn-mini" onClick={onRefreshHistory} disabled={historyLoading}>
            {historyLoading ? '…' : 'Refresh'}
          </button>
          <button type="button" className="btn-mini btn-mini-accent" onClick={onOpenInFb}>
            Open in FB
          </button>
        </div>
      </header>

      <div className="pane-thread-banners">
        {isReturning && (
          <ReturningCustomerBanner
            silenceDurationMs={lead.silence_duration_ms}
            priorStatus={lead.status}
            reason={null}
          />
        )}
        <MultiProductChips products={products} />
        {readyForOptions && (
          <div className="ready-banner" role="status" aria-label="Ready for options">
            <span className="ready-banner-icon" aria-hidden="true">{'\u{1F3AF}'}</span>
            <span className="ready-banner-title">READY FOR OPTIONS</span>
            <span className="ready-banner-body">All tracked products are qualified.</span>
          </div>
        )}
      </div>

      <div
        className="pane-thread-history"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          setAutoScroll(atBottom);
        }}
      >
        {historyLoading && history.length === 0 && (
          <p className="pane-thread-empty-msg">Loading history…</p>
        )}
        {historyError && (
          <p className="pane-thread-error">
            {historyError === 'fb_tab_not_open'
              ? 'FB tab is not open for this thread. Click Open in FB to load history.'
              : `Couldn't load history: ${historyError}`}
          </p>
        )}
        {!historyLoading && !historyError && history.length === 0 && (
          <p className="pane-thread-empty-msg">No messages captured yet.</p>
        )}
        {history.map((m, i) => (
          <div
            key={`${i}-${m.text.slice(0, 24)}`}
            className={`bubble bubble-${m.sender === 'me' ? 'me' : 'them'}`}
          >
            <span className="bubble-text">{m.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
