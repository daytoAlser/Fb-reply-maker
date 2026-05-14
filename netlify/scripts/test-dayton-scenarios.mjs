// Ad-hoc test harness: fires THE_DAYTON_STANDARD scenario openers through the
// real handler and prints the generated variants for inspection. No supabase
// sync because thread_id is omitted.
//
// Run with:
//   cd netlify
//   node --env-file=.env scripts/test-dayton-scenarios.mjs [scenarioName]
//
// scenarioName (optional): steve | tanya | marcus | jordan | kyle | kyle-dodge
//   omit to run all.

import { handler } from '../functions/generate-reply.js';

const scenarios = {
  steve: {
    label: 'Steve T. (Marketplace, Ram fitment + lift upsell)',
    expect: 'casual + "man"/"for sure", vehicle-first qualifying, no tire size ask',
    body: {
      message: 'hey is this still available',
      context: 'Facebook Marketplace inquiry on 20" Fuel wheels with 35" Nitto Trail Grappler tires, $1299 Calgary listing.',
      partnerName: 'Steve Thompson',
      userName: 'Dayton',
      listingTitle: '20 inch Fuel wheels with 35 inch Nitto Trail Grappler tires - $1299 Calgary',
      location: 'Calgary',
      conversation_history: []
    }
  },
  tanya: {
    label: 'Tanya R. (FB DM, gift buyer, brand-led)',
    expect: 'product-first qualifying (size before vehicle), warm/playful, brand_led customerType',
    body: {
      message: 'hi do u guys carry toyo open country at3 / looking for a set of 4',
      context: 'FB DM. Customer opens by naming the tire brand and model, not the vehicle.',
      partnerName: 'Tanya Reynolds',
      userName: 'Dayton',
      listingTitle: '',
      location: 'Calgary',
      conversation_history: []
    }
  },
  marcus: {
    label: 'Marcus L. (FB DM, urgent blown tire)',
    expect: 'grounded/confident not apologetic, "store gets busy" reframe, urgent customerType',
    body: {
      message: 'are u guys actually open / called the calgary store 3 times no answer / need 4 tires asap',
      context: 'FB DM. Customer mentions missed calls and urgency.',
      partnerName: 'Marcus Lee',
      userName: 'Dayton',
      listingTitle: '',
      location: 'Calgary',
      conversation_history: []
    }
  },
  jordan: {
    label: 'Jordan V. (Email, researched buyer)',
    expect: 'formal full sentences, no "man"/"my man", validate research, researched customerType',
    body: {
      message: 'Need a quote on a wheel and tire package for my 2018 Ram 2500 Cummins. Already lifted with a 6 inch BDS. Want 24x14 Fuel Triton wheels with 37x13.50R24 tires. Need them aggressive, want a lot of poke. Got a quote from Fountain Tire for $9,200 installed last week but their lead time is 6 weeks. Need them in 2 weeks max, going to a show. What can you do?',
      context: 'Email inquiry. Customer is researched, names competitor + price + timeline.',
      partnerName: 'Jordan Vasquez',
      userName: 'Dayton',
      listingTitle: '',
      location: 'Calgary',
      conversation_history: []
    }
  },
  kyle: {
    label: 'Kyle B. (Marketplace, tire kicker - 1st message)',
    expect: 'casual opener with vehicle qualifying question, NOT yet flagged tire_kicker',
    body: {
      message: 'still got the wheels',
      context: 'Facebook Marketplace inquiry on the same listing as Steve.',
      partnerName: 'Kyle Bennett',
      userName: 'Dayton',
      listingTitle: '20 inch Fuel wheels with 35 inch Nitto Trail Grappler tires - $1299 Calgary',
      location: 'Calgary',
      conversation_history: []
    }
  },
  'tanya-turn2': {
    label: 'Tanya turn 2 (size + personal context drop)',
    expect: 'should reach for personal-context timing hook (birthday) and/or confirm-and-extend on size',
    body: {
      message: '275 60 20 / for my husbands truck birthday gift lol',
      context: 'FB DM continuation. Customer dropped size + personal detail (husband + birthday).',
      partnerName: 'Tanya Reynolds',
      userName: 'Dayton',
      listingTitle: '',
      location: 'Calgary',
      conversation_history: [
        { role: 'customer', content: 'hi do u guys carry toyo open country at3 / looking for a set of 4' },
        { role: 'rep', content: "Hey @Tanya, Dayton here, I'd be happy to help you out today! We definitely carry Toyo, what size were you on the hunt for?" }
      ]
    }
  },
  'jordan-rubbing': {
    label: 'Jordan turn 3 (raises non-fitment + fitment concerns + install ask)',
    expect: 'should confirm-and-solve the install/timing parts in one move; fitment (rubbing) still gets the flag-driven holding reply',
    body: {
      message: "My buddy runs 24x14 on his 2500 with 37s and they rub on hard turns. Need to know if I have to do any trimming. Also, do you handle the install or do I need to find a shop separately?",
      context: 'Email continuation. Customer is researched and asking two distinct concerns at once.',
      partnerName: 'Jordan Vasquez',
      userName: 'Dayton',
      listingTitle: '',
      location: 'Calgary',
      conversation_history: [
        { role: 'customer', content: 'Need a quote on a wheel and tire package for my 2018 Ram 2500 Cummins. Already lifted with a 6 inch BDS. Want 24x14 Fuel Triton wheels with 37x13.50R24 tires.' },
        { role: 'rep', content: "Hey @Jordan, Dayton here. We can definitely make that work for you, here are a few 24x14 options we have in local warehouses we could have in the next 3-5 days. Any of these options catch the eye?" },
        { role: 'customer', content: "Appreciate the fast reply. Honestly the Fuel Triton is what I want, that's the look I'm going for. Black milled. Can you do better than Fountain's $9,200?" },
        { role: 'rep', content: "Hey Jordan, I'm sure we can make it all work including the price, but I want to make sure we get you what you want, when you need it. We can get the Tritons in just over 4 weeks at a better price than Fountain. What would work best for you?" }
      ]
    }
  },
  'kyle-dodge': {
    label: 'Kyle B. (after 2nd dodge — should NOT push for vehicle 3rd time)',
    expect: 'soft-close, no third qualifying push, "let me know if you want to make it happen" register',
    body: {
      message: 'nah just want those tires / 1100 final offer cash tonight / ill take em as is',
      context: 'Facebook Marketplace inquiry. Customer has dodged the vehicle question twice and is anchoring at $1100 cash.',
      partnerName: 'Kyle Bennett',
      userName: 'Dayton',
      listingTitle: '20 inch Fuel wheels with 35 inch Nitto Trail Grappler tires - $1299 Calgary',
      location: 'Calgary',
      conversation_history: [
        { role: 'customer', content: 'still got the wheels' },
        { role: 'rep', content: "Hey Kyle, Dayton here, I'd be happy to help you out today! We definitely have the wheels if you have the ride! What kind of vehicle are you thinking about putting some new wheels on?" },
        { role: 'customer', content: "what's the lowest u take / just askin" },
        { role: 'rep', content: 'We always give everyone the best possible price right away to save us all time, $1299 out the door on your vehicle, today!' },
        { role: 'customer', content: '1000 cash today / got a buddy with a truck can pick up tonight' },
        { role: 'rep', content: 'I would love to make it happen today to get your vehicle looking sweet, what do you think about changing up the tire in the package to get you a better deal?' }
      ]
    }
  }
};

