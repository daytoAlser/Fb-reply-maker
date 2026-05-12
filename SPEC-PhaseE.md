# FB Reply Maker — Phase E Spec

State-aware conversation intelligence. Phase D taught the AI WHAT to say. Phase E teaches it WHERE the conversation IS so it knows WHEN to say it.

Owner: Dayton Altwasser (CCAW)
Builds on: Phases A, B, C, D (all signed off)
Status: Spec complete, build deferred to fresh session

---

## 1. Philosophy

Phase D built the AI's voice. Real-world testing on the Usman thread proved the voice works ("YES, lean into it more"). Phase E doesn't change the voice. Phase E gives the voice context.

**The five gaps Phase E fixes:**

| Gap | Symptom | Fix |
|---|---|---|
| 1 | Multi-product setups feel like 3 separate conversations | Multi-product state tracking |
| 2 | Long-pause resumes get the "happy to help today" full opener | Returning customer detection |
| 3 | Undecided customers get more questions, not advice | Decision support mode |
| 4 | Wrong-product customers get qualified for a product that won't fit | Wrong-product redirect |
| 5 | After manually sending options, the next reply has no memory of what was sent | Auto-resume after manual options |

**Priority (from Dayton, ranked by daily workflow impact):**

| # | Feature | Why this priority |
|---|---|---|
| 1 | Multi-product state tracking | Customers always want full setups. Highest daily friction. |
| 2 | Long-pause / returning customer detection | Happens often, current behavior is awkward. |
| 3 | Decision support mode | Common, AI sounds robotic when customer is undecided. |
| 4 | Wrong-product redirect | Handle manually fine for now. |
| 5 | Auto-resume after manual options sent | The dream, but maybe overkill. Build last. |

Build order matches priority. Stop after each if energy fades. Anything past #3 is bonus territory.

---

## 2. Architecture Changes

Phase E is a structural shift, not a bolt-on. The lead schema gets bigger. The state machine gets richer. The system prompt gets new context blocks. But the existing pipeline (content script → side panel → Netlify → Supabase) is unchanged.

### 2.1 Lead Schema Evolution

Current lead object (Phase D):

```javascript
{
  threadId: "1515691280211850",
  partnerName: "Usman",
  fbThreadUrl: "...",
  listingTitle: "...",
  adType: "wheel",
  capturedFields: {
    vehicle: "2026 Ram Limited Night Edition",
    lookPreference: "flush",
    rideHeight: "factory",
    tireSize: null,
    intent: "looks",
    customerType: "researched"
  },
  status: "qualifying",
  open_flags: [],
  flag_history: [],
  notes: "",
  createdAt: 1778611755635,
  lastUpdated: 1778611755635
}
```

Phase E lead object (additions in bold):

```javascript
{
  // ...existing Phase D fields unchanged...
  
  // NEW: per-product tracking
  productsOfInterest: [
    {
      productType: "wheel",
      productState: "qualified",
      qualifierFields: {
        size: "18",
        lookPreference: "flush",
        // wheel-specific fields
      },
      optionsSentManually: null,
      selectedProduct: null
    },
    {
      productType: "tire",
      productState: "qualifying",
      qualifierFields: {
        size: null,
        usage: "year-round",
        // tire-specific fields
      },
      optionsSentManually: null,
      selectedProduct: null
    }
  ],
  
  // NEW: conversation mode flags (orthogonal to product state)
  conversationMode: "standard|decision_support|returning|wrong_product",
  
  // NEW: returning customer detection
  lastCustomerMessageAt: 1778611755635,
  silenceDurationMs: 0,
  
  // NEW: manual options sent record (Phase E.5)
  manualOptionsLog: [
    {
      sentAt: 1778611755635,
      productType: "wheel",
      brand: "Fuel",
      model: "Rebel",
      price: 1499,
      sizes: ["20x10", "20x12"],
      notes: "Set of 4"
    }
  ]
}
```

