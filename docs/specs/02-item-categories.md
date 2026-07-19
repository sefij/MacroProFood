# 02 — Add categories to menu items ✅

## Goal

Every scraped item carries a category (e.g. `Burgers`, `Sides`, `Desserts`,
`Sauces`), flowing from scraper → cache → optimizer results → web snapshots.
Foundation for category indicators (03), safer duplicate handling (04), and
category exclusion (05).

## Data model

- `src/core/types.ts`: `NutritionData`, `MenuItem`, and `SnapshotItem` all gain
  `category?: string`. `OptimizationResult.totalNutrition`/`.accuracy`
  explicitly omit it (a combo total has no single category — Omit-ing only
  the ratio fields left `category` inherited as optional, which broke
  `keyof Nutrition`-typed code in `TrackPanel.tsx` that assumed every key was
  numeric).
- `src/scrapers/category.ts` — `normalizeCategory()`: trims/collapses
  whitespace, and Title-Cases a label only when it has **no deliberate mixed
  casing** (all-uppercase *or* all-lowercase) — covers PDF ALL-CAPS headings
  ("SAUCES & CONDIMENTS" → "Sauces & Condiments") and raw-lowercase CMS fields
  ("limited time only" → "Limited Time Only") alike, while never touching a
  source's intentional casing ("BBQ Chicken & Bacon" stays as-is).

## Per-scraper source

| Scraper | Source |
| --- | --- |
| PDF base (Wendy's, Domino's, Subway) | Table section title, via optional `category?: (title) => string` mapper (default: the raw title). Domino's needs one — its titles carry boilerplate ("Domino's Pizza Nutrition – Gluten Free Pizzas (Per Whole Pizza)") that `dominosCategory()` strips down to "Gluten Free Pizzas". Wendy's/Subway titles are already clean; no mapper needed. |
| KFC | `product.categories[0]` from `__NEXT_DATA__` (already read for the Drinks exclusion). |
| Popeyes / Taco Bell | The section-header row tracked while iterating (`currentSection`/`currentCategory`), already used for excluded-category matching — now the pre-lowercase raw text is kept alongside for display. |
| Wagamama | New `collectCategoryNames()` walk of the `__NUXT_DATA__` devalue tree, mirroring the existing `collectDrinkNames()` pattern generalized to record every category (see bug below). |
| McDonald's | `CATEGORY_URLS` restructured from a flat URL list into `{ url, category }` pairs (hand-labeled from the 8 menu-section pages); `collectItemUrls()` now returns `url → category`, threaded through to `buildNutritionData`. |

## Bug found and fixed: Wagamama's devalue walk

`collectItemCategories()` (the category-tagging walk) initially mirrored the
existing `collectItemNames()` pattern of recursing into **every** object key.
That's unsound for a "category" node specifically: fields like `SType`/`Order`
are plain type-code integers, not references — but the devalue payload format
represents every value as an array index, so a number that's actually just a
type code gets treated as `payload[thatNumber]` anyway. When that coincidental
index happened to resolve back into a shared ancestor of the *entire* menu
tree, every category's walk collapsed onto the same path and marked each
other's items `visited` before their real owning category's `Recipes` field
was ever reached — 25 of 110 items silently lost their category as a result
(traced with instrumented path-logging; confirmed by checking devalue-index
referrers directly in a raw payload dump).

Fixed by restricting the walk to only the two fields that actually nest
items/subcategories, `Recipes` and `Sections` (`collectItemNames`/
`collectDrinkNames` have the same theoretical exposure but were left
unchanged — out of scope for this task, and their existing behavior remains
what it was before). Also switched from one `visited` set shared across all
categories to a fresh one per category, since the devalue graph dedupes
shared substructure (sizes, pictures) and a shared guard could still let one
category's incidental visit block another's real one.

## Plumbing

- `src/core/optimizer.ts` `flattenItems()`: copies `category` onto `MenuItem`.
- `src/tools/build-web-data.ts` `toSnapshotItems()` / `web/src/data.ts`
  `toRestaurantsData()`: pass `category` through to the web snapshot format
  and back.
- Cache: no migration needed — `NutritionData` serializes as-is, cached
  entries without `category` just surface `undefined`.

## Out of scope

UI/filtering behavior (specs 03, 05). Cross-restaurant category
canonicalization — categories stay source-native per restaurant.

## Verification (done)

Fresh scrape of all 8 restaurants, zero uncategorized items, item counts
unchanged from pre-category baselines (no regressions):

| Restaurant | Items | Categories |
| --- | --- | --- |
| Subway | 185 | Breads, Cheese, Cookies, Other, Proteins, Salads, Sauces & Condiments, Saver Subs, Sides, Spuds, Subs, Toasties, Toppings, Vegetables, Wraps |
| Wendy's | 145 | Beverages, Breakfast, Chicken, Frosty®, Hamburgers, Ingredients/Condiments, Kid'S Meal, Salads…, Sides, Wraps |
| Domino's | 151 | Chick 'N' Dip(+ Combos), Desserts, Dips, Gluten Free/Main Menu/Personal Size/Plant Based/Specialty Pizzas, New 40g Dips, Sides, Wraps |
| KFC | 81 | Burgers, Just Chicken, Krushems & Desserts, Limited Time Offer, Salad Boxes & Riceboxes, Sides & Dips, Wraps |
| Popeyes | 118 | Boneless, Breakfast, Hot Wings, Sandwiches, Sides, Signature Louisiana Chicken, Signature Wraps, Tenders |
| Taco Bell | 195 | Add-Ons, Burritos, Cravings Value Menu, Featured, Meals, Sides, Single Portions, Specialties, Tacos |
| Wagamama | 110 | Desserts + Sweet Treats, Extras, Gluten Free, Kids, Limited Time Only, Lunch Time, Sides, The Main Event |
| McDonald's | 46 | Burgers, Chicken, Desserts, Fries & Sides, Saver Menu, Sharing, Wraps & Salads |

Also re-confirmed Wendy's (145) and Domino's (151) item counts and duplicate-key
behavior are unchanged from their pre-existing baselines (the one Wendy's
"4 Pc Chicken Nuggets" collision is a pre-existing PDF duplicate, exactly what
spec 04 addresses). `yarn build` and the web app's `tsc --noEmit` both clean.
