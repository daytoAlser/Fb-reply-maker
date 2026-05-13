import { useEffect, useMemo, useState } from 'react';

const VARIANT_ORDER = ['quick', 'standard', 'detailed'];

// F.1.7 adjustment 3: per-variant send. Mirrors the sidepanel
// describeSendResponse so the two surfaces show identical toast text.
function describeSendResponse(res) {
  if (!res) return { label: 'Send failed', tone: 'err' };
  if (res.ok && res.sent) {
    const note = res.humanization_succeeded === false ? ' (bulk-paste fallback used)' : '';
    return { label: 'Sent' + note, tone: 'ok' };
  }
  switch (res.reason) {
    case 'placeholder_leak':
      return { label: 'Blocked: variant contains a template placeholder', tone: 'err' };
    case 'duplicate_send':
      return { label: 'Blocked: this exact message was already sent in this thread', tone: 'err' };
    case 'empty':
      return { label: 'Blocked: variant is empty', tone: 'err' };
    case 'thread_url_drift':
      return { label: 'Blocked: FB tab moved to a different thread', tone: 'warn' };
    case 'send_button_not_found':
      return { label: "Couldn't find Send button on FB. Text copied to clipboard.", tone: 'warn' };
    case 'send_not_confirmed':
      return { label: 'Send may have failed. Check FB to verify.', tone: 'warn' };
    case 'tab_hidden_mid_type':
    case 'tab_hidden_before_send':
      return { label: 'FB tab went background mid-send. Try again.', tone: 'warn' };
    default:
      return { label: 'Send failed: ' + (res.reason || 'unknown'), tone: 'err' };
  }
}

function formatGeneratedAt(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleString();
}

