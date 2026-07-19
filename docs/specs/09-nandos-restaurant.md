# 09 — Add Nando's as a restaurant

## Goal

Add Nando's UK to the scraped restaurants, sourced from the JSON data Gatsby
embeds for the menu page — no browser needed.

## Data source: the URL is content-hashed and changes on every deploy

`https://www.nandos.co.uk/food/menu/page-data/index/page-data.<hash>.json`,
where `<hash>` is the content hash of the site's current "app" JS bundle
(e.g. `1784191211623`), embedded in the menu page's own HTML as
`window.___chunkMapping={"app":["/app-<hash>.js"],...}` — recovered with a
plain-text GET of `https://www.nandos.co.uk/food/menu/` and a regex, no
browser needed.

**A first draft of this spec got this wrong** and shipped against the
unsuffixed `page-data/index/page-data.json` (no hash), which also resolves
with HTTP 200 and a plausible, well-formed response — but is a **stale
build**, roughly 5.5× smaller than the real, current menu (757KB vs 4.18MB;
11 sections/201 items vs 18 sections/440 items, missing the entire breakfast
menu and "The Lunch Fix" meal deals) and, worse, **silently wrong on items
present in both**: e.g. "PERi-Salted Chips (Regular)" scraped as 452kcal
from the stale file vs the true 450kcal, with materially different macros
(fibre, salt, protein all differ). This was caught by the user spot-checking
scraped output against the live site and pasting the mismatched source JSON
— see "How this was caught" below. **Do not fetch the unsuffixed URL.**

Shape (trimmed to what we use):

```
{
  result: {
    data: {
      nandos: {
        menu: {
          bastes: [ { displayName, slug, nutritionalInfo: { energyKcal } | null, ... } ],
          sections: [
            {
              displayName, kind,
              items: [
                {
                  displayName, description, servingInfo, ...,
                  nutritionalInfo: { factsForPortionSizes: [ { energyKcal, proteinMg, fatMg, totalCarbsMg, ... } ] },
                  priceList: null,  // present in the schema but always null in practice — do not use
                  modifiers: [
                    {
                      slug,  // e.g. "choose-size-side", "choose-baste", "choose-side", "choose-add", …
                      options: [ { displayName, nutritionalInfo: { factsForPortionSizes: [ {...} ] } | undefined } ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    }
  }
}
```

18 sections in the current (correct) fetch: The Lunch Fix, Starters,
PERi-PERi Chicken (×2 — see below), Burgers/Pittas/Wraps, Salads & Bowls,
Sharing Platters, Veggie, Nandinos (Kids) (×2), Sides (×2), Dips & Extras,
Extras, Sweet Treats, The Classics, Breakfast Rolls, Eggs, The Works,
Drinks (×2), Desserts — 440 items total. Several section `kind`s repeat
(the menu apparently interleaves a base menu with a breakfast-hours one) —
handled for free, since the scraper iterates `menu.sections` generically and
categorizes by each section's own `displayName`, not `kind`.

## Each item's own nutrition: `factsForPortionSizes`

Every section item carries its **own** base nutrition at
`item.nutritionalInfo.factsForPortionSizes[0]` (`energyKcal`, `proteinMg`,
`fatMg`, `totalCarbsMg`; convert the `Mg` fields to grams by `/1000`). This
is the dish "as published" — sides, drinks, and bastes chosen via
`modifiers` are **not** folded in (see "Out of scope" — those are separate,
independently-scraped items, and combining them into a meal is the
optimizer's job, same as every other restaurant).

Only 2 of 440 items ("Dare to share", appearing twice) have an empty
`factsForPortionSizes` — skipped and counted, same `invalid` bucket
convention as every other scraper.

## Multi-portion items: read the `choose-size-*` modifier, not `priceList`

`priceList` — which a first draft of this spec (see above) tried to zip
against `factsForPortionSizes` by array position — **is always `null`** in
the real data; it's dead weight in the schema, not a usable label source.

The real, reliable source for a multi-size item's per-size nutrition is a
`choose-size-*` modifier (`choose-size-side` on 40 items, `choose-size-wine`
on 7 — no other modifier slug follows this naming convention, confirmed
across every modifier slug in a live pull). Each of its `options[]` is
independently and completely labelled and nutritioned — e.g. "PERi-Salted
Chips"'s `choose-size-side` modifier has one option named "Regular" (own
`factsForPortionSizes`: 450kcal) and one named "Large" (1123kcal); "Spier
Chardonnay"'s `choose-size-wine` modifier has four: "125ml" (98kcal),
"175ml" (130kcal), "250ml" (185kcal), "Bottle" (555kcal). No sorting,
zipping, or index-matching needed — each option already pairs its own label
with its own facts. (The item's own top-level `factsForPortionSizes` is
either a 1-entry aggregate, e.g. Chardonnay's top-level facts is just
`[{250ml's facts}]`, or — for Sides — mirrors the modifier's facts values
exactly; either way it's not used once a `choose-size-*` modifier is found.)

Confirmed on a live pull: every item with more than one top-level
`factsForPortionSizes` entry has a `choose-size-*` modifier (0 exceptions),
and every `choose-size-*` modifier's options are fully nutritioned (0
exceptions) — so the rule is unconditional, no fallback-within-fallback
needed: **`choose-size-*` modifier present → one row per option, using the
option's own label and facts. Otherwise → the item's own
`factsForPortionSizes[0]`, one bare-name row.**

