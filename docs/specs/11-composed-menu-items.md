# 11 — Composed menu items: add Chipotle as a restaurant

## Goal

Add Chipotle UK as a restaurant, despite Chipotle publishing **no per-dish
menu at all** — being build-your-own, the only nutrition data they publish is
a per-*ingredient* table. Source the actual orderable dish list from
Deliveroo's own Chipotle listing, and compute each dish's macros by summing
the ingredients a hand-verified recipe says it contains, read live from
Chipotle's own PDF.

## Why not just scrape the ingredient PDF as standalone items

The PDF's ~30 rows ("Chicken", "Coriander-Lime White Rice", "Black Beans", …)
are each independently orderable-*sounding*, and the app's optimizer already
combines multiple items into a meal — so an earlier version of this plan was
to skip Deliveroo entirely and scrape those rows directly as items. Rejected:
**you can't actually order a standalone tortilla or a cup of rice** from
Chipotle. Every real order is a dish (a bowl, a burrito, a side) built from
several of those rows together. Items in this app are meant to be things a
user can genuinely order, so the dish layer is required, not optional.

## Architecture: two independent sources, cross-referenced by a static recipe table

```
Deliveroo (chipotle-islington)          Chipotle's own nutrition PDF
  → named, orderable dishes                → per-ingredient macros
  → e.g. "Wholesome Bowl"                  → e.g. Chicken: 185kcal/27.3g protein/…
        │                                          │
        └──────────────► recipes.ts ◄──────────────┘
                    (hand-verified, static)
                              │
                        scraper.ts sums
                              │
                      RestaurantData
```

- **`src/scrapers/Chipotle/deliveroo.ts`** — fetches Deliveroo's Chipotle
  Islington menu page and extracts every listing that carries a fixed
  composition (`__NEXT_DATA__`, a Next.js server-rendered JSON blob at
  `props.initialState.menuPage.menu.metas.root.items`; no browser needed).
  Chipotle is build-your-own, so most of the ~140 raw listings are
  scaffolding (the format itself — "Burrito", "Bowl" — plus every protein/
  topping re-listed as its own zero-macro modifier choice, with no
  `description`). A smaller set (~63) *are* named, pre-composed dishes with
  an explicit ingredient list in their `description` — those are what this
  module surfaces, minus a few whose `description` is a backend placeholder
  (`"None"`) or a bare data-entry glitch (a lone number like `"11.4"`), not
  real text.

  The menu URL 403s without a `fulfillment_method` + `geohash` query pair
  (verified live — `day`/`time` are not required). Those encode a specific
  London branch, not a session; Chipotle UK's menu doesn't vary by branch the
  way some other chains' does, so one representative branch
  (`chipotle-islington`) stands in for the whole country, same precedent as
  Slim Chickens resolving one representative tenkites branch.

- **`src/scrapers/Chipotle/ingredients.ts`** — downloads and parses
  Chipotle's published per-ingredient nutrition PDF into a
  `Map<name, {portion, calories, protein, fat, carbs}>`. Doesn't fit the
  shared header-driven PDF pipeline (no single clean header row; a handful of
  rows split their values onto an adjacent line — see the file's docblock for
  the two patterns), so it's hand-rolled from `extractPdfLines`, following
  the Pizza Hut/PDF precedent of a custom parser when a document's structure
  doesn't fit the shared abstraction. Values are written with a **European
  decimal comma** ("8,8" = 8.8) — the opposite convention from the project's
  shared `parseNumber` (comma = thousands separator) — so this file has its
  own `parseCommaDecimal`; reusing `parseNumber` here would have silently
  10×'d every value.

- **`src/scrapers/Chipotle/recipes.ts`** — the static table that ties the two
  together: for each included dish, its Deliveroo listing name, category, and
  the PDF ingredient rows (with an optional multiplier) that sum to its
  macros.

## Why a static recipe table, not runtime text-matching

An earlier design (call it Design A) matched a dish to ingredients
automatically at scrape time — split the Deliveroo `description` on commas,
fuzzy-match each fragment against `ingredients.ts`'s keys, sum the matches.
Rejected in favor of a hand-verified, name-keyed static table (Design B)
after actually doing the matching by hand and finding it isn't reliable
enough to automate blindly:

