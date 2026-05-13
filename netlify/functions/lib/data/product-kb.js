// Phase E.3 (review mode KB) — curated product knowledge base.
//
// Not exhaustive. Hand-picked products that come up in CCAW customer
// conversations often enough to warrant a calibrated, rep-vetted
// reputation read. When a customer in review-mode asks "are these any
// good?" about a product in this KB, the prompt injects the reputation
// read so the LLM can answer with honest tier framing instead of
// improvising.
//
// Out-of-KB products fall back to the existing review-mode punt
// ("haven't sold a ton of those, want me to grab specific reviews?").
//
// Each entry shape:
//   canonical_name    — full product name as Dayton would write it
//   aliases           — 2-4 customer-side phrasings (case-insensitive,
//                       matched as word-boundary substrings)
//   category          — 'tire' | 'wheel' | 'lift' | 'accessory'
//   tier              — 'value' | 'mid' | 'premium' | 'house_brand'
//   reputation_read   — { summary, strengths[], weaknesses[],
//                          good_fit_for, not_great_for } in Dayton voice
//   voice_strings     — { default, brief } — ready-to-use review replies
//
// Updates: when you sell a new product enough that customers ask about
// it by name, add an entry. When a product's positioning changes (price
// shifts tier, warranty changes), update reputation_read.

