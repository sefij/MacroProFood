/**
 * Chipotle UK's hand-verified dish → ingredients table.
 *
 * This is the piece that turns two otherwise-unrelated sources into orderable
 * items with real macros: {@link ../Chipotle/deliveroo.ts} lists Deliveroo's
 * named, pre-composed dishes (what you can actually order), and
 * {@link ../Chipotle/ingredients.ts} gives per-serving macros for each raw
 * component (what Chipotle publishes). Neither alone is enough — Deliveroo's
 * descriptions are marketing copy, not a machine-readable ingredient list, and
 * the PDF has no dish names at all.
 *
 * **Why this is a static table instead of runtime text-parsing.** An earlier
 * design matched a dish to ingredients by parsing its Deliveroo `description`
 * text at scrape time (splitting on commas, fuzzy-matching each fragment
 * against `ingredients.ts` keys). That was dropped after manually
 * reconciling every candidate dish's summed protein against any protein
 * figure Chipotle's own copy states for it: several "High Protein"/"Double"
 * dishes' descriptions don't actually add up to their advertised protein at
 * standard PDF portions (see the exclusion list below), which means blind
 * text-matching would have silently produced wrong macros for exactly the
 * dishes a user most cares about getting right. A hand-verified, name-keyed
 * table catches that at write time instead of shipping it. Composition here
 * is therefore fixed in source (reviewed by a human against the PDF), while
 * per-ingredient macros stay live — refreshed from the PDF on every scrape —
 * so this isn't the "stale hardcoded snapshot" this project otherwise avoids
 * (see spec 11).
 *
 * **Reading a recipe.** Each `ingredient` string must be an exact key from
 * {@link ../Chipotle/ingredients.ts}'s parsed table (`scraper.ts` throws, not
 * silently drops, if one goes missing — a PDF republish that renames a row is
 * a scraper bug, not a quietly wrong menu). `multiplier` scales that
 * ingredient's serving; omitted means 1×. Multipliers are only used where a
 * dish's description states an exact fraction ("½ Chicken, ½ Sofritas") or
 * where the PDF itself publishes the scaled serving as its own row (Chipotle
 * publishes "Guacamole (large)" and "Chips (large)" as their own 2× rows, not
 * a multiplier this file invents) — vague qualifiers ("Light", "Extra") are
 * never guessed at.
 *
 * **Scope: 23 of the ~63 Deliveroo listings that carry a fixed description.**
 * Everything else was deliberately excluded, not missed:
 *
 *  - **Generic build-your-own formats** ("Burrito Bowl", "Burrito",
 *    "Quesadilla", "Tacos (3)", "Salad") — these are the format itself, not a
 *    dish; Deliveroo lists every protein/topping as a separate zero-macro
 *    modifier choice with no fixed composition to sum.
 *  - **Kids' items** ("Kid's Quesadilla", "Kid's Build Your Own Tacos") —
 *    same reason, a protein/topping is chosen per order.
 *  - **Protein figures that genuinely don't reconcile**: "High Protein Taco"
 *    (stated 15g vs ~36g computed from a full standard chicken portion — the
 *    mismatch runs the *other* direction here, meaning a taco clearly uses a
 *    smaller protein scoop than a bowl/burrito, but the description gives no
 *    fraction to size that by, so it isn't guessed at), "NEW Chipotle Honey
 *    Chicken Protein Cup" (stated 27g vs 15.9g for one standard Chipotle
 *    Honey Chicken serving — single-ingredient, no summing involved, just a
 *    real mismatch), "High Protein Cup Steak" (stated 21g vs 28.8g for one
 *    standard Steak serving, same situation). Rather than guess a
 *    non-standard portion to force agreement, these are simply not shipped.
 *    ("High Protein Cup Chicken" reconciles fine — computed 27.3g vs. its own
 *    headline "27g Protein" — and is included; that listing's body copy
 *    separately claims "32g", which looks like a copy error on Deliveroo's
 *    side, not a reason to doubt the 27g/1× figure that does reconcile.)
 *  - **"Double High Protein Bowl" and "Double Protein Burrito" are included**,
 *    not excluded — an earlier pass here mis-checked them by only summing
 *    Chicken×2 + Cheese and skipping the other listed ingredients (rice,
 *    beans, fajita veggies, salsa — and the burrito's own tortilla), which
 *    made them look badly wrong. Summing every listed ingredient: the Bowl
 *    computes to 72.9g protein vs. a stated 81g (~10% under), and the
 *    Burrito to 69.5g vs. a stated 79g (~12% under) — both well within normal
 *    real-world scoop variance, unlike the taco/cup mismatches above. Their
 *    "Double" is an explicit stated multiplier, same category as "½ Chicken,
 *    ½ Sofritas" on Go Half Veggie Bowl — not a vague qualifier.
 *  - **"Grain Free (Keto) Bowl"** references "Tomatillo-Red Chili Salsa",
 *    which isn't a row in the current PDF (the closest matches, "Roasted
 *    Tomato Green/Red-Chilli Salsa", are visibly different products), and
 *    separately double-lists "Monterey Jack cheese, and Cheese" — too
 *    ambiguous to hand-verify.
 *  - **Canned/bottled drinks** (Coke Zero, Diet Coke, Lemonaid ×2, Corona,
 *    San Pellegrino ×3) — the ingredient PDF only covers fountain drinks
 *    (and `ingredients.ts` doesn't even parse that section — see its
 *    docblock), so there's no Chipotle-published source for these at all.
 *  - **Near-duplicate side listings** — a few sides appear twice under
 *    slightly different names with identical descriptions (e.g. "Chips &
 *    Guac" / "Chips & Guacamole (VG)", "Guac on the Side (VG)" / "Guacamole
 *    on the Side (VG)", "Tortilla Chips (VG)" / "Chips (VG)"), most likely
 *    duplicate listings from different Deliveroo menu sections. Only the more
 *    descriptive name is kept to avoid shipping two identical items.
 */

