# 05 — Advanced filtering: exclude categories from calculations ✅

## Goal

Let users exclude whole categories (e.g. desserts, drinks, sauces) so the
optimizer never proposes them, instead of hardcoded per-scraper drops.

## What shipped

`src/core/category-filter.ts` — `excludeCategories(data, excludedCategories)`,
a pure function dropping any item whose `category` case-insensitively matches
one of the excluded names (items with no category are never excluded).
Shared by the CLI and the web app so both apply the identical rule.

Filtering happens **at optimization time, not scrape time** — scraped data
keeps every item.

### CLI

- `-x, --exclude-category <name...>` in `src/main.ts` (commander variadic —
  one flag occurrence takes multiple space-separated names:
  `-x Drinks Desserts`; the spec draft's "repeatable flag" wording is
  satisfied this way rather than via `-x A -x B` accumulation, which would've
  needed a custom collector for no real benefit).
- `defaultExcludedCategories()` in `src/config.ts` reads comma-separated
  `EXCLUDE_CATEGORIES` from the env; used only when `-x` is omitted (replaced,
  not merged, when given). `.env.example` ships `EXCLUDE_CATEGORIES=Drinks`
  uncommented, so a fresh `cp .env.example .env` preserves the old KFC
  behavior below by default.
- Applied in `main.ts` right after the "successfully scraped N items" log
  (so that count reflects the true unfiltered scrape) and before constructing
  `MacroOptimizer`, with an "Excluding categories: …" log line when active.

### Web app

Redesigned after initial ship, per direct feedback: rather than one flat,
global "exclude these categories" list, filtering is **per restaurant** with
**three modes** — closer to how someone actually thinks about it ("no drinks
from KFC, but only burgers from McDonald's").

- `src/core/category-filter.ts` gained `filterCategoriesByRestaurant(data,
  filters)`, keyed by restaurant display name (matching `RestaurantsData`'s
  own keys). Each restaurant's `RestaurantCategoryFilter` is `{ mode, categories
  }`: `'all'` (no filtering), `'include'` (allow-list — only the selected
  categories survive; an uncategorized item can't match an allow-list, so
  it's dropped), or `'exclude'` (deny-list — matches the original global
  behavior, scoped to one restaurant; uncategorized items are never excluded).
  An empty `categories` array passes everything through regardless of mode, so
  switching to "include selected" before picking anything doesn't instantly
  hide the whole restaurant. The original flat `excludeCategories()` is
  untouched and still backs the CLI.
- `CategoryFilters.tsx` renders one group per currently active restaurant that
  has categorized items — a "*Restaurant* categories" heading, a three-button
  mode selector (Include all / Include selected / Exclude selected), and,
  once a non-"all" mode is picked, that restaurant's own category chips
  (highlighted, not struck through, since "selected" now means different
  things in each mode). Nested inside `RestaurantPicker`'s card, under the
  same collapsible "Advanced filters" `<details>` as before.
- Default per restaurant: `'all'` (unfiltered) — matches "the web user sees
  everything until they choose."
- Selection persists in `localStorage` (`macropro:categoryFilters`, keyed by
  restaurant display name).
- `toRestaurantsData` (`web/src/data.ts`)'s third parameter is now
  `Record<string, RestaurantCategoryFilter>` and calls
  `filterCategoriesByRestaurant` — both the main "Find meals" compute path
  and `suggestSwaps` in `App.tsx` already funnel through this one function.

## KFC's hardcoded exclusion removed — real behavior change

KFC's scrape-time `EXCLUDED_CATEGORIES = new Set(['Drinks'])` (dropping drink
products before they ever reached `RestaurantData`) is deleted; drinks now
flow through with `category: "Drinks"` like any other item, and are excluded
only by the new opt-time mechanism. **KFC's raw scraped item count is now 135,
not 81** — the 54 drink items were always there, just invisible. A user who
runs the CLI with no `.env` at all (no `EXCLUDE_CATEGORIES`) will now see
drinks in results by default; shipping `EXCLUDE_CATEGORIES=Drinks` in
`.env.example` preserves the old default for anyone who copies it normally.

**Popeyes' `EXCLUDED_SECTIONS`, Taco Bell's category/name-substring checks, and
Wagamama's `DRINK_CATEGORY` regex exclusion were deliberately left as-is** —
scoped out of this task. Unlike KFC's, none of them are *purely*
category-based: Taco Bell's also matches literal item names ("churro",
"pepsi", "water" — not real meal items regardless of any category system),
and revalidating a full removal for three more scrapers wasn't warranted for
this pass. Worth revisiting if consistency across all scrapers becomes a
priority — see [[item-categories]] memory.

## Out of scope

Per-item (not per-category) exclusion; macro-based filters. (Include-only
mode, originally listed here as out of scope, ended up in scope once the web
UI went per-restaurant — see above.) The CLI's `-x` flag stays a single
global deny-list; it wasn't asked to grow per-restaurant modes.

## Verification (done)

- CLI: `node dist/main.js -e kfc --no-cache -x Drinks` → scraped 135, "Excluding
  categories: Drinks" logged, combos contain no Drinks-category items.
  `EXCLUDE_CATEGORIES="Drinks,Desserts"` env var (flag omitted) → same
  exclusion applied from the default. Neither set → all 135 items available,
  no exclusion message.
- Web (post-redesign): drove the running dev server with Playwright, KFC +
  McDonald's both active. Confirmed two groups render ("KFC categories",
  "McDonald's categories"); set KFC to "Exclude selected" + Drinks and
  McDonald's to "Include selected" + Burgers; "Find meals" produced KFC combos
  with no Drinks items and McDonald's combos containing *only* burger items
  (Big Mac, Quarter Pounder, …) — confirming the allow-list mode actually
  restricts to the chosen category, not just excludes the rest by accident.
  Summary line read "2 restaurants filtered". A full reload preserved both
  restaurants' modes. Screenshots confirmed clean nested layout, active mode
  clearly highlighted, no overflow.
- `yarn build` and the web app's `tsc --noEmit` both clean.
