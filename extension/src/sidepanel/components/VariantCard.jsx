import { useState } from 'react';
import { copyImageToClipboard } from '../lib/clipboard.js';

const TITLES = { quick: 'Quick', standard: 'Standard', detailed: 'Detailed' };

export default function VariantCard({ kind, text, attachImages }) {
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(null);
  const [isFiring, setIsFiring] = useState(false);
  // imageCopyState[i] = 'idle' | 'pending' | 'copied' | 'err'
  const [imageCopyState, setImageCopyState] = useState({});
  // Indicates which image was just auto-copied during INSERT; drives the
  // "Image 1 copied to clipboard — press Ctrl+V in the FB chat" hint.
  const [autoCopiedIndex, setAutoCopiedIndex] = useState(null);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  const previewImages = Array.isArray(attachImages)
    ? attachImages.slice(0, 2).filter(Boolean)
    : [];
  const imgCount = previewImages.length;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  async function copyImageByIndex(idx) {
    const url = previewImages[idx];
    if (!url) return { ok: false, reason: 'no_url' };
    setImageCopyState((prev) => ({ ...prev, [idx]: 'pending' }));
    const res = await copyImageToClipboard(url);
    if (res.ok) {
      setImageCopyState((prev) => ({ ...prev, [idx]: 'copied' }));
      setAutoCopiedIndex(idx);
      setTimeout(() => {
        setImageCopyState((prev) => ({ ...prev, [idx]: 'idle' }));
      }, 2500);
    } else {
      console.warn('[FB Reply Maker SP] image clipboard write failed:', res.reason);
      setImageCopyState((prev) => ({ ...prev, [idx]: 'err' }));
      setTimeout(() => {
        setImageCopyState((prev) => ({ ...prev, [idx]: 'idle' }));
      }, 2000);
    }
    return res;
  }

  async function handleInsert() {
    if (isFiring) return;
    setIsFiring(true);
    setTimeout(() => setIsFiring(false), 1000);
    setInserted('pending');
    setAutoCopiedIndex(null);
    try {
      // Step 1: ask the content script to paste the text reply into the
      // FB chat composer. skip_humanized: true → instant bulk insert.
      chrome.runtime.sendMessage({ type: 'INSERT_REPLY', text, skip_humanized: true }, async (res) => {
        if (chrome.runtime.lastError) {
          console.error('[FB Reply Maker SP] INSERT_REPLY failed:', chrome.runtime.lastError.message);
          setInserted('err');
          setTimeout(() => setInserted(null), 1500);
          return;
        }
        if (!res?.ok) {
          setInserted('err');
          setTimeout(() => setInserted(null), 1500);
          return;
        }
        setInserted('ok');

        // Step 2: copy the FIRST product image onto the clipboard so
        // the rep can paste it into FB with a real Ctrl+V. FB blocks
        // synthetic ClipboardEvent/drag-drop, but a genuine user keypress
        // pulls from the system clipboard fine. Second image is
        // available via the per-thumbnail 📋 button.
        if (previewImages.length > 0) {
          await copyImageByIndex(0);
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

  const pasteHint = (() => {
    if (autoCopiedIndex === null) return null;
    const which = autoCopiedIndex + 1;
    const total = previewImages.length;
    if (total === 1) {
      return 'Image copied. Click into the FB chat and press Ctrl+V to attach it.';
    }
    return `Image ${which}/${total} copied. Click into the FB chat → Ctrl+V. Then click the next 📋 below to attach the other.`;
  })();

  return (
    <article className={cardClass}>
      <header className="variant-header">
        <span className="variant-title">{TITLES[kind] || kind}</span>
        <span className="variant-meta">
          {imgCount > 0 && (
            <span className="variant-attach-chip" title={`Insert auto-copies image 1; use the 📋 button on each thumbnail to copy others to the clipboard. Paste into FB chat with Ctrl+V.`}>
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
          aria-label={`${previewImages.length} product photo${previewImages.length > 1 ? 's' : ''} — click 📋 to copy to clipboard`}
        >
          {previewImages.map((url, i) => {
            const state = imageCopyState[i] || 'idle';
            const btnLabel =
              state === 'pending' ? '…' :
              state === 'copied' ? '✓ Copied' :
              state === 'err' ? '⚠ Failed' :
              '📋 Copy';
            return (
              <div className="pick-img-wrap" key={url + i}>
                <img
                  src={url}
                  alt={`Recommended tire photo ${i + 1} of ${previewImages.length}`}
                  loading="lazy"
                  draggable
                  title="📋 button puts this image on the clipboard — then Ctrl+V into the FB chat."
                />
                <button
                  type="button"
                  className={`pick-img-copy-btn pick-img-copy-${state}`}
                  onClick={() => copyImageByIndex(i)}
                  disabled={state === 'pending'}
                  title={`Copy this image to clipboard, then Ctrl+V in the FB chat`}
                >
                  {btnLabel}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {pasteHint && (
        <p className="variant-paste-hint" role="status">{pasteHint}</p>
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
