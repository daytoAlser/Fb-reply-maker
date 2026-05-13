// Phase E.7 — CCAW financing FAQ (deterministic facts).
//
// The prompt block reads from this object. The LLM must NOT extemporize
// on terms, rates, or process beyond what's stated here. If a customer
// asks something outside this set, the prompt routes them to phone via
// voice_strings.outside_faq_punt.
//
// Update this file (NOT the prompt) when financing policy changes.

export const FINANCING_FAQ = {
  partner: {
    // Spec note: real partner name to be confirmed; voice samples treat
    // it as generic "our financing partner". Swap when confirmed.
    name: 'our financing partner',
    type: 'open_ended_no_credit_check',
    credit_check: 'soft',
    impact_on_score: 'none'
  },
  loan_terms: {
    default_term_months: 36,
    payment_frequency: ['bi-weekly', 'monthly'],
    interest_behavior: 'accrues only on time loan is open',
    is_open_ended: true,
    early_payout_penalty: false
  },
  documents_required: [
    'Void cheque or direct deposit form',
    'Insurance',
    'Registration',
    "Driver's license (both sides)"
  ],
  deposit_rules: {
    special_orders: 'deposit varies by order size',
    in_stock_quick_install: 'no deposit if installing within 2-3 days'
  },
  approval: {
    timeline: 'same-day typically',
    credit_check_type: 'soft',
    no_credit_check_option: true
  },
  // The AI must never emit these. Prompt block reiterates these as
  // HARD RULES so the LLM doesn't slip into specifics under pressure.
  never_quote: [
    'specific interest rate',
    'approval odds',
    'total dollar amounts including interest',
    'promises about approval'
  ],
  voice_strings: {
    inquiry: "Yeah man we do financing through a no-credit-check partner. Soft credit check only, so applying doesn't hit your score. Open-ended loan too, no penalty if you pay off early. Want me to send the application?",
    terms: "Yeah so default term is 36 months, you can do bi-weekly or monthly payments. Big thing is it's open-ended, so if you pay it off in 6 months you only pay 6 months of interest, not the full term.",
    early_payout: "No penalty man, that's the best part. Open-ended loan. Pay off whenever, you just pay the interest accrued to that point. Way different from those loans that lock you into full-term interest.",
    documents: "Easy man, here's what we need: void cheque or direct deposit form, insurance, registration, driver's license (both sides). Send those over and I'll get your approval going.",
    approval: "Soft credit check only, doesn't hit your score. Approval is usually same-day. Want me to send the application?",
    calculation: "Yeah man, that's what it'd be if you ran the full term. Big thing is it's open-ended, so if you pay it off in say 6 months you only pay 6 months of interest, not the whole schedule. No penalty to pay early.",
    rate_punt: "The rate depends on your credit, the financing partner sets that when you apply. The big upside is it's open-ended, no penalty to pay off early.",
    approval_punt: "Honestly man, only the financing partner can confirm, but it's a soft credit check so applying doesn't hurt your score. Want me to send the application?",
    outside_faq_punt: "Honestly that's a question for our financing partner, let me get you on the phone with someone who can answer that properly. Best number for ya?"
  }
};
