export async function generateReply({
  endpoint,
  secret,
  message,
  context,
  categoryOverride,
  conversationHistory
}) {
  const body = { message, context, categoryOverride };
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    body.conversation_history = conversationHistory;
  }
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