export default function ReplyPane({
  threadId,
  cached,
  generating,
  onRegenerate
}) {
  const result = cached?.result || null;
  const variants = result?.variants || {};
  const [expanded, setExpanded] = useState('quick');
  const [drafts, setDrafts] = useState({});
  const [copyToast, setCopyToast] = useState(null);
  // F.1.7 send state per variant kind. Values: null | 'pending' | { label, tone }
  const [sendState, setSendState] = useState({});

  // Reset drafts whenever the cached payload changes (new generation or new
  // thread selected). Drafts are scratch buffers for in-pane edits; they
  // don't persist.
  useEffect(() => {
    setDrafts({});
    setSendState({});
    setExpanded('quick');
  }, [cached?.generated_at, threadId]);

  const ordered = useMemo(() => VARIANT_ORDER.filter((k) => typeof variants[k] === 'string'), [variants]);

  function getText(kind) {
    return typeof drafts[kind] === 'string' ? drafts[kind] : (variants[kind] || '');
  }

  function setText(kind, value) {
    setDrafts((d) => ({ ...d, [kind]: value }));
  }

  async function handleCopy(kind) {
    try {
      await navigator.clipboard.writeText(getText(kind));
      setCopyToast(kind);
      setTimeout(() => setCopyToast(null), 1400);
    } catch (err) {
      console.error('[FB Reply Maker FS] copy failed:', err?.message);
    }
  }

  function handleSend(kind) {
    if (!threadId) return;
    if (sendState[kind] === 'pending') return;
    const text = getText(kind);
    setSendState((s) => ({ ...s, [kind]: 'pending' }));
    try {
      chrome.runtime.sendMessage(
        { type: 'INSERT_REPLY', text, auto_send: true, thread_id: threadId },
        (res) => {
          if (chrome.runtime.lastError) {
            console.error('[FB Reply Maker FS] SEND error:', chrome.runtime.lastError.message);
            setSendState((s) => ({ ...s, [kind]: { label: 'Send error', tone: 'err' } }));
          } else {
            const desc = describeSendResponse(res);
            console.log('[FB Reply Maker FS] SEND response:', res, '→', desc);
            setSendState((s) => ({ ...s, [kind]: desc }));
          }
          setTimeout(() => {
            setSendState((s) => {
              const next = { ...s };
              delete next[kind];
              return next;
            });
          }, 4000);
        }
      );
    } catch (err) {
      console.error('[FB Reply Maker FS] SEND threw:', err);
      setSendState((s) => ({ ...s, [kind]: { label: 'Send failed', tone: 'err' } }));
      setTimeout(() => {
        setSendState((s) => {
          const next = { ...s };
          delete next[kind];
          return next;
        });
      }, 4000);
    }
  }

  if (!threadId) {
    return (
      <aside className="pane-reply pane-reply-empty">
        <p className="pane-reply-empty-msg">Select a lead to see replies.</p>
      </aside>
    );
  }

  return (
    <aside className="pane-reply">
      <header className="pane-reply-head">
        <div className="pane-reply-head-left">
          <h2 className="pane-reply-title">REPLY</h2>
          {result?.category && <span className="pane-reply-category">{result.category}</span>}
        </div>
        <div className="pane-reply-head-right">
          {cached?.generated_at && (
            <span className="pane-reply-timestamp" title={new Date(cached.generated_at).toLocaleString()}>
              {formatGeneratedAt(cached.generated_at)}
            </span>
          )}
          <button
            type="button"
            className="btn-mini"
            onClick={() => onRegenerate(threadId)}
            disabled={generating}
          >
            {generating ? '…' : 'Regenerate'}
          </button>
        </div>
      </header>

      {result?.intent_summary && (
        <p className="pane-reply-intent">{result.intent_summary}</p>
      )}

      {!result && !generating && (
        <p className="pane-reply-empty-msg">
          No variants cached yet. New customer messages auto-generate; or click Regenerate above.
        </p>
      )}

      {!result && generating && (
        <p className="pane-reply-empty-msg">Generating variants…</p>
      )}

      {ordered.map((kind) => {
        const isOpen = expanded === kind;
        const text = getText(kind);
        return (
          <article key={kind} className={`variant-card variant-card-${kind} ${isOpen ? 'is-open' : 'is-collapsed'}`}>
            <header className="variant-card-head">
              <button
                type="button"
                className="variant-card-toggle"
                onClick={() => setExpanded(isOpen ? null : kind)}
                aria-expanded={isOpen}
              >
                <span className="variant-card-kind">{kind.toUpperCase()}</span>
                <span className="variant-card-chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
              </button>
              {!isOpen && (
                <span className="variant-card-preview">{text.slice(0, 90)}{text.length > 90 ? '…' : ''}</span>
              )}
            </header>
            {isOpen && (
              <>
                <textarea
                  className="variant-card-text"
                  value={text}
                  onChange={(e) => setText(kind, e.target.value)}
                  rows={Math.min(10, Math.max(3, text.split('\n').length + 1))}
                  spellCheck={false}
                />
                <div className="variant-card-actions">
                  <button type="button" className="btn-mini" onClick={() => handleCopy(kind)}>
                    {copyToast === kind ? 'Copied ✓' : 'Copy'}
                  </button>
                  {(() => {
                    const ss = sendState[kind];
                    const pending = ss === 'pending';
                    const label = pending
                      ? 'Sending…'
                      : (ss && typeof ss === 'object' ? ss.label : 'Send');
                    const tone = ss && typeof ss === 'object' ? ss.tone : null;
                    const cls = `btn-primary btn-primary-sm send-btn ${tone ? 'send-btn-' + tone : ''}`;
                    return (
                      <button
                        type="button"
                        className={cls}
                        onClick={() => handleSend(kind)}
                        disabled={pending || !threadId}
                        title={
                          !threadId
                            ? 'Select a thread first'
                            : 'Type and click Send on FB with humanization'
                        }
                      >
                        {label}
                      </button>
                    );
                  })()}
                </div>
              </>
            )}
          </article>
        );
      })}
    </aside>
  );
}
