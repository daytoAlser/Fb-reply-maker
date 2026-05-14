import { useState } from 'react';

const TITLES = { quick: 'Quick', standard: 'Standard', detailed: 'Detailed' };

export default function VariantCard({ kind, text, attachImages }) {
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(null);
  const [isFiring, setIsFiring] = useState(false);
  // imageCopyState[i] = 'idle' | 'pending' | 'pasted' | 'copied' | 'err'
  const [imageCopyState, setImageCopyState] = useState({});
  // Status banner state — set after INSERT runs the image attach chain.
  const [attachSummary, setAttachSummary] = useState(null);
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

  // Per-thumbnail 📋 button. Routes through the content script's
  // ATTACH_SINGLE_IMAGE handler so the clipboard write happens in the
  // FB tab context (which is reliably focused). The side-panel-side
  // clipboard write would fail with "Document is not focused" after
  // the first paste shifted focus to FB.
  function copyImageByIndex(idx) {
    const url = previewImages[idx];
    if (!url) return;
    setImageCopyState((prev) => ({ ...prev, [idx]: 'pending' }));
    chrome.runtime.sendMessage({ type: 'ATTACH_SINGLE_IMAGE', url }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        console.warn('[FB Reply Maker SP] ATTACH_SINGLE_IMAGE failed:', chrome.runtime.lastError?.message || res?.reason);
        setImageCopyState((prev) => ({ ...prev, [idx]: 'err' }));
      } else if (res.pasted) {
        setImageCopyState((prev) => ({ ...prev, [idx]: 'pasted' }));
      } else {
        // Clipboard was written but execCommand('paste') didn't land.
        // The image is on the clipboard, FB chat is focused — rep can
        // press Ctrl+V to finish.
        setImageCopyState((prev) => ({ ...prev, [idx]: 'copied' }));
      }
      setTimeout(() => {
        setImageCopyState((prev) => ({ ...prev, [idx]: 'idle' }));
      }, 3000);
    });
  }

  function handleInsert() {
    if (isFiring) return;
    setIsFiring(true);
    setTimeout(() => setIsFiring(false), 1000);
    setInserted('pending');
    setAttachSummary(null);
    try {
      // Send text + images together. The content script inserts the
      // text, then runs the clipboard-and-paste chain for each image
      // (fetch → PNG → clipboard.write → focus chat → execCommand
      // paste → 800ms gap → next image). All clipboard work happens
      // in the FB tab context where focus is reliable.
      const images = previewImages.length > 0 ? previewImages : undefined;
      chrome.runtime.sendMessage({ type: 'INSERT_REPLY', text, images, skip_humanized: true }, (res) => {
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

        // Summarize the attach chain so the rep knows which images
        // landed and which need a manual Ctrl+V.
        const attached = typeof res.imagesAttached === 'number' ? res.imagesAttached : 0;
        const total = previewImages.length;
        if (total > 0) {
          setAttachSummary({ attached, total, results: res.imageAttachResults || [] });
          setTimeout(() => setAttachSummary(null), 6000);
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
    if (!attachSummary) return null;
    const { attached, total } = attachSummary;
    if (total === 0) return null;
    if (attached === total) {
      return total === 1
        ? 'Image attached automatically ✓'
        : `Both images attached automatically ✓ — ready to send.`;
    }
    if (attached > 0) {
      return `${attached}/${total} attached automatically. The remaining ${total - attached} ${total - attached === 1 ? 'is' : 'are'} on the clipboard — click into FB chat and press Ctrl+V (or click 📋 below to retry).`;
    }
    return `Clipboard loaded but FB didn't auto-paste. Click into the FB chat and press Ctrl+V, or click 📋 below to retry.`;
  })();

  return (
    <article className={cardClass}>
      <header className="variant-header">
        <span className="variant-title">{TITLES[kind] || kind}</span>
        <span className="variant-meta">
          {imgCount > 0 && (
            <span className="variant-attach-chip" title={`Insert auto-attaches ${imgCount} product photo${imgCount > 1 ? 's' : ''} into the FB chat (fetches → clipboard → paste). 📋 buttons below re-copy any single image.`}>
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
          aria-label={`${previewImages.length} product photo${previewImages.length > 1 ? 's' : ''} — Insert auto-attaches them`}
        >
          {previewImages.map((url, i) => {
            const state = imageCopyState[i] || 'idle';
            const btnLabel =
              state === 'pending' ? '…' :
              state === 'pasted' ? '✓ Attached' :
              state === 'copied' ? '📋 On clipboard' :
              state === 'err' ? '⚠ Failed' :
              '📋 Copy';
            return (
              <div className="pick-img-wrap" key={url + i}>
                <img
                  src={url}
                  alt={`Recommended tire photo ${i + 1} of ${previewImages.length}`}
                  loading="lazy"
                  draggable
                  title="Insert auto-attaches both photos. Use 📋 to re-copy a single image to the clipboard."
                />
                <button
                  type="button"
                  className={`pick-img-copy-btn pick-img-copy-${state}`}
                  onClick={() => copyImageByIndex(i)}
                  disabled={state === 'pending'}
                  title="Copy + attempt auto-paste of this single image"
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
