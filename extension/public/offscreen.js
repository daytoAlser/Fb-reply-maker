// Offscreen document for clipboard writes. Created by the service worker
// with reason: 'CLIPBOARD' which Chrome documents as the supported path
// for extensions to write to the system clipboard from non-focused
// contexts. navigator.clipboard.write in here bypasses the
// "Document is not focused" check that breaks side-panel and FB-tab
// content-script clipboard.write attempts after a side-panel click.

function swlog(message) {
  try { chrome.runtime.sendMessage({ type: 'LOG_FROM_CS', message: '[offscreen] ' + message }); } catch {}
}

swlog('offscreen document loaded');

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'OFFSCREEN_WRITE_IMAGE') return false;
  (async () => {
    try {
      const { base64, mime } = msg;
      if (typeof base64 !== 'string' || !base64) {
        sendResponse({ ok: false, reason: 'no_base64' });
        return;
      }
      // Decode base64 back to Blob.
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      let blob = new Blob([bytes], { type: mime || 'image/jpeg' });
      // Normalize to PNG for the broadest clipboard compatibility.
      if (blob.type !== 'image/png') {
        const bmp = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no_canvas_2d_context');
        ctx.drawImage(bmp, 0, 0);
        blob = await canvas.convertToBlob({ type: 'image/png' });
      }
      if (typeof ClipboardItem === 'undefined') {
        sendResponse({ ok: false, reason: 'clipboard_item_unavailable' });
        return;
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      swlog('clipboard.write OK bytes=' + blob.size);
      sendResponse({ ok: true, byteSize: blob.size });
    } catch (err) {
      swlog('clipboard.write FAILED: ' + (err?.message || err));
      sendResponse({ ok: false, reason: err?.message || String(err) });
    }
  })();
  return true; // async response
});
