// Phase F.1.5 — central FB DOM selectors.
//
// THIS IS THE ONE FILE TO EDIT when FB changes their Marketplace inbox or
// thread DOM. marketplace.js reads from globalThis.FBRM_SELECTORS at runtime
// and falls back to its own inline defaults if this file failed to load.
//
// Layout target: Facebook Marketplace inbox as of 2026-05.
//   - Inbox URL forms:
//       https://www.facebook.com/marketplace/inbox
//       https://www.facebook.com/marketplace/inbox/all
//       https://business.facebook.com/latest/inbox/all  (Pages Manager)
//       https://www.messenger.com/marketplace/...
//   - Thread URL form inside the inbox:
//       /marketplace/t/<thread_id>/...
//
// If FB ships a redesign, bump LAYOUT_VERSION and re-pin selectors with a
// new comment block. Keep the old block around until the new one stabilizes.

(function () {
  const LAYOUT_VERSION = '2026-05-fb-marketplace';

  const SELECTORS = {
    layoutVersion: LAYOUT_VERSION,

    // ── Active thread (existing — pulled out of marketplace.js so both
    //    paths share a single source of truth) ────────────────────────────
    thread: {
      container: '[role="main"]',
      header: 'h1, h2',
      replyTextbox: '[contenteditable="true"][role="textbox"]'
    },

    // ── Inbox list (new in F.1.5) ─────────────────────────────────────
    //
    // The inbox list pane is a vertical column on the left of the page.
    // Each row is an <a> linking to /marketplace/t/<thread_id>/.  FB does
    // not put stable class names on the row, so we anchor off the href
    // pattern and walk up to the nearest grid/listitem ancestor.
    inbox: {
      // Any <a> whose href starts with /marketplace/t/ is a thread row.
      // We dedupe by thread_id since FB sometimes nests two anchors per row.
      threadAnchor: 'a[href*="/marketplace/t/"]',

      // Ancestor roles to walk up to when locating the row container.
      // Stop walking when we hit any of these.
      rowAncestorRoles: ['row', 'listitem', 'link'],

      // Pattern that pulls the thread_id out of an anchor href.
      threadIdFromHref: /\/marketplace\/t\/([^/?#]+)/,

      // URL patterns the SW uses to identify "this tab is the inbox tab."
      // chrome.tabs.query accepts these as match patterns.
      inboxTabUrlPatterns: [
        'https://*.facebook.com/marketplace/inbox*',
        'https://*.facebook.com/marketplace/inbox/*',
        'https://*.facebook.com/marketplace/t/*',
        'https://business.facebook.com/latest/inbox*',
        'https://business.facebook.com/latest/inbox/*',
        'https://*.messenger.com/marketplace/*',
        'https://*.messenger.com/t/*'
      ],

      // Loose path test for the content script: "is this page showing
      // the inbox right now?"  Used to fail fast when the user has
      // navigated away.
      isInboxPathname: (pathname) =>
        /\/marketplace\/(inbox|t\/)/i.test(pathname || '') ||
        /\/latest\/inbox/i.test(pathname || '') ||
        /\/marketplace\//i.test(pathname || '') && /\/t\//i.test(pathname || '')
    }
  };

  // Publish to globalThis so marketplace.js (same isolated world, loaded
  // immediately after this file) can read it.  Read-only by convention.
  globalThis.FBRM_SELECTORS = SELECTORS;

  // Cheap visibility check — surfaces in DevTools so we can confirm load
  // order on each refresh.
  console.log('[FB Reply Maker] selectors.js loaded, layout', LAYOUT_VERSION);
})();
