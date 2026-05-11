export const DEFAULTS = {
  config: {
    endpoint: 'https://ccacash.netlify.app/.netlify/functions/generate-reply',
    secret: ''
  },
  context: {
    name: 'CCAW (Canada Custom Autoworks)',
    locations: '',
    phone: '',
    hours: 'Mon-Fri 9AM-6PM, Sat 10AM-4PM, Sun closed',
    customNotes:
      'We specialize in wheels, tires, lifts, and accessories. We install everything we sell.'
  },
  preferences: {
    defaultCategory: 'auto'
  }
};

export async function loadAll() {
  const data = await chrome.storage.sync.get(['config', 'context', 'preferences']);
  return {
    config: { ...DEFAULTS.config, ...(data.config || {}) },
    context: { ...DEFAULTS.context, ...(data.context || {}) },
    preferences: { ...DEFAULTS.preferences, ...(data.preferences || {}) }
  };
}

export async function saveAll({ config, context, preferences }) {
  await chrome.storage.sync.set({ config, context, preferences });
}
