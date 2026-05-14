// Image-to-clipboard helper.
//
// Facebook Messenger blocks both synthetic ClipboardEvent('paste') and
// drag/drop file operations in its chat composer — neither programmatic
// path can attach an image. What DOES work is a REAL keyboard Ctrl+V on
// the chat box when the system clipboard holds an image. So our path is:
//
//   1. Side panel button click (this file)  -> writes image to clipboard
//   2. Rep clicks into FB chat, presses Ctrl+V  -> FB accepts the paste
//
// navigator.clipboard.write() with a ClipboardItem({image/png: blob}) is
// the canonical Web Platform path for this. Requires a secure context,
// a user gesture, and the `clipboardWrite` manifest permission.

const FETCH_OPTS = { credentials: 'omit', mode: 'cors', cache: 'force-cache' };

// Fetches an image URL and returns a PNG Blob. Chrome's clipboard image
// path is most reliable with PNG — JPEG works on recent Chrome but I've
// seen edge cases on older versions, so we always normalize via canvas.
async function fetchAsPngBlob(url) {
  if (typeof url !== 'string' || !url) throw new Error('no_url');
  const res = await fetch(url, FETCH_OPTS);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const srcBlob = await res.blob();
  if (srcBlob.type === 'image/png') return srcBlob;
  const bmp = await createImageBitmap(srcBlob);
  // OffscreenCanvas avoids touching the DOM. createImageBitmap +
  // convertToBlob is supported in modern Chrome and works in extension
  // pages without any user-visible flash.
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no_canvas_2d_context');
  ctx.drawImage(bmp, 0, 0);
  return await canvas.convertToBlob({ type: 'image/png' });
}

// Writes the image at `url` to the system clipboard as image/png. Returns
// { ok: true } on success, { ok: false, reason } on failure.
//
// Document-focus handling: navigator.clipboard.write() rejects with
// "Document is not focused" when the side panel isn't the active frame
// (common after the FB tab steals focus during an auto-paste). We try
// to grab focus first and retry once on NotAllowedError — usually enough
// because the side panel becomes focusable again as soon as the rep's
// mouse re-enters it.
export async function copyImageToClipboard(url) {
  try {
    if (!navigator.clipboard || !navigator.clipboard.write) {
      return { ok: false, reason: 'clipboard_api_unavailable' };
    }
    if (typeof ClipboardItem === 'undefined') {
      return { ok: false, reason: 'clipboard_item_unavailable' };
    }
    const pngBlob = await fetchAsPngBlob(url);
    const item = new ClipboardItem({ 'image/png': pngBlob });

    // Best-effort focus grab. window.focus() is a no-op when the side
    // panel is already focused, and helps when it isn't.
    try { window.focus(); } catch {}
    try {
      await navigator.clipboard.write([item]);
      return { ok: true, byteSize: pngBlob.size };
    } catch (err) {
      // Retry once after a brief delay — the "Document is not focused"
      // case often clears within ~50ms as Chrome reasserts side panel
      // focus on the click that triggered us.
      const msg = err && err.message ? err.message : String(err);
      if (/not focused|NotAllowed/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 80));
        try { window.focus(); } catch {}
        try {
          await navigator.clipboard.write([item]);
          return { ok: true, byteSize: pngBlob.size, retried: true };
        } catch (err2) {
          return { ok: false, reason: `${msg} (retry: ${err2?.message || err2})` };
        }
      }
      return { ok: false, reason: msg };
    }
  } catch (err) {
    return { ok: false, reason: err && err.message ? err.message : String(err) };
  }
}
