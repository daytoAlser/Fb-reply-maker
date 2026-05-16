# CCAW Sales — The Dayton Standard

## What This Is

This document captures the exact voice, tone, and standard moves that Dayton Altwasser (Territory Manager, CCAW) demonstrated across five live roleplay scenarios. The replies in this document are pulled verbatim from the original conversation where Dayton played the rep and Claude played five different customer types.

Use this as:

1. The reference for what "good" looks like when training new CCAW reps
2. The source-of-truth voice when building the v4 AI sales trainer
3. The yardstick when grading rep replies in the trainer

## The Dayton Voice

### Core Principles

| Principle | What it means in practice |
|--|--|
| Introduce by name, every time | Every conversation opens with "Hey [Name], Dayton here" |
| Match their emotional tone | Curious customer = friendly, urgent = confident, irritated = grounded, gift buyer = warm |
| Casual but never sloppy | "man", "my man", "for sure", "ready to rock", "wicked", "sweet" — never profanity, never corporate-speak |
| Voice the value before the price | "Wheels, tires, mount/balance, install, lugs, sensors, lift" lands different than "$3,300" |
| Hold price with a reason, not a "no" | The reason ties to the customer's stated priority (speed, value, fit) |
| Friction is in service of the customer | Estimates, phone numbers, deposits are framed as protecting THEM, not your process |
| Quote the total in the formal estimate, never in chat | Hard rule. Holds under pressure. |
| Always give a forward path | Never end on a no, always close with the next step or a choice |

### Tone Markers

These are the specific words and phrases Dayton uses that define the voice:

| Marker | Where used |
|--|--|
| "Hey [Name], Dayton here" | Every opener |
| "I'd be happy to help you out today" | Almost every opener |
| "for sure" | Confidence marker after most confirmations |
| "my man" / "man" | Casual rapport, used heavily on FB DM and Marketplace |
| "no worries" | Defusing a customer worry |
| "ready to rock" / "ready to roll" | Confirming product availability |
| "wicked" / "sweet" | Painting the picture of the build |
| "absolutely" | Confirming a request |
| "get you rolling" | Setting up the close |
| "easy way to tell" | Coaching the customer through a check |
| "quick and easy either way" | Reducing friction on the estimate ask |
| "we will sort that out when you're here" | Punting low-priority detail to in-person |
| "let me know if you want to make it happen" | Soft close on a held price |

### What Dayton NEVER Does

| Forbidden Move | Why |
|--|--|
| Quote a total in chat | Always pull phone number first, send formal estimate |
| Apologize in a way that admits fault | Acknowledge reality without putting yourself on the defensive |
| Drop the install fee, labor, or wheel price | Discount the swappable commodity (tire brand) instead |
| Promise a fitment without qualifying | Always asks body style and bolt count on a Ram |
| Push the high-ticket option | Lays out trade-offs, lets the customer pick |
| Engage past the second discount ask | Holds price, offers alternative, then lets them choose to commit or walk |
| Match a competitor's price by a huge margin | A 2 to 5% better number reads as "fair", a 20% better number reads as "you were robbing me before" |

## The Standard Flow

This pattern emerged consistently across all five scenarios:

```
Introduce by name
  → Match emotional tone
    → Qualify (vehicle, size, OR validate research)
      → Address fitment / use case with real reasoning
        → Handle objections by reframing to customer's stated priority
          → Capture phone number
            → Send formal estimate (never quote total in chat)
              → Hold price under pressure with a reason tied to value
                → Close with three payment paths (e-transfer / phone-in CC / in-person)
```

The variations are in tone, urgency, and which step can be compressed based on context. Urgent customers walking in get the deposit-equivalent of "show up" instead of e-transfer. Researched customers get research validation instead of basic qualifying.

## Standard Phrases by Situation

These are Dayton's reusable lines that should be canonized in the trainer:

### Opening
> "Hey [Name], Dayton here, I'd be happy to help you out today!"

### Vehicle qualifying (cold)
> "What kind of vehicle are you thinking about putting some new shoes on?"

### Body style check on a Ram (skip the Google trip)
> "Easy way to tell, do your wheels have 5 or 6 bolts?"

### Confirming fitment with a real qualifier
> "The rims would fit for sure, but in the 35s with a 2 inch level, they would only clear on the Ram 1500 classic. Is your truck a classic or new body?"

