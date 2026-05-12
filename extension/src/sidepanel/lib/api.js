export async function generateReply({
  endpoint,
  secret,
  message,
  context,
  categoryOverride,
  conversationHistory,
  userName,
  partnerName,
  listingTitle,
  location,
  overrideFlags
}) {
  const body = { message, context, categoryOverride };
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    body.conversation_history = conversationHistory;
  }
  if (typeof userName === 'string' && userName.trim()) {
    body.userName = userName.trim();
  }
  if (typeof partnerName === 'string' && partnerName.trim()) {
    body.partnerName = partnerName.trim();
  }
  if (typeof listingTitle === 'string' && listingTitle.trim()) {
    body.listingTitle = listingTitle.trim();
  }
  if (location && typeof location === 'object') {
    body.location = location;
  }
  if (overrideFlags === true) {
    body.override_flags = true;
  }

  console.log('[FB Reply Maker API] sending body:', { ...body, secret: '[REDACTED]' });

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-secret': secret
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${text || res.statusText}`);
  }

  return res.json();
}
