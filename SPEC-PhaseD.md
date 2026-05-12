# FB Reply Maker — Phase D Spec

Flag-based escalation system + critical settings additions. AI handles low-risk qualifying. Anything risky (fitment, pricing, timeline) gets flagged for human review with a holding reply that keeps the conversation warm.

Owner: Dayton Altwasser (CCAW)
Builds on: Phases A, B, C (current main branch)

---

## 1. Philosophy

**AI is your qualifier. Salesperson is your expert.**

The system handles the easy 80% (greetings, vehicle qualification, look/height/size collection, vague-intent narrowing). The risky 20% (fitment confirmation, pricing, timeline commitments) always gets a human review gate.

The trade is: AI handles more volume, but never says something that costs a return, a refund, or a banned account.

**Three principles:**

1. **Aggressive flagging is the right default.** Better to flag too often (you say "yeah AI's fine, send it" with the override button) than flag too rarely (AI confidently sends wrong info).
2. **Holding replies keep the lead warm.** When a flag fires, the AI still generates a reply, just a "give me a sec, I'm on it" reply that buys you time without losing trust.
3. **One-click override matters.** When you trust the AI's reply on a flagged moment, send it with one click. Otherwise you'll start ignoring the flags entirely.

---

## 2. Architecture (small change)

Phase D extends the existing system. No new services. Three changes:

| Layer | What changes |
|---|---|
| Netlify function | Detects flags, returns `flags` array in response, adapts variants to holding replies when flag fires |
| Side panel | New banner system above variants, override button, flagged-lead chip on cards |
| Storage | Leads get `open_flags` array and `flag_history` log |

---

## 3. The Three Flag Types

### 3.1 needs_fitment_check (RED, highest priority)

**Triggers (detected by the model via system prompt):**

| Pattern | Example |
|---|---|
| "will [this/these/it] fit" | "will these fit a 2018 f150" |
| Specific vehicle + compatibility question | "got a 2019 ram, would these work" |
| Bolt pattern / offset / PCD questions | "what bolt pattern is this", "what's the offset" |
| Clearance / rubbing / trimming questions | "would these rub on my truck", "will i need trimming" |
| Friend-comparison fitment | "my buddy has these on his 2020 silverado" |

**Holding reply pattern:**

> "Hey @[Name], [YourName] here, I'd be happy to help you out today! Great question on fitment, let me double-check that for ya and confirm everything will work perfectly. Give me just a moment and I'll have you sorted!"

Or for thread mid-conversation (no opener):

> "Great question on fitment, let me double-check that for ya. What vehicle are these going on so I can confirm everything will fit perfectly?"

### 3.2 needs_pricing_assist (YELLOW)

**Triggers:**

| Pattern | Example |
|---|---|
| Total/package price ask | "what's the total", "how much all in", "out the door price" |
| Installed pricing | "installed price", "with install how much" |
| Discount ask | "can you do better", "best price", "any deals" |
| Competitor match | "fountain quoted me $9200, can you match" |
| Financing | "do you guys do financing", "payment plans" |
| Trade-in inquiry | "what'll you give me for my stock 18s" |
| Generic damage ask | "what's the damage" |

**Holding reply pattern (existing quote-in-chat punt):**

> "Send me a good phone number for ya so I can add you to the system here and I'll make you a full estimate, broken down and easy to read, and send it right here to review!"

For discount asks after estimate sent (second-ask pattern), the AI should still flag but generate the "best price right off the bat" hold reply rather than the phone-ask punt.

### 3.3 needs_timeline_check (YELLOW)

**Triggers:**

| Pattern | Example |
|---|---|
| When can I get it | "when can I get these", "how soon" |
| Lead time question | "what's the lead time", "how long to ship" |
| Specific date | "need them by next saturday", "before the 22nd" |
| Event-driven deadline | "got a show in 2 weeks", "wedding next month" |
| In-stock question | "do you have these in stock right now" |
| Availability window | "available this week?" |

**Holding reply pattern:**

> "Let me confirm lead time and stock for ya, give me just a moment and I'll have it sorted!"

Or with light context:

> "We've got most stuff in stock or in the warehouse, let me confirm exact availability on these for ya and I'll get back with timing right away!"

