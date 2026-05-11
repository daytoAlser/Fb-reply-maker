export const SELECTORS = {
  threadContainer: '[role="main"]',
  replyTextbox: '[contenteditable="true"][role="textbox"]'
};

export const ROLE_PATTERNS = {
  incoming: /^Message from\b/i,
  outgoing: /^(You sent|Sent)\b/i
};

export const MAX_CONTEXT_MESSAGES = 5;