- Manually reconciling every candidate dish's summed protein against any
  protein figure Chipotle's own copy states for it surfaced a few "High
  Protein"-branded dishes whose description **doesn't add up** to their
  advertised protein even after summing every listed ingredient — up to a
  ~2.4× mismatch depending on the dish (full list and figures in
  `recipes.ts`'s docblock). A description-driven auto-matcher would have
  computed *something* for these and shipped it silently wrong; a human
  doing the same reconciliation catches it and excludes the dish instead.
  (A first pass at this reconciliation also nearly excluded two dishes that
  are actually fine — "Double High Protein Bowl" and "Double Protein
  Burrito" — because the initial check only summed the two most
  protein-obvious ingredients and skipped the rest of the listed ones;
  redone properly, both land within ~10-12% of their stated figure, well
  inside normal scoop variance, and are included. A lesson in doing the full
  sum, not a shortcut, before excluding a dish for "not reconciling.")
- Some descriptions use marketing phrasing that doesn't map 1:1 to a PDF row
  name (e.g. "roasted corn salsa" → the PDF's "Chilli-Corn Salsa"), which a
  literal or fuzzy string matcher could easily mismap to a wrong or
  nonexistent row.

So **composition is fixed in source** (each recipe reviewed by hand against
the PDF and Deliveroo's own copy), while **macros stay live** — every
ingredient's `calories`/`protein`/`fat`/`carbs` is re-read from the PDF on
every scrape, refreshed the same way every other restaurant's data is. This
isn't the "stale hardcoded snapshot" this project otherwise avoids (see
`ingredients.ts`'s docblock) — only the *shape* of a dish is fixed, not its
numbers.

At scrape time, `scraper.ts` still confirms each recipe's `deliverooName` is
present in the live Deliveroo fetch before trusting the hand-pinned
composition for it — a delisted/renamed dish is skipped with a warning
instead of silently shipping a menu item that's no longer orderable.

## Scope: 23 of ~63 candidate dishes

Included: 11 bowls/burritos, 1 protein-cup extra, 11 sides — the full list
and each one's exact ingredient composition is in `recipes.ts`. Excluded, by
category, with reasoning:

- **Generic build-your-own formats** ("Burrito Bowl", "Burrito", "Quesadilla",
  "Tacos (3)", "Salad") — these describe the *format*, not a dish; every
  protein/topping is its own separate modifier choice with no fixed
  composition to sum.
- **Kids' items** ("Kid's Quesadilla", "Kid's Build Your Own Tacos") — same
  reason.
- **Protein figures that genuinely don't reconcile** (see above) — "High
  Protein Taco" (stated 15g vs ~36g computed from a full chicken portion —
  the mismatch runs the *other* direction, meaning a taco uses a smaller
  scoop than a bowl, but the description gives no fraction to size that by),
  "NEW Chipotle Honey Chicken Protein Cup" (27g stated vs 15.9g for one
  standard serving), "High Protein Cup Steak" (21g stated vs 28.8g for one
  standard serving) — both single-ingredient, so the mismatch isn't a
  summing artifact. ("High Protein Cup Chicken" reconciles fine — computed
  27.3g vs. its own headline "27g Protein" — and is included; its body copy
  separately claims "32g", read as a copy error on Deliveroo's side rather
  than grounds to doubt the 1×-serving figure that does reconcile.)
- **"Double High Protein Bowl" and "Double Protein Burrito" are included**
  (not excluded, despite the "High Protein" branding above) — summing every
  listed ingredient, not just the obviously protein-heavy ones, lands them
  within ~10-12% of their stated protein figure, well inside normal scoop
  variance. Their "Double" is an explicit stated multiplier on the chicken
  (2×), same category as "½ Chicken, ½ Sofritas" on Go Half Veggie Bowl.
- **"Grain Free (Keto) Bowl"** — references "Tomatillo-Red Chili Salsa",
  which isn't a row in the current PDF (the closest matches, "Roasted Tomato
  Green/Red-Chilli Salsa", are visibly different products), and separately
  double-lists "Monterey Jack cheese, and Cheese" — too ambiguous to
  hand-verify against the PDF.
- **Canned/bottled drinks** (Coke Zero, Diet Coke, Lemonaid ×2, Corona, San
  Pellegrino ×3) — the ingredient PDF only covers fountain drinks, and
  `ingredients.ts` doesn't even parse that section (materially different
  multi-portion layout, and nothing in `recipes.ts` needs it) — there's no
  Chipotle-published source for these at all.
- **Near-duplicate side listings** — a few sides appear twice under slightly
  different names with byte-identical descriptions (e.g. "Chips & Guac" /
  "Chips & Guacamole (VG)", "Guac on the Side (VG)" / "Guacamole on the Side
  (VG)", "Tortilla Chips (VG)" / "Chips (VG)"), most likely duplicate
  listings from different Deliveroo menu sections — only the more descriptive
  name of each pair is kept.

Multipliers are only ever used where a dish's description states an exact
fraction ("½ Chicken, ½ Sofritas" on "Go Half Veggie Bowl") or where Chipotle
itself publishes the scaled serving as its own PDF row ("Guacamole (large)"
and "Chips (large)" are real 2× rows, not an invented multiplier). Vague
qualifiers ("Light", "Extra") are never guessed at — a dish either reconciles
at standard 1× portions or it's excluded.

## Disclaimer

Because Chipotle is the first restaurant with no single published source for
its dishes' macros, both the web app footer and the README's data-sources
table now call this out as its own accuracy caveat, distinct from the
existing "data may be out of date" disclaimer: a Chipotle item's accuracy
depends on Deliveroo's description matching the real dish *and* the recipe
staying in sync with it, not on one restaurant-published number.

## Product strategy (context, not scope)

This is explicitly **phase 1** of a broader pattern for onboarding
restaurants that don't publish a conventional per-dish menu: pair a
delivery-platform's dish catalogue (for orderable names) with the
restaurant's own nutrition source (for macros), and hand-verify the mapping
between them. If this works well in practice, **phase 2** (not started, not
designed, tracked here only as direction) would generalize the "macros"
side away from a *restaurant-specific* ingredient table toward **generic
per-ingredient macros** shared across restaurants — letting this pattern
extend to menus with no published nutrition source at all, not just ones
missing a per-dish breakdown. Phase 2 needs its own spec if pursued; nothing
in this implementation depends on it.

## Wiring

- `src/scrapers/Chipotle/{deliveroo,ingredients,recipes,scraper}.ts` (new).
- `src/config.ts`: `RestaurantKey` gains `'CHIPOTLE'`.
- `src/scrapers/scraping-oprerator.ts`: `scrapeChipotle()` (cached, like
  every other live scraper), wired into `scrapeAll()` and
  `scrapeRestaurant()`.
- `src/tools/build-web-data.ts`: `REGISTRY` gains a Chipotle entry
  (`source: 'live'`).
- `.env.example` / `README.md`: `DISABLE_CHIPOTLE` row; restaurant added to
  the features list and the data-sources table, plus the accuracy-caveat
  paragraph above.
- `web/src/App.tsx`: footer disclaimer extended with the composed-macro
  caveat.

## Tests

First automated tests in this project (Node's built-in `node:test` runner —
no new dependency; `*.test.ts` alongside source, already covered by
`tsconfig.json`'s existing `include`). `package.json` gained a `test` script
(`tsc && node --test "dist/**/*.test.js"`).

- `ingredients.test.ts` — `parseIngredientRows` against synthetic `PdfLine`
  fixtures: a normal row, a stray allergen-tick cell between name and
  portion, the orphan-portion/name-on-next-line split (the Romaine Lettuce
  case), the European comma-decimal parse, the Fountain Drinks cutoff, and
  malformed/zero-calorie rows being dropped rather than crashing or
  corrupting data.
- `deliveroo.test.ts` — `parseDeliverooDishes` against synthetic
  `__NEXT_DATA__` HTML: keeps a real name+description pair, drops
  no-description/`"None"`/bare-number placeholders, first-occurrence-wins on
  a repeated name, throws when the script tag is missing.
- `recipes.test.ts` — internal consistency of the static table against a
  frozen, offline snapshot of the real PDF's ingredient rows (not a live
  fetch — this is a fast regression guard against a typo'd/renamed
  ingredient key, not a substitute for re-verifying against a real PDF
  republish): every ingredient reference resolves, no duplicate dish names,
  every recipe sums to positive/plausible macros (a summed macro's calorie
  contribution can't wildly exceed the dish's own calorie total), "High
  Protein Cup Chicken" reconciles to ~27g protein, and both "Double" dishes
  reconcile to within ~15% of their own stated protein figure.

## Verification plan

- `ingredients.ts` verified against a live PDF pull: 29 ingredient rows
  parsed, all 15 hand-checked ground-truth values (including the Romaine
  Lettuce split-line case) matching exactly.
- `yarn build` (`tsc --noEmit`) clean across the whole project.
- `yarn test` — 22 tests, all passing.
- Live end-to-end scrape run directly against `ChipotleScraper`: all 23
  recipes resolved against a fresh Deliveroo + PDF fetch, zero delisted-dish
  warnings, zero duplicate/requalified collisions. Spot-checked "High Protein
  Cup Chicken" (185kcal/27.3g protein — exactly the standalone Chicken row,
  as designed) and "Large Chips and Guac" (917kcal, summing the two
  large-portion PDF rows).