### 3.4 Multiple flags at once

A customer can ask "will these fit my f150 and how much installed?" That's both fitment AND pricing.

Model returns `flags: ["fitment", "pricing"]`. The holding reply addresses fitment first (highest priority), then mentions pricing punt secondarily.

Example combined reply:

> "Great question on fitment, let me double-check those'll work perfectly for ya. While I'm at it, shoot me your phone number and I'll have a full estimate ready broken down nice and easy to read!"

---

## 4. Netlify Function Changes

### 4.1 New JSON Output Contract

```json
{
  "category": "availability|fitment|price_haggle|location_hours|delivery_shipping|stock_check|install_service|trade_in|other",
  "intent_summary": "<one short sentence>",
  "flags": ["fitment"],
  "variants": {
    "quick": "<text>",
    "standard": "<text>",
    "detailed": "<text>"
  },
  "extracted_fields": {
    "vehicle": "<year make model or null>",
    "lookPreference": "poke|flush|null",
    "rideHeight": "lifted|leveled|factory|null",
    "tireSize": "<size or null>",
    "intent": "looks|performance|function|null",
    "customerType": "standard|tire_kicker|researched|urgent|gift_buyer|unknown"
  },
  "ad_type": "wheel|tire|accessory|lift|unknown",
  "lead_status_suggestion": "new|qualifying|qualified",
  "conversation_stage": "opener|qualifying|recommendation|quote_ask|booking|unknown"
}
```

The `flags` array is new. Empty array `[]` means no flags. Otherwise contains one or more of: `"fitment"`, `"pricing"`, `"timeline"`.

### 4.2 New Request Parameter

Side panel can send `override_flags: true` in the request body. If true, the model ignores its flag detection and generates normal qualifying variants. Used when user clicks "Generate normal reply anyway" button.

### 4.3 System Prompt Additions

Append new section to the existing system prompt (after the CUSTOMER TYPE RECOGNITION section):

```
FLAG DETECTION

Before generating variants, detect if the customer's message contains content requiring human review. Set the flags array in your response accordingly. If override_flags is true in the input, skip detection and generate normal qualifying variants.

FITMENT FLAG (flags: ["fitment"]) - HIGHEST PRIORITY
Trigger when customer asks any of:
- Will these fit / do these fit / will it work for [vehicle]
- Mentions specific vehicle and asks about compatibility
- Asks about bolt pattern, offset, PCD, hub bore, backspacing
- Asks about clearance, rubbing, trimming, fender modification
- Compares to friend's truck setup as proof of fit

When fitment flag fires, the variants are holding replies, NOT confirmations:

Quick: "Great question on fitment, let me double-check that quick and I'll be right back with ya!"

Standard: "Great question on fitment, let me double-check those'll work perfectly for ya. What vehicle are we working with so I can confirm everything?"

Detailed: "Hey @[Name], [YourName] here, I'd be happy to help you out today! Great question on fitment, let me confirm everything will work perfectly. Give me just a moment to double-check and I'll be right back with you on this!"

NEVER confirm fitment yourself. NEVER say "yes those will fit." Even if you think they will. The holding reply pattern always wins.

PRICING FLAG (flags: ["pricing"])
Trigger when customer asks any of:
- Total price, package price, out-the-door price
- Installed pricing, all-in cost
- Discount, best price, can you do better
- Competitor price matching
- Financing or payment plans
- Trade-in valuation
- "What's the damage"

When pricing flag fires, the variants use the quote-in-chat punt pattern:

Quick: "Send me your phone number and I'll have a full estimate ready for ya in a few!"

Standard: "Send me a good phone number for ya so I can add you to the system here and I'll make you a full estimate, broken down and easy to read, and send it right here to review!"

Detailed: Same as Standard plus additional warmth and timeline.

EXCEPTION: If the discount ask is the SECOND one (customer already received an estimate, conversation_history shows they're pushing back on the total), use the second-discount-ask hold pattern instead of phone punt. The flag still fires, but the variants frame the price hold around the customer's stated priority.

TIMELINE FLAG (flags: ["timeline"])
Trigger when customer asks any of:
- When can I get / how soon
- Lead time questions
- Specific date deadline (wedding, show, birthday, trip)
- In-stock questions
- Availability windows

When timeline flag fires, the variants are holding replies:

Quick: "Let me confirm stock on those for ya quick!"

Standard: "Let me confirm lead time and stock for ya, give me just a moment and I'll have it sorted!"

Detailed: "Hey @[Name], [YourName] here, I'd be happy to help you out today! Let me confirm stock and lead time on these for you and I'll have an answer right away!"

MULTIPLE FLAGS
If multiple flags fire simultaneously (e.g. customer asks "will these fit my truck and how much installed"), prioritize:
1. Fitment > Pricing > Timeline

Generate a combined holding reply that addresses the highest-priority flag fully, then mentions the others briefly. Example combining fitment + pricing:

"Great question on fitment, let me double-check those'll work perfectly. While I'm at it, shoot me your phone number and I'll have a full estimate ready broken down for ya as well!"

CRITICAL OVERRIDE
If override_flags is true in the input, treat the message as normal and generate qualifying variants per the standard flow. The user has reviewed the flag and chosen to proceed.
```