### Delivering bad news on fitment with an alternative
> "Awesome man we would be able to get you into the rims for sure, but we would end up with some rubbing on 35s with your body style. We could definitely get you into the same tire in a 33x12.50R20 and you'd be looking great and not rubbing, would that work for you?"

### Holding fitment with a choice
> "We can definitely make them fit with a bit of trimming modifications if youre open to that, otherwise we could look at getting you into a 3.5 inch lift and these guys would fit no problem! Which would you prefer?"

### Holding a wheel price while upselling a lift
> "Yes sir same price in the wheels and we could get you into a sweet 3.5 inch kit for $1999 installed, making the whole truck look brand new. When were you thinking about getting everything done?"

### Pre-selling the estimate line items
> "Send me your phone number so I can make you a profile in the system here, and I will make you a full estimate for the four wheels and tires, mounted balanced and installed with new lug nuts, and sensors for the new wheels as well as the lift installed and all broken down for you to see, and send that right back here for you"

### Closing with deposit ask
> "Here's the full estimate for you to get the truck rolling fresh, we just need a deposit to get everything ordered up if it all looks good and we will get it all in here for ya!"

### Holding price with a value reframe
> "I wish man unfortunately we give everyone the best possible price right off the bat to try and save us all time. We could look at going with a bit better deal on a different tire, what do you think about that my man?"

### Offering a value tire as the discount lever
> If a cheaper SKU in the SAME SIZE is in live inventory, name it exactly with the real price the system surfaces. Do not invent brand+model names. If no cheaper option exists in the customer's exact size, the move is to ask if they're open to going down a size (smaller diameter, different ratio) to get into a better price point — or to confirm they need to stick with that size and accept the current sticker.

### Three payment paths close
> "You can send us an e-transfer at [address], or give us a call at [number] with a CC, as well as pop by in person and we can make it work!"

### Matching a brand-led shopper (Tanya)
> "I'd be happy to help you out today, we definitely carry Toyo. What size were you on the hunt for?"

### Light tone match on a personal context drop
> "Nice I wish I got that kind of present lol"

### Use-case-based recommendation (contractor)
> "If he's a contractor I'd go 10 ply, harder to get nail punctures, and will last longer under heavy use driving around from site to site. Would you need those guys installed as well?"

### Birthday close (double-duty timing question)
> "When is his birthday?"

### Confident urgent customer handling (Marcus)
> "Gotcha man, we will have it either way, our Calgary store is connected to our warehouse, so we got you! Can you get here?"

### Holding the no-quote-in-chat rule under pressure
> "Sorry man I gotta make sure I'm giving you the best deal and right sizing and an estimate makes sure you get what you need and I don't make any mistakes or miss any last minute deals for you. Quick and easy either way my man, here's the estimate out the door and taxes in! When can you make er in?"

### Walk-in close for urgent customers (no deposit)
> "Let's make it happen, my name is Dayton, just come in and ask for me and I'll get you rolling ASAP"

### Acknowledging a missed call without admitting fault
> "The Calgary store does get super busy in store sometimes but I'll get you helped out ASAP. To be sure, where are you located?"

### Researched customer alternative routing (Jordan)
> "We can definitely make that work for you, here are a few 24x14 options we have in local warehouses we could have in the next 3 to 5 days. Any of these options catch the eye?"

### Memorable bad news on lead time
> "I can't possibly get the Tritons in by that timeline unless you or I drive to Tennessee ourselves, which I can't do unfortunately. We can get any of the above options in your timeline, or we can get you the Tritons in just over 4 weeks at a better price, but that's outside the timeline. What would work best for you?"

### Handling customer-raised fitment concerns
> "For 37s with 14 wides we would definitely need to do some trimming to give you full turning, but we can make that happen for sure. As for the install that's no problem, send me a good phone number for ya so I can add you to the system here and make you a full estimate with a nice breakdown, and send it here for you to review!"

### Second discount ask hold (after estimate is sent)
> "Glad the estimate looks good! As for the dollars, I gave you the best possible pricing I could with the extra shipping and duties to get the wheels for you as fast as possible so I really can't get any lower but if the $8998 works for you, we can make it happen right away!"

### Tire kicker re-anchor (Kyle)
> "We always give everyone the best possible price right away to save us all time, $1299 out the door on your vehicle, today!"