export interface RecipeIngredient {
    /** Exact key into the map `ingredients.ts` parses from the PDF. */
    ingredient: string
    /** Serving multiplier; omitted means 1×. Only used for stated exact fractions or Chipotle's own published scaled rows — never guessed. */
    multiplier?: number
}

export interface Recipe {
    /** Must match a name `deliveroo.ts` returns, checked at scrape time so a delisted dish is dropped instead of silently kept. */
    deliverooName: string
    category: string
    ingredients: RecipeIngredient[]
}

export const RECIPES: Recipe[] = [
    // --- Bowls & burritos ---
    {
        deliverooName: 'Go-To Chicken Bowl',
        category: 'Bowl',
        ingredients: [
            { ingredient: 'Chicken' },
            { ingredient: 'Coriander-Lime White Rice' },
            { ingredient: 'Black Beans' },
            { ingredient: 'Fajita Vegetables' },
            { ingredient: 'Fresh Tomato Salsa' },
            { ingredient: 'Monterey Jack Cheese' },
            { ingredient: 'Guacamole (topping/side)' }
        ]
    },
    {
        deliverooName: '(NEW) Go-To Chipotle Honey Chicken Bowl 🍯🔥',
        category: 'Bowl',
        ingredients: [
            { ingredient: 'Chipotle Honey Chicken (LTO)' },
            { ingredient: 'Coriander-Lime White Rice' },
            { ingredient: 'Black Beans' },
            { ingredient: 'Fajita Vegetables' },
            { ingredient: 'Fresh Tomato Salsa' },
            { ingredient: 'Chilli-Corn Salsa' },
            { ingredient: 'Monterey Jack Cheese' },
            { ingredient: 'Sour Cream' },
            { ingredient: 'Romaine Lettuce (salad/topping)' }
        ]
    },
    {
        deliverooName: '(New) Go-To Honey Chicken Burrito 🔥🍯',
        category: 'Burrito',
        ingredients: [
            { ingredient: 'Chipotle Honey Chicken (LTO)' },
            { ingredient: 'Coriander-Lime White Rice' },
            { ingredient: 'Black Beans' },
            { ingredient: 'Fajita Vegetables' },
            { ingredient: 'Fresh Tomato Salsa' },
            { ingredient: 'Chilli-Corn Salsa' },
            { ingredient: 'Monterey Jack Cheese' },
            { ingredient: 'Sour Cream' },
            { ingredient: 'Romaine Lettuce (salad/topping)' },
            { ingredient: 'Flour Tortilla (Burrito)' }
        ]
    },
    {
        deliverooName: '🌱 Go-To Vegan Burrito 🌱',
        category: 'Burrito',
        ingredients: [
            { ingredient: 'Sofritas (braised tofu)' },
            { ingredient: 'Coriander-Lime White Rice' },
            { ingredient: 'Black Beans' },
            { ingredient: 'Fresh Tomato Salsa' },
            { ingredient: 'Flour Tortilla (Burrito)' }
        ]
    },
    {
        deliverooName: 'Plant-Powered Bowl 🌱',
        category: 'Bowl',
        ingredients: [
            { ingredient: 'Super Greens' },
            { ingredient: 'Coriander-Lime White Rice' },
            { ingredient: 'Sofritas (braised tofu)' },
            { ingredient: 'Fajita Vegetables' },
            { ingredient: 'Fresh Tomato Salsa' },
            { ingredient: 'Chilli-Corn Salsa' },
            { ingredient: 'Guacamole (topping/side)' }
        ]
    },
    {
        deliverooName: 'Veggie Full Bowl',
        category: 'Bowl',
        ingredients: [
            { ingredient: 'Coriander-Lime White Rice' },
            { ingredient: 'Black Beans' },
            { ingredient: 'Fajita Vegetables' },
            { ingredient: 'Fresh Tomato Salsa' },
            { ingredient: 'Chilli-Corn Salsa' },
            { ingredient: 'Sour Cream' },
            { ingredient: 'Guacamole (topping/side)' }
        ]
    },
    {
        deliverooName: 'Wholesome Bowl',
        category: 'Bowl',
        ingredients: [
            { ingredient: 'Super Greens' },
            { ingredient: 'Chicken' },
            { ingredient: 'Fajita Vegetables' },
            { ingredient: 'Fresh Tomato Salsa' },
            { ingredient: 'Guacamole (topping/side)' }
        ]
    },
    {
        deliverooName: 'Wholesome Bowl with Carnitas',
        category: 'Bowl',
        ingredients: [
            { ingredient: 'Super Greens' },
            { ingredient: 'Carnitas' },
            { ingredient: 'Fajita Vegetables' },
            { ingredient: 'Fresh Tomato Salsa' },
            { ingredient: 'Guacamole (topping/side)' }
        ]
    },
    {
        deliverooName: 'Go Half Veggie Bowl',
        category: 'Bowl',
        ingredients: [
            { ingredient: 'Chicken', multiplier: 0.5 },
            { ingredient: 'Sofritas (braised tofu)', multiplier: 0.5 },
            { ingredient: 'Super Greens' },
            { ingredient: 'Coriander-Lime White Rice' },
            { ingredient: 'Fajita Vegetables' },
            { ingredient: 'Fresh Tomato Salsa' },
            { ingredient: 'Chilli-Corn Salsa' },
            { ingredient: 'Sour Cream' }
        ]
    },
    {
        deliverooName: 'Double High Protein Bowl',
        category: 'Bowl',
        ingredients: [
            { ingredient: 'Chicken', multiplier: 2 },
            { ingredient: 'Coriander-Lime White Rice' },
            { ingredient: 'Black Beans' },
            { ingredient: 'Fajita Vegetables' },
            { ingredient: 'Fresh Tomato Salsa' },
            { ingredient: 'Monterey Jack Cheese' },
            { ingredient: 'Romaine Lettuce (salad/topping)' }
        ]
    },
    {
        deliverooName: 'Double Protein Burrito',
        category: 'Burrito',
        ingredients: [
            { ingredient: 'Chicken', multiplier: 2 },
            { ingredient: 'Fajita Vegetables' },
            { ingredient: 'Fresh Tomato Salsa' },
            { ingredient: 'Monterey Jack Cheese' },
            { ingredient: 'Romaine Lettuce (salad/topping)' },
            { ingredient: 'Flour Tortilla (Burrito)' }
        ]
    },

    // --- Extras ---
    {
        deliverooName: 'High Protein Cup Chicken',
        category: 'Extras',
        ingredients: [{ ingredient: 'Chicken' }]
    },

    // --- Sides ---
    {
        deliverooName: 'Chips & Guacamole (VG)',
        category: 'Sides',
        ingredients: [{ ingredient: 'Chips (regular)' }, { ingredient: 'Guacamole (topping/side)' }]
    },
    {
        deliverooName: 'Chips (VG)',
        category: 'Sides',
        ingredients: [{ ingredient: 'Chips (regular)' }]
    },
    {
        deliverooName: 'Guacamole on the Side (VG)',
        category: 'Sides',
        ingredients: [{ ingredient: 'Guacamole (topping/side)' }]
    },
    {
        deliverooName: 'Chips & Fresh Tomato Salsa (VG)',
        category: 'Sides',
        ingredients: [{ ingredient: 'Chips (regular)' }, { ingredient: 'Fresh Tomato Salsa' }]
    },
    {
        deliverooName: 'Chips & Green Chili Salsa 🌶️ (VG)',
        category: 'Sides',
        ingredients: [{ ingredient: 'Chips (regular)' }, { ingredient: 'Roasted Tomato Green-Chilli Salsa' }]
    },
    {
        deliverooName: 'Chips & Red Chili Salsa 🌶️🌶️ (VG)',
        category: 'Sides',
        ingredients: [{ ingredient: 'Chips (regular)' }, { ingredient: 'Roasted Tomato Red-Chilli Salsa' }]
    },
    {
        deliverooName: 'Tortilla on the Side (VG)',
        category: 'Sides',
        ingredients: [{ ingredient: 'Flour Tortilla (Burrito)' }]
    },
    {
        deliverooName: 'Large Chips',
        category: 'Sides',
        ingredients: [{ ingredient: 'Chips (large)' }]
    },
    {
        deliverooName: 'Large Chips and Guac',
        category: 'Sides',
        ingredients: [{ ingredient: 'Chips (large)' }, { ingredient: 'Guacamole (large)' }]
    },
    {
        deliverooName: 'Large Guac on the Side (VG)',
        category: 'Sides',
        ingredients: [{ ingredient: 'Guacamole (large)' }]
    },
    {
        deliverooName: 'Pinto Beans (VG)',
        category: 'Sides',
        ingredients: [{ ingredient: 'Pinto Beans' }]
    }
]