---

## 5. Side Panel UI Changes

### 5.1 Banner System

When `flags` array is non-empty, show a banner above the variant cards:

**Fitment flag banner (red):**

```
🚨 FITMENT QUESTION DETECTED
Holding reply ready below. Confirm fitment manually before normal reply.
[ GENERATE NORMAL REPLY ANYWAY ]
```

**Pricing flag banner (yellow):**

```
💰 PRICING QUESTION DETECTED
Estimate workflow reply ready below. Override for general pricing discussion.
[ GENERATE NORMAL REPLY ANYWAY ]
```

**Timeline flag banner (yellow):**

```
📅 TIMELINE QUESTION DETECTED
Holding reply ready below. Confirm lead time before commitments.
[ GENERATE NORMAL REPLY ANYWAY ]
```

**Multiple flags banner (red, fitment dominant):**

```
🚨 MULTIPLE FLAGS: FITMENT + PRICING
Combined holding reply ready below.
[ GENERATE NORMAL REPLY ANYWAY ]
```

### 5.2 Override Behavior

When user clicks "GENERATE NORMAL REPLY ANYWAY":
1. Re-call the Netlify function with `override_flags: true`
2. New variants generated as normal qualifying replies
3. Banner stays visible but changes to: "🟢 OVERRIDE ACTIVE - Variants below ignore flag, review before send"
4. The flag is logged to `flag_history` with `overridden: true` for analytics
5. The flag does NOT clear from `open_flags` on the lead (still needs your action on the actual customer message)
6. Send normally via Copy or Insert buttons

### 5.3 Variant Cards (no changes)

Cards render exactly as today. The banner above provides context. The Copy/Insert buttons work the same.

---

## 6. Lead Schema Updates

### 6.1 New Fields on Lead Object

```javascript
{
  // ...existing fields...
  open_flags: [],          // array of currently unresolved flags
  flag_history: [           // log of all flags ever fired
    {
      flag_type: "fitment",
      fired_at: 1778603583961,
      overridden: false,
      resolved_at: null,    // set when user takes action (sends a reply manually or marks resolved)
      customer_message: "will these fit my 2018 f150"  // truncated to 200 chars
    }
  ]
}
```

### 6.2 Flag Lifecycle

| Event | Effect |
|---|---|
| Customer message triggers flag | Add to `open_flags`, append to `flag_history` |
| User clicks Insert/Copy on holding reply variant | Flag stays open (the reply was a holding reply, the actual question still needs human action) |
| User clicks "Generate Normal Reply Anyway" | Flag is marked `overridden: true` in `flag_history`, stays in `open_flags` for one more cycle |
| User clicks "Mark Flag Resolved" on the lead card | All open_flags cleared, `resolved_at` set on each entry in flag_history |
| New customer message arrives that doesn't trigger flag | Open flags from previous generation auto-clear (assumption: user addressed them before responding) |

The auto-clear on new clean message is important. Without it, every lead accumulates flags forever. Logic: if customer keeps engaging without re-asking the flagged question, they got their answer.