Suffix naming: `${displayName} (${option.displayName})`, e.g. "PERi-Salted
Chips (Regular)" / "PERi-Salted Chips (Large)", "Spier Chardonnay (125ml)" /
… / "(Bottle)".

## How this was caught

The user spot-checked "PERi-Salted Chips (Regular)" in the scraped output
(452kcal) against the live site's network tab and pasted the source JSON for
the item they saw (450kcal, with different protein/fat/carbs/fibre/salt too)
— asking where the discrepancy came from. Re-deriving the exact source of
their pasted numbers (grepping the full fetched JSON for the unique
`proteinMg`/`totalCarbsMg` values) found them nowhere in the file the
scraper was using at all, which is what surfaced the stale-URL bug — not a
units/parsing mistake, but a fundamentally different, out-of-date data
source. The user then provided the exact hashed URL their browser loaded,
confirming the real endpoint and the `window.___chunkMapping` discovery
mechanism.

## Category

`section.displayName` (e.g. "Sides", "Drinks", "Nandinos (Kids)"), through
the existing `normalizeCategory()` — same as every other scraper, no
per-scraper mapping. Sections sharing a `displayName` (e.g. the two "Sides"
sections — one `kind: SIDES` with 50 items, one oddly `kind: DRINKS` with 7)
naturally merge into one category; no special-casing needed.

## Out of scope: the global `bastes` list and every other `modifiers` entry

The 8 PERi-PERi spice levels (`menu.bastes`) are **not** scraped as items —
they aren't listed under `sections` at all (Nando's own site doesn't present
them as an independently-orderable dish), and they only carry `energyKcal`
with no protein/fat/carbs breakdown, so there's no way to represent one
accurately as a `NutritionData` row anyway. Every item's own
`factsForPortionSizes` already stands as its "as-published" nutrition
regardless of baste choice.

Every modifier other than `choose-size-*` is ignored — `choose-baste`
(flavour), `choose-side`/`choose-drink`/`choose-add` (bundling in other,
already-separately-scraped items), `choose-remove` (ingredient removal),
`choose-meal` (combo pricing), `choose-chicken` (protein-cut choice), etc.
Same reasoning as Wingstop's per-piece items: the optimizer already composes
separately-scraped Sides/Drinks/Extras items with mains to hit a macro
target — we don't need to model Nando's own combo UI to get the same result.

## Everything else

- Insertion goes through the existing shared `addItem()` (spec 04). The
  full menu has substantial raw duplication (e.g. "Fully Loaded Chips"
  listed 3× consecutively within one section, likely per-`restaurantGroup`
  or per-`fulfilmentTypes` variants) — `addItem()`'s exact-macro-match
  dedup handles the large majority of these as silent no-ops; genuine
  same-name-different-macro items (e.g. two distinct "Coleslaw" recipes,
  "3 Chicken Wings" existing in both PERi-PERi Chicken and Nandinos (Kids)
  with different macros) split/requalify as usual.
- No browser needed — two `axios.get`s (HTML for the hash, then the JSON),
  same "no Playwright" spirit as KFC/Wagamama/Wingstop.
- Icon: 🐔 is taken (Popeyes); 🌶️ (peri-peri heat, Nando's own branding
  motif) is free.

## Wiring

- `src/scrapers/Nandos/scraper.ts` (new).
- `src/config.ts`: `RestaurantKey` gains `'NANDOS'`.
- `src/scrapers/scraping-oprerator.ts`: `scrapeNandos()` (cached, like the
  other live scrapers), wired into `scrapeAll()` and `scrapeRestaurant()`.
- `src/tools/build-web-data.ts`: `REGISTRY` gains a Nando's entry
  (`source: 'live'`).
- `.env.example` / `README.md`: `DISABLE_NANDOS` row; restaurant added to
  the features list and the data-sources table.

## Verification plan

- Run the scraper standalone against the real (hash-discovered) endpoint;
  confirm output row count is plausible from 440 source items. **Actual,
  verified against a live run:** 200 items found — 13 skipped for
  missing/zero nutrition, 286 exact-duplicate rows dropped (the raw
  per-`restaurantGroup`/`fulfilmentTypes` repetition noted above), 8 name
  collisions requalified.
- Spot-check the exact item the user flagged: "PERi-Salted Chips (Regular)"
  = 450 kcal, 6.6g protein, 18g fat, 68.9g carbs — matching the live site
  exactly. **Verified**, and cross-checked directly against
  `nandos_nutrition.json`.
- Spot-check the Wine `choose-size-wine` expansion: "Spier Chardonnay
  (125ml)" = 98 kcal, "(175ml)" = 130 kcal, "(250ml)" = 185 kcal, "(Bottle)"
  = 555 kcal. **Verified.**
- Confirm "Chicken Butterfly" comes through as one row (332 kcal, 59.4g
  protein) with no baste/side/meal-size modifiers folded in. **Verified.**
- Confirm `addItem()` resolves every collision without silently dropping
  distinct data (0 implausible-macro drops). **Verified.**
- `yarn build` clean; `yarn build:data --no-cache` includes Nando's (200
  items) alongside all 8 other restaurants scraping cleanly in the same run.
