# 07 — Menu mode inside normal mode ✅

**Depends on:** 06 (menu builder + sticky summary components).

## Goal

After the user picks an optimized combo, let them hand-add menu items to the
picked meal — alongside the existing swap suggestions in `TrackPanel` — using
the same browsing UI as menu mode.

## Note on the gate

The spec draft said this was contingent on 06 "proving useful" first, with no
real usage signal available yet. Built anyway on explicit direction — the
user asked for it directly ("add the option to use the menu instead of the
supplemental suggestion in the optimized mode") rather than waiting on the
originally-envisioned usage signal, which doesn't really exist for a
just-shipped feature in this project's shape anyway (no analytics, no other
users yet).

## What shipped

Two small extractions made the reuse clean instead of duplicating markup:

- **`MenuItemList`** (pulled out of `MenuBuilder.tsx`): the search box +
  category-grouped, add/stepper item list, with no restaurant switcher of its
  own. `MenuBuilder` now wraps it with the restaurant chips (unchanged for
  menu mode); `TrackPanel` uses it directly, scoped to the tracked meal's own
  restaurant.
- **`MacroStatusGrid`** (pulled out of `StickySummary.tsx`): the bare
  current/target/remaining tiles, no "Track this meal" button (redundant
  inside a panel that's already tracking something). `StickySummary` now
  wraps it with that button for menu mode's top-level flow.
- **`TrackPanel.tsx`** gained a `menuItems: SnapshotItem[]` prop (the tracked
  meal's restaurant's full item list; `App.tsx` resolves it from
  `tracked.items[0].restaurant`) and a collapsible "＋ Add from menu" section
  — same disclosure pattern as "Advanced filters" / menu mode's category
  groups — containing `MacroStatusGrid` (current combo totals vs. targets)
  and `MenuItemList`.
  - **Add** reuses the *existing* `addSuggestion` handler unchanged (the same
    one swap-suggestion chips already call) — pushes a new `{item, on: true,
    added: true}` row.
  - **Remove** is new (`removeFromMenu`): turns the most recently matching
    `on` row *off* rather than deleting it, so it stays toggleable via its
    own checkbox exactly like any other row — no separate deletion concept
    was introduced.
  - The item-list's own "already added" quantity is derived from the current
    `rows` (only `on` ones) via a small `useMemo`, so toggling a row off
    anywhere (its checkbox or the embedded stepper) is immediately reflected
    back in the embedded browse list as an available `+` again.
- Section only renders when `menuItems.length > 0` (i.e. the restaurant
  resolved successfully) — silently absent otherwise rather than showing an
  empty, useless list.

## Verification (done)

Drove the running dev server with Playwright:

- Set targets, restricted to KFC, computed, picked a combo (4 items) — opened
  "+ Add from menu" and confirmed the status grid showed the *original*
  combo's totals against the targets set earlier.
- Expanded "Burgers" inside the embedded list and added "Fillet Burger" —
  confirmed it appeared in the main meal-items list tagged "added" and the
  status grid updated to the new (now over-target) total.
- Clicked the embedded stepper's − button — confirmed the row turned off
  (struck through, unchecked) rather than disappearing, its browse-list row
  reverted to a plain `+` (its active quantity is back to 0), and the
  clipboard token reverted to *exactly* the original combo's totals —
  round-tripping add → remove correctly, not just add.
- `yarn build` and the web app's `tsc --noEmit` both clean.