### Pivot from used listing to new alternatives
> "All our options are brand new, warranty and lifetime services included! When you get tires here, you get more than rubber"

### Soft close on a held price (lets them walk without chase)
> "We do have these guys ready to rock, but the best we can make it work for would be $1299. Let me know if you want to make it happen!"

## The Five Scenarios — Verbatim

These are the actual conversations that happened. Use them as the gold standard reference for the trainer's expected behavior.

### Scenario 1: Steve T. (Marketplace, Ram fitment + lift upsell)

Listing: 20 inch Fuel wheels with 35 inch Nitto Trail Grappler tires, $1,299 Calgary.
Outcome: Closed full margin on wheels + lift + alternative tire. Roughly $3,000 ticket from a midnight Marketplace "is this still available."

```
CUSTOMER: hey is this still available

REP: Hey Steve, Dayton here, I'd be happy to help you out today!
     What kind of vehicle are you thinking about putting some new shoes on?

CUSTOMER: oh hey ya i got a 2019 ram 1500 on a 2in level / these would fit right

REP: Nice truck man, the rims would fit for sure, but in the 35s with a 2" level,
     they would only clear on the ram 1500 classic
     Is your truck a classic or a new body style?

CUSTOMER: uhh not sure tbh / its a 2019 sport / black one

REP: Gotcha man no worries, easy way to tell, do your wheels have 5, or 6 bolts?

CUSTOMER: oh ya its 6 / just went and looked lol

REP: Awesome man we would be able to get you into the rims for sure, but we would
     end up with some rubbing on 35s with your body style, we could definitely
     get you into the same tire in a 33x12.50r20 and you'd be looking great and
     not rubbing, would that work for you?

CUSTOMER: hmm / ya i mean the 35s are what i really wanted tho / u sure they
          wont fit? my buddy has 35s on his

REP: We can definitely make them fit with a bit of trimming modifications if
     youre open to that, otherwise we could look at getting you into a 3.5"
     lift and these guys would fit no problem! Which would you prefer?

CUSTOMER: oh shit a lift would be sick / how much for the lift installed /
          and would it still be the 1299 for the wheels

REP: Yes sir same price in the wheels and we could get you into a sweet 3.5"
     kit for $1999 installed, making the whole truck look brand new
     When were you thinking about getting everything done?

CUSTOMER: damn ok / prob next weekend if u guys can do it / what do u need from me

REP: We could make the work I'm sure, we have everything in stock ready to roll!
     Send me your phone number so I can make you a profile in the system here,
     and I will make you a full estimate for the four wheels and tires, mounted
     balanced and installed with new lug nuts, and sensors for the new wheels
     as well as the lift installed and all broken down for you to see, and
     send that right back here for you

CUSTOMER: ya sounds good / 403-555-0182 / shoot it over

REP: Here's the full estimate for you to get the truck rolling fresh, we just
     need a deposit to get everything ordered up if it all looks good and we
     will get it all in here for ya!

CUSTOMER: damn ok thats more than i thought / can u do any better on it /
          like maybe drop the install fee or something

REP: I wish man unfortunately we give everyone the best possible price right
     off the bat to try and save us all time
     We could look at going with a bit better deal on a different tire,
     what do you think about that my man?

CUSTOMER: ya what other tires u got / something cheaper but still looks mean

REP: [If the live inventory surfaces a cheaper SKU in the SAME size, name it
     exactly with the price the system shows — never invent a brand+model.
     If no cheaper SKU exists in the customer's exact size, the script is
     to confirm the current pick is already the value tier and ask if
     they're open to going down a size for a better deal.]

CUSTOMER: ok ya that works / lets do it / when do i pay the deposit

REP: You can send it to k@.com or call in to the store with a CC at any time
     to get it going

CUSTOMER: sweet ill send it tmrw morning / appreciate it man /
          ill call to book the install time
```

### Scenario 2: Tanya R. (FB DM, gift buyer)

Channel: FB DM, F-150 Lariat, Toyo Open Country AT3 inquiry.
Outcome: Closed $1,988 installed package + Saturday morning birthday surprise install.

