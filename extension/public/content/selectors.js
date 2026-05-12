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
  // Idempotency: if the SW's executeScript fallback re-runs us alongside the
  // registered injection, skip the second init so we don't blow away the
  // existing FBRM_SELECTORS reference (or re-log the load banner).
  if (globalThis.__FBRM_SELECTORS_LOADED__) return;
  globalThis.__FBRM_SELECTORS_LOADED__ = true;

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
    // Two FB surfaces use anchor-based inbox rows we can scrape:
    //   - facebook.com/marketplace/inbox       (Marketplace threads)
    //   - facebook.com/messages (or .../t/<id>) (Messenger threads)
    //
    // Pages Manager (business.facebook.com/latest/inbox) is a different DOM
    // entirely — keys threads off mailbox_id/selected_item_id query params
    // on non-anchor rows — and is intentionally NOT supported in F.1.5.
    inbox: {
      // Anchors that identify thread rows. FB nests both /marketplace/t/<id>
      // and /messages/t/<id> on the row, so we accept either. Dedupe is
      // keyed by (source, thread_id) in scrapeInboxList.
      threadAnchorSelectors: [
        'a[href*="/marketplace/t/"]',
        'a[href*="/messages/t/"]'
      ],
      // Back-compat — single selector form, still read by older builds.
      threadAnchor: 'a[href*="/marketplace/t/"], a[href*="/messages/t/"]',

      // Ancestor roles to walk up to when locating the row container.
      rowAncestorRoles: ['row', 'listitem', 'link'],

      // Per-source thread_id extractors. The first regex to match wins, and
      // its `source` label gets stamped onto the row so the consumer can
      // tell marketplace threads apart from messenger threads.
      threadIdExtractors: [
        { source: 'marketplace', re: /\/marketplace\/t\/([^/?#]+)/ },
        { source: 'messages',    re: /\/messages\/t\/([^/?#]+)/ }
      ],
      // Back-compat — first extractor only, for older builds.
      threadIdFromHref: /\/(?:marketplace|messages)\/t\/([^/?#]+)/,

      // URL patterns the SW uses to identify "this tab is the inbox tab."
      // chrome.tabs.query accepts these as match patterns.
      inboxTabUrlPatterns: [
        'https://*.facebook.com/marketplace/inbox*',
        'https://*.facebook.com/marketplace/inbox/*',
        'https://*.facebook.com/marketplace/t/*',
        'https://*.facebook.com/messages*',
        'https://*.facebook.com/messages/*',
        'https://*.facebook.com/messages/t/*',
        'https://*.messenger.com/marketplace/*',
        'https://*.messenger.com/t/*'
      ],

      // Loose path test for the content script: "is this page showing
      // the inbox right now?"  Used to fail fast when the user has
      // navigated away. Pages Manager paths are deliberately excluded.
      isInboxPathname: (pathname) =>
        /\/marketplace\/(inbox|t\/)/i.test(pathname || '') ||
        /\/messages(\/|$)/i.test(pathname || '')
    }
  };

  // Publish to globalThis so marketplace.js (same isolated world, loaded
  // immediately after this file) can read it.  Read-only by convention.
  globalThis.FBRM_SELECTORS = SELECTORS;

  // Cheap visibility check — surfaces in DevTools so we can confirm load
  // order on each refresh.
  console.log('[FB Reply Maker] selectors.js loaded, layout', LAYOUT_VERSION);
})();