### 2.2 Supabase Schema Migration

Add new columns to the `leads` table:

```sql
alter table leads add column products_of_interest jsonb default '[]'::jsonb;
alter table leads add column conversation_mode text default 'standard';
alter table leads add column last_customer_message_at timestamptz;
alter table leads add column silence_duration_ms bigint default 0;
alter table leads add column manual_options_log jsonb default '[]'::jsonb;

create index idx_leads_conversation_mode on leads(conversation_mode);
```

Migration is forward-compatible. Existing rows get defaults. No data loss.

### 2.3 System Prompt Additions

Add four new sections to the Netlify function system prompt:

| Section | Purpose |
|---|---|
| CONVERSATION MODE DETECTION | Identify decision_support, returning, wrong_product modes from message + context |
| MULTI-PRODUCT TRACKING | Recognize when customer wants multiple products, track each independently |
| RETURNING CUSTOMER VOICE | Skip opener, use "no worries" pattern, resume from prior state |
| DECISION SUPPORT VOICE | Switch from sales to advisor, explain tradeoffs, values-based reasoning |
| MANUAL OPTIONS CONTEXT | When manualOptionsLog has entries, AI knows what was sent and references it |

### 2.4 Side Panel UI Additions

| Element | When shown |
|---|---|
| Mode banner ("DECISION SUPPORT", "RETURNING CUSTOMER", "WRONG PRODUCT") | When conversationMode is not "standard" |
| Multi-product chip row | When productsOfInterest has 2+ entries |
| "Log Options Sent" button | After Generate, optional, opens form for Phase E.5 |
| Manual options summary panel | When manualOptionsLog has entries |

---

## 3. Phase E.1: Multi-Product State Tracking

**Source roleplay:** Conversation #4 with Brandon (2021 Ram 1500 Bighorn, wheels + tires + lift).

### 3.1 Detection Triggers

Customer expresses interest in multiple product categories within a single conversation:

| Pattern | Example |
|---|---|
| Explicit multi-mention in one message | "wheels and tires and maybe a level kit" |
| Sequential product asks | First message: wheels. Third message: "do you do tires too?" |
| Use-case implying multi-product | "Full setup for my truck" |
| Aspirational language implying multi-product | "Want to do something to make it look sick" |
| Ad type mismatch with stated needs | Customer messaging on wheel ad asks "what about a lift to go with it" |

### 3.2 State Machine Behavior

When multi-product detected:

```
single_product_qualifying → multi_product_qualifying
```

Each product enters its own qualifier chain:

| Product | Required fields | Optional fields |
|---|---|---|
| wheel | vehicle, look_preference, ride_height, intent | size_constraint |
| tire | size OR vehicle, usage (year-round/seasonal), tread_preference | brand_preference |
| lift | vehicle, height_goal, use_case (street/off-road/towing/jumps) | budget_band |

The AI's job: track which products are still missing qualifiers, ask the next missing qualifier in priority order (wheel size constraints often drive tire size, which feeds lift requirements).

### 3.3 Voice Patterns

Multi-product acknowledgment:

> "We can hook it up for sure, what kind of truck are we working on?"

Then run vehicle qualifier (shared across all products).

Use-case qualifier for lift (Brandon pattern):

> "What kind of driving are you doing with the truck, any jumping or just cruising?"

The Brandon-style use-case answer of "just cruising" should lead AI to recommend cheaper kits (Rough Country style), not push expensive ones (Carli style). Honest-recommendation pattern.

Multi-product budget defer:

> "Let's pick the [last unknown product] first my man, would you need something [last qualifier]?"

The "pick one variable at a time" pattern defers total-price questions naturally without breaking workflow.

### 3.4 ready_for_options Logic

A lead enters `ready_for_options` state when ALL products in `productsOfInterest` have `productState: "qualified"`.

Until then, AI keeps asking the next missing qualifier across all products.

