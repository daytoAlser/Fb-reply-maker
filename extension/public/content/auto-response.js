// FB Reply Maker — Auto Response in-page surface.
//
// Injects an "Auto Response" button directly into the FB Messenger
// compose bar (only on Marketplace threads) + a left-side variant
// panel that overlays the inbox column. Parallel surface to the
// extension's side panel; the side panel stays untouched.
//
// Runs in the same isolated world as marketplace.js (registered
// sequentially by the SW). Reuses scrape + insert helpers via
// globalThis.FBRM_API. The SW handles the variant API call + the
// trusted-Ctrl+V image attach via chrome.debugger.

(function () {
  if (globalThis.__FBRM_AUTO_RESPONSE_LOADED__) return;
  globalThis.__FBRM_AUTO_RESPONSE_LOADED__ = true;

  const BUILD = 'ar-2026-05-14-v2';
  console.log('[FB Reply Maker] auto-response.js loaded build=' + BUILD);

  // Layout mode for the variant panel. 'center' renders a centered
  // modal with a backdrop dimming the FB page; 'left' renders a
  // left-edge column overlaying the inbox. The left-side code path
  // is preserved (not deleted) — flip this constant to switch.
  const LAYOUT_MODE = 'center';

  // ──────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────

  function swlog(message) {
    try {
      const api = globalThis.FBRM_API;
      if (api && typeof api.swlog === 'function') {
        api.swlog('[ar] ' + message);
        return;
      }
      chrome.runtime.sendMessage({ type: 'LOG_FROM_CS', message: '[ar] ' + message });
    } catch {}
  }

  function getSelectors() {
    return (globalThis.FBRM_SELECTORS && globalThis.FBRM_SELECTORS.autoResponse) || {};
  }

  function getThreadSelectors() {
    return (globalThis.FBRM_SELECTORS && globalThis.FBRM_SELECTORS.thread) || {};
  }

  function getThreadIdFromUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const m = url.match(/\/t\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ──────────────────────────────────────────────────────────────────
  // Marketplace detection
  //
  // Two-step gate: URL pattern (cheap, fires first) + DOM signal
  // (confirms it's actually a Marketplace thread vs a personal
  // Messenger thread that happens to share the /messages/t/<id> URL).
  // ──────────────────────────────────────────────────────────────────

  function urlIsThreadUrl() {
    const re = getSelectors().threadPathRegex || /\/(?:marketplace|messages)\/t\/[^/?#]+/i;
    return re.test(location.pathname);
  }

  function hasMarketplaceDomSignal() {
    const ar = getSelectors();
    const selectors = ar.marketplaceSignalSelectors || [
      '[role="main"] [aria-label*="Mark as sold"]',
      '[role="main"] a[href*="/marketplace/item/"]'
    ];
    for (const sel of selectors) {
      try { if (document.querySelector(sel)) return true; } catch {}
    }
    // Text-content fallback: scan the first ~80 elements inside
    // [role="main"] for an exact "Marketplace" leaf text node. This is
    // the sub-label shown under the partner name on every Marketplace
    // thread and is absent on personal Messenger threads.
    const main = document.querySelector('[role="main"]');
    if (!main) return false;
    let count = 0;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (count++ > 200) break;
      const t = (node.textContent || '').trim();
      if (t === 'Marketplace') return true;
    }
    return false;
  }

  function isMarketplaceThread() {
    if (!urlIsThreadUrl()) return false;
    return hasMarketplaceDomSignal();
  }

  // ──────────────────────────────────────────────────────────────────
  // Button injection
  // ──────────────────────────────────────────────────────────────────

  function findComposeAnchor() {
    const anchor = getSelectors().anchorTextboxSelector || '[contenteditable="true"][role="textbox"]';
    return document.querySelector(anchor);
  }

  function buildButton() {
    // Shadow DOM gives total CSS isolation — FB's compose-bar CSS
    // can't reach inside the shadow root to blank our background or
    // override our padding/border-radius. The host element is plain
    // and inherits nothing visible.
    const host = document.createElement('div');
    host.setAttribute(getSelectors().buttonMarker || 'data-fbrm-auto-response-button', '');
    host.style.cssText = 'display:inline-block;vertical-align:middle;all:initial;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { display: inline-block; vertical-align: middle; }
        * { box-sizing: border-box; }
        .btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 36px;
          padding: 0 18px;
          background: #1B7CFF;
          background-image: linear-gradient(180deg, #1B85FF 0%, #1166E6 100%);
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.01em;
          line-height: 1;
          border: 1px solid #2D8BFF;
          border-radius: 18px;
          cursor: pointer;
          user-select: none;
          white-space: nowrap;
          box-shadow:
            0 2px 8px rgba(8, 102, 255, 0.55),
            inset 0 0 0 1px rgba(255, 255, 255, 0.10);
          text-shadow: 0 1px 0 rgba(0, 0, 0, 0.18);
          transition: filter 120ms ease, transform 120ms ease, box-shadow 120ms ease;
        }
        .btn:hover {
          filter: brightness(1.10);
          box-shadow:
            0 4px 14px rgba(8, 102, 255, 0.70),
            inset 0 0 0 1px rgba(255, 255, 255, 0.16);
        }
        .btn:active { transform: scale(0.97); }
        .btn:focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }
        .sparkle {
          flex: 0 0 auto;
          color: #ffffff;
          filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.55));
        }
      </style>
      <div class="btn" role="button" tabindex="0" title="Open Auto Response (FB Reply Maker)">
        <svg class="sparkle" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path fill="currentColor" d="M12 2.5l1.6 4.7a2 2 0 001.2 1.2l4.7 1.6-4.7 1.6a2 2 0 00-1.2 1.2L12 17.5l-1.6-4.7a2 2 0 00-1.2-1.2l-4.7-1.6 4.7-1.6a2 2 0 001.2-1.2L12 2.5z"/>
          <path fill="currentColor" opacity="0.75" d="M19 14.5l.7 2.1a1 1 0 00.6.6l2.1.7-2.1.7a1 1 0 00-.6.6l-.7 2.1-.7-2.1a1 1 0 00-.6-.6l-2.1-.7 2.1-.7a1 1 0 00.6-.6l.7-2.1z"/>
        </svg>
        <span>Auto Response</span>
      </div>
    `;
    const inner = shadow.querySelector('.btn');
    const onActivate = (e) => {
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      openPanel();
    };
    inner.addEventListener('click', onActivate);
    inner.addEventListener('keydown', onActivate);
    return host;
  }

  // Throttled diagnostic so we don't flood the SW console with every
  // mutation tick. Logs once per ~3s when the mount state changes.
  let lastMountLog = '';
  function logMountState(state) {
    if (state === lastMountLog) return;
    lastMountLog = state;
    swlog('mount check: ' + state);
  }

  function mountButton() {
    if (!urlIsThreadUrl()) {
      logMountState('skip — not a thread URL (path=' + location.pathname + ')');
      unmountButton();
      return;
    }
    if (!hasMarketplaceDomSignal()) {
      logMountState('skip — thread URL but no Marketplace DOM signal');
      unmountButton();
      return;
    }
    const marker = getSelectors().buttonMarker || 'data-fbrm-auto-response-button';
    if (document.querySelector('[' + marker + ']')) {
      logMountState('already mounted');
      return;
    }
    const textbox = findComposeAnchor();
    if (!textbox) {
      logMountState('skip — composer textbox not found');
      return;
    }
    // Insert the button in a NEW row immediately ABOVE the compose row
    // (the row containing the textbox + mic/photo/emoji/send icons).
    // Inline placement crowds the textbox; an above-row keeps the
    // composer untouched and gives the button breathing room.
    //
    // Walk up from the textbox until we find a row that contains
    // multiple button-role siblings — that's the compose row. Insert
    // our launch row as the previous sibling.
    let row = textbox.parentElement;
    let depth = 0;
    while (row && depth < 8) {
      const buttonCount = row.querySelectorAll('[role="button"], button').length;
      if (buttonCount >= 2 && row.parentElement) break;
      row = row.parentElement;
      depth++;
    }
    if (!row || !row.parentElement) {
      logMountState('skip — no compose row found');
      return;
    }
    const launchRow = document.createElement('div');
    launchRow.setAttribute(marker, '');
    launchRow.className = 'fbrm-ar-launch-row';
    const btn = buildButton();
    launchRow.appendChild(btn);
    row.parentElement.insertBefore(launchRow, row);
    logMountState('mounted above compose row');
  }

  function unmountButton() {
    const marker = getSelectors().buttonMarker || 'data-fbrm-auto-response-button';
    const existing = document.querySelector('[' + marker + ']');
    if (existing) {
      existing.remove();
      swlog('button unmounted');
    }
  }

  // FB is an SPA. Re-evaluate button visibility on URL changes and any
  // major DOM mutation that might mean the compose bar just rendered.
  let mountThrottle = null;
  function scheduleMount() {
    if (mountThrottle) return;
    mountThrottle = setTimeout(() => {
      mountThrottle = null;
      try { mountButton(); } catch (err) { swlog('mount threw: ' + (err?.message || err)); }
    }, 200);
  }

  function watchForNavigation() {
    // popstate fires on browser back/forward. FB SPA also uses pushState
    // which doesn't dispatch popstate; we observe the document title as
    // a cheap proxy for navigation events.
    window.addEventListener('popstate', scheduleMount);
    let lastHref = location.href;
    const obs = new MutationObserver(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        scheduleMount();
        // Close panel on thread switch so we don't show stale variants.
        if (!isMarketplaceThread() && panelEl) closePanel();
      }
      scheduleMount();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ──────────────────────────────────────────────────────────────────
  // Panel lifecycle
  // ──────────────────────────────────────────────────────────────────

  let panelEl = null;
  let escHandler = null;

  function openPanel() {
    if (panelEl) return;
    injectStylesOnce();
    panelEl = buildPanelSkeleton();
    document.body.appendChild(panelEl);
    escHandler = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closePanel();
      }
    };
    // Use capture so we beat FB's own ESC handlers (image viewer, etc.)
    document.addEventListener('keydown', escHandler, true);
    swlog('panel opened');
    runGenerate();
  }

  function closePanel() {
    if (!panelEl) return;
    panelEl.remove();
    panelEl = null;
    if (escHandler) {
      document.removeEventListener('keydown', escHandler, true);
      escHandler = null;
    }
    swlog('panel closed');
  }

  function buildPanelSkeleton() {
    // 'center' wraps the panel in a backdrop that dims the FB page
    // and clicks through to close. 'left' (the original) docks to the
    // left edge and covers the inbox column. Both share the same
    // .fbrm-ar-panel inner element.
    const wrapper = document.createElement('div');
    wrapper.setAttribute(getSelectors().panelMarker || 'data-fbrm-auto-response-panel', '');
    wrapper.className = LAYOUT_MODE === 'center' ? 'fbrm-ar-modal-root' : 'fbrm-ar-left-root';
    if (LAYOUT_MODE === 'center') {
      const backdrop = document.createElement('div');
      backdrop.className = 'fbrm-ar-backdrop';
      backdrop.addEventListener('click', closePanel);
      wrapper.appendChild(backdrop);
    }
    const panel = document.createElement('div');
    panel.className = LAYOUT_MODE === 'center' ? 'fbrm-ar-panel fbrm-ar-panel-center' : 'fbrm-ar-panel fbrm-ar-panel-left';
    panel.innerHTML = `
      <header class="fbrm-ar-panel-header">
        <span class="fbrm-ar-panel-title">▌AUTO RESPONSE</span>
        <button type="button" class="fbrm-ar-panel-close" aria-label="Close">×</button>
      </header>
      <div class="fbrm-ar-panel-body">
        <div class="fbrm-ar-loading">
          <div class="fbrm-ar-loading-status">Scraping conversation…</div>
          <div class="fbrm-ar-loading-bar"></div>
          <div class="fbrm-ar-loading-bar"></div>
          <div class="fbrm-ar-loading-bar"></div>
        </div>
      </div>
    `;
    panel.querySelector('.fbrm-ar-panel-close').addEventListener('click', closePanel);
    wrapper.appendChild(panel);
    return wrapper;
  }

  function setLoadingStatus(text) {
    if (!panelEl) return;
    const el = panelEl.querySelector('.fbrm-ar-loading-status');
    if (el) el.textContent = text;
  }

  function renderError(msg) {
    if (!panelEl) return;
    const body = panelEl.querySelector('.fbrm-ar-panel-body');
    body.innerHTML = `<div class="fbrm-ar-error">${escapeHtml(msg)}</div>`;
  }

  function renderToast(msg, durationMs) {
    if (!panelEl) return;
    // Append to the inner panel (not the wrapper) so absolute
    // positioning lands at the panel's bottom-left, not the screen's.
    const innerPanel = panelEl.querySelector('.fbrm-ar-panel');
    if (!innerPanel) return;
    let toast = innerPanel.querySelector('.fbrm-ar-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'fbrm-ar-toast';
      innerPanel.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('fbrm-ar-toast-visible');
    clearTimeout(toast.__hide);
    toast.__hide = setTimeout(() => {
      toast.classList.remove('fbrm-ar-toast-visible');
    }, durationMs || 2500);
  }

  // ──────────────────────────────────────────────────────────────────
  // Generate flow (scrape thread + fetch settings + SW proxy call)
  // ──────────────────────────────────────────────────────────────────

  async function getLeadByThreadId(threadId) {
    if (!threadId) return null;
    try {
      const data = await chrome.storage.local.get('leads');
      const leads = (data && data.leads) || {};
      return leads[threadId] || null;
    } catch (err) {
      swlog('lead lookup failed: ' + (err?.message || err));
      return null;
    }
  }

  async function runGenerate() {
    const t0 = performance.now();
    try {
      const api = globalThis.FBRM_API;
      const detect = api && api.detectThread ? api.detectThread() : null;
      if (!detect || detect.status !== 'ok') {
        renderError('No conversation detected. Make sure you are inside a Marketplace thread.');
        return;
      }
      const threadId = getThreadIdFromUrl(detect.url);
      setLoadingStatus('Loading settings…');
      // Parallelize the two storage reads — they're independent and
      // chrome.storage RPCs each take ~30-80ms; running concurrently
      // saves the time of the slower one.
      const [settings, lead] = await Promise.all([
        chrome.storage.sync.get(['userName', 'config', 'context', 'location']),
        getLeadByThreadId(threadId)
      ]);
      const config = settings.config || {};
      if (!config.endpoint || !config.secret) {
        renderError('Configure API endpoint + secret in the extension Options page first.');
        return;
      }
      const tStorage = performance.now() - t0;

      const payload = {
        endpoint: config.endpoint,
        secret: config.secret,
        message: detect.latestIncoming || '',
        context: settings.context || {},
        categoryOverride: 'auto',
        conversationHistory: detect.conversationHistory,
        userName: settings.userName,
        partnerName: detect.partnerName,
        listingTitle: detect.listingTitle,
        location: settings.location,
        thread_id: threadId || undefined,
        fb_thread_url: detect.url || undefined,
        existing_captured_fields: lead?.capturedFields,
        existing_products_of_interest: lead?.productsOfInterest,
        existing_conversation_mode: lead?.conversationMode,
        existing_last_customer_message_at: lead?.lastCustomerMessageAt,
        existing_status: lead?.status,
        existing_last_updated: lead?.lastUpdated,
        existing_silence_duration_ms: lead?.silenceDurationMs,
        existing_manual_options_log: lead?.manualOptionsLog
      };

      setLoadingStatus('Asking Claude for variants…');
      swlog('generate request thread=' + (threadId || '?') + ' history=' + (detect.conversationHistory?.length || 0) + ' storage=' + Math.round(tStorage) + 'ms');
      const tApi = performance.now();
      const resp = await chrome.runtime.sendMessage({ type: 'GENERATE_REPLY', payload });
      const tApiDone = performance.now();
      if (!resp || !resp.ok) {
        renderError('Generate failed: ' + (resp?.reason || 'no response from service worker'));
        return;
      }
      swlog('generate response in ' + Math.round(tApiDone - tApi) + 'ms (total ' + Math.round(tApiDone - t0) + 'ms)');
      setLoadingStatus('Rendering…');
      renderResult(resp.data);
    } catch (err) {
      swlog('runGenerate threw: ' + (err?.message || err));
      renderError('Error: ' + (err?.message || err));
    }
  }

  function renderResult(result) {
    if (!panelEl) return;
    const body = panelEl.querySelector('.fbrm-ar-panel-body');
    body.innerHTML = `
      <p class="fbrm-ar-tip">Tip: click @name in FB's reply box to convert it to a real tag before sending.</p>
      <div class="fbrm-ar-variants"></div>
    `;
    const container = body.querySelector('.fbrm-ar-variants');
    const attachImages = (result.inventory_meta && Array.isArray(result.inventory_meta.attach_images))
      ? result.inventory_meta.attach_images.slice(0, 2)
      : [];
    const variants = result.variants || {};
    for (const kind of ['quick', 'standard', 'detailed']) {
      const text = variants[kind];
      if (typeof text !== 'string' || !text.trim()) continue;
      container.appendChild(renderVariantCard(kind, text, attachImages));
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Variant card rendering (vanilla DOM, closure-based state)
  // ──────────────────────────────────────────────────────────────────

  async function blobToPng(blob) {
    if (!blob) return null;
    if (blob.type === 'image/png') return blob;
    let drawable, width, height;
    try {
      const bmp = await createImageBitmap(blob);
      drawable = bmp; width = bmp.width; height = bmp.height;
    } catch {
      // Lenient fallback via HTMLImageElement.
      const url = URL.createObjectURL(blob);
      try {
        const img = await new Promise((resolve, reject) => {
          const el = new Image();
          el.onload = () => resolve(el);
          el.onerror = () => reject(new Error('img decode failed'));
          el.src = url;
        });
        drawable = img;
        width = img.naturalWidth || img.width;
        height = img.naturalHeight || img.height;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    if (!width || !height) throw new Error('zero-dimension image');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(drawable, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob null'))),
        'image/png'
      );
    });
  }

  async function preloadBlob(url) {
    const resp = await chrome.runtime.sendMessage({ type: 'FETCH_IMAGE_FOR_CLIPBOARD', url });
    if (!resp || !resp.ok) throw new Error('sw fetch failed: ' + (resp?.reason || 'no_response'));
    const binary = atob(resp.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const srcBlob = new Blob([bytes], { type: resp.mime || 'image/jpeg' });
    return await blobToPng(srcBlob);
  }

  function writeClipboardImage(blob) {
    if (!blob) return Promise.reject(new Error('no blob'));
    if (typeof ClipboardItem === 'undefined') return Promise.reject(new Error('no ClipboardItem'));
    return navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  function renderVariantCard(kind, text, attachImageUrls) {
    const card = document.createElement('article');
    card.className = 'fbrm-ar-variant-card';
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    const previewUrls = attachImageUrls.slice(0, 2);
    const imgCount = previewUrls.length;

    card.innerHTML = `
      <header class="fbrm-ar-variant-header">
        <span class="fbrm-ar-variant-title">${kind.toUpperCase()}</span>
        <span class="fbrm-ar-variant-meta">
          ${imgCount > 0 ? `<span class="fbrm-ar-attach-chip">📎 ${imgCount}</span>` : ''}
          <span class="fbrm-ar-word-count">${wordCount}w</span>
        </span>
      </header>
      <p class="fbrm-ar-variant-body"></p>
      <div class="fbrm-ar-image-preview"></div>
      <p class="fbrm-ar-paste-hint" style="display:none"></p>
      <div class="fbrm-ar-variant-actions">
        <button type="button" class="fbrm-ar-btn-mini fbrm-ar-btn-copy">Copy</button>
        <button type="button" class="fbrm-ar-btn-mini fbrm-ar-btn-insert">Insert</button>
      </div>
    `;
    card.querySelector('.fbrm-ar-variant-body').textContent = text;

    // Closure state for this card
    const blobs = [];
    const imgRowEls = [];
    let inserted = null;

    // Build image preview rows (and start preload). The <img>.src
    // intentionally stays empty until preload completes — FB's page
    // CSP blocks cross-origin images from canadacustomautoworks.com,
    // so we wait for the SW-fetched blob and use a blob: URL instead.
    const preview = card.querySelector('.fbrm-ar-image-preview');
    previewUrls.forEach((url, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'fbrm-ar-pick-wrap';
      wrap.innerHTML = `
        <div class="fbrm-ar-pick-skeleton"></div>
        <img loading="lazy" alt="Tire photo ${i + 1}" style="display:none" />
        <button type="button" class="fbrm-ar-pick-copy-btn" data-idx="${i}">📋 Copy</button>
      `;
      preview.appendChild(wrap);
      imgRowEls.push(wrap);
      blobs.push(null);
      preloadBlob(url).then((png) => {
        blobs[i] = png;
        const imgEl = wrap.querySelector('img');
        const skeleton = wrap.querySelector('.fbrm-ar-pick-skeleton');
        try {
          const objUrl = URL.createObjectURL(png);
          if (imgEl) {
            imgEl.src = objUrl;
            imgEl.style.display = '';
            imgEl.addEventListener('load', () => {
              // Release the blob URL after the browser has decoded it.
              setTimeout(() => { try { URL.revokeObjectURL(objUrl); } catch {} }, 1000);
            }, { once: true });
          }
          if (skeleton) skeleton.remove();
        } catch {}
        swlog('preload[' + i + '] OK bytes=' + (png?.size || 0));
      }).catch((err) => {
        const skeleton = wrap.querySelector('.fbrm-ar-pick-skeleton');
        if (skeleton) skeleton.classList.add('fbrm-ar-pick-skeleton-err');
        swlog('preload[' + i + '] FAILED: ' + (err?.message || err));
      });
    });

    // Per-image 📋 button
    preview.querySelectorAll('.fbrm-ar-pick-copy-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const idx = Number(btn.getAttribute('data-idx'));
        await attachImageByIndex(card, idx, blobs, imgRowEls, btn);
      });
    });

    // COPY (text)
    card.querySelector('.fbrm-ar-btn-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        const b = card.querySelector('.fbrm-ar-btn-copy');
        b.textContent = 'Copied';
        setTimeout(() => { b.textContent = 'Copy'; }, 1200);
      } catch {
        renderToast('Copy failed — try again');
      }
    });

    // INSERT
    card.querySelector('.fbrm-ar-btn-insert').addEventListener('click', () => {
      handleInsert(card, text, previewUrls, blobs, imgRowEls);
    });

    return card;
  }

  // ──────────────────────────────────────────────────────────────────
  // INSERT — text via FBRM_API.tryInsertReply, images via clipboard +
  // SW chrome.debugger Ctrl+V. Mirrors the side panel VariantCard flow.
  // ──────────────────────────────────────────────────────────────────

  function setInsertState(card, state) {
    const btn = card.querySelector('.fbrm-ar-btn-insert');
    if (!btn) return;
    if (state === 'pending') { btn.textContent = '…'; btn.disabled = true; }
    else if (state === 'ok')  { btn.textContent = 'Inserted'; btn.disabled = true; }
    else if (state === 'err') { btn.textContent = 'Failed'; btn.disabled = false; }
    else                       { btn.textContent = 'Insert'; btn.disabled = false; }
  }

  function setImageRowState(rowEl, state) {
    if (!rowEl) return;
    const btn = rowEl.querySelector('.fbrm-ar-pick-copy-btn');
    if (!btn) return;
    btn.classList.remove('fbrm-ar-pick-state-pasted', 'fbrm-ar-pick-state-copied', 'fbrm-ar-pick-state-err', 'fbrm-ar-pick-state-pending');
    if (state === 'pending') { btn.textContent = '…'; btn.disabled = true; btn.classList.add('fbrm-ar-pick-state-pending'); }
    else if (state === 'pasted')  { btn.textContent = '✓ Attached'; btn.disabled = true; btn.classList.add('fbrm-ar-pick-state-pasted'); }
    else if (state === 'copied')  { btn.textContent = '📋 On clipboard'; btn.disabled = false; btn.classList.add('fbrm-ar-pick-state-copied'); }
    else if (state === 'err')     { btn.textContent = '⚠ Failed'; btn.disabled = false; btn.classList.add('fbrm-ar-pick-state-err'); }
    else                          { btn.textContent = '📋 Copy'; btn.disabled = false; }
  }

  function setHint(card, msg) {
    const hint = card.querySelector('.fbrm-ar-paste-hint');
    if (!hint) return;
    if (!msg) { hint.style.display = 'none'; hint.textContent = ''; return; }
    hint.textContent = msg;
    hint.style.display = 'block';
  }

  // Bypasses to ESC-trapping by FB: we send INSERT_REPLY through the SW
  // route so the existing message path is used. The CS handler in
  // marketplace.js is what executes — but we could also call
  // FBRM_API.tryInsertReply directly here since we're in the same
  // isolated world. Going through the message keeps a single code path.
  async function callInsertReply(text, opts) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'INSERT_REPLY', text, skip_humanized: true, ...(opts || {}) },
          (res) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, reason: chrome.runtime.lastError.message });
              return;
            }
            resolve(res || { ok: false, reason: 'no_response' });
          }
        );
      } catch (err) {
        resolve({ ok: false, reason: err?.message || String(err) });
      }
    });
  }

  async function callDispatchCtrlV() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'DISPATCH_CTRL_V' });
      return !!(resp && resp.ok);
    } catch (err) {
      swlog('DISPATCH_CTRL_V threw: ' + (err?.message || err));
      return false;
    }
  }

  async function callFocusReplyBox() {
    try {
      await chrome.runtime.sendMessage({ type: 'FOCUS_REPLY_BOX' });
    } catch {}
  }

  // Auto-close timer state — single-image variants close ~1.5s after
  // image 1 attach; two-image variants stay open until image 2 attaches.
  function scheduleAutoClose(ms) {
    setTimeout(() => { if (panelEl) closePanel(); }, ms);
  }

  async function attachImageByIndex(card, idx, blobs, imgRowEls, _btn) {
    const row = imgRowEls[idx];
    setImageRowState(row, 'pending');
    let blob = blobs[idx];
    if (!blob) {
      // Try to reload on the fly in case the background preload failed.
      try {
        const url = card.querySelectorAll('.fbrm-ar-pick-wrap img')[idx]?.src;
        if (url) {
          blob = await preloadBlob(url);
          blobs[idx] = blob;
        }
      } catch (err) {
        swlog('lazy preload failed idx=' + idx + ': ' + (err?.message || err));
      }
    }
    if (!blob) {
      setImageRowState(row, 'err');
      return false;
    }
    try {
      await writeClipboardImage(blob);
    } catch (err) {
      swlog('clipboard.write idx=' + idx + ' failed: ' + (err?.message || err));
      // Retry with a focus nudge.
      try { window.focus(); } catch {}
      await sleep(80);
      try {
        await writeClipboardImage(blob);
      } catch (err2) {
        swlog('clipboard.write retry idx=' + idx + ' failed: ' + (err2?.message || err2));
        setImageRowState(row, 'err');
        return false;
      }
    }
    await callFocusReplyBox();
    const pasted = await callDispatchCtrlV();
    setImageRowState(row, pasted ? 'pasted' : 'copied');
    if (!pasted) {
      renderToast('Image on clipboard — press Ctrl+V in the chat');
    }
    return pasted;
  }

  async function handleInsert(card, text, previewUrls, blobs, imgRowEls) {
    setInsertState(card, 'pending');
    setHint(card, '');

    // 1. Text insert via the shared INSERT_REPLY pipeline.
    const res = await callInsertReply(text);
    if (!res || !res.ok) {
      // Common cause: duplicate_send guard. Offer the rep a single
      // retry that bypasses the guard.
      if (res?.guard && res?.reason) {
        setHint(card, 'Blocked by guard: ' + res.reason + '. Retrying with bypass…');
        const retry = await callInsertReply(text, { bypass_guards: true });
        if (!retry || !retry.ok) {
          setInsertState(card, 'err');
          // Fallback: text to clipboard so the rep can manually paste.
          try { await navigator.clipboard.writeText(text); renderToast('Text copied — Ctrl+V in the chat'); } catch {}
          return;
        }
      } else {
        setInsertState(card, 'err');
        try { await navigator.clipboard.writeText(text); renderToast('Text copied — Ctrl+V in the chat'); } catch {}
        return;
      }
    }
    setInsertState(card, 'ok');

    if (previewUrls.length === 0) {
      scheduleAutoClose(1200);
      return;
    }

    // 2. Image 1: clipboard.write + trusted Ctrl+V via SW.
    let image1Pasted = false;
    try {
      // Wait briefly for preload to complete if still in flight.
      let waited = 0;
      while (!blobs[0] && waited < 2500) { await sleep(120); waited += 120; }
      if (!blobs[0]) {
        try { blobs[0] = await preloadBlob(previewUrls[0]); } catch {}
      }
      if (blobs[0]) {
        setImageRowState(imgRowEls[0], 'pending');
        await writeClipboardImage(blobs[0]);
        await callFocusReplyBox();
        image1Pasted = await callDispatchCtrlV();
        setImageRowState(imgRowEls[0], image1Pasted ? 'pasted' : 'copied');
      } else {
        setImageRowState(imgRowEls[0], 'err');
      }
    } catch (err) {
      swlog('image 1 attach failed: ' + (err?.message || err));
      setImageRowState(imgRowEls[0], 'err');
    }

    // 3. If there's a second image, leave the panel open and prompt for
    // the 📋 click. Single-image variants auto-close.
    if (previewUrls.length === 1) {
      scheduleAutoClose(1500);
      return;
    }

    setHint(card, image1Pasted
      ? 'Image 1 attached ✓ — click 📋 below image 2 to attach the other.'
      : 'Image 1 on clipboard — press Ctrl+V. Then click 📋 below image 2.');

    // Watch for image 2 attach to trigger auto-close. We listen for a
    // mutation on the second pick row's class list.
    const row2 = imgRowEls[1];
    if (row2) {
      const obs = new MutationObserver(() => {
        const btn2 = row2.querySelector('.fbrm-ar-pick-copy-btn');
        if (btn2 && btn2.classList.contains('fbrm-ar-pick-state-pasted')) {
          obs.disconnect();
          setHint(card, 'Both images attached ✓');
          scheduleAutoClose(2000);
        }
      });
      obs.observe(row2.querySelector('.fbrm-ar-pick-copy-btn'), { attributes: true, attributeFilter: ['class'] });
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Styles (terminal aesthetic, fbrm-ar- prefix, injected once)
  // ──────────────────────────────────────────────────────────────────

  function injectStylesOnce() {
    if (document.getElementById('fbrm-ar-styles')) return;
    const z = getSelectors().panelZIndex || 9999;
    const style = document.createElement('style');
    style.id = 'fbrm-ar-styles';
    style.textContent = `
      /* Launch row above the compose row */
      .fbrm-ar-launch-row {
        display: flex !important;
        justify-content: flex-start !important;
        align-items: center !important;
        padding: 8px 12px 6px !important;
        gap: 6px !important;
        background: transparent !important;
      }
      /* Compose-bar button — FB-native blue, sparkle icon, rounded
       * pill. Heavy !important usage because FB's compose styles
       * cascade aggressively into descendants and can otherwise
       * blank out the background/color. */
      .fbrm-ar-launch-btn {
        display: inline-flex !important;
        align-items: center !important;
        gap: 8px !important;
        height: 36px !important;
        padding: 0 18px !important;
        background: #1B7CFF !important;
        background-image: linear-gradient(180deg, #1B85FF 0%, #1166E6 100%) !important;
        color: #ffffff !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif !important;
        font-size: 14px !important;
        font-weight: 700 !important;
        letter-spacing: 0.01em !important;
        border: 1px solid #2D8BFF !important;
        border-radius: 18px !important;
        cursor: pointer !important;
        user-select: none !important;
        transition: filter 120ms ease, transform 120ms ease, box-shadow 120ms ease !important;
        white-space: nowrap !important;
        box-shadow: 0 2px 6px rgba(8, 102, 255, 0.50), 0 0 0 1px rgba(255,255,255,0.06) inset !important;
        text-shadow: 0 1px 0 rgba(0, 0, 0, 0.18) !important;
      }
      .fbrm-ar-launch-btn:hover {
        filter: brightness(1.10) !important;
        box-shadow: 0 4px 12px rgba(8, 102, 255, 0.65), 0 0 0 1px rgba(255,255,255,0.10) inset !important;
      }
      .fbrm-ar-launch-btn:active { transform: scale(0.97) !important; }
      .fbrm-ar-sparkle { flex: 0 0 auto !important; color: #ffffff !important; filter: drop-shadow(0 0 4px rgba(255,255,255,0.40)) !important; }
      .fbrm-ar-launch-label { line-height: 1 !important; color: #ffffff !important; }

      /* Backdrop for the centered modal mode. Dims the FB page,
       * click-through closes the panel. Left-mode skips this. */
      .fbrm-ar-modal-root .fbrm-ar-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.55);
        backdrop-filter: blur(2px);
        z-index: ${z - 1};
        animation: fbrm-ar-fadein 160ms ease-out;
      }
      @keyframes fbrm-ar-fadein {
        from { opacity: 0; }
        to   { opacity: 1; }
      }

      /* Panel base — shared by both layouts */
      .fbrm-ar-panel {
        background: #0a0a0a;
        color: #f0f0f0;
        font-family: 'JetBrains Mono', 'Courier New', monospace;
        z-index: ${z};
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(239, 68, 68, 0.10);
      }

      /* Layout: left-side column overlaying the inbox */
      .fbrm-ar-panel-left {
        position: fixed;
        top: 0;
        left: 0;
        height: 100vh;
        width: 360px;
        border-right: 1px solid #2a2a2a;
        animation: fbrm-ar-slidein 180ms ease-out;
      }
      @keyframes fbrm-ar-slidein {
        from { transform: translateX(-16px); opacity: 0; }
        to   { transform: translateX(0);     opacity: 1; }
      }

      /* Layout: centered modal */
      .fbrm-ar-panel-center {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 460px;
        max-width: calc(100vw - 32px);
        max-height: calc(100vh - 64px);
        border: 1px solid #2a2a2a;
        border-radius: 12px;
        overflow: hidden;
        animation: fbrm-ar-popin 200ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes fbrm-ar-popin {
        from { transform: translate(-50%, -50%) scale(0.95); opacity: 0; }
        to   { transform: translate(-50%, -50%) scale(1);    opacity: 1; }
      }

      /* Panel header */
      .fbrm-ar-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        border-bottom: 1px solid #2a2a2a;
        background: #050505;
      }
      .fbrm-ar-panel-title {
        font-family: 'Oswald', 'Impact', sans-serif;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #ef4444;
      }
      .fbrm-ar-panel-close {
        background: transparent;
        border: 1px solid #2a2a2a;
        color: #f0f0f0;
        width: 26px;
        height: 26px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
      }
      .fbrm-ar-panel-close:hover { background: #1a1a1a; border-color: #ef4444; color: #ef4444; }

      .fbrm-ar-panel-body {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .fbrm-ar-loading {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px 0;
      }
      .fbrm-ar-loading-status {
        font-size: 11px;
        color: #f87171;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding-bottom: 4px;
      }
      .fbrm-ar-loading-bar {
        height: 90px;
        background: linear-gradient(90deg, #1a1a1a 0%, #232323 50%, #1a1a1a 100%);
        background-size: 200% 100%;
        border-radius: 4px;
        animation: fbrm-ar-shimmer 1200ms linear infinite;
      }
      @keyframes fbrm-ar-shimmer {
        from { background-position: 200% 0; }
        to   { background-position: -200% 0; }
      }

      .fbrm-ar-error {
        padding: 12px;
        background: rgba(180, 60, 60, 0.10);
        border: 1px solid #b14848;
        border-left: 3px solid #ef4444;
        color: #ffb4b4;
        font-size: 12px;
        line-height: 1.45;
        border-radius: 4px;
      }

      .fbrm-ar-tip {
        margin: 0 0 4px;
        font-size: 10.5px;
        color: #8a8a8a;
        letter-spacing: 0.02em;
      }

      .fbrm-ar-variants {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      /* Variant card */
      .fbrm-ar-variant-card {
        background: #111111;
        border: 1px solid #2a2a2a;
        border-left: 3px solid #ef4444;
        padding: 12px 14px;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
      }
      .fbrm-ar-variant-card:hover {
        border-color: #3a3a3a;
        border-left-color: #f87171;
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.12);
      }
      .fbrm-ar-variant-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }
      .fbrm-ar-variant-title {
        font-family: 'Oswald', 'Impact', sans-serif;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #ef4444;
      }
      .fbrm-ar-variant-meta {
        font-size: 10px;
        color: #8a8a8a;
        display: inline-flex;
        gap: 6px;
        align-items: center;
      }
      .fbrm-ar-attach-chip {
        padding: 1px 5px;
        border: 1px solid #2a2a2a;
        border-radius: 3px;
        color: #f87171;
        background: rgba(255,255,255,0.03);
      }
      .fbrm-ar-variant-body {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.45;
        white-space: pre-wrap;
        color: #e8e8e8;
      }

      .fbrm-ar-image-preview {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 6px;
      }
      .fbrm-ar-image-preview:empty { display: none; }
      .fbrm-ar-pick-wrap {
        position: relative;
        aspect-ratio: 1 / 1;
        background: #ffffff;
        border: 1px solid #2a2a2a;
        border-radius: 8px;
        overflow: hidden;
      }
      .fbrm-ar-pick-wrap img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: #ffffff;
      }
      .fbrm-ar-pick-skeleton {
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg, #1a1a1a 0%, #232323 50%, #1a1a1a 100%);
        background-size: 200% 100%;
        animation: fbrm-ar-shimmer 1200ms linear infinite;
      }
      .fbrm-ar-pick-skeleton-err {
        background: repeating-linear-gradient(45deg, #2a1414 0 8px, #1a0a0a 8px 16px);
        animation: none;
      }
      .fbrm-ar-pick-copy-btn {
        position: absolute;
        bottom: 6px;
        right: 6px;
        background: rgba(0,0,0,0.78);
        color: #ffffff;
        border: 1px solid rgba(255,255,255,0.18);
        padding: 4px 8px;
        font-family: 'JetBrains Mono', 'Courier New', monospace;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.04em;
        border-radius: 6px;
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
      }
      .fbrm-ar-pick-copy-btn:hover { background: rgba(0,0,0,0.92); border-color: #f87171; }
      .fbrm-ar-pick-copy-btn.fbrm-ar-pick-state-pasted { background: #16a34a; color: #000; border-color: #16a34a; }
      .fbrm-ar-pick-copy-btn.fbrm-ar-pick-state-copied { background: #f87171; color: #000; border-color: #f87171; }
      .fbrm-ar-pick-copy-btn.fbrm-ar-pick-state-err    { background: #b14848; color: #fff; border-color: #b14848; }

      .fbrm-ar-paste-hint {
        margin: 0;
        padding: 6px 8px;
        font-size: 10.5px;
        line-height: 1.4;
        color: #f87171;
        background: rgba(255,255,255,0.03);
        border: 1px solid #2a2a2a;
        border-left: 2px solid #f87171;
        border-radius: 3px;
      }

      .fbrm-ar-variant-actions {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
      }
      .fbrm-ar-btn-mini {
        font-family: 'JetBrains Mono', 'Courier New', monospace;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 7px 14px;
        background: #1a1a1a;
        color: #f0f0f0;
        border: 1px solid #2a2a2a;
        border-radius: 6px;
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease;
      }
      .fbrm-ar-btn-mini:hover { border-color: #ef4444; color: #ef4444; }
      .fbrm-ar-btn-mini:active { transform: scale(0.97); }
      .fbrm-ar-btn-mini:disabled { opacity: 0.5; cursor: default; transform: none; }
      .fbrm-ar-btn-insert { background: #ef4444; color: #000; border-color: #ef4444; box-shadow: 0 1px 3px rgba(239, 68, 68, 0.30); }
      .fbrm-ar-btn-insert:hover { background: #f87171; border-color: #f87171; color: #000; box-shadow: 0 2px 8px rgba(239, 68, 68, 0.45); }

      /* Toast */
      .fbrm-ar-toast {
        position: absolute;
        bottom: 14px;
        left: 14px;
        right: 14px;
        padding: 8px 12px;
        background: #1a1a1a;
        border: 1px solid #ef4444;
        color: #f87171;
        font-size: 11px;
        border-radius: 4px;
        opacity: 0;
        transition: opacity 180ms ease;
        pointer-events: none;
      }
      .fbrm-ar-toast.fbrm-ar-toast-visible { opacity: 1; }
    `;
    document.head.appendChild(style);
  }

  // ──────────────────────────────────────────────────────────────────
  // Bootstrap
  // ──────────────────────────────────────────────────────────────────

  // Wait briefly for marketplace.js to publish FBRM_API. Both scripts
  // load in the same isolated world; selectors.js → marketplace.js →
  // auto-response.js is the documented order, but if anything in
  // marketplace.js throws early, FBRM_API may not exist yet. The button
  // can still mount because we don't need FBRM_API to MOUNT; we only
  // need it when the rep clicks it. runGenerate() guards on its absence.

  scheduleMount();
  watchForNavigation();
})();