### 6.3 Qualification Logic Unchanged

Leads still qualify based on captured fields (vehicle + look + height for wheel ads, etc). Flags do NOT block qualification. A lead can be qualified AND have an open flag. The leads tab handles this with separate filters.

---

## 7. Leads Tab UI Updates

### 7.1 New Filter Chip: FLAGGED

Add fourth filter chip alongside ALL / NEW QUALIFIED / CONTACTED / CLOSED:

```
[ ALL (N) ] [ NEW QUALIFIED (N) ] [ FLAGGED (N) ] [ CONTACTED (N) ] [ CLOSED (N) ]
```

FLAGGED filter shows any lead with `open_flags.length > 0` regardless of other status.

### 7.2 Lead Card Updates

If lead has open flags, show a flag chip next to the status pill:

```
GLEN                     [ QUALIFIED ] [ 🚨 FITMENT ]
WHEEL DEALS $1000/SET OR LESS
INTENT: looks    LOOK: poke    HEIGHT: lifted    VEHICLE: 2018 F150 Sport
Captured: 12m ago
[ OPEN THREAD ]  [ MARK CONTACTED ]  [ ⋯ ]
```

Flag chip color matches the flag type (red for fitment, yellow for pricing/timeline).

### 7.3 Three-Dot Menu Addition

Add new option: **Mark Flags Resolved**. Clears all open_flags on the lead (sets `resolved_at` on each, removes from open_flags).

### 7.4 Badge Logic Update

Badge count on extension icon = count of leads with `open_flags.length > 0` PLUS count of unviewed qualified leads. Combined into one badge for simplicity.

When user opens Leads tab AND filter is FLAGGED or NEW QUALIFIED, the relevant counter clears.

---

## 8. Settings Page Additions

Four new fields in the options page, placed in a new card titled "LOCATION" after the "YOU" card:

| Field | Used for | Default |
|---|---|---|
| **E-Transfer Email** | Closing replies asking for deposit | blank |
| **Location Name** | Missed call reframe ("The [Calgary] store gets busy") | blank |
| **Location Address** | "Pop down to see us" + customer asking where | blank |
| **Location Phone** | "Give us a call with a CC" | blank |

### 8.1 Storage Schema

```javascript
chrome.storage.sync.location = {
  name: "Calgary",
  address: "1234 Macleod Trail SE, Calgary AB",
  phone: "403-555-0100",
  etransferEmail: "deposits@ccaw.ca"
}
```

### 8.2 System Prompt Integration

Pass location fields into the system prompt context. The AI uses them naturally in replies:

```javascript
const locationContext = `
LOCATION CONTEXT
- Location: ${location.name}
- Address: ${location.address}
- Phone: ${location.phone}
- E-Transfer Email: ${location.etransferEmail}

Use these naturally when referenced in conversation. When customer asks where you are, give the address. When closing with payment paths, use the actual e-transfer email. When reframing missed calls, name the actual location.
`;
```

### 8.3 Options Page UI

Add the LOCATION card with four labeled inputs. Save button persists to chrome.storage.sync. Green "Saved" flash on success.

---

## 9. Build Order

Strict phase order. Stop and test after each.

### Phase D.1: Settings additions (smallest, isolated)

1. Add four new fields to options page (e-transfer, name, address, phone)
2. Update chrome.storage.sync schema
3. Update side panel to load and pass location context to API
4. Update Netlify function to accept and inject location context into system prompt
5. Test: customer asks "where are you guys" → reply uses real address

**Why first:** Low risk, isolated changes. Validates the side-panel-to-Netlify pipeline still works after refactor.

### Phase D.2: Flag detection in Netlify function

1. Update system prompt with FLAG DETECTION section
2. Update response JSON contract to include `flags` array
3. Accept `override_flags` in request body
4. Add console.log of detected flags in Netlify function
5. Test via Invoke-RestMethod with these messages:
   - "will these fit a 2018 f150" → expect flags: ["fitment"]
   - "whats the total all in installed" → expect flags: ["pricing"]
   - "when can i get these by saturday" → expect flags: ["timeline"]
   - "will these fit my truck and how much installed" → expect flags: ["fitment", "pricing"]
   - Normal qualifying message → expect flags: []

