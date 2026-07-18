# 04 — Safe conflict resolution for duplicate item names

**Depends on:** 02 (categories make the best disambiguator), but a first
version can ship without it using numeric suffixes only.

## Problem

`RestaurantData` is keyed by item name, so two distinct items with the same
name silently overwrite each other:

- `PdfNutritionScraper.scrape()` detects the collision, logs a warning, and
  overwrites anyway (`src/scrapers/pdf/pdf-nutrition-scraper.ts`).
- Every live scraper (`KFC`, `McDonalds`, `Popeyes`, `TacoBell`, `Wagamama`)
  assigns `items[name] = …` with no detection at all — e.g. Wendy's-style
  menus where the same item name appears in multiple menu sections.

Losing an item skews the optimizer (missing candidates) and misreports counts.

## Design

Add one shared helper, e.g. `src/scrapers/add-item.ts`:

```ts
addItem(items: RestaurantData, name: string, nutrition: NutritionData): string
```

Resolution rules, in order:

1. **No existing entry** → insert under `name`.
2. **Existing entry with identical macros** (calories/protein/fat/carbs equal)
   → keep the first, drop the newcomer silently. This is the common case of
   the same product listed in two menus/sections.
3. **Existing entry with different macros** → both survive:
   - If the two items have different `category` values, re-key as
     `"<name> (<category>)"` (both the existing entry and the newcomer —
     the existing one is moved).
   - Otherwise fall back to `"<name> (2)"`, `"<name> (3)"`, ….
   - Log one `chalk.yellow` line per rename so scraper output stays auditable.

All scrapers (PDF base + the five live scrapers) route insertions through the
helper; the PDF base's current warn-and-overwrite block is replaced by it.

## Consequences

- Keys stay display-friendly — they're what the CLI, web app, and MFP push
  show — so qualification must read naturally, hence `Name (Category)`.
- Snapshots/cache need no migration: keys are still plain strings.
- MFP quick-add uses totals, not names, so renames are cosmetic there.

## Verification

Unit-style check by running each scraper fresh and asserting zero silent
losses: total inserted == total emitted (the PDF base already counts
collisions; extend the same counters to the helper). Manually confirm a known
Wendy's duplicate resolves into two qualified entries with distinct macros.
