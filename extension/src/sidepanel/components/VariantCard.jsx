import { useState, useEffect, useRef } from 'react';

const TITLES = { quick: 'Quick', standard: 'Standard', detailed: 'Detailed' };

// Convert a blob to PNG via OffscreenCanvas, returning a Blob with
// image/png MIME. PNG is the most reliable clipboard format on Chrome.
async function blobToPng(blob) {
  if (!blob) return null;
  if (blob.type === 'image/png') return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no_canvas_2d_context');
  ctx.drawImage(bmp, 0, 0);
  return await canvas.convertToBlob({ type: 'image/png' });
}

export default function VariantCard({ kind, text, attachImages }) {
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(null);
  const [isFiring, setIsFiring] = useState(false);
  // imageCopyState[i] = 'idle' | 'pending' | 'pasted' | 'copied' | 'err'
  const [imageCopyState, setImageCopyState] = useState({});
  const [attachSummary, setAttachSummary] = useState(null);
  const [guardFailure, setGuardFailure] = useState(null);
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  const previewImages = Array.isArray(attachImages)
    ? attachImages.slice(0, 2).filter(Boolean)
    : [];
  const imgCount = previewImages.length;

  // Pre-fetch product images as PNG blobs as soon as the variant
  // renders. clipboard.write fails with "Document is not focused"
  // when called from an async path (after the focus has shifted), so
  // we keep the blobs ready in memory and call clipboard.write
  // SYNCHRONOUSLY inside the click handler — that's when the side
  // panel still holds focus + transient activation.
  const blobsRef = useRef([]);
  const [blobsReady, setBlobsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    blobsRef.current = [];
    setBlobsReady(false);
    if (previewImages.length === 0) return;
    (async () => {
      const next = [];
      for (const url of previewImages) {
        try {
          const res = await fetch(url, { credentials: 'omit' });
          if (!res.ok) throw new Error(`fetch ${res.status}`);
          const blob = await res.blob();
          const png = await blobToPng(blob);
          next.push(png);
        } catch (err) {
          console.warn('[FB Reply Maker SP] preload image failed:', err?.message || err);
          next.push(null);
        }
      }
      if (!cancelled) {
        blobsRef.current = next;
        setBlobsReady(next.some(Boolean));
      }
    })();
    return () => { cancelled = true; };
  }, [previewImages.join('|')]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  // SYNC clipboard.write of a pre-loaded blob. Returns a promise but
  // the focus check happens before this returns, so even if the rest
  // of the click handler completes and focus shifts, the write still
  // succeeds.
  function clipboardWriteSync(idx) {
    const blob = blobsRef.current[idx];
    if (!blob || typeof ClipboardItem === 'undefined') {
      return Promise.reject(new Error(blob ? 'no_ClipboardItem' : 'blob_not_loaded'));
    }
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  // Trigger a trusted Ctrl+V on the FB tab via the SW's chrome.debugger
  // path. Returns whether the dispatch was accepted.
  async function dispatchCtrlV() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'DISPATCH_CTRL_V' });
      return !!(resp && resp.ok);
    } catch (err) {
      console.warn('[FB Reply Maker SP] DISPATCH_CTRL_V threw:', err?.message || err);
      return false;
    }
  }

  // Per-thumbnail manual copy button. Synchronously calls clipboard.write
  // with the pre-loaded blob (focus check passes — user just clicked
  // a side-panel button), then asks SW to fire a trusted Ctrl+V which
  // pastes the image into FB. Falls back to "clipboard loaded — press
  // Ctrl+V manually" if chrome.debugger can't attach.
  function copyImageByIndex(idx) {
    if (!blobsRef.current[idx]) {
      console.warn('[FB Reply Maker SP] image blob not loaded yet, idx=', idx);
      setImageCopyState((p) => ({ ...p, [idx]: 'err' }));
      setTimeout(() => setImageCopyState((p) => ({ ...p, [idx]: 'idle' })), 1500);
      return;
    }
    setImageCopyState((p) => ({ ...p, [idx]: 'pending' }));
    // SYNC: call clipboard.write IMMEDIATELY in the click handler so the
    // focus check passes while the side panel still owns focus.
    const writePromise = clipboardWriteSync(idx);
    writePromise.then(async () => {
      // Ask SW to focus FB compose + fire trusted Ctrl+V.
      const focused = await chrome.runtime.sendMessage({ type: 'FOCUS_REPLY_BOX' }).catch(() => null);
      const pasted = await dispatchCtrlV();
      setImageCopyState((p) => ({ ...p, [idx]: pasted ? 'pasted' : 'copied' }));
      setTimeout(() => setImageCopyState((p) => ({ ...p, [idx]: 'idle' })), 3000);
    }).catch((err) => {
      console.warn('[FB Reply Maker SP] clipboard.write failed:', err?.message || err);
      setImageCopyState((p) => ({ ...p, [idx]: 'err' }));
      setTimeout(() => setImageCopyState((p) => ({ ...p, [idx]: 'idle' })), 2000);
    });
  }

  function handleInsert(extraOpts) {
    if (isFiring) return;
    const bypassGuards = !!(extraOpts && extraOpts.bypassGuards);
    setIsFiring(true);
    setTimeout(() => setIsFiring(false), 1000);
    setInserted('pending');
    setAttachSummary(null);
    if (!bypassGuards) setGuardFailure(null);

    // SYNC: write image 1 to clipboard FIRST, while the side panel
    // still holds focus from this click. Without this, by the time
    // the text insert has round-tripped through the SW + CS, focus
    // has shifted and clipboard.write rejects with "Document is not
    // focused". Calling it sync here, the focus check passes; the
    // resolution can happen async without issue.
    const imageWriteP = previewImages.length > 0 && blobsRef.current[0]
      ? clipboardWriteSync(0).catch((err) => {
          console.warn('[FB Reply Maker SP] image 1 clipboard.write failed:', err?.message || err);
          return Promise.reject(err);
        })
      : Promise.resolve(null);

    try {
      const payload = { type: 'INSERT_REPLY', text, skip_humanized: true };
      if (bypassGuards) payload.bypass_guards = true;
      chrome.runtime.sendMessage(payload, async (res) => {
        if (chrome.runtime.lastError) {
          console.error('[FB Reply Maker SP] INSERT_REPLY failed:', chrome.runtime.lastError.message);
          setInserted('err');
          setTimeout(() => setInserted(null), 1500);
          return;
        }
        if (!res?.ok) {
          setInserted('err');
          if (res?.guard && res?.reason) {
            setGuardFailure({ reason: res.reason, detail: res });
          }
          setTimeout(() => setInserted(null), 1500);
          return;
        }
        setInserted('ok');
        setGuardFailure(null);

        // Wait for the sync image-write to actually resolve before
        // triggering the paste — the focus check already passed when
        // clipboardWriteSync was called, but the bytes need to land
        // before Ctrl+V pulls them.
        let image1Pasted = false;
        let image2Pasted = false;
        try {
          await imageWriteP;
          // Focus FB compose, then trusted Ctrl+V.
          await chrome.runtime.sendMessage({ type: 'FOCUS_REPLY_BOX' }).catch(() => null);
          image1Pasted = await dispatchCtrlV();
        } catch (err) {
          // Image 1 write or paste failed; leave for user to retry via 📋.
          console.warn('[FB Reply Maker SP] image 1 attach failed:', err?.message || err);
        }

        // Image 2 can't be auto-chained reliably because side-panel
        // focus is now gone (FB tab grabbed it during paste). The
        // 📋 button is the manual path for image 2.
        if (previewImages.length > 0) {
          setAttachSummary({
            attached: image1Pasted ? 1 : 0,
            total: previewImages.length,
            results: [{ pasted: image1Pasted }]
          });
          setTimeout(() => setAttachSummary(null), 8000);
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
    if (attached === 1 && total === 1) return 'Image attached automatically ✓';
    if (attached >= 1 && total === 2) return 'Image 1 attached ✓ — click 📋 below image 2 to attach the other.';
    if (attached === 0) return 'Image 1 is on the clipboard. Click into the FB chat and press Ctrl+V, or click 📋 below to retry the auto-paste.';
    return `${attached}/${total} attached — see thumbnails below.`;
  })();

  return (
    <article className={cardClass}>
      <header className="variant-header">
        <span className="variant-title">{TITLES[kind] || kind}</span>
        <span className="variant-meta">
          {imgCount > 0 && (
            <span className="variant-attach-chip" title={`Insert auto-attaches image 1; use 📋 below image 2 to attach the rest. ${blobsReady ? 'Images preloaded ✓' : 'Loading images…'}`}>
              📎 {imgCount}{!blobsReady ? '…' : ''}
            </span>
          )}
          {wordCount}w
        </span>
      </header>
      <p className="variant-body">{text}</p>
      {previewImages.length > 0 && (
        <div className="variant-image-preview" aria-label="Recommended product photos">
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
                  title="Use 📋 to copy this image to the clipboard."
                />
                <button
                  type="button"
                  className={`pick-img-copy-btn pick-img-copy-${state}`}
                  onClick={() => copyImageByIndex(i)}
                  disabled={state === 'pending' || !blobsReady}
                  title="Click to copy + auto-paste this image into the FB chat"
                >
                  {btnLabel}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {guardFailure && (
        <div className="variant-guard-banner" role="alert">
          <p>
            <strong>Insert blocked:</strong>{' '}
            {guardFailure.reason === 'duplicate_send'
              ? 'this exact text was already sent in this thread (duplicate-protection guard). Regenerate for a slightly different reply, or click Insert anyway below to override.'
              : guardFailure.reason === 'thread_url_drift'
                ? 'you switched threads since this variant was generated.'
                : guardFailure.reason === 'placeholder_leak'
                  ? 'the reply still contains an unfilled placeholder. Edit it before inserting.'
                  : guardFailure.reason === 'empty'
                    ? 'the reply is empty.'
                    : `pre-send guard fired: ${guardFailure.reason}`}
          </p>
          {guardFailure.reason !== 'placeholder_leak' && guardFailure.reason !== 'empty' && (
            <button
              type="button"
              className="btn-mini"
              onClick={() => handleInsert({ bypassGuards: true })}
              disabled={isFiring}
            >
              Insert anyway
            </button>
          )}
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
