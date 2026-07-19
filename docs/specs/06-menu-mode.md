# 06 — Menu mode: manually build a meal against your goals ✅

## Goal

A web-app mode where the user browses a restaurant's menu and hand-picks items
(instead of running the optimizer), with an always-visible summary comparing
running totals to their targets.

## What shipped

- **Mode switch** (`web/src/App.tsx`): a `.segmented` tab row — 🎯 Optimize |
  🍽️ Build a meal — right below the header, above the shared `MacroInput`.
  Switching modes clears `results`/`picked`/`tracked` so a stale panel from
  the other mode never lingers.
- **`web/src/components/MenuBuilder.tsx`** — single-select restaurant chips
  (same `.chip` styling as `RestaurantPicker`, one restaurant at a time), a
  search box, and the menu grouped by category (falls back to an "Other"
  bucket for uncategorized items — every restaurant has categories per specs
  02–03, but this keeps the component correct even if one didn't). Each row
  shows name + macros and a `+` button that becomes a −/count/+ stepper once
  added.
- **`web/src/components/StickySummary.tsx`** — a `position: sticky` bar
  showing current/target/remaining per macro, colored via `format.ts`'s new
  `macroStatusColor()` (green within 5%, amber under, red over), plus the
  "Track this meal" button.
- **`web/src/menu.ts`** — pure helpers shared by both components:
  `menuItemKey()` (keys by `restaurant::name` so the same item name from two
  restaurants stays distinct) and `menuTotals()` (sums an in-progress meal).
- **State**: `menuMeal: Map<string, { item: MenuItem; qty }>` in `App`,
  restaurant-qualified by key — surviving restaurant switches, so a meal can
  mix items from several restaurants (verified below).
- **TrackPanel reuse**: "Track this meal" expands the qty map back into a flat
  `MenuItem[]` (qty 2 → the item appears twice, matching how an optimizer
  combo already represents a repeated item) and builds an `OptimizationResult`
  — real `totalNutrition` and `accuracy` computed against the current
  targets — then hands it to the *same* `TrackPanel` optimize mode uses. No
  new send/copy code was needed. "Suggest swaps" naturally no-ops here
  (`suggestSwaps` already guards on `picked`, which menu mode never sets) —
  matches spec's "out of scope" for substitution suggestions without any
  special-casing.

## Bug found and fixed: the desktop "top-pinned" sticky never actually engaged

The original design (matching the spec draft) called for the sticky bar to
pin to the bottom on mobile and near the top on wider viewports. Implemented
that as a `@media (min-width: 641px)` flip of `top`/`bottom`, then verified
it by actually scrolling in a real (Playwright-driven) browser rather than
trusting the CSS to work as intended — good thing, because it didn't.

The app is a single centered column (`max-width: 720px`) with nothing beside
the summary to anchor a top-pin against, and `.sticky-summary` sits right
after the entire (long) menu list, with only an empty tracked-slot and the
footer trailing it. A CSS top-sticky only becomes visible once you've
scrolled *up to* its natural document position; here that position sits so
close to the page's absolute end that the scrollable range runs out before
the pin can engage — measured directly: the scroll offset needed to trigger
it sat *past* `document.scrollHeight - viewportHeight`, i.e. unreachable.
The bottom-pin (mobile's original rule) doesn't have this problem, since it
engages as soon as the short trailing content fits the remaining viewport,
and holds for the entire scroll. Fix: dropped the desktop media query
entirely — bottom-pinned everywhere, which is what "always visible while
scrolling the menu" actually requires on this page shape.

## Out of scope (per original spec, unchanged)

CLI equivalent; saving named meals; substitution suggestions inside menu mode
(spec 07's direction, in reverse).

## Verification (done)

Drove the running dev server with Playwright (not just typecheck):

- Selected KFC, added one item plus a second at qty 2 via the stepper (+/−),
  confirmed the running sticky totals updated correctly.
- Switched to McDonald's *without clearing the meal* and added a third item —
  confirmed the KFC items were still present (cross-restaurant meal
  persistence) and the sticky totals reflected all three.
- Searched "wing" and confirmed KFC's list correctly filtered from 135 items
  down to 3.
- Clicked "Track this meal": `TrackPanel` opened showing all four expanded
  rows (the qty-2 item as two separate lines), matching optimizer-combo
  display conventions exactly.
- Forced deliberately mismatched targets and confirmed all three status
  colors render correctly (red over, amber under, green within 5% — verified
  via computed style, not just visual guess).
- Confirmed the MFP copy-fallback path fires from a menu-mode-tracked meal
  exactly like an optimizer combo (clipboard contained the same `MM1:...`
  token format).
- Found and fixed the desktop sticky-pin bug above via direct
  `boundingBox()`/`scrollTo()` measurement in a real browser, not just
  visual screenshot review.
- `yarn build` and the web app's `tsc --noEmit` both clean.
