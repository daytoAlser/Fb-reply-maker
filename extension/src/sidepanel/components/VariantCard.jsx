import { useState } from 'react';

const TITLES = { quick: 'Quick', standard: 'Standard', detailed: 'Detailed' };

export default function VariantCard({ kind, text }) {
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(null);
  const [isFiring, setIsFiring] = useState(false);
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
    if (isFiring) {
      console.log('[FB Reply Maker SP] Insert click ignored — cooldown active');
      return;
    }
    setIsFiring(true);
    setTimeout(() => setIsFiring(false), 1000);
    console.log('[FB Reply Maker SP] Insert clicked, sending INSERT_REPLY', text.slice(0, 40));
    setInserted('pending');
    try {
      chrome.runtime.sendMessage({ type: 'INSERT_REPLY', text }, (res) => {
        if (chrome.runtime.lastError) {
          console.error('[FB Reply Maker SP] INSERT_REPLY failed:', chrome.runtime.lastError.message);
          setInserted('err');
        } else {
          console.log('[FB Reply Maker SP] INSERT_REPLY response:', res);
          if (res?.ok) setInserted('ok');
          else setInserted('err');
        }
        setTimeout(() => setInserted(null), 1500);
      });
    } catch (err) {
      console.error('[FB Reply Maker SP] sendMessage threw:', err);
      setInserted('err');
      setTimeout(() => setInserted(null), 1500);
    }
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
          disabled={isFiring}
        >
          {insertLabel}
        </button>
      </div>
    </article>
  );
}
