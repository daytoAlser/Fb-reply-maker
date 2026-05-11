import { useState } from 'react';

const TITLES = { quick: 'Quick', standard: 'Standard', detailed: 'Detailed' };

export default function VariantCard({ kind, text }) {
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(null);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  function handleInsert() {
    setInserted('pending');
    chrome.runtime.sendMessage({ type: 'INSERT_REPLY', text }, (res) => {
      if (chrome.runtime.lastError) {
        setInserted('err');
      } else if (res?.ok) {
        setInserted('ok');
      } else {
        setInserted('err');
      }
      setTimeout(() => setInserted(null), 1500);
    });
  }

  const insertLabel =
    inserted === 'pending' ? '…' :
    inserted === 'ok' ? 'Inserted' :
    inserted === 'err' ? 'Failed' :
    'Insert';

  const cardClass = `variant-card${inserted === 'ok' ? ' variant-card-flash' : ''}`;

  return (
    <article className={cardClass}>
      <header className="variant-header">
        <span className="variant-title">{TITLES[kind] || kind}</span>
        <span className="variant-meta">{wordCount}w</span>
      </header>
      <p className="variant-body">{text}</p>
      <div className="variant-actions">
        <button type="button" className="btn-mini" onClick={handleCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          className={`btn-mini btn-mini-accent ${inserted === 'err' ? 'btn-mini-err' : ''}`}
          onClick={handleInsert}
        >
          {insertLabel}
        </button>
      </div>
    </article>
  );
}
