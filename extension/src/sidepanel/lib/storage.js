export const DEFAULTS = {
  userName: '',
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
  location: {
    name: '',
    short: '',
    key: '',
    address: '',
    phone: '',
    etransferEmail: ''
  },
  preferences: {
    defaultCategory: 'auto'
  }
};

export async function loadAll() {
  const data = await chrome.storage.sync.get(['userName', 'config', 'context', 'location', 'preferences']);
  return {
    userName: typeof data.userName === 'string' ? data.userName : DEFAULTS.userName,
    config: { ...DEFAULTS.config, ...(data.config || {}) },
    context: { ...DEFAULTS.context, ...(data.context || {}) },
    location: { ...DEFAULTS.location, ...(data.location || {}) },
    preferences: { ...DEFAULTS.preferences, ...(data.preferences || {}) }
  };
}

export async function saveAll({ userName, config, context, location, preferences }) {
  await chrome.storage.sync.set({
    userName: typeof userName === 'string' ? userName : '',
    config,
    context,
    location: { ...DEFAULTS.location, ...(location || {}) },
    preferences
  });
}
