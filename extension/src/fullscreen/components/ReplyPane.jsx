import { useEffect, useMemo, useState } from 'react';

const VARIANT_ORDER = ['quick', 'standard', 'detailed'];

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

  // Reset drafts whenever the cached payload changes (new generation or new
  // thread selected). Drafts are scratch buffers for in-pane edits; they
  // don't persist.
  useEffect(() => {
    setDrafts({});
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
                  <button
                    type="button"
                    className="btn-primary btn-primary-sm"
                    title="Send-injection ships in F.1 step 7; for now this is disabled."
                    disabled
                  >
                    Send (F.1 step 7)
                  </button>
                </div>
              </>
            )}
          </article>
        );
      })}
    </aside>
  );
}
