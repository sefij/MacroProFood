# 09 — Add Wingstop as a restaurant

## Goal

Add Wingstop UK to the scraped restaurants, sourced from a public JSON menu
endpoint rather than HTML — the simplest source shape in the app so far.

## Data source

`https://live.menu.app.andithas.com/4dfd8702-9ace-4b89-a02a-3cd8861e740c/menu.json`
— a plain JSON GET (gzip-compressed over the wire; `axios` decompresses
transparently). Shape:

```
{ sections: [ { name, items: [ { name, description, nutritionals, ... } ] } ] }
```

`nutritionals` carries `calories`, `protein`, `total_fat`, `carbohydrates`
(the four we use), plus `serving_size` and others we ignore.

## The core math

`multiplier = totalCalories ÷ nutritionals.calories` (the item's true total
calories, parsed from the description — see below — divided by the
per-`serving_size` calories the feed publishes); then every other macro
(`protein`, `total_fat`, `carbohydrates`) scales by that same multiplier.

Worth noting why this works uniformly without needing to assume
`serving_size` is 100: for large shareable items (wings, burgers, platters,
fries, corn, churros) it genuinely is 100 (a normalized per-100g rate, since
one flavour's profile has to cover many order sizes), but for fixed-size
single-serve items `serving_size` is already the real weight/volume and
`nutritionals.calories` is already that item's true total — e.g. a
milkshake reports `serving_size: 350, calories: 571`, and the description
independently confirms `"571kcal"`; a dip reports `serving_size: 49,
calories: 225` matching `"225kcal - 49g"`. The multiplier formula handles
both cases identically (it just comes out to 1 for the already-true-total
ones), so there's no need to branch on what `serving_size` equals. Verified
against the request's own Crowd Pleaser example: 1375kcal/person × 5 people
= 6875 kcal; multiplier = 6875/232 = 29.63; protein = 20 × 29.63 = 592.7g.

## Parsing `description` for true total calories

Descriptions are free text with no consistent machine format. Pulled every
item (102 total) and found these shapes, checked in this order (first match
wins), each producing one or more `(suffix, totalCalories)` results:

1. **Two-size items** — `"Regular 175g= 371kcal Large 250g = 531kcal"`
   (Fries), `"Regular = 418kcal Large 597kcal"` (Sweet Potato Fries, "="
   and gram-weight both inconsistently present/absent across rows). Extract
   via `/(Regular|Large)[\s\S]*?(\d+(?:\.\d+)?)\s*kcal/gi` (global, lazy —
   skips over any intervening "175g=" text since it never itself ends in
   "kcal") → **two items**, e.g. "Wingstop Style Fries (Regular)" / "(Large)".
2. **Two-count items** — `"4 Cobettes 210kcal or 8 Cobettes 421kcal..."`
   (Corn on the Cob) and `"6x 257kcal & 10x 455kcal"` (Churros). Same
   lazy-skip idea, generalized: `/(\d+)\s*Cobettes[\s\S]*?(\d+(?:\.\d+)?)\s*kcal/gi`
   and `/(\d+)x[\s\S]*?(\d+(?:\.\d+)?)\s*kcal/gi` → **two items** per name,
   suffixed "(4 Cobettes)"/"(8 Cobettes)" or "(6x)"/"(10x)".
3. **Per-person + name says "(For N)"** — `"1375kcal per person"` +
   `"The Crowd Pleaser (For 5)"` → `total = perPerson × N` (N parsed from the
   name). One item, name unchanged (already carries "(For N)").
4. **Per-piece** — `"Average 90kcal per Wing"` (also "per Boneless" / "per
   Tender", covering the Wings/Boneless/Tenders "& Flavours" sections — 36
   items across the three). No quantity is ever given in this feed for these
   — Wingstop's real site lets you pick a piece-count for a flavour
   separately. Rather than guess a quantity, treat each as **one single
   piece**, matching the existing per-piece convention already in this app
   (KFC's "Hot Wing (per piece, average)"): name becomes e.g. "Atomic Wings
   (per wing, average)", total = the stated per-piece kcal. Ordering "6
   wings" is then just adding that one item 6× via the existing menu-mode
   stepper — composability the app already has, no new modeling needed.
5. **Fallback: first plain number immediately followed by "kcal"/"kcals"**
   (case-insensitive, optional space, tolerates the one "1035kcals" plural) —
   covers plain totals ("689kcal"), "X kcal per platter" (the qualifier
   after the number doesn't matter, we already have the right total),
   "from Nkcal*" (Tender Fix — a stated *minimum*, since actual varies by
   chosen flavour; documented as an approximation, same caveat style as
   Taco Bell/Subway's existing source-accuracy notes), and milkshakes/dips
   whose description states the total directly. One item, name unchanged.
6. **No "kcal" anywhere in the description at all** (4 items, all small
   Dips missing a stated total) — use `nutritionals` completely as-is
   (scale = 1). Confirmed safe: every *other* dip's `serving_size` already
   matches its real weight, so these almost certainly do too.

## The standalone "Flavours" section is kept, not dropped

10 items (Atomic Sauce, Mango Habanero, …) list each flavour/rub's own
calories on its own — already baked into every flavoured Wing/Boneless/
Tender/Burger item's own total, so adding both could double-count a flavour.
An earlier draft of this spec proposed dropping the section entirely to
avoid that, but that's a scrape-time judgment call this project deliberately
doesn't make elsewhere (spec 05: filtering is a user preference applied at
optimization time, not something scrapers decide — the data keeps every
item). Scraped like any other section, under its own "Flavours" category;
anyone who doesn't want it cluttering results can exclude that category via
the existing per-restaurant category filter, same as any other category.

## Everything else

- **Category** = the section name as published (`Wings & Flavours`, `Dips`,
  `Fries`, `Corn on the Cob`, …), normalized via the existing
  `normalizeCategory()` — no per-scraper category mapping needed.
- Insertion goes through the existing shared `addItem()` (spec 04) like
  every other scraper, so an accidental name collision (e.g. two sections
  independently producing "Regular" as a suffix) resolves safely instead of
  silently overwriting.
- No browser needed — a single `axios.get` + `JSON.parse`, same shape as
  KFC/Wagamama's HTTP-only scrapers.
- Icon: 🔥 (Wingstop's KFC/Popeyes chicken-emoji neighbors are already
  taken; heat/flavour is Wingstop's own branding hook).

## Wiring

- `src/scrapers/Wingstop/scraper.ts` (new).
- `src/config.ts`: `RestaurantKey` gains `'WINGSTOP'`.
- `src/scrapers/scraping-oprerator.ts`: `scrapeWingstop()` (cached, like the
  other live scrapers), wired into `scrapeAll()` and `scrapeRestaurant()`.
- `src/tools/build-web-data.ts`: `REGISTRY` gains a Wingstop entry
  (`source: 'live'`).
- `.env.example` / `README.md`: `DISABLE_WINGSTOP` row; restaurant added to
  the features list and the data-sources table.

## Out of scope

Modelling the real "pick a piece-count + flavour" combo flow precisely —
covered well enough by per-piece items + the app's existing stepper.
Per-item availability/scheduling (the feed has no such flag; every item is
treated as always orderable).

## Verification plan

- Run the scraper standalone; confirm item count is plausible (~102 source
  items → more than 102 output rows, since Fries/Sweet Potato Fries/Corn/
  Churros each expand into 2).
- Spot-check the exact worked example from the request: "The Crowd Pleaser
  (For 5)" → 6875 kcal, 592.7g protein (scaled from the 20g/100g base).
- Spot-check a per-piece item (e.g. "Atomic Wings (per wing, average)" =
  90 kcal) and a two-size item (Fries "(Regular)" = 371 kcal, "(Large)" =
  531 kcal).
- Confirm the 4 kcal-less Dips come through with their `nutritionals` used
  directly, un-scaled.
- Confirm zero duplicate-key collisions logged.
- `yarn build` clean; `yarn build:data --no-cache` includes Wingstop.
