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
