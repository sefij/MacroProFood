/**
 * Five Guys UK's hand-verified dish → ingredients table (see spec 11; same
 * approach as ../Chipotle/recipes.ts).
 *
 * {@link ../FiveGuys/deliveroo.ts} lists Deliveroo's named, orderable dishes;
 * {@link ../FiveGuys/ingredients.ts} gives per-serving macros for each raw
 * component Five Guys' own nutrition PDF publishes. Composition (which
 * ingredients, in what multiple) is fixed here, reviewed by a human against
 * both sources — the macros themselves stay live, refreshed from the PDF on
 * every scrape.
 *
 * **Cross-checking.** Unlike Chipotle, Deliveroo's own listing for every Five
 * Guys dish here carries a `productMeta` calorie figure (e.g. "678 kcal" on
 * "Hamburger") — a real, independently-published total for the finished
 * dish, not derived from this table. Every recipe below was checked by
 * summing its ingredients' PDF macros and comparing to that figure. The gaps
 * described here are for that raw ingredient sum — `scraper.ts` now anchors
 * the *shipped* calories (and proportionally scales protein/fat/carbs) to
 * Deliveroo's figure whenever the gap is small enough to trust (see its
 * docblock), so what this project actually serves for burgers/hot dogs
 * matches Deliveroo exactly, not the undershot raw sum below:
 *
 *  - **Fries and shakes reconcile exactly.** Regular/Large Salted Fries,
 *    Regular/Large Cajun Fries (base fries + one serving of "Cajun
 *    seasoning"), the plain Five Guys Shake / Little Shake ("Five Guys
 *    Milkshake Base[, Little]" alone), and "NEW: Jimmy's Iced Coffee Shake" /
 *    "RETURNING: Pistachio" (base + one serving of the named flavour) all
 *    match Deliveroo's stated calories to the kcal.
 *  - **"RETURNING: Pistachio" was originally shipped as the standalone
 *    flavour alone (194 kcal), not base + flavour** — it happened to match
 *    Deliveroo's *then*-stated calories exactly, which looked like a clean
 *    reconciliation but wasn't: this project's own scraper.ts docblock
 *    explains why every recipe's gap is also re-checked live, not just
 *    hand-verified once. A later scrape's warning (computed 194 vs. a newly-
 *    stated 819) caught that Deliveroo's own figure had been corrected to a
 *    full shake — 625 (base) + 194 (Pistachio) = 819 exactly — and this
 *    recipe was fixed to match. Left here as a concrete example of what the
 *    live check is for.
 *  - **"Veggie Sandwich", "Cheese Veggie Sandwich", "Grilled Cheese" and
 *    "BLT" are direct 1:1 matches**, not summed — Five Guys' PDF publishes
 *    these as their own complete rows under "OTHER ITEMS" (unlike Chipotle's
 *    PDF, which is pure ingredients, this one also carries a handful of
 *    whole-dish totals), and each matches Deliveroo's stated calories
 *    exactly.
 *  - **Burgers (patty + bun, + cheese, + bacon) undershoot by roughly
 *    3-8%** — e.g. "Hamburger" (2 patties + bun) computes 628 kcal vs. a
 *    stated 678. The gap is consistent in direction and rough size across
 *    every burger checked, which points to something real but unlisted
 *    (Five Guys toasts buns with a butter/oil spread the PDF doesn't
 *    itemise) rather than a wrong ingredient match — the same "normal
 *    real-world variance" call Chipotle's recipes.ts makes for its Double
 *    Bowl/Burrito (10-12% under). Shipped as-is.
 *  - **Hot dogs undershoot further, roughly 12-18%** — "All Beef Hot Dog"
 *    (Hot Dog + Hot Dog Bun) computes 407 kcal vs. a stated 483. Larger than
 *    the burger gap, but the ingredients are unambiguous (no disputed
 *    matching, unlike Chipotle's excluded "High Protein Taco") and the
 *    pattern is the same bun-related story — shipped as-is rather than
 *    excluded, but flagged here as the least tight reconciliation in this
 *    table.
 *  - **Cheese is 2× on Regular burgers, 1× (the default) on Little ones —
 *    both stated, not inferred.** Deliveroo's own description says "two
 *    slices of melted American cheese" for Cheeseburger/Bacon Cheeseburger,
 *    but just "melted American cheese" (no count) for the Little variants —
 *    the same kind of stated-quantity signal as Chipotle's "½ Chicken, ½
 *    Sofritas", not a guess. Both sizes reconcile within the ~8% burger
 *    tolerance once read this way. Bacon is always a full serving (two
 *    strips) regardless of burger size — the description text says "two
 *    strips" on every Bacon variant, Little included, and the numbers agree.
 *  - **"Lettuce Wrap" is composed from raw ingredients** (patty + the
 *    toppings its own description lists), not read as a PDF row — the PDF
 *    does publish a total for it, but that row's name and values land on
 *    separate lines in a way `ingredients.ts` doesn't attempt to reassemble
 *    (see its docblock). The from-scratch sum (230 kcal) lands within the
 *    same burger-tier tolerance of Deliveroo's stated 246 kcal.
 *
 * **Scope.** Kids' meals are excluded — like Chipotle's kids items, they
 * bundle a customer-chosen "up to 3 toppings" selection, not a fixed recipe.
 * Canned/bottled drinks and beers are excluded — the nutrition PDF doesn't
 * cover them at all. Breakfast sandwiches, breakfast build-your-own items,
 * and hash browns are excluded because the PDF itself states they're sold at
 * Heathrow Airport only, not at the branch this scraper's Deliveroo source
 * represents.
 */