```
CUSTOMER: hi do u guys carry toyo open country at3 / looking for a set of 4

REP: Hey Tanya, Dayton here
     I'd be happy to help you out today, we definitely carry toyo, what size
     were you on the hunt for?

CUSTOMER: 275 60 20 / for my husbands truck birthday gift lol

REP: Nice I wish I got that kind of present lol
     Those guys in the 275/60r20 are on for $429/tire in the P rated sizing,
     and $489/tire in the 10 Ply sizing, coming with a sweet looking tread
     pattern, snowflake rated for year round use and good to go!
     Would you need the 10 Ply version? If you're not sure just let me know
     the truck they go in and I'll confirm!
     Would you need them installed as well or just grabbing them loose?

CUSTOMER: oh wow ok / its a 2020 f150 lariat, stock / and ya wed need them
          installed / hes been wanting these forever

REP: Nice truck for sure
     The truck would be fine with the P rated version for sure if you're
     looking for the best deal, but the 10 Ply would carry a bit more load,
     last a bit longer and be a bit better for punctures, while trading a
     bit rougher ride and higher cost for those positives

CUSTOMER: hmm / hes a contractor if that matters / hauls stuff sometimes /
          u think hed want the 10 ply then?

REP: If he's a contractor id go for 10 ply, harder to get nail punctures,
     and will last longer under heavy use driving around from site to site
     Would you need those guys installed as well?

CUSTOMER: ya install too / what's the total damage

REP: Send me a good phone number for ya so I can add you to the system here
     and I will make you a full estimate for the tires and install broken
     down and easy to read, and send it here for you to review!

CUSTOMER: oh ok ya / 403-555-0294 / when can u send it

REP: Here is the full estimate for you, quick and easy!
     When is his birthday?

CUSTOMER: next saturday the 22nd! / can u do that morning so i can surprise
          him / ill bring it in while hes sleeping lol

REP: We can make that work for sure!
     We just need a deposit to get it all going
     You can send us an e transfer at [address], or give us a call at
     [number] with a CC, as well as pop by in person and we can make it work!

CUSTOMER: awesome ill etransfer tonight / thanks so much dayton ur a lifesaver
          / hes gonna love it
```

### Scenario 3: Marcus L. (FB DM, urgent blown tire)

Channel: FB DM, 2017 Silverado 1500, blown tire on Deerfoot, driving on a donut.
Outcome: Closed walk-in install. "Finally someone who picks up the damn phone."

```
CUSTOMER: are u guys actually open / called the calgary store 3 times no answer
          / need 4 tires asap

REP: Hey Marcus, Dayton here, I'd be happy to help you out today!
     The Calgary store does get super busy in store sometimes but I'll get
     you helped out ASAP, to be sure, where are you located?

CUSTOMER: nw calgary / need them today if possible / blew one out on deerfoot
          this morning / driving on the donut rn its sketchy af

REP: I'm sure we can get you in my man, what's the tire size or vehicle?

CUSTOMER: 2017 silverado 1500 / stock size whatever that is / just need
          something safe i dont care about brand / how much and how fast

REP: Gotcha man, we will have it eaither way, our Calgary store is connected
     to our warehouse, so we got you!
     Can you get here?
     That truck from factory can come with anything from 17s to 22s but we
     will sort that out when you're here

CUSTOMER: ya im like 20 min away / but i wanna know price before i drive over
          / dont wanna get there and get ripped off

REP: I can get that for you for sure man but I would need to know the tire
     size to get you the digits
     Can you read the numbers on the sidewall for me and fire them off here?
     If easier, you can always give me your number here, and I'll give you a
     call and walk you through how to get the size and get you some oricing

CUSTOMER: ok hold on / 265 65 18 / just want something cheap and safe i dont
          need fancy

REP: Perfect man we've got a few options in stock starting at $159 per tire,
     nice looking tread pattern, M+S rated and ready to rock

CUSTOMER: ok whats that out the door / all 4 installed / and how long will it take

REP: Send me a good phone number for ya so I can add you to the system here
     and I will make you a full estimate for the four tires, installed out
     the door broken down and easy to read, then send it right here for
     you to review

CUSTOMER: bro i just need a price / im on the side of the road basically /
          can u just tell me the number / 403-555-0617 if u need it

REP: Sorry man I gotta make sure I'm giving you the best deal and right
     sizing and an estimate makes sure you get what you need and I don't
     make any mistakes or miss any last minutes deals for you
     Quick and easy either way my man, Heres the estimate out the door and
     taxes in!
     When can you make er in?

CUSTOMER: ok ya the price is fine / can i come right now / like in 20 min

REP: Let's make it happen, my name is Dayton, just come in and ask for me
     and I'll get you rolling ASAP

CUSTOMER: appreciate it man / heading over now / finally someone who picks
          up the damn phone lol
```

