# FB Reply Maker — Implementation Spec

Chrome Extension (MV3) + Netlify Function that generates 3 reply variants for incoming Facebook Marketplace messages. Personal use V1, scale to multi-location later.

Owner: Dayton Altwasser (CCAW)
Stack: Vite + CRXJS + React (extension), Netlify Function (API proxy), Claude Haiku 4.5

---

## 1. Architecture

```
┌────────────────────────────────────┐
│  Facebook Marketplace / Messenger  │
│  (browser tab)                     │
└─────────────┬──────────────────────┘
              │ DOM scrape / inject
              ▼
┌────────────────────────────────────┐
│  Chrome Extension                  │
│  ┌──────────────────────────────┐  │
│  │ Content Script               │  │
│  │ (detect thread, read/insert) │  │
│  └──────────┬───────────────────┘  │
│             │ chrome.runtime msg   │
│  ┌──────────▼───────────────────┐  │
│  │ Side Panel (React UI)        │  │
│  │ - Incoming message preview   │  │
│  │ - Category picker            │  │
│  │ - 3 reply variant cards      │  │
│  │ - Copy / Insert buttons      │  │
│  └──────────┬───────────────────┘  │
│             │ HTTPS POST           │
│             │ + x-api-secret       │
└─────────────┼──────────────────────┘
              ▼
┌────────────────────────────────────┐
│  Netlify Function                  │
│  /generate-reply                   │
│  - Validates shared secret         │
│  - Calls Claude Haiku 4.5          │
│  - Returns JSON {category, intent, │
│    variants:{quick,standard,       │
│    detailed}}                      │
└─────────────┬──────────────────────┘
              ▼
       Anthropic API
       (claude-haiku-4-5-20251001)
```

**Why this split:** API key stays server-side. Extension only needs a shared secret. Future multi-user rollout becomes trivial (add user auth at the Netlify function layer).

---

## 2. Project Structure

```
fb-reply-maker/
├── extension/
│   ├── manifest.json
│   ├── vite.config.js
│   ├── package.json
│   ├── src/
│   │   ├── background/
│   │   │   └── service-worker.js
│   │   ├── content/
│   │   │   ├── marketplace.js          # FB Marketplace DOM logic
│   │   │   └── messenger.js            # messenger.com DOM logic
│   │   ├── sidepanel/
│   │   │   ├── index.html
│   │   │   ├── main.jsx
│   │   │   ├── App.jsx
│   │   │   ├── components/
│   │   │   │   ├── IncomingPanel.jsx
│   │   │   │   ├── CategoryPicker.jsx
│   │   │   │   ├── VariantCard.jsx
│   │   │   │   └── ErrorBanner.jsx
│   │   │   ├── lib/
│   │   │   │   ├── api.js              # fetch wrapper for Netlify fn
│   │   │   │   ├── storage.js          # chrome.storage helpers
│   │   │   │   └── messaging.js        # runtime msg helpers
│   │   │   └── styles.css
│   │   └── options/
│   │       ├── index.html
│   │       └── options.jsx             # settings page
│   ├── icons/
│   │   ├── icon16.png
│   │   ├── icon48.png
│   │   └── icon128.png
│   └── README.md
│
└── netlify/
    ├── netlify.toml
    ├── package.json
    ├── functions/
    │   └── generate-reply.js
    └── .env.example
```

---

## 3. Chrome Extension

### 3.1 manifest.json

```json
{
  "manifest_version": 3,
  "name": "FB Reply Maker",
  "version": "1.0.0",
  "description": "AI reply assistant for FB Marketplace messages",
  "permissions": ["storage", "sidePanel", "activeTab", "scripting"],
  "host_permissions": [
    "https://www.facebook.com/*",
    "https://m.facebook.com/*",
    "https://www.messenger.com/*"
  ],
  "background": {
    "service_worker": "src/background/service-worker.js",
    "type": "module"
  },
  "action": {
    "default_title": "Open Reply Maker"
  },
  "side_panel": {
    "default_path": "src/sidepanel/index.html"
  },
  "options_ui": {
    "page": "src/options/index.html",
    "open_in_tab": true
  },
  "content_scripts": [
    {
      "matches": ["https://www.facebook.com/marketplace/*", "https://www.messenger.com/*"],
      "js": ["src/content/marketplace.js"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### 3.2 Service Worker (background)

Responsibilities:
1. Open side panel when extension action clicked
2. Relay messages between content scripts and side panel
3. Cache last detected message per tab

```js
// src/background/service-worker.js
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

