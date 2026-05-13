import { useState } from 'react';

const TITLES = { quick: 'Quick', standard: 'Standard', detailed: 'Detailed' };

// F.1.7 adjustment 3: Send button. Maps content-script response codes to
// short button labels + tones. ok = green flash, blockers = red, soft
// failures = amber.
function describeSendResponse(res) {
  if (!res) return { label: 'Failed', tone: 'err' };
  if (chrome.runtime.lastError) {
    return { label: 'Failed', tone: 'err' };
  }
  if (res.ok && res.sent) {
    const note = res.humanization_succeeded === false ? ' (bulk)' : '';
    return { label: 'Sent' + note, tone: 'ok' };
  }
  switch (res.reason) {
    case 'placeholder_leak':
      return { label: 'Placeholder leak', tone: 'err' };
    case 'duplicate_send':
      return { label: 'Duplicate', tone: 'err' };
    case 'empty':
      return { label: 'Empty', tone: 'err' };
    case 'thread_url_drift':
      return { label: 'Tab moved', tone: 'warn' };
    case 'send_button_not_found':
      return { label: 'No Send btn — copied', tone: 'warn' };
    case 'send_not_confirmed':
      return { label: 'Check FB', tone: 'warn' };
    case 'tab_hidden_mid_type':
    case 'tab_hidden_before_send':
      return { label: 'Tab hidden', tone: 'warn' };
    default:
      return { label: res.reason || 'Failed', tone: 'err' };
  }
}

async function readActiveThreadId() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    const m = tab.url.match(/\/(?:marketplace|messages)\/t\/([^/?#]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export default function VariantCard({ kind, text }) {
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(null);
  const [isFiring, setIsFiring] = useState(false);
  const [sendState, setSendState] = useState(null); // null | 'pending' | { label, tone }
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  function handleInsert() {
    if (isFiring) {
      console.log('[FB Reply Maker SP] Insert click ignored — cooldown active');
      return;
    }
    setIsFiring(true);
    setTimeout(() => setIsFiring(false), 1000);
    console.log('[FB Reply Maker SP] Insert clicked, sending INSERT_REPLY', text.slice(0, 40));
    setInserted('pending');
    try {
      chrome.runtime.sendMessage({ type: 'INSERT_REPLY', text }, (res) => {
        if (chrome.runtime.lastError) {
          console.error('[FB Reply Maker SP] INSERT_REPLY failed:', chrome.runtime.lastError.message);
          setInserted('err');
        } else {
          console.log('[FB Reply Maker SP] INSERT_REPLY response:', res);
          if (res?.ok) setInserted('ok');
          else setInserted('err');
        }
        setTimeout(() => setInserted(null), 1500);
      });
    } catch (err) {
      console.error('[FB Reply Maker SP] sendMessage threw:', err);
      setInserted('err');
      setTimeout(() => setInserted(null), 1500);
    }
  }

  async function handleSend() {
    if (sendState === 'pending') return;
    setSendState('pending');
    const threadId = await readActiveThreadId();
    if (!threadId) {
      setSendState({ label: 'No thread', tone: 'err' });
      setTimeout(() => setSendState(null), 2200);
      return;
    }
    try {
      chrome.runtime.sendMessage({
        type: 'INSERT_REPLY',
        text,
        auto_send: true,
        thread_id: threadId
      }, (res) => {
        const desc = describeSendResponse(res);
        console.log('[FB Reply Maker SP] SEND response:', res, '→', desc);
        setSendState(desc);
        setTimeout(() => setSendState(null), 2500);
      });
    } catch (err) {
      console.error('[FB Reply Maker SP] SEND sendMessage threw:', err);
      setSendState({ label: 'Failed', tone: 'err' });
      setTimeout(() => setSendState(null), 2500);
    }
  }

  const insertLabel =
    inserted === 'pending' ? '…' :
    inserted === 'ok' ? 'Inserted' :
    inserted === 'err' ? 'Failed' :
    'Insert';

  const sendLabel =
    sendState === 'pending' ? '…' :
    sendState && typeof sendState === 'object' ? sendState.label :
    'Send';
  const sendTone = sendState && typeof sendState === 'object' ? sendState.tone : null;

  const cardClass = `variant-card${inserted === 'ok' || sendTone === 'ok' ? ' variant-card-flash' : ''}`;

  return (
    <article className={cardClass}>
      <header className="variant-header">
        <span className="variant-title">{TITLES[kind] || kind}</span>
        <span className="variant-meta">{wordCount}w</span>
      </header>
      <p className="variant-body">{text}</p>
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
        <button
          type="button"
          className={`btn-mini btn-mini-send ${sendTone === 'err' ? 'btn-mini-err' : ''} ${sendTone === 'warn' ? 'btn-mini-warn' : ''} ${sendTone === 'ok' ? 'btn-mini-ok' : ''}`}
          onClick={handleSend}
          disabled={sendState === 'pending'}
          title="Type and click Send on FB with humanization"
        >
          {sendLabel}
        </button>
      </div>
    </article>
  );
}