### Scenario 4: Jordan V. (Email, researched buyer with tight timeline)

Channel: Email, 2018 Ram 2500 Cummins with 6 inch BDS lift, wanting 24x14 Fuel Tritons with 37s.
Outcome: Closed at $8,998 (under Fountain's $9,200), with the Tritons at 4 weeks (vs Fountain's 6).

```
EMAIL FROM CUSTOMER:
> Need a quote on a wheel and tire package for my 2018 Ram 2500 Cummins.
> Already lifted with a 6 inch BDS. Want 24x14 Fuel Triton wheels with
> 37x13.50R24 tires. Need them aggressive, want a lot of poke.
> Got a quote from Fountain Tire for $9,200 installed last week but their
> lead time is 6 weeks. Need them in 2 weeks max, going to a show.
> What can you do?

REP: Hey Jordan, Dayton here, I'd be happy to help you out today!
     We can definitely make that work for you, here are a few 24x14 options
     we have in local warehouses we could have in the next 3-5 days
     Any of these options catch the eye?

EMAIL FROM CUSTOMER:
> Appreciate the fast reply. Honestly the Fuel Triton is what I want,
> that's the look I'm going for. Black milled. Don't really care about
> other options unless you can't get the Tritons.
> Can you do better than $9,200? Fountain quoted me at that price but I've
> heard you guys can usually match or beat.
> Also need to know if you'll handle the install or if I have to find a
> shop separately.

REP: Hey Jordan, I'm sure we can make it all work including the price,
     but I want to make sure we get you what you want, when you need it,
     before that.
     I can't possibly get the Tritons in by that timeline unless you or
     I drive to Tenesee ourselves, which I can't do unfortunately.
     We can get any of the above options in your timeline, or we can
     get you the Tritons in just over 4 weeks at a better price, but
     that's outside the timeline.
     What would work best for you?

EMAIL FROM CUSTOMER:
> Ha, fair enough on Tennessee. Honestly the show is what's driving the
> timeline. If I can't get the Tritons in time I'm not going to settle
> for something I don't actually want just to make the date. I'll wait
> the 4 weeks for the Tritons and skip the show.
> So lock in the Tritons for 4 weeks. What's the actual price out the
> door with install? And yes, need install handled.
> Also, my buddy runs 24x14 on his 2500 with 37s and a 6 inch lift and
> they rub on hard turns. Do I need to do any trimming or is your install
> going to handle that?

REP: For 37s with 14 wides we would definitely need to do some trimming
     to give you full turning, but we can make that happen for sure
     As for the install that's no problem, send me a good phone number
     for ya so I can add you to the system here and make you a full
     estimate with a nice breakdown, and send it here for you to review!

EMAIL FROM CUSTOMER:
> 403-555-0429. Send it over. Want to see the breakdown before I commit.
> If the price is right we lock it in today.

REP: Here is the full estimate for the entire package to get the truck
     show ready, let me now if you have any questions at all!
     If you want to get it rolling we just need a deposit
     You can send us an e transfer to [address], call in with a CC, or
     pop in and see us in person!
     (Estimate totals $8998)

EMAIL FROM CUSTOMER:
> Breakdown looks clean. Tell you what, knock it down to $8,500 and I'll
> send the deposit right now. That's still better than Fountain on price
> AND on timeline, and you'd be saving me from having to go anywhere else.
> Win-win.

REP: Glad the estimate looks good!
     As for the dollars, I gave you the best possible pricing I could
     with the extra shipping and duties to get the wheels for you as
     fast as possible so I really can't get any lower but if the $8998
     works for you, we can make it happen right away!

EMAIL FROM CUSTOMER:
> Fair enough. Sending the etransfer now. 4 weeks from today, I want
> install scheduled the day they land.
```

### Scenario 5: Kyle B. (Marketplace, tire kicker)

Same listing as Steve T. Customer is a price-only shopper who never gives vehicle info.
Outcome: Walked at $1,299 holding, no margin damage, no bridge burned.