export interface RecipeIngredient {
    /** Exact key into the map `ingredients.ts` parses from the PDF. */
    ingredient: string
    /** Serving multiplier; omitted means 1×. See docblock above for which multipliers are stated fact vs. inferred. */
    multiplier?: number
}

export interface Recipe {
    /** Must match a name `deliveroo.ts` returns, checked at scrape time so a delisted dish is dropped instead of silently kept. */
    deliverooName: string
    category: string
    ingredients: RecipeIngredient[]
}

export const RECIPES: Recipe[] = [
    // --- Burgers ---
    {
        deliverooName: 'Hamburger',
        category: 'Burgers',
        ingredients: [{ ingredient: 'Beef Burger Patty', multiplier: 2 }, { ingredient: 'Burger Bun' }]
    },
    {
        deliverooName: 'Cheeseburger',
        category: 'Burgers',
        ingredients: [
            { ingredient: 'Beef Burger Patty', multiplier: 2 },
            { ingredient: 'Burger Bun' },
            { ingredient: 'Cheese (pasteurised)', multiplier: 2 }
        ]
    },
    {
        deliverooName: 'Bacon Burger',
        category: 'Burgers',
        ingredients: [
            { ingredient: 'Beef Burger Patty', multiplier: 2 },
            { ingredient: 'Burger Bun' },
            { ingredient: 'Bacon**' }
        ]
    },
    {
        deliverooName: 'Bacon Cheeseburger',
        category: 'Burgers',
        ingredients: [
            { ingredient: 'Beef Burger Patty', multiplier: 2 },
            { ingredient: 'Burger Bun' },
            { ingredient: 'Cheese (pasteurised)', multiplier: 2 },
            { ingredient: 'Bacon**' }
        ]
    },
    {
        deliverooName: 'Little Hamburger',
        category: 'Burgers',
        ingredients: [{ ingredient: 'Beef Burger Patty' }, { ingredient: 'Burger Bun' }]
    },
    {
        deliverooName: 'Little Cheeseburger',
        category: 'Burgers',
        ingredients: [
            { ingredient: 'Beef Burger Patty' },
            { ingredient: 'Burger Bun' },
            { ingredient: 'Cheese (pasteurised)' }
        ]
    },
    {
        deliverooName: 'Little Bacon Burger',
        category: 'Burgers',
        ingredients: [{ ingredient: 'Beef Burger Patty' }, { ingredient: 'Burger Bun' }, { ingredient: 'Bacon**' }]
    },
    {
        deliverooName: 'Little Bacon Cheeseburger',
        category: 'Burgers',
        ingredients: [
            { ingredient: 'Beef Burger Patty' },
            { ingredient: 'Burger Bun' },
            { ingredient: 'Cheese (pasteurised)' },
            { ingredient: 'Bacon**' }
        ]
    },
    {
        deliverooName: 'Lettuce Wrap',
        category: 'Burgers',
        ingredients: [
            { ingredient: 'Beef Burger Patty' },
            { ingredient: 'Tomatoes' },
            { ingredient: 'Pickles' },
            { ingredient: 'Grilled Onions' },
            { ingredient: 'Green Peppers' },
            { ingredient: 'Grilled Mushrooms' }
        ]
    },

    // --- Hot dogs ---
    {
        deliverooName: 'All Beef Hot Dog',
        category: 'Hot Dogs',
        ingredients: [{ ingredient: 'Hot Dog' }, { ingredient: 'Hot Dog Bun' }]
    },
    {
        deliverooName: 'Cheese Dog',
        category: 'Hot Dogs',
        ingredients: [{ ingredient: 'Hot Dog' }, { ingredient: 'Hot Dog Bun' }, { ingredient: 'Cheese (pasteurised)' }]
    },
    {
        deliverooName: 'Bacon Dog',
        category: 'Hot Dogs',
        ingredients: [{ ingredient: 'Hot Dog' }, { ingredient: 'Hot Dog Bun' }, { ingredient: 'Bacon**' }]
    },
    {
        deliverooName: 'Bacon Cheese Dog',
        category: 'Hot Dogs',
        ingredients: [
            { ingredient: 'Hot Dog' },
            { ingredient: 'Hot Dog Bun' },
            { ingredient: 'Cheese (pasteurised)' },
            { ingredient: 'Bacon**' }
        ]
    },

    // --- Sandwiches (published as their own PDF rows — direct 1:1, not summed) ---
    { deliverooName: 'Veggie Sandwich', category: 'Sandwiches', ingredients: [{ ingredient: 'Veggie Sandwich' }] },
    {
        deliverooName: 'Cheese Veggie Sandwich',
        category: 'Sandwiches',
        ingredients: [{ ingredient: 'Cheese Veggie Sandwich' }]
    },
    { deliverooName: 'Grilled Cheese', category: 'Sandwiches', ingredients: [{ ingredient: 'Grilled Cheese' }] },
    { deliverooName: 'BLT', category: 'Sandwiches', ingredients: [{ ingredient: 'BLT**' }] },

    // --- Fries ---
    { deliverooName: 'Little Salted Fries', category: 'Fries', ingredients: [{ ingredient: 'Little Fries' }] },
    { deliverooName: 'Regular Salted Fries', category: 'Fries', ingredients: [{ ingredient: 'Reg Fries' }] },
    { deliverooName: 'Large Salted Fries', category: 'Fries', ingredients: [{ ingredient: 'Large Fries' }] },
    {
        deliverooName: 'Little Cajun Fries',
        category: 'Fries',
        ingredients: [{ ingredient: 'Little Fries' }, { ingredient: 'Cajun seasoning' }]
    },
    {
        deliverooName: 'Regular Cajun Fries',
        category: 'Fries',
        ingredients: [{ ingredient: 'Reg Fries' }, { ingredient: 'Cajun seasoning' }]
    },
    {
        deliverooName: 'Large Cajun Fries',
        category: 'Fries',
        ingredients: [{ ingredient: 'Large Fries' }, { ingredient: 'Cajun seasoning' }]
    },

    // --- Shakes ---
    {
        deliverooName: 'Five Guys Shake',
        category: 'Shakes',
        ingredients: [{ ingredient: 'Five Guys Milkshake Base' }]
    },
    {
        deliverooName: 'Little Shake',
        category: 'Shakes',
        ingredients: [{ ingredient: 'Five Guys Milkshake Base Little' }]
    },
    {
        deliverooName: 'NEW: Jimmy’s Iced Coffee Shake',
        category: 'Shakes',
        ingredients: [{ ingredient: 'Five Guys Milkshake Base' }, { ingredient: 'Jimmy’s Iced Coffee' }]
    },
    {
        deliverooName: 'RETURNING: Pistachio',
        category: 'Shakes',
        ingredients: [{ ingredient: 'Five Guys Milkshake Base' }, { ingredient: 'Pistachio***' }]
    }
]
