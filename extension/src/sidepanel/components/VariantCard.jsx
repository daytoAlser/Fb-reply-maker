import { useState } from 'react';

const TITLES = { quick: 'Quick', standard: 'Standard', detailed: 'Detailed' };

export default function VariantCard({ kind, text, attachImages }) {
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
    if (isFiring) return;
    setIsFiring(true);
    setTimeout(() => setIsFiring(false), 1000);
    setInserted('pending');
    try {
      // skip_humanized: true → instant bulk paste. User reviews + clicks
      // FB's Send themselves, so no need to humanize-type here.
      // images: optional URLs the content script fetches + pastes as
      // attached photos into the FB chat composer alongside the text.
      const images = Array.isArray(attachImages) && attachImages.length > 0
        ? attachImages.slice(0, 2)
        : undefined;
      chrome.runtime.sendMessage({ type: 'INSERT_REPLY', text, images, skip_humanized: true }, (res) => {
        if (chrome.runtime.lastError) {
          console.error('[FB Reply Maker SP] INSERT_REPLY failed:', chrome.runtime.lastError.message);
          setInserted('err');
        } else {
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
  const imgCount = Array.isArray(attachImages)
    ? Math.min(attachImages.length, 2)
    : 0;

  const previewImages = Array.isArray(attachImages)
    ? attachImages.slice(0, 2).filter(Boolean)
    : [];

  return (
    <article className={cardClass}>
      <header className="variant-header">
        <span className="variant-title">{TITLES[kind] || kind}</span>
        <span className="variant-meta">
          {imgCount > 0 && (
            <span className="variant-attach-chip" title={`Insert will paste ${imgCount} product photo${imgCount > 1 ? 's' : ''} alongside this reply`}>
              📎 {imgCount}
            </span>
          )}
          {wordCount}w
        </span>
      </header>
      <p className="variant-body">{text}</p>
      {previewImages.length > 0 && (
        <div
          className="variant-image-preview"
          role="img"
          aria-label={`${previewImages.length} product photo${previewImages.length > 1 ? 's' : ''} that will attach on Insert`}
        >
          {previewImages.map((url, i) => (
            <img
              key={url + i}
              src={url}
              alt={`Recommended tire photo ${i + 1} of ${previewImages.length}`}
              loading="lazy"
              draggable
              title="This image attaches to the FB chat when you click Insert. You can also drag it directly into FB."
            />
          ))}
        </div>
      )}
      <div className="variant-actions">
        <button type="button" className="btn-mini" onClick={handleCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          className={`btn-mini ${inserted === 'err' ? 'btn-mini-err' : ''}`}
          onClick={handleInsert}
          disabled={isFiring}
        >
          {insertLabel}
        </button>
      </div>
    </article>
  );
}
