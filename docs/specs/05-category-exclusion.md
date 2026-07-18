# 05 — Advanced filtering: exclude categories from calculations

**Depends on:** 02 (item categories); pairs with 03's category map for the UI.

## Goal

Let users exclude whole categories (e.g. desserts, drinks, sauces) so the
optimizer never proposes them, instead of today's hardcoded per-scraper drops
(e.g. KFC's `EXCLUDED_CATEGORIES = {'Drinks'}`).

## Behavior

- Filtering happens **at optimization time**, not scrape time — the data keeps
  every item; exclusions are a user preference. (KFC's hardcoded drop can then
  be removed, since "Drinks" becomes a default exclusion instead.)
- Matching is case-insensitive on the normalized category name. Items with no
  category are never excluded.

## CLI

- New repeatable flag: `-x, --exclude-category <name...>` in `src/main.ts`
  (commander variadic), applied by filtering `RestaurantsData` before it is
  handed to the optimizer.
- Optional env default `EXCLUDE_CATEGORIES=Desserts,Drinks` in `src/config.ts`
  (comma-separated), overridden by the flag.

## Web app

- New collapsible "Filters" row under `RestaurantPicker`: chips for every
  category present in the loaded snapshots (union across selected restaurants,
  using 03's emoji map), each toggleable; excluded chips render struck-through.
- Default exclusions: none (unlike the CLI env default — the web user sees
  everything until they choose).
- Selection persists in `localStorage`.
- Implementation: filter inside `toRestaurantsData` (`web/src/data.ts`), which
  both the main compute path and swap suggestions already share.

## Out of scope

Per-item (not per-category) exclusion; include-only mode; macro-based filters
("no items over 500 kcal").

## Verification

CLI: run with and without `-x Desserts` against one restaurant and diff the
proposed combos. Web: exclude a category, recompute, confirm no item from it
appears in results or swap suggestions, then reload to confirm persistence.