export const PRODUCT_KB = {
  // ────────────────────────────────────────────────────────────────
  // TIRES — value / house brand
  // ────────────────────────────────────────────────────────────────
  ilink_multimatch: {
    canonical_name: 'iLink MultiMatch (3PMS all-season)',
    aliases: ['ilink multimatch', 'ilink multi-match', 'multimatch', 'multi-match'],
    category: 'tire',
    tier: 'house_brand',
    reputation_read: {
      summary: "iLink is our in-house value brand. The MultiMatch is the 3PMS-rated all-season that handles year-round driving for daily commuters.",
      strengths: ['60K warranty covers most replacement cycles', '3PMS rated (winter capable)', 'great price for what you get'],
      weaknesses: ['compound is firmer than premium tires', 'less plush ride feel', "won't match Michelin for highway quiet"],
      good_fit_for: 'daily commuters, value-conscious buyers, second-set winters',
      not_great_for: 'customers chasing premium tire feel or aggressive driving'
    },
    voice_strings: {
      default: "Real talk, iLink is our in-house value brand. Customers who buy them for daily commuting are happy — the 60K warranty covers most people's replacement cycle anyway. Compound is firmer than premium so you'll feel that on rough roads, but for your use case they punch above their weight. Totally fine choice if you rotate yearly.",
      brief: "iLink is our house value brand, solid budget pick for daily driving."
    }
  },
  ilink_lzeal: {
    canonical_name: 'iLink L-Zeal 56',
    aliases: ['ilink l-zeal', 'ilink lzeal', 'l-zeal 56', 'lzeal'],
    category: 'tire',
    tier: 'house_brand',
    reputation_read: {
      summary: "iLink's higher-performance tier. L-Zeal 56 leans more sporty/touring than the MultiMatch.",
      strengths: ['better dry grip than MultiMatch', 'sportier compound', 'still value priced'],
      weaknesses: ['not 3PMS rated (summer/touring)', 'tread life shorter than touring premium options'],
      good_fit_for: 'cars wanting better grip without premium price',
      not_great_for: 'year-round driving in real winter'
    },
    voice_strings: {
      default: "L-Zeal is iLink's sportier tier. Better dry grip than the MultiMatch, still our value price. Catch is it's summer/touring, not 3PMS, so if you need winter capability look elsewhere.",
      brief: "L-Zeal is iLink's sporty tier — good grip, value priced, not for winter."
    }
  },

  suretrac_wide_climber_awt: {
    canonical_name: 'Suretrac Wide Climber AWT',
    aliases: ['suretrac awt', 'wide climber awt', 'suretrac all terrain', 'wide climber'],
    category: 'tire',
    tier: 'value',
    reputation_read: {
      summary: "Suretrac's smoother all-terrain. Workhorse value brand — tough enough for daily truck use, quiet enough for highway.",
      strengths: ['good highway manners for an AT', 'aggressive enough for light off-road', 'great value'],
      weaknesses: ['not as plush as premium AT options', 'tread life decent but not premium'],
      good_fit_for: 'daily-driven trucks doing occasional off-road',
      not_great_for: 'serious mudders or premium-feel chasers'
    },
    voice_strings: {
      default: "Suretrac is our workhorse value-tier brand. The Wide Climber AWT is the smoother all-terrain in their lineup — quiet enough for daily highway driving but still handles light off-road. For most trucks doing daily plus weekend dirt, it's a hard combo to beat at the price.",
      brief: "Suretrac AWT is value-tier AT, quiet on highway, decent off-road."
    }
  },
  suretrac_wide_climber_rt: {
    canonical_name: 'Suretrac Wide Climber R/T II',
    aliases: ['suretrac rt', 'wide climber rt', 'suretrac r/t', 'wide climber r/t'],
    category: 'tire',
    tier: 'value',
    reputation_read: {
      summary: "Suretrac's R/T — hybrid between all-terrain and mud-terrain. Aggressive look, capable off-road, value priced.",
      strengths: ['aggressive tread without going full M/T', 'good off-road grip', 'value pricing'],
      weaknesses: ['louder than AT on highway', 'less efficient than touring tires'],
      good_fit_for: 'trucks doing real off-road but also driven daily',
      not_great_for: 'pure highway commuter setups'
    },
    voice_strings: {
      default: "Wide Climber R/T II is Suretrac's hybrid — sits between AT and M/T. Aggressive look and grip without going full mud terrain. Daily driver who hits real dirt regularly, this is the sweet spot.",
      brief: "Suretrac R/T II is the AT/MT hybrid — aggressive but daily-drivable."
    }
  },
  suretrac_wide_climber_mt: {
    canonical_name: 'Suretrac Wide Climber M/T 2',
    aliases: ['suretrac mt', 'wide climber mt', 'suretrac mud', 'wide climber m/t'],
    category: 'tire',
    tier: 'value',
    reputation_read: {
      summary: "Suretrac's full mud-terrain. For trucks that actually see mud, rocks, and trails.",
      strengths: ['serious off-road grip', 'aggressive sidewall', 'value pricing for what you get'],
      weaknesses: ['highway noise (expected on any M/T)', 'shorter tread life on pavement'],
      good_fit_for: 'serious off-road trucks, occasional highway',
      not_great_for: 'primarily-highway daily drivers'
    },
    voice_strings: {
      default: "Wide Climber M/T 2 is Suretrac's full mud terrain. If you're hitting trails for real, this is built for it. Highway noise is what you'd expect on any M/T — that's the trade. For trucks that earn their keep off-road, hard to beat at the price.",
      brief: "Suretrac M/T 2 is value-tier mud terrain. Loud on highway, capable off-road."
    }
  },

  gladiator_x_comp_at: {
    canonical_name: 'Gladiator X Comp A/T',
    aliases: ['gladiator x comp', 'gladiator at', 'x comp a/t', 'x comp at'],
    category: 'tire',
    tier: 'value',
    reputation_read: {
      summary: "Value-tier all-terrain alternative to Suretrac. Comparable quality, slightly different look.",
      strengths: ['solid value', 'decent off-road grip', 'quieter than aggressive AT options'],
      weaknesses: ['less aggressive look than Wide Climber R/T', 'tread life mid-range'],
      good_fit_for: 'daily-driven trucks on a budget',
      not_great_for: 'customers wanting aggressive M/T look'
    },
    voice_strings: {
      default: "Gladiator X Comp A/T is in the same value-tier lane as the Suretrac AWT. Comparable quality, just a different style. Customers happy with daily-driver-on-a-budget framing.",
      brief: "Gladiator A/T is value-tier AT, similar to Suretrac AWT."
    }
  },
  gladiator_x_comp_ht: {
    canonical_name: 'Gladiator X Comp H/T ASII',
    aliases: ['gladiator ht', 'x comp ht', 'gladiator h/t', 'x comp h/t'],
    category: 'tire',
    tier: 'value',
    reputation_read: {
      summary: "Gladiator's highway-terrain — built for trucks that mostly cruise pavement.",
      strengths: ['quiet on highway', 'long tread life on road use', 'value priced'],
      weaknesses: ['not for off-road', 'not winter rated'],
      good_fit_for: 'highway commuter trucks',
      not_great_for: 'trucks doing dirt or winter driving'
    },
    voice_strings: {
      default: "Gladiator H/T is for trucks that live on pavement. Quiet, decent life, value priced. If you're hitting dirt though, step up to the X Comp A/T or look at the Suretrac AWT.",
      brief: "Gladiator H/T — value highway tire, pavement only."
    }
  },

  haida_hd869: {
    canonical_name: 'Haida HD869 M/T',
    aliases: ['haida', 'hd869', 'haida hd869'],
    category: 'tire',
    tier: 'value',
    reputation_read: {
      summary: "Value-tier M/T. Often where customers running 35+ on big wheels end up because options shrink at that size.",
      strengths: ['affordable big-tire option', 'aggressive look', 'available in sizes where premium brands aren\'t'],
      weaknesses: ['loud on highway', 'shorter tread life'],
      good_fit_for: 'big-tire builds on a budget, especially 24"+ wheels',
      not_great_for: 'premium-feel chasers'
    },
    voice_strings: {
      default: "Haida HD869 is honestly where a lot of big-tire builds end up. If you're running 35s on 24-inch wheels, your premium options shrink — Haida fills that gap at a value price. Loud on highway (any M/T is) but for the look + budget combo, it works.",
      brief: "Haida M/T — value-tier, big-tire fit when premium options run out."
    }
  },

  tesche_ridge_blade_xt: {
    canonical_name: 'Tesche Ridge Blade X/T',
    aliases: ['tesche', 'ridge blade', 'tesche xt', 'ridge blade xt'],
    category: 'tire',
    tier: 'value',
    reputation_read: {
      summary: "Value X/T (extreme terrain hybrid). Staggered shoulders, aggressive tread, year-round capable.",
      strengths: ['aggressive look', 'year-round driving', 'value pricing'],
      weaknesses: ['less brand recognition than Suretrac/Gladiator', 'tread life mid-range'],
      good_fit_for: 'trucks wanting aggressive look year-round on a budget',
      not_great_for: 'premium-tier shoppers'
    },
    voice_strings: {
      default: "Tesche Ridge Blade X/T is the extreme-terrain hybrid in the value lane. Staggered shoulders, aggressive tread, drives year-round. Less famous than Suretrac but for the look + price combo, customers are happy.",
      brief: "Tesche X/T — value extreme terrain, aggressive look, year-round."
    }
  },

  radar_angler_rst22: {
    canonical_name: 'Radar Angler RST-22 (trailer ST)',
    aliases: ['radar angler', 'rst-22', 'rst22', 'radar trailer'],
    category: 'tire',
    tier: 'value',
    reputation_read: {
      summary: "Standard trailer ST tire. Trailer use only — never run on a passenger vehicle.",
      strengths: ['load-rated for trailer use', 'value priced', 'reliable for the application'],
      weaknesses: ['ST rating means trailer-only, not for cars/trucks'],
      good_fit_for: 'travel trailers, RVs, utility trailers',
      not_great_for: 'anything that isn\'t a trailer'
    },
    voice_strings: {
      default: "Radar Angler RST-22 is a standard trailer ST tire — does the job for the application. Big thing to flag: ST tires are trailer-only, don't put them on a passenger truck or car.",
      brief: "Radar Angler — value-tier trailer ST tire. Trailer use only."
    }
  },

  // ────────────────────────────────────────────────────────────────
  // TIRES — mid tier
  // ────────────────────────────────────────────────────────────────
  bfgoodrich_trail_terrain: {
    canonical_name: 'BFGoodrich Trail-Terrain T/A',
    aliases: ['bfg trail terrain', 'trail-terrain', 'trail terrain ta', 'bfg trail-terrain'],
    category: 'tire',
    tier: 'mid',
    reputation_read: {
      summary: "Mid-tier all-terrain. Strong off-road grip, comfortable on pavement. Premium feel without Michelin price.",
      strengths: ['great off-road grip', 'comfortable on highway', 'BFGoodrich brand reputation', 'good tread life'],
      weaknesses: ['less highway-quiet than touring tires', 'mid-tier price (not budget)'],
      good_fit_for: 'trucks doing frequent outdoor trips, mixed-use ownership',
      not_great_for: 'pure highway commuters'
    },
    voice_strings: {
      default: "BFG Trail-Terrain is one of the best mid-tier ATs on the market. Strong off-road grip, comfortable on pavement, BFG name behind it. Costs more than Suretrac, less than Toyo or Michelin. Sweet spot for trucks doing weekend trips alongside daily driving.",
      brief: "BFG Trail-Terrain — mid-tier AT, premium feel without premium price."
    }
  },
  bfgoodrich_advantage_ta_sport: {
    canonical_name: 'BFGoodrich Advantage T/A Sport LT',
    aliases: ['bfg advantage', 'advantage ta sport', 'advantage t/a sport', 'bfg advantage ta'],
    category: 'tire',
    tier: 'mid',
    reputation_read: {
      summary: "Mid-tier touring all-season. Smooth ride, strong wet/dry traction, long life. Common $70 mail-in rebate.",
      strengths: ['smooth ride', 'strong wet/dry grip', 'long tread life', 'rebate sweetener'],
      weaknesses: ['not for serious off-road', 'mid-tier price'],
      good_fit_for: 'daily drivers wanting comfort + durability',
      not_great_for: 'off-road or aggressive sport driving'
    },
    voice_strings: {
      default: "Advantage T/A Sport LT is BFG's touring all-season. Smooth ride, strong grip wet and dry, long tread life. Usually a $70 mail-in rebate on these too. Great balance for daily driving on a truck or SUV.",
      brief: "BFG Advantage T/A Sport — mid touring, comfort + durability, rebate common."
    }
  },

  kanati_trail_hog: {
    canonical_name: 'Kanati Trail Hog A/T',
    aliases: ['kanati trail hog', 'trail hog', 'kanati at', 'kanati trailhog'],
    category: 'tire',
    tier: 'mid',
    reputation_read: {
      summary: "Mid-tier all-terrain with aggressive look. Customers like the visual without going full M/T.",
      strengths: ['aggressive tread without M/T noise compromise', 'good off-road grip', 'distinctive look'],
      weaknesses: ['louder than touring tires', 'tread life mid-range'],
      good_fit_for: 'trucks wanting aggressive look + decent off-road',
      not_great_for: 'customers wanting touring-quiet'
    },
    voice_strings: {
      default: "Kanati Trail Hog is mid-tier AT with the look people want — aggressive tread without going full mud terrain. Customers love how it looks on lifted trucks. Louder than touring tires but you're not getting a touring tire when you pick this.",
      brief: "Kanati Trail Hog — mid-tier AT, aggressive look, decent off-road."
    }
  },

  radar_renegade_rt: {
    canonical_name: 'Radar Renegade R/T+',
    aliases: ['radar renegade', 'renegade rt', 'radar rt', 'renegade r/t'],
    category: 'tire',
    tier: 'mid',
    reputation_read: {
      summary: "Mid-tier R/T. Common 24-inch+ option where premium R/T options thin out.",
      strengths: ['aggressive R/T look', 'available in big sizes (24"+)', 'mid-tier price'],
      weaknesses: ['less famous than BFG or Toyo', 'highway noise on aggressive sizes'],
      good_fit_for: 'big-wheel trucks needing R/T look',
      not_great_for: 'small-wheel daily drivers (better mid options exist)'
    },
    voice_strings: {
      default: "Radar Renegade R/T+ is one of the go-to options when you're on 24s or bigger. Premium R/T options shrink at those sizes, Radar fills the gap with a solid mid-tier product. Customers running big builds end up here a lot.",
      brief: "Radar Renegade R/T — mid-tier R/T, common 24\"+ option."
    }
  },
  arroyo_tamarock_rt: {
    canonical_name: 'Arroyo Tamarock R/T',
    aliases: ['arroyo tamarock', 'tamarock rt', 'arroyo rt', 'tamarock r/t'],
    category: 'tire',
    tier: 'mid',
    reputation_read: {
      summary: "Mid-tier R/T alternative to Radar Renegade. Same positioning, slightly different look.",
      strengths: ['aggressive R/T tread', 'available in big sizes', 'mid-tier price'],
      weaknesses: ['less name recognition', 'highway noise typical for R/T'],
      good_fit_for: 'big-wheel builds, R/T-look shoppers comparing options',
      not_great_for: 'shoppers wanting touring quiet'
    },
    voice_strings: {
      default: "Arroyo Tamarock R/T sits right next to the Radar Renegade in the mid-tier R/T lane. Same use case — big wheel builds wanting the aggressive look. Pick whichever style you like better.",
      brief: "Arroyo Tamarock R/T — mid R/T, alternative to Radar Renegade."
    }
  },

  uniroyal_tiger_paw: {
    canonical_name: 'Uniroyal Tiger Paw Touring A/S',
    aliases: ['uniroyal tiger paw', 'tiger paw', 'uniroyal touring'],
    category: 'tire',
    tier: 'mid',
    reputation_read: {
      summary: "Mid-tier touring all-season. 105K warranty. Common $50 mail-in rebate. Comfort + durability balance.",
      strengths: ['105K km warranty', 'quieter than budget tires', 'good wet traction', 'rebate sweetener'],
      weaknesses: ['not for trucks or off-road', 'not 3PMS / winter rated'],
      good_fit_for: 'sedans and crossovers doing highway commuting',
      not_great_for: 'winter conditions, off-road, performance driving'
    },
    voice_strings: {
      default: "Uniroyal Tiger Paw Touring A/S is mid-tier touring. 105K warranty, quieter than the value-tier options, $50 mail-in rebate usually on top. Great fit for daily commuter cars wanting comfort + tread life.",
      brief: "Tiger Paw — mid touring, 105K warranty, $50 rebate common."
    }
  },

  // ────────────────────────────────────────────────────────────────
  // TIRES — premium
  // ────────────────────────────────────────────────────────────────
  toyo_open_country_at3: {
    canonical_name: 'Toyo Open Country A/T III',
    aliases: ['toyo open country', 'open country at3', 'toyo at3', 'open country a/t iii', 'toyo at iii'],
    category: 'tire',
    tier: 'premium',
    reputation_read: {
      summary: "Premium all-terrain. 105K km warranty. Common $80 mail-in rebate. Worth it for long-haul ownership.",
      strengths: ['105K km warranty', 'quiet on highway for an AT', 'capable off-road', 'Toyo brand reliability'],
      weaknesses: ['premium price', 'overkill for occasional weekend trips'],
      good_fit_for: 'trucks driven hard and kept long',
      not_great_for: 'short-ownership buyers or pure pavement use'
    },
    voice_strings: {
      default: "Toyo Open Country A/T III is the premium pick in the AT lane. 105K warranty, quiet on highway for how aggressive it looks, capable off-road. $80 mail-in rebate common. If you keep your trucks long and use them hard, it pays for itself.",
      brief: "Toyo A/T III — premium AT, 105K warranty, $80 rebate common."
    }
  },
  toyo_celsius_ii: {
    canonical_name: 'Toyo Celsius II',
    aliases: ['toyo celsius', 'celsius ii', 'celsius 2', 'toyo celsius ii'],
    category: 'tire',
    tier: 'premium',
    reputation_read: {
      summary: "Premium all-weather touring. 95K km warranty. $80 mail-in rebate. Strong wet/winter grip, quiet ride.",
      strengths: ['95K warranty', 'strong winter traction', 'quieter than CrossClimate2', '3PMS rated'],
      weaknesses: ['premium price', 'slightly less aggressive in snow than CrossClimate2'],
      good_fit_for: 'year-round drivers wanting quiet comfort + winter capability',
      not_great_for: 'extreme winter conditions where dedicated snows win'
    },
    voice_strings: {
      default: "Toyo Celsius II is premium all-weather. 95K warranty, strong wet and winter grip, quieter than the CrossClimate2 if that matters to you. $80 mail-in rebate common. If you want year-round without swapping tires seasonally, top-tier choice.",
      brief: "Celsius II — premium all-weather, 95K warranty, $80 rebate."
    }
  },
  michelin_crossclimate2: {
    canonical_name: 'Michelin CrossClimate2',
    aliases: ['crossclimate', 'crossclimate2', 'crossclimate 2', 'michelin crossclimate', 'cross climate'],
    category: 'tire',
    tier: 'premium',
    reputation_read: {
      summary: "THE premium all-weather pick. 100K warranty. $100 mail-in rebate. Top-tier traction rain and snow.",
      strengths: ['100K km warranty', 'top-tier wet + snow traction', 'very quiet', 'long tread life', '3PMS rated'],
      weaknesses: ['premium price (you\'re paying for it)', 'overkill if you don\'t keep the car long'],
      good_fit_for: 'long-haul ownership, daily drivers who want one tire all year',
      not_great_for: 'short-flip cars or pure budget shoppers'
    },
    voice_strings: {
      default: "Honestly the CrossClimate2 is the premium pick in the all-weather lane. 100K warranty, super quiet, top-tier traction rain and snow. $100 mail-in rebate usually. You're paying for the longevity and the comfort — worth it if you keep your cars long, less worth it if you're flipping in 3 years.",
      brief: "CrossClimate2 — premium all-weather, 100K, top tier. Worth it for long-haul."
    }
  },
  michelin_pilot_sport_as4: {
    canonical_name: 'Michelin Pilot Sport A/S 4',
    aliases: ['pilot sport as4', 'pilot sport a/s 4', 'michelin pilot sport', 'ps a/s 4'],
    category: 'tire',
    tier: 'premium',
    reputation_read: {
      summary: "Premium ultra-high-performance all-season. 70K warranty. $100 mail-in rebate. Exceptional grip + year-round.",
      strengths: ['exceptional dry + wet grip', 'year-round capability', 'long life for UHP tier', 'rebate sweetener'],
      weaknesses: ['premium price', 'overkill for non-performance vehicles', 'less winter capable than dedicated snow'],
      good_fit_for: 'performance car owners wanting one-tire year-round',
      not_great_for: 'family sedans or budget shoppers'
    },
    voice_strings: {
      default: "Pilot Sport A/S 4 is premium ultra high performance all-season. If you've got a performance car and want one tire that does sporty driving plus year-round, this is the call. 70K warranty for a UHP tire is solid, $100 rebate usually on top.",
      brief: "Pilot Sport A/S 4 — premium UHP all-season, performance car pick."
    }
  },

  // ────────────────────────────────────────────────────────────────
  // WHEELS — Armed (CCAW house brand)
  // ────────────────────────────────────────────────────────────────
  armed_infantry: {
    canonical_name: 'Armed Offroad Infantry',
    aliases: ['armed infantry', 'infantry', 'armed offroad infantry'],
    category: 'wheel',
    tier: 'house_brand',
    reputation_read: {
      summary: "Armed Infantry — clean truck wheel look in our house lineup. Best price-to-style ratio for the clean concave style.",
      strengths: ['clean style without going aggressive', 'house brand pricing', 'wide width / offset options'],
      weaknesses: ['less aggressive than Carnage or Havoc'],
      good_fit_for: 'trucks wanting clean modern look',
      not_great_for: 'aggressive lifted-truck builds'
    },
    voice_strings: {
      default: "Armed Infantry is our house wheel — clean style, good price, lots of size options. If you want modern truck look without going super aggressive, this is the move.",
      brief: "Armed Infantry — clean house-brand truck wheel."
    }
  },
  armed_carnage: {
    canonical_name: 'Armed Offroad Carnage',
    aliases: ['armed carnage', 'carnage', 'armed offroad carnage'],
    category: 'wheel',
    tier: 'house_brand',
    reputation_read: {
      summary: "Armed Carnage — aggressive style with red accent options. Stands out in the Armed lineup.",
      strengths: ['aggressive look', 'red accent option', 'house brand pricing'],
      weaknesses: ['accent color isn\'t for everyone'],
      good_fit_for: 'trucks wanting bold style + accent color pop',
      not_great_for: 'subtle / clean style preferences'
    },
    voice_strings: {
      default: "Armed Carnage is one of the meanest in our Armed lineup — aggressive style, red accent option if you want the pop. House brand price for the look.",
      brief: "Armed Carnage — aggressive house wheel with red accent option."
    }
  },
  armed_havoc: {
    canonical_name: 'Armed Offroad Havoc',
    aliases: ['armed havoc', 'havoc', 'armed offroad havoc'],
    category: 'wheel',
    tier: 'house_brand',
    reputation_read: {
      summary: "Armed Havoc — gloss black milled accents. Popular Armed pick for trucks wanting milled detail.",
      strengths: ['gloss black with milled accents', 'house brand pricing', 'popular Armed silhouette'],
      weaknesses: ['milled accents need occasional cleaning'],
      good_fit_for: 'trucks wanting detailed wheel finish without premium brand price',
      not_great_for: 'monochrome / no-contrast preferences'
    },
    voice_strings: {
      default: "Armed Havoc is our gloss-black-with-milled-accents option. Stands out on a clean truck without being loud. House brand price.",
      brief: "Armed Havoc — gloss black milled, house brand."
    }
  },
  armed_spear: {
    canonical_name: 'Armed Offroad Spear',
    aliases: ['armed spear', 'spear', 'armed offroad spear'],
    category: 'wheel',
    tier: 'house_brand',
    reputation_read: {
      summary: "Armed Spear — multi-color finish options. Most customizable look in the Armed lineup.",
      strengths: ['multi-color options', 'distinctive style', 'house brand pricing'],
      weaknesses: ['multi-color isn\'t every customer\'s taste'],
      good_fit_for: 'custom builds wanting unique color combos',
      not_great_for: 'stock / understated builds'
    },
    voice_strings: {
      default: "Armed Spear lets you go multi-color — most customizable in the Armed lineup. Good fit if you've got a vision for the build and want the wheel to match.",
      brief: "Armed Spear — multi-color Armed option."
    }
  },
  armed_assassin: {
    canonical_name: 'Armed Offroad Assassin',
    aliases: ['armed assassin', 'assassin', 'armed offroad assassin'],
    category: 'wheel',
    tier: 'house_brand',
    reputation_read: {
      summary: "Armed Assassin — sharp aggressive design in our house lineup.",
      strengths: ['aggressive sharp lines', 'house brand pricing'],
      weaknesses: ['style is polarizing'],
      good_fit_for: 'aggressive lifted-truck builds',
      not_great_for: 'understated/clean preferences'
    },
    voice_strings: {
      default: "Armed Assassin is sharp and aggressive — strong choice if you want the wheel to look mean on a lifted truck.",
      brief: "Armed Assassin — sharp aggressive house wheel."
    }
  },
  armed_militia: {
    canonical_name: 'Armed Offroad Militia',
    aliases: ['armed militia', 'militia', 'armed offroad militia'],
    category: 'wheel',
    tier: 'house_brand',
    reputation_read: {
      summary: "Armed Militia — tactical/utilitarian style in the Armed lineup.",
      strengths: ['tough utilitarian look', 'house brand pricing'],
      weaknesses: ['less flashy than Carnage or Spear'],
      good_fit_for: 'work trucks or utilitarian builds',
      not_great_for: 'show-truck builds wanting flash'
    },
    voice_strings: {
      default: "Armed Militia is the tactical/utilitarian look in our house lineup. Strong fit for work trucks or builds that want function-first style.",
      brief: "Armed Militia — utilitarian house wheel."
    }
  },
  armed_contra: {
    canonical_name: 'Armed Offroad Contra',
    aliases: ['armed contra', 'contra', 'armed offroad contra'],
    category: 'wheel',
    tier: 'house_brand',
    reputation_read: {
      summary: "Armed Contra — concave deep-dish look in our house lineup.",
      strengths: ['deep concave style', 'house brand pricing'],
      weaknesses: ['concave look isn\'t for every truck'],
      good_fit_for: 'lifted trucks wanting deep wheel depth',
      not_great_for: 'flush / clean style preferences'
    },
    voice_strings: {
      default: "Armed Contra is the deep-concave look — wheels really pop on a lifted truck. House brand price for that style.",
      brief: "Armed Contra — concave house wheel."
    }
  },
  armed_force: {
    canonical_name: 'Armed Offroad Force',
    aliases: ['armed force', 'armed offroad force'],
    category: 'wheel',
    tier: 'house_brand',
    reputation_read: {
      summary: "Armed Force — strong classic-aggressive style in the Armed lineup.",
      strengths: ['versatile aggressive look', 'house brand pricing'],
      weaknesses: ['fewer flash variants than Spear'],
      good_fit_for: 'trucks wanting reliable aggressive look',
      not_great_for: 'unique color combo seekers'
    },
    voice_strings: {
      default: "Armed Force is a strong classic-aggressive look in our house lineup. Solid choice if you want reliable mean truck wheel style.",
      brief: "Armed Force — classic aggressive house wheel."
    }
  },
  armed_maverick: {
    canonical_name: 'Armed Offroad Maverick',
    aliases: ['armed maverick', 'maverick', 'armed offroad maverick'],
    category: 'wheel',
    tier: 'house_brand',
    reputation_read: {
      summary: "Armed Maverick — alternative spoke design in the house lineup, breaks from the standard concave look.",
      strengths: ['unique spoke pattern', 'stands out from typical truck wheel styles'],
      weaknesses: ['less aggressive than Carnage / Assassin'],
      good_fit_for: 'builds wanting non-standard wheel silhouette',
      not_great_for: 'classic aggressive lifted-truck look'
    },
    voice_strings: {
      default: "Armed Maverick is the alternative-style option in our Armed lineup. Different spoke pattern from the typical truck wheel — good if you want something that stands out without being loud.",
      brief: "Armed Maverick — alternative-style house wheel."
    }
  },
  armed_sniper: {
    canonical_name: 'Armed Offroad Sniper',
    aliases: ['armed sniper', 'sniper', 'armed offroad sniper'],
    category: 'wheel',
    tier: 'house_brand',
    reputation_read: {
      summary: "Armed Sniper — sleek modern style in the house lineup.",
      strengths: ['sleek modern look', 'house brand pricing'],
      weaknesses: ['less aggressive feel than Carnage / Assassin'],
      good_fit_for: 'modern trucks wanting clean sleek style',
      not_great_for: 'aggressive lifted builds'
    },
    voice_strings: {
      default: "Armed Sniper is sleek and modern — good fit for newer trucks where you want clean style instead of going full aggressive.",
      brief: "Armed Sniper — sleek modern house wheel."
    }
  },
  armed_stealth: {
    canonical_name: 'Armed Offroad Stealth',
    aliases: ['armed stealth', 'stealth', 'armed offroad stealth'],
    category: 'wheel',
    tier: 'house_brand',
    reputation_read: {
      summary: "Armed Stealth — low-key understated style in the house lineup. The opposite end of the Armed spectrum from Carnage.",
      strengths: ['understated look', 'house brand pricing', 'works on clean / stock-look builds'],
      weaknesses: ['won\'t pop in a sea of aggressive wheels'],
      good_fit_for: 'clean / stock-look builds, trucks wanting subtle upgrade',
      not_great_for: 'show-truck or aggressive-style builds'
    },
    voice_strings: {
      default: "Armed Stealth is the low-key option — clean understated style. Good if you don't want the wheels to scream at people. House brand price.",
      brief: "Armed Stealth — low-key understated house wheel."
    }
  },

  // ────────────────────────────────────────────────────────────────
  // WHEELS — mid tier
  // ────────────────────────────────────────────────────────────────
  fuel_blitz: {
    canonical_name: 'Fuel Blitz',
    aliases: ['fuel blitz', 'fuel offroad blitz', 'blitz wheel'],
    category: 'wheel',
    tier: 'mid',
    reputation_read: {
      summary: "Fuel's Blitz — popular truck wheel from a name-brand wheel co. Style is the draw. Fitment can be tight in some sizes.",
      strengths: ['Fuel brand recognition', 'aggressive style', 'good resale value'],
      weaknesses: ['size availability not as wide as house brands (some widths only in certain bolt patterns)', 'pricier than Armed'],
      good_fit_for: 'customers who specifically ask for Fuel',
      not_great_for: 'shoppers open to house brand for better price-to-style'
    },
    voice_strings: {
      default: "Fuel Blitz is one of their most popular models — known brand, aggressive look. Heads up though, sizing isn't as flexible as some — sometimes the wide widths aren't available in every bolt pattern. If you've got a specific size in mind, let me check stock first.",
      brief: "Fuel Blitz — popular mid-tier wheel, check size availability."
    }
  },
  element_wheel: {
    canonical_name: 'Element (wheel brand)',
    aliases: ['element wheel', 'element wheels'],
    category: 'wheel',
    tier: 'value',
    reputation_read: {
      summary: "Element — value-tier wheel brand. Honest budget option for cost-conscious builds.",
      strengths: ['budget price', 'decent style range'],
      weaknesses: ['less brand recognition', 'fewer aggressive style options'],
      good_fit_for: 'budget-first wheel buyers',
      not_great_for: 'style-first shoppers'
    },
    voice_strings: {
      default: "Element is a value-tier wheel brand. If budget is the main driver, they get the job done. For better style options at a similar price, check our Armed lineup.",
      brief: "Element — value-tier wheel brand, budget option."
    }
  },

  // ────────────────────────────────────────────────────────────────
  // LIFT / SUSPENSION
  // ────────────────────────────────────────────────────────────────
  rough_country_lift: {
    canonical_name: 'Rough Country lift kits',
    aliases: ['rough country lift', 'rough country kit', 'rough country'],
    category: 'lift',
    tier: 'value',
    reputation_read: {
      summary: "Value-tier lift brand. Most popular budget option. Industry workhorse — solid for street trucks doing mild off-road.",
      strengths: ['popular brand with lots of fitment options', 'good customer support', 'value pricing'],
      weaknesses: ['not premium ride feel', 'not built for hardcore off-road abuse'],
      good_fit_for: 'street trucks, daily-driver lifts, mild off-road',
      not_great_for: 'serious off-road or 35"+ tire on hard trails'
    },
    voice_strings: {
      default: "Rough Country is the most popular value-tier lift brand. Industry workhorse — tons of fitment options, good support, fair price. Solid for street trucks doing mild off-road. If you're doing serious trail abuse or going 35\"+ regularly, look at BDS or Icon.",
      brief: "Rough Country — value-tier lift, popular workhorse brand."
    }
  },
  rough_country_level: {
    canonical_name: 'Rough Country leveling kits',
    aliases: ['rough country leveling', 'rough country level kit', 'rough country level'],
    category: 'lift',
    tier: 'value',
    reputation_read: {
      summary: "Rough Country leveling kit — cheap entry into the leveled-truck look.",
      strengths: ['affordable', 'easy install', 'good for stock look upgrade'],
      weaknesses: ['just a level, no real lift travel benefit'],
      good_fit_for: 'trucks wanting front-end level for stance',
      not_great_for: 'trucks needing actual lift travel or off-road clearance'
    },
    voice_strings: {
      default: "Rough Country leveling kit is the cheap entry point if you just want the front leveled for stance. Easy install, fair price. If you want actual lift travel or off-road clearance, step up to a real lift kit.",
      brief: "Rough Country leveling — cheap leveling for stance."
    }
  },
  bds_lift: {
    canonical_name: 'BDS Suspension lift kits',
    aliases: ['bds lift', 'bds suspension', 'bds kit'],
    category: 'lift',
    tier: 'premium',
    reputation_read: {
      summary: "Premium lift brand. Built for serious off-road. Pricier than Rough Country, worth it for trucks actually doing hard off-road.",
      strengths: ['serious off-road durability', 'better ride feel than value brands', 'great for 35\"+ tire builds'],
      weaknesses: ['premium price'],
      good_fit_for: 'trucks doing real off-road, 35+ tire builds, enthusiast owners',
      not_great_for: 'street-only trucks (overkill)'
    },
    voice_strings: {
      default: "BDS is one of the premium lift brands. Built for serious off-road — better travel, better damping, lasts longer under abuse. Pricier than Rough Country but worth it if you're actually using the truck off-road or running 35\"+ regularly.",
      brief: "BDS — premium lift, built for serious off-road."
    }
  },
  zone_offroad: {
    canonical_name: 'Zone Offroad lift kits',
    aliases: ['zone offroad', 'zone lift', 'zone kit'],
    category: 'lift',
    tier: 'mid',
    reputation_read: {
      summary: "Mid-tier lift brand. Step up from Rough Country, step below BDS / Icon.",
      strengths: ['better ride feel than Rough Country', 'good fitment options', 'mid-tier price'],
      weaknesses: ['less premium than BDS', 'less serious off-road than enthusiast brands'],
      good_fit_for: 'mixed-use trucks (daily + occasional trail)',
      not_great_for: 'extreme off-road or absolute budget builds'
    },
    voice_strings: {
      default: "Zone Offroad sits in the mid-tier lift lane. Better ride feel than Rough Country, less than BDS. Good fit for trucks that do daily driving plus the occasional trail.",
      brief: "Zone Offroad — mid-tier lift, mixed-use sweet spot."
    }
  },
  readylift: {
    canonical_name: 'ReadyLift leveling kits',
    aliases: ['readylift', 'ready lift', 'readylift level'],
    category: 'lift',
    tier: 'mid',
    reputation_read: {
      summary: "Mid-tier leveling brand. Better quality than Rough Country leveling, still budget-friendly.",
      strengths: ['better build than value brands', 'good fitment range', 'fair price'],
      weaknesses: ['just leveling, not a full lift'],
      good_fit_for: 'trucks wanting solid front level + stance',
      not_great_for: 'trucks needing actual lift'
    },
    voice_strings: {
      default: "ReadyLift is mid-tier leveling — better quality than the bargain options without going premium. Good fit if you want a solid level for stance and don't need full lift travel.",
      brief: "ReadyLift — mid-tier leveling, solid quality at fair price."
    }
  },
  carli_suspension: {
    canonical_name: 'Carli Suspension',
    aliases: ['carli suspension', 'carli', 'carli kit'],
    category: 'lift',
    tier: 'premium',
    reputation_read: {
      summary: "Premium-premium specialty lift brand. Built for heavy-duty trucks (Power Wagon, F250/350 style). Enthusiast tier.",
      strengths: ['top-tier ride feel + travel', 'engineered for HD trucks specifically', 'enthusiast reputation'],
      weaknesses: ['premium-premium price', 'overkill for non-HD or street use'],
      good_fit_for: 'HD truck owners (2500/3500/Power Wagon) doing real work or enthusiast builds',
      not_great_for: 'half-ton trucks or street-only setups'
    },
    voice_strings: {
      default: "Carli is the specialty brand for heavy-duty trucks — Power Wagons, F-350s, that crowd. Premium-premium pricing but the ride quality and engineering are top tier. If you're asking about Carli you usually already know what you want.",
      brief: "Carli — premium-premium HD truck suspension, enthusiast tier."
    }
  },
  icon_vehicle_dynamics: {
    canonical_name: 'Icon Vehicle Dynamics',
    aliases: ['icon vehicle dynamics', 'icon suspension', 'icon kit', 'icon lift'],
    category: 'lift',
    tier: 'premium',
    reputation_read: {
      summary: "Premium lift brand. Similar positioning to BDS. Tuned for off-road performance.",
      strengths: ['top-tier off-road performance tuning', 'great damping', 'enthusiast credibility'],
      weaknesses: ['premium price'],
      good_fit_for: 'trucks doing real off-road, enthusiast performance builds',
      not_great_for: 'street-only or value-first shoppers'
    },
    voice_strings: {
      default: "Icon is right there with BDS in the premium lift lane. Tuned specifically for off-road performance, damping is exceptional. Premium price — worth it if you're using the truck for what these brands are built for.",
      brief: "Icon — premium lift, tuned for off-road performance."
    }
  },
  bc_racing_coilovers: {
    canonical_name: 'BC Racing coilovers',
    aliases: ['bc racing', 'bc racing coilovers', 'bc coilovers', 'bcracing'],
    category: 'lift',
    tier: 'mid',
    reputation_read: {
      summary: "Mid-tier coilovers for street cars and sport sedans. Common Rev9 alternative when customers ask for that (which we don't carry).",
      strengths: ['adjustable damping', 'wide fitment range for street cars', 'fair price for the feature set'],
      weaknesses: ['not for trucks or off-road', 'enthusiast install / dial-in required'],
      good_fit_for: 'street cars, sport sedans, tuner builds',
      not_great_for: 'trucks, off-road, daily-driver-and-forget-it setups'
    },
    voice_strings: {
      default: "BC Racing is solid mid-tier coilovers for street cars. Adjustable damping, fits most sport sedans and tuner platforms. Good middle ground — not cheap, not super-premium, dial them in and they perform.",
      brief: "BC Racing — mid-tier street coilovers, common Rev9 alternative."
    }
  },
  ksport_coilovers: {
    canonical_name: 'KSport coilovers',
    aliases: ['ksport', 'ksport coilovers', 'k sport', 'k-sport'],
    category: 'lift',
    tier: 'mid',
    reputation_read: {
      summary: "Mid-tier coilovers, alternative to BC Racing. Same use case — street cars and sport sedans.",
      strengths: ['adjustable damping', 'fitment range', 'mid-tier pricing'],
      weaknesses: ['not for trucks or off-road', 'requires dial-in'],
      good_fit_for: 'street cars, sport sedans',
      not_great_for: 'trucks, off-road use'
    },
    voice_strings: {
      default: "KSport sits right next to BC Racing in the mid-tier coilover lane. Same use case, slightly different feel. Pick whichever has better fitment for your specific car.",
      brief: "KSport — mid coilovers, alternative to BC Racing."
    }
  }
};

