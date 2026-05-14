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
  // Was the auto-paste accepted by FB on the last write? If true, we tell
  // the rep the image attached automatically; if false, they need Ctrl+V.
  const [autoPasted, setAutoPasted] = useState(false);
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
      // Tell the FB content script to focus the chat composer and try
      // an auto-paste from clipboard. If execCommand('paste') cooperates,
      // the image attaches automatically; if not, the box is at least
      // focused for the rep to press Ctrl+V manually.
      try {
        chrome.runtime.sendMessage({ type: 'FOCUS_REPLY_BOX' }, (resp) => {
          if (chrome.runtime.lastError) {
            console.warn('[FB Reply Maker SP] FOCUS_REPLY_BOX failed:', chrome.runtime.lastError.message);
            setAutoPasted(false);
            return;
          }
          const pasted = !!(resp && resp.paste_accepted);
          setAutoPasted(pasted);
          console.log('[FB Reply Maker SP] focus+paste result:', resp);
        });
      } catch (err) {
        console.warn('[FB Reply Maker SP] FOCUS_REPLY_BOX threw:', err);
        setAutoPasted(false);
      }
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

        // Step 2: copy + auto-paste the FIRST product image. FB blocks
        // synthetic ClipboardEvent/drag-drop, but the content script's
        // FOCUS_REPLY_BOX handler attempts document.execCommand('paste')
        // which has been landing on FB Messenger's composer.
        if (previewImages.length > 0) {
          await copyImageByIndex(0);
        }

        // Step 3: if there's a second image, wait long enough for FB's
        // composer to commit the first paste, then auto-copy + auto-paste
        // image 2. The 700ms delay is empirical — too short and FB drops
        // the second paste (still processing the first); 700ms is reliable.
        // Extension contexts with clipboardWrite permission keep the
        // user-gesture token alive long enough for this chained write.
        if (previewImages.length > 1) {
          setTimeout(async () => {
            await copyImageByIndex(1);
          }, 700);
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
    if (autoPasted) {
      // execCommand('paste') worked — image is already attached.
      if (total === 1) return `Image attached automatically ✓`;
      return `Image ${which}/${total} attached automatically ✓ — click the next 📋 below for the other.`;
    }
    // Auto-paste didn't land; chat is focused, rep presses Ctrl+V.
    if (total === 1) {
      return 'Image copied + chat focused. Press Ctrl+V to attach.';
    }
    return `Image ${which}/${total} copied + chat focused. Press Ctrl+V. Then click the next 📋 below.`;
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
