# 06 — Menu mode: manually build a meal against your goals

## Goal

A web-app mode where the user browses a restaurant's menu and hand-picks items
(instead of running the optimizer), with a always-visible summary comparing the
running totals to their targets.

## UX

- Mode switch at the top of the app (`web/src/App.tsx`): **Optimize** (current
  flow) | **Menu** (new). Targets input (`MacroInput`) is shared by both modes.
- Menu mode layout:
  1. Restaurant selector (single-select — reuse `RestaurantPicker` visuals).
  2. Searchable, category-grouped item list (groups from 02/03; plain list
     until categories ship). Each row: name, kcal/P/F/C, and a `+` button;
     added items show a quantity stepper (`−` / count / `+`).
  3. **Sticky summary bar** (bottom on mobile, top-pinned card on desktop):
     for each macro show `current / target` plus remaining, color-coded —
     green within 5% of target, amber under, red over. Always visible while
     scrolling the menu (`position: sticky`).
- The built meal reuses `TrackPanel`'s existing send/copy path so it can be
  pushed to MyFitnessPal exactly like an optimized combo (build an
  `OptimizationResult` from the picked items).
- Meal state survives switching restaurants (a mixed-restaurant meal is
  allowed; items are tagged with their restaurant as `MenuItem` already
  supports).

## State & components

- New `web/src/components/MenuBuilder.tsx` (list + search + stepper) and
  `web/src/components/StickySummary.tsx` (also reusable by 07).
- Meal state: `Map<itemKey, { item: MenuItem; qty: number }>` in `App` state,
  restaurant-qualified keys.
- No optimizer involvement; totals are simple sums.

## Out of scope

CLI equivalent; saving named meals; substitution suggestions inside menu mode
(that's 07's direction, in reverse).

## Verification

Build a meal across two restaurants, watch the summary update per add/remove,
confirm sticky behavior on a narrow viewport, and push the result to MFP (or
copy fallback) successfully.
