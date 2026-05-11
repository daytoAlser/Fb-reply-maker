import { useEffect, useRef, useState } from 'react';
import IncomingPanel from './components/IncomingPanel.jsx';
import CategoryPicker from './components/CategoryPicker.jsx';
import VariantCard from './components/VariantCard.jsx';
import ErrorBanner from './components/ErrorBanner.jsx';
import AutoDetectCard from './components/AutoDetectCard.jsx';
import { generateReply } from './lib/api.js';
import { loadAll } from './lib/storage.js';

const CATEGORIES = [
  'auto',
  'availability',
  'fitment',
  'price_haggle',
  'location_hours',
  'delivery_shipping',
  'stock_check',
  'install_service',
  'trade_in',
  'other'
];

export default function App() {
  const [incoming, setIncoming] = useState('');
  const [categoryOverride, setCategoryOverride] = useState('auto');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [settings, setSettings] = useState(null);
  const [autoDetect, setAutoDetect] = useState(null);
  const [isManual, setIsManual] = useState(false);

  const isManualRef = useRef(false);
  const lastAutoFilledRef = useRef('');

  function markManual(val) {
    isManualRef.current = val;
    setIsManual(val);
  }

  function applyAutoDetect(payload) {
    setAutoDetect(payload);
    if (
      payload?.status === 'ok' &&
      payload.latestIncoming &&
      !isManualRef.current &&
      payload.latestIncoming !== lastAutoFilledRef.current
    ) {
      lastAutoFilledRef.current = payload.latestIncoming;
      setIncoming(payload.latestIncoming);
    }
  }

  function requestCurrentThread() {
    chrome.runtime.sendMessage({ type: 'GET_CURRENT_THREAD' }, (res) => {
      if (chrome.runtime.lastError) return;
      applyAutoDetect(res);
    });
  }

  useEffect(() => {
    loadAll().then((data) => {
      setSettings(data);
      setCategoryOverride(data.preferences?.defaultCategory || 'auto');
    });
  }, []);

  useEffect(() => {
    requestCurrentThread();

    function onMessage(msg) {
      if (msg?.type !== 'THREAD_BROADCAST') return;
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeId = tabs?.[0]?.id;
        if (activeId && activeId === msg.tabId) {
          applyAutoDetect(msg.payload);
        }
      });
    }
    chrome.runtime.onMessage.addListener(onMessage);

    function onActivated() {
      requestCurrentThread();
    }
    chrome.tabs.onActivated.addListener(onActivated);

    function onUpdated(_tabId, changeInfo) {
      if (changeInfo.status === 'complete' || changeInfo.url) {
        requestCurrentThread();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);

    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  function handleIncomingChange(value) {
    setIncoming(value);
    if (value !== lastAutoFilledRef.current) {
      markManual(true);
    }
  }

  function handleUseThis() {
    const latest = autoDetect?.latestIncoming;
    if (!latest) return;
    lastAutoFilledRef.current = latest;
    setIncoming(latest);
    markManual(false);
  }

  function handleRefresh() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'REQUEST_RESCAN' }, () => {
        setTimeout(() => {
          requestCurrentThread();
          resolve();
        }, 200);
      });
    });
  }

  async function handleGenerate() {
    setError(null);
    if (!incoming.trim()) {
      setError('Paste an incoming message first.');
      return;
    }
    if (!settings?.config?.endpoint || !settings?.config?.secret) {
      setError('Configure endpoint and secret in the options page.');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const conversationHistory =
        autoDetect?.status === 'ok' &&
        Array.isArray(autoDetect.conversationHistory) &&
        autoDetect.conversationHistory.length > 0
          ? autoDetect.conversationHistory
          : null;

      const partnerName = (autoDetect?.partnerName || '').trim();
      const listingTitle = (autoDetect?.listingTitle || '').trim();
      const userName = (settings.userName || '').trim();

      if (!partnerName) {
        console.warn('[FB Reply Maker SP] WARNING: partnerName missing, opener will degrade');
      }
      if (!userName) {
        console.warn('[FB Reply Maker SP] WARNING: userName missing — set it in Options to personalize opener');
      }

      console.log('[FB Reply Maker SP] request payload:', {
        hasMessage: !!incoming,
        messageLength: incoming?.length,
        userName: settings?.userName,
        partnerName: autoDetect?.partnerName,
        listingTitle: autoDetect?.listingTitle,
        historyLength: conversationHistory?.length,
        category: categoryOverride
      });

      const res = await generateReply({
        endpoint: settings.config.endpoint,
        secret: settings.config.secret,
        message: incoming,
        context: settings.context,
        categoryOverride,
        conversationHistory,
        userName: userName || undefined,
        partnerName: partnerName || undefined,
        listingTitle: listingTitle || undefined
      });

      console.log('[FB Reply Maker SP] response meta:', {
        ad_type: res?.ad_type,
        lead_status_suggestion: res?.lead_status_suggestion,
        extracted_fields: res?.extracted_fields
      });

      setResult(res);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>FB Reply Maker</h1>
        <button
          className="icon-btn"
          onClick={() => chrome.runtime.openOptionsPage()}
          title="Settings"
        >
          <span aria-hidden="true">⚙</span>
        </button>
      </header>

      <AutoDetectCard
        autoDetect={autoDetect}
        isManual={isManual}
        onUseThis={handleUseThis}
        onRefresh={handleRefresh}
      />

      <IncomingPanel value={incoming} onChange={handleIncomingChange} />

      <CategoryPicker
        categories={CATEGORIES}
        value={categoryOverride}
        onChange={setCategoryOverride}
      />

      <button
        className="btn-primary"
        onClick={handleGenerate}
        disabled={loading}
      >
        {loading ? 'Generating…' : 'Generate Replies'}
      </button>

      {error && <ErrorBanner message={error} />}

      {result && (
        <section className="results">
          <div className="result-header">
            <span className="badge">{result.category}</span>
            <p className="intent">{result.intent_summary}</p>
          </div>
          <p className="insert-tip">
            Tip: click on the @name in FB's reply box to convert it to a real tag before sending.
          </p>
          <VariantCard kind="quick" text={result.variants.quick} />
          <VariantCard kind="standard" text={result.variants.standard} />
          <VariantCard kind="detailed" text={result.variants.detailed} />
          <button
            className="btn-secondary"
            onClick={handleGenerate}
            disabled={loading}
          >
            Regenerate
          </button>
        </section>
      )}
    </div>
  );
}