**Why second:** Validates the model can detect flags reliably before we wire UI.

### Phase D.3: Side panel banner system

1. Add banner component above variant cards
2. Read flags from API response, render appropriate banner
3. Wire "Generate Normal Reply Anyway" button → re-calls API with override_flags: true
4. Style: red for fitment, yellow for pricing/timeline
5. Test: trigger each flag type from the side panel, confirm banner renders correctly

### Phase D.4: Lead schema + open_flags lifecycle

1. Update leads.js schema to include open_flags and flag_history
2. createOrUpdateLead writes flags from response into open_flags
3. Auto-clear logic: if new generate has no flags, clear previous open_flags
4. Override sets `overridden: true` in flag_history entry
5. Test: trigger fitment flag → lead has open_flags: ["fitment"] → trigger normal message → flags clear

### Phase D.5: Leads tab UI updates

1. Add FLAGGED filter chip
2. Render flag chips on lead cards (red/yellow per type)
3. Add "Mark Flags Resolved" to three-dot menu
4. Update badge count logic (open flags + unviewed qualified)
5. Test: trigger flag, see it in FLAGGED filter, mark resolved, see it clear

---

## 10. Acceptance Criteria

Phase D is signed off when ALL of these pass:

| # | Criterion | Test |
|---|---|---|
| 1 | E-transfer email used in close reply | Paste "what email for etransfer" → reply contains the configured email |
| 2 | Location address used when asked | Paste "where are you guys" → reply contains the configured address |
| 3 | Location name used in missed-call reframe | Paste "called 3 times no answer" → reply contains "[Configured Name] store gets busy" |
| 4 | Fitment flag fires on direct fit question | Paste "will these fit my 2018 f150" → red banner appears, variants are holding replies |
| 5 | Pricing flag fires on total ask | Paste "whats the total installed" → yellow banner, variants are phone-ask |
| 6 | Timeline flag fires on date-pressure | Paste "need these by next saturday" → yellow banner, variants are lead-time check |
| 7 | Multiple flags fire when applicable | Paste "will these fit my truck and how much" → banner shows both flags, combined reply |
| 8 | Override button generates normal reply | Click override on fitment flag → variants change to normal qualifying replies |
| 9 | Override is logged in flag_history | Check chrome.storage.local, confirm overridden: true is set |
| 10 | Open flags persist on lead | Trigger flag, switch tabs, return → flag chip still visible |
| 11 | Auto-clear works | After flag, paste normal message → flag clears from lead |
| 12 | FLAGGED filter works | Trigger flag, switch to FLAGGED filter → flagged lead appears |
| 13 | Badge updates correctly | Trigger flag → badge increments → open FLAGGED filter → badge clears |
| 14 | Settings persist across sessions | Save location, restart Chrome, reload extension → values still there |

---

## 11. Out of Scope for Phase D

These are real future builds, deferred to Phase E or later:

| Feature | Reason deferred |
|---|---|
| Multi-product state tracking | Complex schema change, needs real usage data first |
| Long-pause / returning-customer detection | Needs lead aging logic |
| Decision support mode (consultant tone) | Voice pattern, can be added via system prompt later |
| Wrong-product redirect state | Complex branching, defer to usage data |
| Auto-resume after manual options sent | Major architecture shift, Phase F |
| NetSuite SKU lookup | Separate integration project |
| Catalog database | Optional, defer until you decide if needed |
| Auto-send / auto-reply | Banned by FB, not building |

---

## 12. Known Risks

| Risk | Mitigation |
|---|---|
| Model misses a flag (false negative) | Aggressive system prompt rules, monitor for missed flags in real usage, tighten prompt over time |
| Model over-flags (false positive) | Override button makes this trivial to handle, expected behavior in early use |
| Flag history grows unbounded | Cap flag_history at last 20 entries per lead, drop oldest |
| Settings get lost on extension reinstall | chrome.storage.sync persists across Chrome installs on same Google account, low risk |
| Multiple flag types overflow the banner | Cap visible flags at 2 in banner, "+1 more" indicator if 3+ |

---

End of Phase D spec.