### 3.5 Acceptance Criteria for E.1

| # | Criterion |
|---|---|
| E1-1 | Customer mentions wheels + tires + lift in single message → lead.productsOfInterest has 3 entries |
| E1-2 | Each product entry has its own qualifierFields tracked independently |
| E1-3 | Captured fields update per-product (wheel size goes into wheel entry, tire usage into tire entry) |
| E1-4 | AI asks vehicle ONCE (shared across products) |
| E1-5 | AI asks use-case ONCE when lift is in products list |
| E1-6 | AI does NOT prompt for tire-specific qualifiers if only wheels are in products list |
| E1-7 | When all 3 products qualified, ready_for_options badge fires |
| E1-8 | Side panel shows multi-product chip row indicating active products |
| E1-9 | Supabase row has populated products_of_interest jsonb with 3 entries |

---

## 4. Phase E.2: Long-Pause / Returning Customer Detection

**Source roleplay:** Conversation #3 with Tyler (8-day gap after options sent).

### 4.1 Detection Triggers

Multiple signals combine. ANY of these flips the lead to `returning` mode:

| Signal | Threshold |
|---|---|
| Time gap since last lead activity | More than 48 hours |
| Status was `options_sent` or `lead_warm_pending` | And new customer message arrives |
| Customer language indicates resumption | "sorry just getting back to ya", "haven't forgotten", "hey again", "still got those" |
| Customer references prior context | "those wheels", "the ones you showed me", "the bronze ones" |

### 4.2 State Machine Behavior

```
options_sent → returning_after_silence
lead_warm_pending → returning_after_silence
```

The conversationMode field flips to `returning`. The status field STAYS at its prior value. Two separate dimensions.

### 4.3 Voice Patterns

**Returning customer opener (NOT the full Phase A opener):**

> "Hey [Name], no worries at all my man, life happens!"

Or simpler:

> "No worries at all my man! We definitely still have them, which ones were you thinking about pulling the trigger on?"

The full "Hey @Name, [Rep] here, I'd be happy to help you out today!" is WRONG for returning customers. They already know the rep, already had the conversation, the formal opener feels disconnected.

**Decision support layer (if customer is now torn):**

> "Honestly man in my opinion, you're gonna have the wheels for years and years right, divide that $300 over the timeline. The cost of getting the wheels you really want is usually worth the extra few hundred to not have any regrets."

**Direct buy signal (returning customer commits):**

> "Easy man, we just need a deposit and we can get it all going ASAP!"

Skip estimate workflow if estimate was already sent in the prior conversation. Go straight to deposit + three payment paths.

### 4.4 Side Panel UI

Banner above variants when conversationMode is `returning`:

```
🔄 RETURNING CUSTOMER (gap: 8 days)
Last status: options_sent
Variants below skip opener, use returning-customer voice.
```

### 4.5 Acceptance Criteria for E.2

| # | Criterion |
|---|---|
| E2-1 | Lead with lastUpdated > 48h ago receives new customer message → conversationMode flips to "returning" |
| E2-2 | Generated variants do NOT contain "happy to help you out today" |
| E2-3 | Variants use "no worries my man, life happens" or equivalent |
| E2-4 | If prior status was "options_sent", variants reference prior options ("which ones were you thinking") |
| E2-5 | If customer expresses direct buy signal in returning state, AI skips estimate workflow, generates deposit-ready close |
| E2-6 | Side panel shows returning-customer banner with gap duration |
| E2-7 | After AI replies once in returning mode, conversationMode stays as "returning" for subsequent messages in same session |

---

## 5. Phase E.3: Decision Support Mode

**Source roleplay:** Conversations #3 (Tyler torn between Hostiles and KMC Cranks) and #5 (Carlos vague intent).

### 5.1 Detection Triggers