```
CUSTOMER: still got the wheels

REP: Hey Kyle, Dayton here, I'd be happy to help you out today!
     We definitely have the wheels if you have the ride!
     What kind of vehicle are you thinking about putting some new wheels on?

CUSTOMER: what's the lowest u take / just askin

REP: We always give everyone the best possible price right away to save
     us all time, $1299 out the door on your vehicle, today!

CUSTOMER: 1000 cash today / got a buddy with a truck can pick up tonight

REP: I would love to make it happen today to get your vehicle looking
     sweet, what do you think about changing up the tire in the package
     to get you a better deal?

CUSTOMER: nah just want those tires / 1100 final offer cash tonight /
          ill take em as is

REP: We do have these guys ready to rock, but the best we can make it
     work for would be $1299
     Let me know if you want to make it happen!

CUSTOMER: lame / 1100 is fair these are used

REP: All our options are brand new, warranty and lifetime services included!
     When you get tires here, you get more than rubber

CUSTOMER: nah ill keep lookin / thanks tho
```

## Principles That Emerged From The Five Scenarios

These are the lessons that should anchor the trainer's scoring rubric:

| Principle | Demonstrated in | Why it matters |
|--|--|--|
| Fitment isn't yes/no, it's body-style dependent | Steve | Same wheel + lift on a different body = different outcome |
| Physical checks beat knowledge questions | Steve ("5 or 6 bolts?") | Keeps momentum on a customer who doesn't know specs |
| Lift upsell as a fitment solution, not a sales pitch | Steve | Different psychology, customer feels helped not sold to |
| Tire downgrade as the discount lever | Steve, Jordan | Protects margin on wheels, install, and lift |
| Pre-sell line items before showing price | Steve, all closes | "Wheels, tires, install, lugs, sensors, lift" frames value |
| "Best price right off the bat" is the standard rebuttal | Steve, Marcus, Kyle | Reframes the no without making customer feel bad |
| Tone matches emotional state, not channel | Steve curious, Tanya excited, Marcus pissed | Same intro, completely different energy after |
| Brand-led shoppers get product-first qualifying | Tanya | She named Toyo Open Country first, vehicle came second |
| Use-case beats specs in recommendations | Tanya ("he's a contractor → 10 ply") | Customer remembers the reasoning, not the spec |
| Personal context = timing question | Tanya (birthday) | Lets you book the install via the data they already have |
| Three payment paths standard | Steve, Tanya, Jordan | E-transfer / phone-in CC / in-person reduces friction |
| Never apologize in a way that admits fault | Marcus | "Store gets busy" not "sorry we missed your calls" |
| Calgary-warehouse connection as a real differentiator | Marcus | "We will have it either way" is a confidence statement competitors can't make |
| Hold the no-quote-in-chat rule under pressure | Marcus, Jordan, Tanya | The hardest discipline, the most important |
| Match close mechanic to urgency | Marcus walk-in vs Steve/Tanya/Jordan deposit-first | Rule is "match the close to urgency" not "always take deposit" |
| Researched customer needs validation, not redesign | Jordan | Don't rebuild his package, find the ONE thing he got wrong |
| Memorable phrasing beats accurate on bad news | Jordan ("drive to Tennessee") | Customer repeats the line to friends |
| Force-choice resolves competing customer needs | Jordan (Tritons OR timeline) | Customer reveals real priority when forced to choose |
| Customer-raised concerns are a gift | Jordan (mentioned rubbing himself) | Confirm-and-solve in one move |
| Beat competitor by 2-5%, not 20% | Jordan ($8,998 vs $9,200) | Builds trust instead of creating suspicion |
| Second discount ask is the real test | Jordan ($8,500 after estimate landed) | Hold with reason tied to value, close with forward path |
| Recognize the dodge | Kyle (dodged vehicle twice) | Real buyers engage with qualifying, kickers dodge |
| Hold listed price under three discount asks | Kyle ($1,000 → $1,100 → "fair these are used") | The margin discipline that pays for itself across hundreds of inquiries |
| Qualify out without burning the bridge | Kyle ("thanks tho") | He might come back in 48 hours. Damage nothing. |

## Margin Discipline Hierarchy

When pressured for a discount, Dayton protects in this order:

| Priority | What | Why |
|--|--|--|
| 1 | Wheel price | Highest margin item |
| 2 | Lift price | High-ticket, high-margin add-on |
| 3 | Install / labor fee | Pays for the technicians and the bay time |
| 4 | TPMS sensors / lug nuts | Small items, mostly cost recovery |
| 5 | Tire brand swap | The ONE acceptable lever |

If the customer needs to hit a price, the move is to swap to a cheaper SKU IN THE SAME SIZE that lives in our live inventory — name it exactly, never invent a brand+model. If no cheaper SKU exists in the customer's exact size, the move is to ask if they're open to a different size for a better price point. Never invent products. Never drop the install fee or wheel price.

## Tone Matching Across the Five Customers

| Customer | Their energy | Dayton's tone match |
|--|--|--|
| Steve | Curious, casual, late-night Marketplace | Casual, "man", "my man", "wicked", "sweet" |
| Tanya | Excited, light, gift-giving | Warm, matched her "lol", playful, complimentary |
| Marcus | Pissed, urgent, distrustful | Grounded, confident, "we got you", offered to call him personally |
| Jordan | Researched, formal, slightly arrogant | Validated his research, used humor on bad news, matched email formality |
| Kyle | Lowball, dismissive, dodgy | Polite but firm, no engagement past second ask, soft close |

## Closing Workflow (Hard Rules)

These are the non-negotiable elements of every close:

1. Phone number captured before any total dollar figure leaves the rep's keyboard
2. Estimate built in NetSuite, sent as a real document, not a chat-bubble total
3. Estimate pre-sold with line items mentioned in the chat before sending
4. Deposit ask follows the estimate, never the other way around
5. Three payment paths offered for any customer not arriving in the next 30 minutes:
   * E-transfer to [store address]
   * Phone in with credit card to [store number]
   * In person at the store
6. For walk-in urgent customers (driving over now), the install IS the deposit equivalent. The rep gives their name as the ask-for contact instead of taking payment.
7. No discount on the second ask. Hold price with a reason tied to the customer's stated priority (speed, value, fit) and close with a forward path.

## How To Use This Document

### In the v4 trainer

The five scenario transcripts above are the ground truth for what good looks like. When grading a rep's reply, compare against these moves:

* Did they introduce by name?
* Did they qualify before quoting?
* Did they pull a phone number before sending a total?
* Did they hold price under pressure with a real reason?
* Did they close with three payment paths (or a walk-in name-ask for urgent)?
* Did they match the customer's emotional tone?

### In live coaching

The Dayton Standard phrases above can be lifted directly as templates. Don't hand them to reps as scripts — hand them as patterns. The voice has to be their own, but the structure of "intro by name → qualify → reframe → close" is universal.

### In the AI customer (v4 LLM-driven)

When the v4 trainer's AI plays a customer, the customer should respond to these moves the way Steve, Tanya, Marcus, Jordan, and Kyle responded. The five transcripts are the calibration set. If the rep does what Dayton did, the AI customer should react like the original did. If the rep does something different, the AI customer should react in a way that's consistent with the personality dimensions plus the underlying lesson from the closest matching scenario.

## Cross-Reference With Sharp to Sticky

The Dayton Standard and the Sharp to Sticky framework agree on these points:

| Sharp to Sticky | Dayton Standard |
|--|--|
| Open with the standard | "Hey [Name], Dayton here" sets the professional baseline |
| Fact, no adjectives | Specific qualifying questions ("5 or 6 bolts") not vague ones |
| State the standard violated | "We give everyone the best price right off the bat" implies the standard |
| One sentence for why | "to save us all time" gives the reason without monologuing |
| Consequence stated once | The forward path ("let me know if you want to make it happen") is the consequence |
| Path forward, always | Three payment paths, alternative tire, lift option — always offers a next step |
| No "I want / I need" | Dayton never frames his needs, only the customer's path |
| No stacked adjectives | "Wicked", "sweet", "nice" used singly, not stacked |
| No "are we clear" | Never asks for compliance, asks for the next step |

## Maintainers

* User: Dayton Altwasser
* Role: Territory Manager, Canada Custom Autoworks
* Source conversations: 5 live roleplay sessions, May 12, 2026

This document is the canonical reference for the CCAW sales voice. Update it only when new patterns emerge from real conversations, not from theoretical best practices.