const tabState = new Map(); // tabId -> { incoming, threadId }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'THREAD_UPDATE' && sender.tab) {
    tabState.set(sender.tab.id, msg.payload);
    chrome.runtime.sendMessage({ type: 'THREAD_BROADCAST', payload: msg.payload }).catch(() => {});
  }
  if (msg.type === 'GET_CURRENT_THREAD') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse(tabState.get(tabs[0]?.id) || null);
    });
    return true; // async
  }
  if (msg.type === 'INSERT_REPLY') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'INSERT_REPLY', text: msg.text });
    });
  }
});
```

### 3.3 Content Script

Responsibilities:
1. Detect when user opens a Marketplace message thread
2. Find the most recent incoming message text
3. Post updates to service worker
4. Insert text into FB's reply textarea on command

```js
// src/content/marketplace.js

// FB uses React with dynamic class names. Use stable role/aria attrs where possible.
// These selectors will need maintenance. Keep them in one place.
const SELECTORS = {
  threadRoot: '[role="main"]',
  messageRow: '[role="row"]',
  incomingMessage: '[data-scope="messages_table"] [dir="auto"]', // tune at build time
  replyTextbox: '[contenteditable="true"][role="textbox"]'
};

let lastSent = '';

function getLatestIncoming() {
  // Walk the thread, find the latest message that is NOT from the current user.
  // FB renders sender messages right-aligned; incoming left-aligned. Use aria-label
  // on the row container that often contains "Message from <name>".
  const rows = [...document.querySelectorAll('[aria-label^="Message from"]')];
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const text = last.innerText?.trim();
  return text || null;
}

function broadcast() {
  const incoming = getLatestIncoming();
  if (!incoming || incoming === lastSent) return;
  lastSent = incoming;
  chrome.runtime.sendMessage({
    type: 'THREAD_UPDATE',
    payload: { incoming, capturedAt: Date.now(), url: location.href }
  });
}

const observer = new MutationObserver(() => {
  // Debounce — FB mutates a lot.
  clearTimeout(window.__rmDebounce);
  window.__rmDebounce = setTimeout(broadcast, 300);
});
observer.observe(document.body, { childList: true, subtree: true });
broadcast();

// Insert reply
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'INSERT_REPLY') return;
  const box = document.querySelector(SELECTORS.replyTextbox);
  if (!box) return;
  box.focus();
  // FB listens to input events on contenteditable. Use execCommand fallback.
  document.execCommand('insertText', false, msg.text);
});
```

**Note for Claude Code:** Selectors will drift as FB updates. Build with paste fallback as primary path so the extension is never bricked by a FB UI change. Auto-capture is the bonus.

### 3.4 Side Panel UI (React)

Layout (top to bottom):
1. Header: title + settings cog
2. Incoming message card: text + "Refresh from page" + "Paste manually" toggle
3. Category picker: 9 chips, Auto highlighted by default
4. Generate button (primary)
5. Result section:
   - Detected category badge + intent summary line
   - 3 variant cards in a vertical stack (Quick, Standard, Detailed)
   - Each card: label, word count, body text, [Copy] [Insert] buttons
6. Regenerate button at bottom

State:
```js
{
  incoming: string,
  manualPaste: boolean,
  categoryOverride: 'auto' | <category>,
  loading: boolean,
  error: string | null,
  result: { category, intent_summary, variants: { quick, standard, detailed } } | null,
  copiedKey: string | null,
  settingsLoaded: boolean,
  context: BusinessContext
}
```

Listen for `THREAD_BROADCAST` from service worker. Update `incoming` automatically unless user has manualPaste enabled.

Design:
- Dark theme (industrial/garage aesthetic)
- Display font: Oswald (condensed, uppercase for labels)
- Body: DM Sans
- Mono accents: JetBrains Mono (for tags, word counts)
- Accent: amber (#f59e0b)
- Sharp corners, no rounded soft cards
- Compact density (this lives in a narrow side panel)

### 3.5 Options Page

Editable settings:

| Field | Type | Default |
|---|---|---|
| API endpoint | URL | `https://<your-site>.netlify.app/.netlify/functions/generate-reply` |
| API secret | password | blank, user pastes |
| Business name | text | `CCAW (Canada Custom Autoworks)` |
| Locations | textarea | full 13-location list |
| Phone | text | blank |
| Hours | text | `Mon-Fri 9AM-6PM, Sat 10AM-4PM, Sun closed` |
| Custom notes | textarea | `We specialize in wheels, tires, lifts, and accessories. We install everything we sell.` |
| Default category | dropdown | Auto |

