# 07 — Menu mode inside normal mode (if 06 proves useful)

**Depends on:** 06 (menu builder + sticky summary components). Deliberately
gated: ship 06 first, gather usage, then decide.

## Goal

After the user picks an optimized combo, let them hand-add menu items to the
picked meal — alongside the existing swap suggestions in `TrackPanel` — using
the same browsing UI as menu mode.

## UX

- In `TrackPanel` (`web/src/components/TrackPanel.tsx`), next to the swap
  suggestions section, add a "**+ Add from menu**" affordance that expands an
  inline `MenuBuilder` scoped to the picked restaurant.
- Items added/removed there update the panel's meal exactly like removing a
  combo item does today; `suggestSwaps` re-runs against the new remaining
  macros so suggestions and manual browsing stay consistent.
- The 06 `StickySummary` replaces/augments the panel's current totals display
  so current-vs-target stays visible while the menu list is open.

## Trigger for building this

06 is "proves useful" when it's actually used — before investing here, confirm
via the only signal available (user's own usage / feedback), per the README's
intent. If 06 flops, close this spec instead.

## Verification

Pick a combo, remove one item, add two others manually, and confirm totals,
swap suggestions, and the MFP push all reflect the edited meal.
