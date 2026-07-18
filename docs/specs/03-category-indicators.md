# 03 — Show category indicators on items in the view ✅

**Depends on:** 02 (item categories).

## Goal

Wherever an item name is rendered, show a small category indicator so users can
tell at a glance what kind of item a combo contains (a burger vs a dessert vs
a drink).

## Web app

- `web/src/category.ts` — pure `categoryIcon(category): string | null`, a
  keyword-match table (🍔 burgers, 🍗 chicken, 🥗 salads, 🍰 desserts/cookies,
  🥤 drinks, 🥪 subs/wraps/tacos, 🧂 sauces/toppings, 🍟 sides/fries/dips,
  fallback 🍽️ for a real-but-unmatched category), returning `null` for no
  category so callers render nothing (no fallback noise). Kept JSX-free so
  05's filter-chip UI can reuse it.
- Badge rendered as `{icon && <span className="cat-badge" title={category}>{icon}</span>}`
  at the three places an item name actually appears:
  - `web/src/components/MealBlock.tsx` — the full (non-compact) combo item
    list. (The collapsed one-line "compact" summary, shown for the options
    you didn't pick, stays text-only — it already drops the per-item calorie
    breakdown for space, so a badge there would be its own kind of clutter.)
  - `web/src/components/TrackPanel.tsx` — the editable meal checklist and the
    swap-suggestion chips.
  - `.cat-badge` CSS: small left margin, slightly reduced opacity, default
    cursor — added to `web/src/styles.css`.

## CLI

- `src/macro-optimizer.ts`'s `displayResults()` (the actual per-item render
  site — not `src/main.ts`, which only calls it): appends a dim
  `chalk.gray(' [Category]')` after each item's name line, omitted when
  `item.category` is unset.

## Out of scope

Filtering by category (05); editing/overriding categories.

## Verification (done)

- Web: local `web/public/data/*.json` snapshots already carried categories
  from a prior `build:data` run. Drove the running dev server with Playwright
  — filled targets, ran "Find meals", confirmed `.cat-badge` elements render
  in the results list with correct icon + `title` tooltip (e.g. "Spicy Italian
  Salad" → 🥗, title "Salads"), then picked a meal and confirmed badges also
  render in the Track panel's checklist and (after unchecking an item and
  requesting swaps) the suggestion chips. Screenshots showed clean inline
  spacing, no overflow, in both the full item list and the checklist.
- CLI: ran `displayResults()` directly against a mixed categorized/
  uncategorized item set — categorized item printed `Bacon Sub [Subs]`;
  uncategorized items get no suffix.
- `yarn build` and the web app's `tsc --noEmit` both clean.