Persist to `chrome.storage.sync` so settings follow the user across Chrome installs signed into the same Google account.

### 3.6 Storage Schema (chrome.storage.sync)

```json
{
  "config": {
    "endpoint": "https://...netlify.app/.netlify/functions/generate-reply",
    "secret": "<shared secret>"
  },
  "context": {
    "name": "CCAW (Canada Custom Autoworks)",
    "locations": "...",
    "phone": "",
    "hours": "...",
    "customNotes": "..."
  },
  "preferences": {
    "defaultCategory": "auto"
  }
}
```

---

## 4. Netlify Function

### 4.1 Function Code

```js
// netlify/functions/generate-reply.js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT_TEMPLATE = ({ name, hours, locations, phone, customNotes, categoryOverride }) => `
You are a Facebook Marketplace reply assistant for ${name}, an automotive aftermarket retailer specializing in wheels, tires, lifts, and accessories.

BUSINESS CONTEXT
- Hours: ${hours}
- Locations: ${locations}
- Phone: ${phone || 'not provided'}
- Notes: ${customNotes}

TONE GUIDELINES
- Friendly, direct, professional. No corporate stiffness.
- Always drive toward action: visit a location, call, book an appointment.
- Do not haggle over price in writing. Hold price and invite them in or to call.
- Do not promise fitment without seeing the vehicle. Ask for year, make, model, trim if missing.
- Match casual FB Marketplace tone. No "Dear customer" or stiff openers.
- No emojis unless the customer used one first.
- Keep it tight. No filler.
${categoryOverride && categoryOverride !== 'auto' ? `\nThe user has tagged this message as: ${categoryOverride.replace('_', ' ')}.` : ''}

OUTPUT
Generate THREE reply variants:
- quick: ONE short line, max 15 words, for fast triage
- standard: 2 to 3 sentences with a clear CTA
- detailed: 4 or more sentences for complex questions (fitment, multi-part requests)

Respond ONLY with valid JSON. No markdown fencing. No preamble.
{
  "category": "availability|fitment|price_haggle|location_hours|delivery_shipping|stock_check|install_service|trade_in|other",
  "intent_summary": "<one short sentence>",
  "variants": {
    "quick": "<text>",
    "standard": "<text>",
    "detailed": "<text>"
  }
}
`.trim();

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  // Auth
  const secret = event.headers['x-api-secret'] || event.headers['X-Api-Secret'];
  if (!secret || secret !== process.env.SHARED_SECRET) {
    return { statusCode: 401, headers, body: 'Unauthorized' };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: 'Invalid JSON' }; }

  const { message, context, categoryOverride } = body;
  if (!message || !context) {
    return { statusCode: 400, headers, body: 'Missing message or context' };
  }

  const systemPrompt = SYSTEM_PROMPT_TEMPLATE({ ...context, categoryOverride });

  try {
    const completion = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: `INCOMING MESSAGE:\n${message}` }]
    });

    const text = completion.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .replace(/```json\n?|```/g, '')
      .trim();

    const parsed = JSON.parse(text);
    return { statusCode: 200, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
```

### 4.2 Environment Variables

```
ANTHROPIC_API_KEY=sk-ant-...
SHARED_SECRET=<long random string, generated once, pasted into extension options>
```

### 4.3 netlify.toml

```toml
[build]
  functions = "netlify/functions"
  publish = "public"

[functions]
  node_bundler = "esbuild"
```