// ── Alias index ────────────────────────────────────────────────────
//
// Built once at module load. Maps lowercased alias → product slug.
// Longest aliases match first so "armed offroad infantry" wins over
// "infantry" alone when both are present in the message.

const ALL_ALIAS_ENTRIES = (() => {
  const entries = [];
  for (const [slug, entry] of Object.entries(PRODUCT_KB)) {
    if (!Array.isArray(entry.aliases)) continue;
    for (const alias of entry.aliases) {
      const norm = alias.toLowerCase().trim();
      if (norm) entries.push({ alias: norm, slug });
    }
  }
  // Longest first so longer phrases preempt their substrings on match.
  entries.sort((a, b) => b.alias.length - a.alias.length);
  return entries;
})();

// Match a single alias against text using a word-boundary regex. Returns
// the matching slug + alias, or null.
function escapeForRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findKbProductInText(text) {
  if (typeof text !== 'string' || !text) return null;
  for (const { alias, slug } of ALL_ALIAS_ENTRIES) {
    const re = new RegExp('\\b' + escapeForRegex(alias) + '\\b', 'i');
    if (re.test(text)) {
      return { slug, alias_matched: alias, entry: PRODUCT_KB[slug] };
    }
  }
  return null;
}

// Convenience: scan a list of text blobs (current message + recent rep
// messages) and return the first match. Walks in the order given —
// pass current message FIRST so it wins when both customer and rep
// mention different products.
export function findKbProductInTexts(texts) {
  if (!Array.isArray(texts)) return null;
  for (const t of texts) {
    const m = findKbProductInText(t);
    if (m) return m;
  }
  return null;
}
