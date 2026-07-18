# 04 — Safe conflict resolution for duplicate item names ✅

## Problem

`RestaurantData` is keyed by item name, so two distinct items with the same
name silently overwrote each other — every scraper either warned-and-
overwrote (the PDF base) or had no detection at all (every live scraper).
Losing an item skews the optimizer (missing candidates) and misreports counts.

## What shipped

`src/scrapers/add-item.ts` — one shared `addItem(items, name, nutrition)`
helper, routed through by the PDF base and all five live scrapers (KFC,
McDonald's, Popeyes, Taco Bell, Wagamama), replacing every direct
`items[name] = …` assignment.

Resolution, checked against **every existing key in `name`'s family** (the
bare name, plus any already-qualified `"name (…)"` variants — not just the
bare name, which matters once a name has already collided once; see bug
below):

1. No existing entry anywhere in the family → insert under the bare `name`.
2. An existing variant with **identical macros** → same product listed twice
   (e.g. under two menu sections); keep it, drop the newcomer silently.
3. Different macros → genuine distinct item, both survive:
   - If this is the *first* collision (the bare `name` is still the one
     colliding) and the two items have different `category`s, neither is
     more "primary" — both move to `"name (category)"`.
   - Otherwise (no usable categories, or the bare name was already moved by
     an earlier collision) the established entry's key is left untouched,
     and only the newcomer gets the next free `"name (2)"`, `"name (3)"`, ….
     This avoids churning an already-displayed item's name just because
     something else with the same name shows up later.
   - One `chalk.yellow` line logged per rename.

## Bug found during verification: 3rd+ occurrence of an already-split name

Initial version only checked the *bare* `name` key for an identical-macro
match. Once a name has already been split (e.g. `"Nuggets (Chicken)"` /
`"Nuggets (Kids Meal)"` after a first collision), the bare `name` key no
longer exists — so a **third** occurrence, even one with macros identical to
one of the already-split variants, fell through to "no existing entry" and
got inserted as a brand-new, spuriously duplicated entry instead of being
recognized as the same product and dropped. Caught with a synthetic test
exercising the 3rd-collision path (real scraper data doesn't currently go
three deep). Fixed by checking *all* of a name's variant keys for a
macro match, not just the bare one.

## Real-world impact found during verification

Re-running Wagamama surfaced **5 previously-lost items** — e.g. "yasai yaki
soba | rice noodles" and "grilled chicken ramen" each appear twice in
Wagamama's menu with different macros (different portion/bowl variants) but
no distinguishing category (both "The Main Event"), so the second listing was
silently overwriting the first before this fix. Wagamama's item count is
therefore now **115, not 110** — the old number was the bug, not a baseline to
preserve. The single pre-existing Wendy's collision ("4 Pc Chicken Nuggets")
turned out to be case 2 (identical macros, same product under two menus) —
correctly dropped, count unchanged at 145.

## Consequences

- Keys stay display-friendly (they're what the CLI, web app, and MFP push
  show), hence `Name (Category)` rather than an opaque id.
- Snapshots/cache need no migration — keys are still plain strings.
- A 3rd+ occurrence whose category *could* disambiguate it nicely still falls
  back to a numeric suffix rather than `name (thatCategory)`, since the
  category-qualifier path only fires on the first collision (deliberate
  simplification — real data hasn't needed a 3-way category split yet).

## Verification (done)

- Synthetic test via `addItem` directly, covering: fresh insert; identical-
  macro duplicate; first collision with distinct categories (both moved);
  first collision with no categories (only newcomer numbered); a third
  distinct collision (sequential numbering); and a 4th "collision" that's
  actually a duplicate of an already-qualified variant (correctly dropped,
  not re-inserted) — this last case is what caught the bug above.
- Fresh scrape of all 8 restaurants: Subway (185), Wendy's (145), Domino's
  (151), KFC (81) unchanged from their spec-02 baselines, zero unexpected
  renames. Wagamama recovered from 110 → 115 (see above). Popeyes/Taco
  Bell/McDonald's re-verified with no regressions.
- `yarn build` clean.