---

## 5. Setup Instructions (README)

### Extension (local dev)
```bash
cd extension
npm install
npm run build
# Then in Chrome: chrome://extensions → Developer mode → Load unpacked → select extension/dist
```

### Netlify function
```bash
cd netlify
npm install
# Deploy via Netlify CLI or Git push
# Set env vars: ANTHROPIC_API_KEY, SHARED_SECRET
```

### First-time config
1. Generate a random SHARED_SECRET (e.g. `openssl rand -hex 32`)
2. Set it in Netlify env vars
3. Open extension Options page
4. Paste endpoint URL and SHARED_SECRET
5. Customize business context if needed

---

## 6. V1 Acceptance Criteria

| # | Criterion |
|---|---|
| 1 | Extension loads in Chrome with no manifest errors |
| 2 | Side panel opens when extension icon is clicked |
| 3 | Visiting a FB Marketplace message thread populates the incoming message in the side panel within 1 second |
| 4 | If auto-capture fails, paste fallback still works |
| 5 | Clicking Generate produces 3 distinct reply variants in under 5 seconds |
| 6 | Each variant has a working Copy button (clipboard confirmed) |
| 7 | Each variant has a working Insert button that places the text into FB's reply box |
| 8 | Category auto-detection matches user judgment on at least 8 out of 10 sample messages |
| 9 | Options page persists settings across browser restarts |
| 10 | API secret is never logged, never visible in extension UI after entry |

### Sample test messages (use for acceptance)

| # | Message | Expected category |
|---|---|---|
| 1 | "is this still available?" | availability |
| 2 | "will these fit a 2018 f150 sport?" | fitment |
| 3 | "what's your best price bro" | price_haggle |
| 4 | "can u ship to vernon" | delivery_shipping |
| 5 | "what time u open tmrw" | location_hours |
| 6 | "got any more of these in 20s" | stock_check |
| 7 | "do you guys install" | install_service |
| 8 | "what'll you give me for my stock 18s" | trade_in |
| 9 | "still got these. fits my truck? 2020 ram 1500 5.7 hemi crew" | fitment |
| 10 | "lowest u take cash today pickup" | price_haggle |

---

## 7. V2 Hooks (architect for, do not build)

| Feature | Architectural note |
|---|---|
| Location switcher | `context` object becomes `contexts: { [locationId]: BusinessContext }` + active selector in side panel |
| Per-location FB accounts | Detect FB account from page, auto-select matching location context |
| Conversation history awareness | Content script captures last N messages, function uses them as additional context |
| Template editor UI | Add `templates: [{trigger, body, vars}]` to storage. Function prefers template fill over pure generation when match score > threshold |
| Send button (auto-send) | Adds a confirm step, then content script clicks FB's send button. High risk, keep behind a toggle. |
| Cross-platform (Kijiji, Marketplace mobile) | Abstract `MarketplaceAdapter` interface. Each platform implements `getLatestIncoming()` and `insertReply()`. |
| Analytics | Optional ping to a Supabase row on each generation: category, latency, accepted variant. Drives template refinement. |

---

## 8. Out of Scope for V1

- Auto-sending replies (always require manual paste or click)
- Reading entire thread history (just latest incoming message)
- Multiple FB accounts in a single Chrome profile (use Firefox containers as before, or run multiple profiles)
- Mobile (FB app on phone — not addressable via extension)
- Chrome Web Store submission (load unpacked is fine for personal use)

---

## 9. Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| FB DOM selectors drift | Paste fallback always available. Selectors isolated in one file for fast patches. |
| Claude returns invalid JSON | Function strips code fences before parse. On parse fail, return 500 with the raw text so the extension can show fallback UI. |
| Rate limits on Anthropic API | Haiku is cheap, but add a simple in-memory throttle in the function: max 1 req/sec per secret. |
| Secret leak in extension | Stored in chrome.storage.sync (encrypted at rest by Chrome). Never logged. Rotate easily by changing env var + options entry. |
| FB ToS | Read-only DOM scrape + clipboard insert is low risk. Auto-send would be higher risk and is V2-gated. |

---

End of spec.