function makeEvent(body) {
  return {
    httpMethod: 'POST',
    headers: { 'x-api-secret': process.env.SHARED_SECRET, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  };
}

async function runOne(name) {
  const sc = scenarios[name];
  if (!sc) { console.error(`unknown scenario: ${name}`); return; }
  console.log(`\n${'='.repeat(80)}`);
  console.log(`SCENARIO: ${name} — ${sc.label}`);
  console.log(`EXPECT  : ${sc.expect}`);
  console.log(`OPENER  : ${sc.body.message.slice(0, 140)}${sc.body.message.length > 140 ? '...' : ''}`);
  console.log('-'.repeat(80));

  const res = await handler(makeEvent(sc.body));
  if (res.statusCode !== 200) {
    console.log(`FAIL statusCode=${res.statusCode} body=${res.body}`);
    return;
  }
  const parsed = JSON.parse(res.body);
  console.log(`flags          : ${JSON.stringify(parsed.flags)}`);
  console.log(`customerType   : ${parsed.extracted_fields?.customerType}`);
  console.log(`ad_type        : ${parsed.ad_type}`);
  console.log(`stage          : ${parsed.conversation_stage}`);
  console.log(`status         : ${parsed.lead_status_suggestion}`);
  console.log('');
  for (const variant of ['quick', 'standard', 'detailed']) {
    console.log(`--- ${variant.toUpperCase()} ---`);
    console.log(parsed.variants?.[variant] || '(missing)');
    console.log('');
  }
}

const only = process.argv[2];
const targets = only ? [only] : Object.keys(scenarios);
for (const t of targets) {
  try { await runOne(t); }
  catch (err) { console.error(`scenario ${t} threw:`, err); }
}