| Pattern | Example |
|---|---|
| Explicit indecision language | "torn between", "not sure which", "can't decide", "help me pick" |
| Comparative ask | "which is better X or Y", "what would you recommend" |
| Vague-intent buyer language | "I dunno what I want", "what looks better", "what do you think" |
| Multiple options + delay | After options sent, customer asks comparison questions |
| Friend-reference indecision | "my buddy says X but I'm not sure" |

### 5.2 State Machine Behavior

`conversationMode` flips to `decision_support`. Lead status unchanged.

This is orthogonal to multi-product and returning. A customer can be returning AND in decision support mode simultaneously.

### 5.3 Voice Patterns

The decision support voice is the BIGGEST tonal shift in Phase E. The AI moves from salesperson to advisor.

**Tradeoff disclosure:**

> "Poking out looks sweet for sure, the only downside is that you do end up getting the truck a bit dirtier with the tire being outside the fender. Is that something you'd be okay with?"

**Values reframe (Tyler's $300 example):**

> "Honestly man in my opinion, you're gonna have the wheels for years and years right, divide that $300 over the timeline. The cost of getting the wheels you really want is usually worth the extra few hundred to not have any regrets and get exactly what you're after."

**Use-case recommendation (Brandon's lift):**

> "For just cruising and highway, the Rough Country kit at $2,399 is gonna be perfect for you. Save the extra cash for tires or wheels you really love."

**Choice narrowing for vague intent (Carlos):**

> "We could go for something like a 20x10 -18 on there and it would look absolutely sick, poking out the fender around 1.75 inches."

Concrete recommendation with reasoning. Not "what do you want?"

### 5.4 Voice DO and DON'T

| DO | DON'T |
|---|---|
| Give honest tradeoffs ("downside is...") | Push the more expensive option |
| Reframe cost over time ("divide over years") | Apologize for price |
| Recommend based on use case | Recommend based on what makes the rep money |
| Use "honestly" and "in my opinion" | Use "you should" or "you need to" |
| Acknowledge their hesitation as valid | Treat indecision as a problem to solve |

### 5.5 Side Panel UI

Banner when conversationMode is `decision_support`:

```
🤝 DECISION SUPPORT MODE
Customer is torn or asking for recommendation.
Variants below are in advisor voice, not sales voice.
```

### 5.6 Acceptance Criteria for E.3

| # | Criterion |
|---|---|
| E3-1 | Customer says "torn between X and Y" → conversationMode flips to "decision_support" |
| E3-2 | Customer says "what would you recommend" → mode flips to "decision_support" |
| E3-3 | Generated variants contain advisor language ("honestly in my opinion", "the downside is") |
| E3-4 | Variants do NOT contain sales pressure ("you'll love it", "we can definitely make that happen") |
| E3-5 | Variants reference customer's use case when recommending |
| E3-6 | When tradeoffs exist, AI mentions the downside, not just the upside |
| E3-7 | Mode banner shows in side panel |

---

## 6. Phase E.4: Wrong-Product Redirect

**Source roleplay:** Conversation #2 with Jared (2015 Civic on 20x12 truck wheel ad).

### 6.1 Detection Triggers

| Pattern | How detected |
|---|---|
| Vehicle is a car, listing is for trucks | Cross-reference adType and vehicle classification |
| Bolt count mismatch | 4-bolt car on 6-bolt truck wheel listing |
| Size mismatch with vehicle constraints | Civic asking about 20x12 -44 |
| Customer expresses doubt | "would these even fit my car?" |

### 6.2 State Machine Behavior

`conversationMode` flips to `wrong_product`. AI generates a redirect reply that:

1. Acknowledges the mismatch honestly (with humor where appropriate)
2. Offers to pivot to a product that DOES fit
3. Starts a new qualifier chain for the alternative

### 6.3 Voice Patterns

**Honest dead-end + redirect (Jared pattern):**

> "The wheels in the ad here would be more for trucks, a 20x12 on the Civic would be poking out the fender around 5 inches hahaha"

> "Were you thinking 20s for the new rims? Let me know and I'll get you some options to check out here ASAP!"

The humor matters. "hahaha" diffuses the rejection. Customer feels like they're talking to a buddy, not getting told no.

**Size narrow-down for car redirect:**

> "We've got options in 18 and 19, but 18s will be more cost effective for sure!"

### 6.4 Side Panel UI

Banner when conversationMode is `wrong_product`:

```
↪️ WRONG-PRODUCT REDIRECT
Customer's vehicle doesn't fit listing. Variants offer alternative.
```

### 6.5 Acceptance Criteria for E.4

| # | Criterion |
|---|---|
| E4-1 | Civic customer on truck wheel ad → conversationMode = "wrong_product" |
| E4-2 | Variants acknowledge mismatch honestly without being dismissive |
| E4-3 | Variants include humor/lightness on the mismatch ("hahaha") |
| E4-4 | Variants offer a pivot to compatible product |
| E4-5 | Mode banner shows in side panel |
| E4-6 | After customer accepts pivot, mode returns to "standard" with new ad context |

---

## 7. Phase E.5: Auto-Resume After Manual Options Sent

**The original vision.** When user manually sends product options to a customer (because the AI can't pick actual products from inventory), the system needs to know WHAT was sent so the next reply has context.

### 7.1 The Architecture Challenge

Facebook doesn't reliably expose outgoing messages to the extension's content script. We tried scraping but the DOM structure varies between thread types and customer-initiated vs rep-initiated conversations.

**The solution: user explicitly logs what was sent.**

After the user sends options in FB, they click "Log Options Sent" in the side panel and fill a quick form:

| Field | Example |
|---|---|
| Product type | wheel / tire / lift |
| Brand | Fuel |
| Model | Rebel |
| Size | 20x10 |
| Price | $1,499 |
| Notes | Set of 4, gloss black |

This data goes into `manualOptionsLog` on the lead.

### 7.2 State Machine Behavior

When `manualOptionsLog` has entries, the AI's context includes them. The lead status flips to `options_sent`.

When customer replies after this state, the AI's system prompt includes:

```
YOU PREVIOUSLY SENT THESE OPTIONS:
- Wheel: Fuel Rebel 20x10, $1,499 (set of 4)
- Tire: Nitto Ridge Grappler 33x12.5R20, $389/tire

Reference these naturally when the customer responds. Do not re-suggest products.
```

### 7.3 Voice Patterns

**Customer expresses interest in option:**

Customer: "I like the Rebels"

AI variant: "Those rebels are sick for sure! Send me a good phone number for ya so I can add you to the system and get you a full estimate for the wheels and tires, broken down easy to read."

**Customer is torn between options:**

Customer: "Torn between the Rebels and the Cranks"

AI variant: "Honestly man, in my opinion both are sick but if you want the meaner look the Cranks pull it off harder. The Rebels are more versatile. What kind of vibe are you going for, aggressive or clean-aggressive?"

(Auto-applies decision support mode on top of options_sent context.)

### 7.4 UI: Log Options Sent Form

Modal in side panel, opened by "Log Options Sent" button after a generate:

```
┌─────────────────────────────┐
│  LOG OPTIONS SENT           │
├─────────────────────────────┤
│  Product Type: [wheel ▾]    │
│  Brand:        [Fuel    ]   │
│  Model:        [Rebel   ]   │
│  Size:         [20x10   ]   │
│  Price:        [$1499   ]   │
│  Notes:        [        ]   │
│                              │
│  [ + Add Another Product ]   │
│                              │
│  [ Cancel ]  [ Log Options ] │
└─────────────────────────────┘
```

After logging, lead.manualOptionsLog gets the entry. Status flips to options_sent. Future generates include the context.

### 7.5 Acceptance Criteria for E.5

| # | Criterion |
|---|---|
| E5-1 | Log Options Sent button appears in side panel after a generate when status is qualified |
| E5-2 | Clicking opens modal with all fields |
| E5-3 | Multiple products can be logged in single submission |
| E5-4 | Lead.manualOptionsLog updates with new entries |
| E5-5 | Lead status flips to options_sent |
| E5-6 | Next Generate includes logged options in system prompt context |
| E5-7 | AI variants reference logged options by name/price |
| E5-8 | AI does NOT re-suggest products that were already logged |
| E5-9 | Supabase manual_options_log column persists entries |

---

## 8. Build Order

Strict phase order. Stop after each. Test before moving on.

### Phase E.0: Schema Migration

| Step | Action |
|---|---|
| 1 | Run alter table SQL in Supabase to add 5 new columns |
| 2 | Update chrome.storage.local lead schema to include new fields with defaults |
| 3 | Update generate-reply.js to map new fields to Supabase columns |
| 4 | Verify existing leads load correctly with default values for new fields |

### Phase E.1: Multi-Product Tracking (priority 1)

| Step | Action |
|---|---|
| 1 | Update system prompt with MULTI-PRODUCT TRACKING section |
| 2 | Update extracted_fields to include productsOfInterest array |
| 3 | Update side panel to render multi-product chip row |
| 4 | Update leads tab card to show all products in interest list |
| 5 | Update ready_for_options gate to require all products qualified |

### Phase E.2: Returning Customer Detection (priority 2)

| Step | Action |
|---|---|
| 1 | Add lastCustomerMessageAt tracking to content script |
| 2 | Update system prompt with RETURNING CUSTOMER VOICE section |
| 3 | Add returning-customer detection logic (time gap + status) |
| 4 | Add returning-customer banner to side panel |
| 5 | Tune variants to skip opener when returning |

### Phase E.3: Decision Support Mode (priority 3)

| Step | Action |
|---|---|
| 1 | Add decision support trigger detection to system prompt |
| 2 | Add DECISION SUPPORT VOICE section to system prompt with tradeoff/values patterns |
| 3 | Add decision support banner to side panel |
| 4 | Test on Tyler-style ("torn between") and Carlos-style ("what would you recommend") messages |

### Phase E.4: Wrong-Product Redirect (priority 4)

| Step | Action |
|---|---|
| 1 | Add wrong-product detection (vehicle class vs ad product type) |
| 2 | Add WRONG-PRODUCT REDIRECT section to system prompt |
| 3 | Add redirect banner to side panel |
| 4 | Test on car-customer-on-truck-ad scenario |

### Phase E.5: Manual Options Logging (priority 5)

| Step | Action |
|---|---|
| 1 | Add Log Options Sent button to side panel |
| 2 | Build options-log modal form |
| 3 | Add manualOptionsLog storage and Supabase sync |
| 4 | Update generate-reply to include logged options in system prompt context |
| 5 | Test full loop: log options, customer reply, AI references options |

---

## 9. Composite Acceptance Test

Run this AFTER all 5 phases are built. End-to-end test that exercises every Phase E feature.

**Scenario: Brandon-style customer with all features in play**

| Step | Action | What it tests |
|---|---|---|
| 1 | New thread, customer opens with "looking for a full setup for my truck, wheels tires and lift" | Multi-product detection (E.1) |
| 2 | Customer gives 2021 Ram Bighorn, new body 6 bolt | Vehicle qualifier (shared across products) |
| 3 | AI asks look preference (wheel-specific) | Wheel qualifier flow |
| 4 | Customer says aggressive poke + 35s + just cruising | All 3 products partially qualified |
| 5 | AI asks year-round vs seasonal (tire-specific) | Tire qualifier flow |
| 6 | Customer says "torn between aggressive looking lifts" | Decision support mode triggers (E.3) |
| 7 | AI gives tradeoff advice (Rough Country vs Carli) | Decision support voice |
| 8 | Customer picks Rough Country, all 3 products qualified | ready_for_options badge fires |
| 9 | User clicks Log Options Sent, fills 3 product entries | Manual options logging (E.5) |
| 10 | Customer goes silent for 3 days | Stale lead |
| 11 | Customer returns: "sorry just getting back to ya, what was the total again" | Returning customer detected (E.2) + pricing flag fires (Phase D) |
| 12 | AI generates returning-customer phone-ask | Combined modes |
| 13 | Customer provides phone, gets estimate, accepts | Standard close |

All 13 steps should work seamlessly without manual intervention beyond the user logging options at step 9.

---

## 10. Out of Scope for Phase E

| Feature | Reason |
|---|---|
| NetSuite SKU integration for auto-product-selection | Requires NetSuite API project, separate scope |
| Product catalog database | Phase D decision was flag-based escalation > catalog |
| Multi-rep collaboration features | Solo use for now, multi-user is Phase F |
| Analytics dashboard | Use Supabase data via SQL for now, dashboard is Phase F |
| Auto-send without user confirmation | FB ban risk, never building |
| iOS/Android version | Chrome extension only |

---

## 11. Known Risks

| Risk | Mitigation |
|---|---|
| Multi-product state confusion (which product was the customer asking about?) | AI must explicitly track which product each qualifier belongs to in extracted_fields. System prompt enforces this. |
| Returning-customer false positives (gap was actually customer thinking, not absence) | 48 hour threshold conservative. Override if needed via manual mode toggle. |
| Decision support kills momentum on otherwise-ready buyers | Detection requires explicit indecision language, not silence. Buyers who are just slow to respond don't trigger it. |
| Wrong-product detection misclassifies (some trucks DO use car-style wheels) | Default to "let the human decide" via flag rather than confident pivot. Phase D fitment flag covers ambiguous cases. |
| Manual options logging is tedious for users | Form has "Add Another" but kept short. Optional, not required. AI works without it, just less context-rich. |
| Supabase schema migration breaks existing leads | All new columns have defaults. Migration is forward-compatible. Test on staging if possible. |
| System prompt length explosion | Each mode section is conditional. Only include in prompt when relevant mode is detected. Keep base prompt lean. |

---

## 12. Notes for Future Self

When you (Dayton, fresh, next session) come back to build Phase E, read this section first.

### 12.1 Why we built this in this order

Multi-product first because Brandon-style customers are your most common high-value lead. Long-pause second because real-world testing showed the current resume feel is awkward. Decision support third because the voice already works, this just gates when it kicks in. Wrong-product fourth because you said you handle it fine manually. Auto-resume last because it's the riskiest architecturally and you can keep using the current "log nothing" approach indefinitely if needed.

### 12.2 Why no NetSuite catalog

You chose flag-based escalation over catalog in Phase D. That decision still stands for Phase E. Building a product catalog is a different project, and flag-based escalation has proven correct in real testing.

### 12.3 What if energy is low?

Build E.0 + E.1 only. That's the highest-impact slice. Multi-product alone solves the most daily friction. Everything else is additive polish.

### 12.4 What if energy is high?

Plow through E.0 → E.5 in one session. Roughly 2-3 hours of Claude Code time + 30 min of testing per phase. The composite acceptance test at the end takes another 30 min.

### 12.5 Watch for these bugs

Based on Phase D experience:

| Pattern | Bug we saw |
|---|---|
| Template placeholders leaking | Phase D had [Name] and [Customer] leaks. Resolve openers to literal strings before prompt injection. |
| Env vars with typos | Phase D had .com vs .co. Verify any new env var with a smoke test. |
| Side panel not sending fields the function expects | Phase D had partnerName/listingTitle/threadId not flowing. Add a payload-debug log on every generate. |
| Content script DOM selectors breaking on different thread types | Phase D needed v2 strict-sender update. Test on BOTH customer-initiated AND rep-initiated threads. |

---

End of Phase E spec.
