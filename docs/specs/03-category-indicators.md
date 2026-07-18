# 03 — Show category indicators on items in the view

**Depends on:** 02 (item categories).

## Goal

Wherever an item name is rendered, show a small category indicator so users can
tell at a glance what kind of item a combo contains (a burger vs a dessert vs
a drink).

## Web app

- `web/src/components/Results.tsx` (combo item lists) and
  `web/src/components/TrackPanel.tsx` (picked meal + swap suggestions): render
  a compact badge after each item name.
- Representation: a small emoji chip chosen by keyword match on the category
  name (🍔 burgers, 🍗 chicken, 🍟 sides, 🥗 salads, 🍰 desserts/cookies,
  🥤 drinks, 🥪 subs/wraps, 🧂 sauces/extras, fallback 🍽️), with the full
  category name in a `title` tooltip. Keyword→emoji map lives in a new
  `web/src/category.ts` so 05 can reuse it.
- Items with no `category` get no badge (no fallback noise).

## CLI

- Where results are printed in `src/main.ts`, append a dim `chalk.gray`
  `[Category]` suffix to each item line. Same fallback rule: omit when unknown.

## Out of scope

Filtering by category (05); editing/overriding categories.

## Verification

Run the web app with freshly built data and confirm badges render in results
and the track panel, tooltips show the category, and uncategorized items render
exactly as today. CLI: run an optimization and check the suffix formatting.
