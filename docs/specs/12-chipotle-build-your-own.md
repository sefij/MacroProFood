# 12 — Chipotle build-your-own order builder

> Status: **Done**, including automatic-optimizer integration, a since-fixed
> performance bug, target-aware candidate selection, and post-pick editing.
> All 5 formats shipped: `deliveroo.ts` (modifier-tree types +
> `parseDeliverooRoot`), `buildable.ts` (recursive walker + alias table),
> `SnapshotItem.build` (`core/types.ts`), `build-web-data.ts` wiring, a Menu
> Mode picker (`web/src/components/BuildYourOwn.tsx`), and
> `core/buildable-combos.ts` (required-choices-only expansion feeding the
> automatic optimizer via `web/src/data.ts`). A user-reported hang ("Find
> Meals" pegged the CPU with only Chipotle selected) traced to this expansion
> producing too many near-identical candidates for the search's pruning to
> handle — fixed by capping the expansion further (293 → ~150 rows) and, more
> importantly, by adding a hard wall-clock search budget to
> `core/optimizer.ts` itself, which turned out to protect several
> *pre-existing* restaurants (Nando's, Domino's, Subway) from the same latent
> issue. The cap was then made **target-aware** — ranked by whichever macro
> the request's own target leans on most, not a fixed heuristic. Finally, a
> tracked meal's build-your-own line — including one the *automatic
> optimizer* picked from its necessarily-capped candidate slice — can be
> **edited** back against the item's full, uncapped live tree, via
> `resolveInitialSelection` + `BuildYourOwnEditor`; see "Editing an
> already-picked combo" below. 58 tests passing (up from 22 after spec 11);
> verified against a live scrape and a full `web/tsc -b` + `vite build`.

## Goal

Let a user compose a genuine Chipotle build-your-own order — pick a format
(Bowl, Burrito, …), then a protein, rice, beans, salsa(s) and extras — and get
exact summed macros for it, using the same live per-ingredient PDF data
`ingredients.ts` (spec 11) already parses. This covers the long tail of real
orders that the 23 hand-curated dishes in `recipes.ts` don't: those are the
popular, pre-named combinations; this is "anything you could actually build
at the counter."

## Why this isn't "item alterations" (spec 10)

Alterations models **one flat, mutually-exclusive option list** per item —
Pizza Hut's 11 size/crust combos are one list, you pick one. Spec 10
explicitly ruled out "multiple independent choice axes" as out of scope.
Build-your-own is exactly that: several **independent** groups stacked
together. No amount of squeezing this into "a list of variants" works — it
needs its own data model.

## The real group structure — sourced live from Deliveroo, not hand-guessed

Deliveroo's own `__NEXT_DATA__` blob already encodes the exact choice
structure Chipotle's ordering flow uses, as a `root.modifierGroups` array
referenced by each item's `modifierGroupIds` — and, deeper, by each
**option's own** `modifierGroupIds` (a protein choice unlocks its own next
groups). Pulled live for "Burrito Bowl":

| Group | `minSelection`/`maxSelection` | Options |
| --- | --- | --- |
| Protein or Veggie | 1 / 1 (**required**) | Chicken, Steak, Carnitas, Braised Beef Barbacoa, Chipotle Honey Chicken, Sofritas, **Veggie** |
| Choose Rice | 1 / 1 (**required**) | White Rice, Brown Rice, **No Rice** |
| Choose Beans | 1 / 1 (**required**) | Black Beans, Pinto Beans, **No Beans** |
| Add Your Toppings | 0 / 9 (optional, up to all 9) | Fajita Veggies, Fresh Tomato salsa, Green-Chilli salsa, Red-Chilli salsa, Sweetcorn (= Chilli-Corn Salsa), Sour Cream, Cheese, Guacamole, Salad Lettuce |
| Extra | 0 / 6 (optional) | Extra/upgraded full scoops of each protein (a paid upsell, not a composition choice) |

This confirms your read: **Protein, Rice and Beans are each `min=1`
required** — not skippable groups, just single-select groups where "No
Rice"/"No Beans" is one of the concrete options. There's also **no separate Salsa group** — real
Chipotle folds all four salsas in with Cheese/Sour Cream/Guac/Lettuce/Fajita
Veggies into one flat, optional "Add Your Toppings" group. (Deliveroo's
`multiselect` flag reads `false` on both optional groups despite `maxSelection`
being 9 and 6 with that many real options — a schema quirk; `minSelection`/
`maxSelection` is what actually governs the real ordering flow, not that
flag.) The "Extra" group (buy an extra full scoop of any protein) is a
pricing upsell, not a composition axis — out of scope, same as no price
modeling elsewhere in this app.

**This changes the plan**: `buildable.ts` should scrape `root.modifierGroups`
live (group IDs, `minSelection`/`maxSelection`, option labels) rather than
hand-declaring the group shape — Deliveroo is now a *second* live source
here, not just a name lookup. What still needs hand-curation is the
**name mapping** from a Deliveroo option label to a PDF `ingredients.ts` key
(e.g. "Sweetcorn - medium (VG)" → "Chilli-Corn Salsa", "Braised Beef
Barbacoa" → "Barbacoa") — the same kind of alias table `recipes.ts` already
needed for whole dishes, just applied to option labels instead.

## Open data wrinkle: topping portions don't always match the PDF's serving size

Deliveroo's modifier options carry their own rough `nutritionalInfo`
(calories only, no protein/fat/carbs) — useful as a cross-check, and it
mostly agrees with the PDF: Green-Chilli salsa (6 kcal) and Red-Chilli salsa
(9 kcal) match the PDF's "Roasted Tomato …-Chilli Salsa" rows (59 g portion)
exactly, and Sweetcorn (38 kcal) matches "Chilli-Corn Salsa" (113 g) exactly.
**But** Deliveroo's "Fresh Tomato" topping shows **9 kcal**, while the PDF's
"Fresh Tomato Salsa" row is **15 kcal at 113 g** (confirmed no duplicate row
exists in the PDF — checked the raw text directly). The likely explanation:
a topping *scoop* added to a bowl is a smaller portion than a *side cup* of
the same salsa, and that happens to equal the PDF's published serving for
three of the four salsas but not the fourth.

This matters for accuracy once toppings compose a bowl (it doesn't affect
`recipes.ts`'s existing sides, which correctly use the full 113 g side
portion). **Resolved**: when two live sources disagree on a portion and the
gap is small enough to plausibly be scoop-size variance (not a wrong-product
mapping), **use the higher figure** — never derive a scale factor that
would under-report. Concretely: every topping uses the PDF's published
serving as its macros, since in every observed mismatch the PDF's figure is
the higher one (Fresh Tomato: PDF's 15 kcal beats Deliveroo's 9 kcal
hint — use 15). This is now a standing project rule for future 2-source
mismatches, not just this one case: prefer not under-reporting over
manufacturing precision from a single-number hint.

## Key decision (revised): full picker in Menu Mode; a bounded expansion feeds the automatic optimizer too

The automatic optimizer (`flattenItems` + the knapsack search) expects every
item to already be a small, fixed set of absolute-macro rows to search over.
A buildable item's *full* option space is the cartesian product of every
group's choices — proteins × rices × beans × topping subsets — which is in
the thousands per format (Quesadilla's own pick-3 group alone is
C(10,3) = 120). That full space was never going to be pre-flattened into
individual searchable rows; it would blow up the search for every other
restaurant's results and mostly generate combinations nobody would order.

Originally this meant buildable items were Menu-Mode-only. Revised after
follow-up discussion: **`src/core/buildable-combos.ts`** expands a build
tree into flat rows too, but only over the **required** groups (`'one'` and
`'exactly'`) — Toppings and every other `'many'` group are excluded, and an
`'exactly'` group (Quesadilla) is further capped to its 5 highest-calorie
choices before combinations are taken (see that module's docblock for the
full reasoning). This mirrors exactly how a *variant* item already expands
(`web/src/data.ts`'s `toRestaurantsData`, spec 10) — client-side, at request
time, from the same tree the picker already has, not a new static data
source. A first version of this produced 270 candidate rows across the 5
formats (54 + 54 + 54 + 28 + 80) alongside the 23 `recipes.ts` dishes; see
"A hang, its cause, and the fix" below for why that turned out to be too
many, and the current, further-capped count.

Toppings remain Menu-Mode-only regardless: still fully available in the
manual picker (uncapped, every live option), just excluded from what the
automatic optimizer searches over, since they're optional and a
comparatively small share of a dish's macros.

### A hang, its cause, and the fix

Shortly after shipping the above, a real "Find Meals" run (only Chipotle
selected, 1903 kcal / 177 g protein / 55 g fat / 235 g carbs) hung — the
tab became unresponsive and CPU usage spiked ("fans spinning louder").
Reproduced directly: with all 293 candidate rows, `findBestCombinations`
didn't return within 20 seconds. Isolated by re-running with a shrinking
subset of formats — 23 (recipes only) resolved in 3ms, +54 (Bowl) in 164ms,
+54 more (Burrito, 131 total) in 2.6s, +28 (Tacos, 159 total) in 6.2s, and
adding Salad's 54 (185+) never returned inside a 10s test timeout. The
growth was super-linear and non-monotonic in candidate count — evidence the
admissible-bound prune in `optimizeRestaurant` (`core/optimizer.ts`) was
being defeated, not just that there were "a lot" of candidates.

**Why the prune fails here specifically**: it assumes candidates are
reasonably differentiated (its "upper bound" reasoning gets tight fast when
a few items clearly dominate). Chipotle's build-your-own combos are the
opposite — dozens of rows that are the *same* dish with one ingredient
swapped, so huge numbers of partial combos score nearly identically to the
running best and none of them can be ruled out early. This is a structural
mismatch between how the candidates are generated and what the search
assumes, not a bug in either piece alone.

**Two-part fix, in `src/core/`:**

1. **`buildable-combos.ts` gained a root-level cap.** The Protein group (the
   top of every format's tree) is capped to `MAX_ROOT_CHOICES` (3),
   sampled *evenly across the protein-to-calorie ratio range* — not the
   highest-calorie 3, which would have systematically dropped genuinely
   different options (e.g. Sofritas, at 84 kcal, would never survive a
   highest-calorie cut against 150-210 kcal meats). This is the ratio-based
   idea from the original conversation about this feature, applied here as
   a tractability/diversity measure rather than a "assume everyone wants
   high protein" filter. Brings the total from 293 down to ~150-160 rows.
2. **`optimizer.ts` gained a hard wall-clock search budget** (1.5s per
   restaurant, checked every 4096 recursive calls to keep the check itself
   cheap) — a genuine safety net, not a tuning knob: it silently returns
   whatever `topK` has found so far once exceeded, rather than letting the
   search run away. This is the more important half of the fix. Spot-checking
   every other restaurant's snapshot against the same hard target surfaced
   that **this was already a latent, pre-existing issue** — Nando's (197
   items, no buildable combos involved at all) also hit exactly the same
   1.5s ceiling, and Domino's (151 items, 723ms) and Subway (185 items,
   523ms) were already meaningfully slow. Chipotle's build-your-own combos
   didn't invent this failure mode, they just had the most candidates and
   surfaced it first. The budget now protects all of them.

Re-verified against the exact reported target after both fixes: 156
candidate rows, resolves in a bounded 1.5s (down from an unbounded hang),
producing a valid 1899.5 kcal / 141.2 g protein / 54.8 g fat / 221.4 g carbs
combo against the 1903/177/55/235 target. Regression-tested with a synthetic
near-identical-candidate fixture (`src/core/optimizer.test.ts`) so this
doesn't require live Chipotle data to verify in CI.

### Target-aware candidate selection

Follow-up improvement, once the hang itself was fixed: the cap above was
still a **fixed** heuristic — every request capped the root Protein group to
3 choices sampled by protein-to-calorie ratio, regardless of what that
request's target actually needed. A user asking for a high-carb, low-protein
meal got the same protein-ratio-diverse candidates as one asking for very
high protein.

`buildable-combos.ts` gained `dominantMacro(targets)`: whichever of protein/
fat/carbs the request's own target leans on most by raw target grams — the
same "which macro is highest" rule `core/optimizer.ts`'s own candidate sort
already uses, reused here for consistency rather than inventing a second
convention. Every group's cap (`diverseIndices`, generalized from the
protein-only version) now ranks by *that* macro's per-calorie ratio instead
of always protein, keeping an even spread across the range — the choice that
contributes the most of the dominant macro, the one that contributes the
least, and points between. This applies uniformly to every `'one'` group
(not just the root) and to the `'exactly'` group's pool, replacing the
earlier calorie-based pool ranking.

This is architecturally free: `toRestaurantsData` (`web/src/data.ts`) already
runs fresh on every "Find Meals" click rather than being baked into the
static snapshot, so it just computes `dominantMacro(targets)` once per
request and threads it into every buildable item's expansion — no new
fetching, caching, or precomputation. `toRestaurantsData` gained a required
`targets: TargetMacros` parameter; both call sites in `App.tsx` pass their
already-available target (the swap-suggestion call site uses the meal's
overall `macros`, not the locally-widened `widened` target computed just
after it, since dominance is about the user's original ask, not the padded
search window).

Verified against the exact reported target (1903/177/55/235 — carbs is
dominant here, 235 > 177 > 55): the resulting combo hit carbs **exactly** at
235g, versus 221.4g from the pre-target-aware version above — a direct
accuracy improvement on the macro that mattered most for that specific
request. Covered by dedicated tests (`dominantMacro`'s tie-breaking; that
capping by 'protein' vs. 'fat' on the same choice set keeps different
choices).

### Editing an already-picked combo

Follow-up: once a build-your-own row is capped/ranked for the automatic
optimizer, a user is stuck with whatever the search happened to pick from
that narrowed slice — reasonable macros, but not necessarily the exact
protein/rice/beans they'd have chosen by hand. Requested improvement: let a
tracked meal's build-your-own line be **edited** back against the full,
uncapped tree, not just removed and rebuilt from scratch.

**`resolveInitialSelection(group, labels)`** (`core/buildable-combos.ts`) is
the inverse of the expansion above: instead of enumerating every valid pick,
it walks a tree matching a specific ordered label list — exactly what a
`ComboCandidate.labels` or a picker's `report.labels` already is — back onto
choice indices at every level, partitioning the label sequence across
sibling nested groups as it descends. Always resolved against the tree as
stored on the `SnapshotItem` (never a capped one — capping only affects
which combos the *optimizer* considers, not which choices exist), so it
works identically whether the combo being edited came from the automatic
search or a manual Menu Mode pick. Round-trip-tested: every combo
`expandBuildableCombos` can produce resolves back to the same choices at
every level via its own label list.

**`BuildStep`** (`web/src/components/BuildYourOwn.tsx`) gained an optional
`initial?: InitialSelection` prop, read once via `useState`'s lazy
initializer to seed `selected`, and threaded down to each nested `BuildStep`
via `initial?.nested.get(choiceIndex)?.[nestedGroupIndex]` — the same
recursive shape the component already had, just seeded instead of starting
empty. **`BuildYourOwnEditor`** is the new entry point: given the item, its
current composed name, and save/cancel callbacks, it parses the name back
into labels (`parseBuildRowLabels` — also doubles as the "is this row
editable" check), resolves the initial selection, and renders the same tree
UI pre-populated, with "Save changes" (disabled until valid, same rule as
adding) and "Cancel".

**`TrackPanel`** wires this in: each tracked row checks
`findBuildableSource(item, menuItems)` (loops the restaurant's full menu
looking for a `.build` item whose name is a prefix match) to decide whether
to show an "Edit" button; clicking it swaps that row for an inline
`BuildYourOwnEditor`; saving replaces the row's item in place (same
position, `on: true`) and closes the editor. `menuItems` here is already the
restaurant's *full* snapshot list (verified — same source `MenuBuilder`
uses), so this always has access to every live option, capped or not.

Verified end-to-end against a live scrape: an optimizer-picked "Bowl (Build
Your Own) — Sofritas, White Rice, Black Beans" row correctly re-resolves to
Sofritas at the root, White Rice under its Rice group, and Black Beans under
its Beans group (with the excluded Toppings group correctly resolving to no
selection, since it never contributed a label to begin with).

**Follow-up bug, caught by the user, not by this session's own
verification**: the editor rendered with every choice pill collapsed to a
sliver a few pixels wide, text wrapping illegibly inside it. Root cause:
`.meal-item label { flex: 1; min-width: 0; … }` — added for the row's own
label + Edit button layout — is a *descendant* selector, so it also matched
every `<label>` inside an open `BuildYourOwnEditor`'s choice tree
(`.build-choice` is a `<label>` too, many levels deep). `flex: 1` expands to
`flex-basis: 0%`, and combined with `min-width: 0`, every pill started from
zero width with nothing stopping it from collapsing below its content's
size — flex-wrap never got the chance to move items to a new line because
they were all shrinking to fit one line instead. Fixed by changing the
selector to `.meal-item > label` (direct-child combinator), which only
targets the row's own label; a second, related issue in the same rule block
(`.build-editor` setting both `flex-basis: 100%` and a conflicting `width`)
was cleaned up in the same pass. **This shipped without ever being opened in
an actual browser** — every check before the user's report was
typecheck/build/unit-test/live-data-only, which cannot catch a pure-CSS
layout bug. Re-verified visually via a scripted Playwright pass (launch the
real dev server, click through Optimize → pick a combo → Edit → change a
choice → Save) after the fix, confirming both the layout and the underlying
pre-population logic work correctly together.

## Format quirks found in the live trees — why the model is nested, not flat

Walking all 5 formats' real trees (not just Bowl, previously) found the
group structure isn't uniformly "Protein, then a fixed list of follow-up
groups" — it's genuinely **conditional on which choice you make**:

- **Tacos is inconsistent across protein branches.** Chicken/Steak/Barbacoa/
  Carnitas tacos only unlock "Choose Your Taco" (Crispy/Soft) → Toppings.
  Sofritas and Veggie tacos *additionally* unlock Rice/Beans groups that the
  meat proteins don't get. This isn't a rendering quirk — it's a real
  difference in Deliveroo's own ordering flow, so a scraper that assumes one
  canonical shape per format and applies it to every protein would either
  wrongly add Rice/Beans to a Chicken taco or wrongly omit them from a
  Sofritas taco.
- **Quesadilla doesn't fit "pick one" or "pick any" at all.** Its "Quesa
  Sides" group is `min=3, max=3` — pick **exactly 3** from a merged list of
  rice/beans/salsa/toppings (10 options). That's a third selection kind.
  Quesadilla's "Protein or Veggie" step also includes non-meat slots this
  app has never modeled as a protein before: "Cheese" (plain cheese
  quesadilla) and "Fajita Veggie".
- **Salad** is the one exception that's simple: same Protein → Rice → Beans
  → Toppings shape as Bowl/Burrito, plus one extra optional group
  ("Vinaigrette", 0/1 — maps straight onto the existing "Chipotle Honey
  Vinaigrette" PDF row).

So the data model has to represent **choices that unlock their own next
groups**, not a fixed flat list of groups per format:

## Data model (`src/core/types.ts`)

A third `SnapshotItem` shape, alongside today's *simple* (inline macros) and
*variant-bearing* (`variants[]`, spec 10):

```ts
export interface BuildChoice {
  label: string              // "Chicken", "White Rice", "No Beans"
  calories: number
  protein: number
  fat: number
  carbs: number
  next?: BuildGroup[]        // groups THIS choice unlocks — absent/empty for a leaf choice
}

export interface BuildGroup {
  label: string                          // "Protein or Veggie", "Choose Rice", "Quesa Sides"
  selection: 'one' | 'many' | 'exactly'  // 'one' = min=max=1 ("None" is a real option where Chipotle offers it); 'many' = 0..N; 'exactly' = pick exactly `count`
  count?: number                         // required when selection === 'exactly' (Quesadilla's "Quesa Sides": count 3)
  choices: BuildChoice[]
}

export interface SnapshotItem {
  // ...existing fields...
  build?: BuildGroup   // the single root group ("Protein or Veggie" for every format) — everything else hangs off each choice's `next`
}
```

An item carries **one** of `variants` or `build` (or neither, for a plain
item) — never both. This shape maps 1:1 onto Deliveroo's own tree (each
choice's `next` is that option's `modifierGroupIds`, recursively resolved),
so Tacos' per-protein variation and Quesadilla's pick-3 group are just what
the scraper finds when it walks the real data — nothing is special-cased in
the model itself. It also means the picker UI is naturally step-by-step
(you don't see Rice until you've picked a protein), matching how Chipotle's
own ordering flow actually works rather than showing every group at once.

## Scraper layer

Two live sources, cross-referenced like `recipes.ts` cross-references
Deliveroo dishes and the ingredient PDF: `ingredients.ts` for macros, and
Deliveroo's `root.modifierGroups` (via a new export from `deliveroo.ts`) for
the live group structure. A recursive walker starts at each format's root
item's single top-level group ("Protein or Veggie" in every format observed,
skipping the shared "Add a Drink?" group every root item also carries), and
for every option, recurses into that **option's own** `modifierGroupIds`
(skipping any group literally named "Extra" — the buy-more-protein upsell,
pricing only, no PDF macro to attach) to build its `next`. This walk needs
no per-format special-casing to get Tacos' and Quesadilla's real shapes
right — it just records whatever Deliveroo's tree actually contains for each
branch, including the asymmetries above.

New `src/scrapers/Chipotle/buildable.ts` holds the hand-verified **name
mapping** from each live Deliveroo option label to its `ingredients.ts` key
(e.g. "Sweetcorn - medium (VG)" → "Chilli-Corn Salsa", "Braised Beef
Barbacoa" → "Barbacoa", Quesadilla's "Cheese" protein slot → "Monterey Jack
Cheese", "Fajita Veggie" → "Fajita Vegetables") — the tree shape is live,
only this label↔ingredient alias table is hand-curated. Same "throw on a
missing mapping, don't silently drop" rule as `recipes.ts`: an alias that
stops resolving (Deliveroo renames an option, a PDF row disappears) should
fail the scrape loudly, not quietly narrow the picker.

What's hand-curated per format is just **which Deliveroo root item is the
format's entry point** ("Burrito Bowl" for Bowl, "Burrito" for Burrito,
"Salad" for Salad, "Tacos (3)" for Tacos, "Quesadilla" for Quesadilla) — same
as `recipes.ts` hand-pins a `deliverooName` per dish. Everything below that
(groups, required-ness, per-branch asymmetry, option labels) is walked live.

**Scope: all 5 formats**, per your call — the marginal cost turned out to be
the walker handling real branching correctly (done once, generically) rather
than 5× the hand-curation `recipes.ts` needed, since there's no per-dish
composition to verify here, only per-option name aliases.

## Web UI (Menu Mode)

- Chipotle's item list in Menu Mode gains a "Build Your Own" entry per
  format (Bowl, Burrito, Salad, Tacos, Quesadilla) alongside the 23 fixed
  dishes.
- Selecting one opens a **step-by-step** picker following `build.next`: the
  root "Protein or Veggie" group first: `selection: 'one'` groups render
  like today's variant selector (segmented control / dropdown); `'many'`
  groups (Toppings) render as checkboxes; Quesadilla's `'exactly'` group
  enforces picking precisely `count` before continuing. Each choice reveals
  the next group(s) it unlocks — so a Chicken taco simply never shows a
  Rice/Beans step, since Deliveroo's own data never offered one. A running
  macro total updates live (same live-total pattern Menu Mode already uses
  for the meal itself).
- Confirming adds one line to the meal, named from the picked choices (e.g.
  "Bowl — Chicken, White Rice, Black Beans, Fresh Tomato Salsa, Cheese") with
  the summed macros — an ordinary manual-meal entry from that point on,
  editable by removing and re-building rather than editing in place (matches
  how a picked variant works today).
- **Default selections**: every group starts unselected — the user must
  actively pick through each step, same as Chipotle's own ordering flow and
  this app's "don't assume/fabricate" stance elsewhere (no silently
  pre-picking Chicken/White Rice/Black Beans on someone's behalf).

## Out of scope

- **Toppings/Vinaigrette in the automatic optimizer** — these `'many'`
  groups stay Menu-Mode-only (see above); only the required-choices
  expansion (`buildable-combos.ts`) feeds the optimizer.
- **The CLI** — `expandBuildableCombos` is called from `web/src/data.ts`
  (browser-only), not from any scraper, so `RestaurantData`/`flattenItems`
  (the CLI's path) never sees buildable combos. Consistent with existing
  precedent: Menu Mode itself has always been web-app-only too.
- Price/extra-charge modeling (e.g. real Chipotle upcharges for extra
  guac, or the "Extra" protein-upsell group) — this app has never modeled
  price, only macros.
- Saving a built combo back into `recipes.ts` as a named dish — a nice
  future affordance, not needed now.

## Risks / notes

- Group **labels must exactly match Chipotle's real ordering flow**, or the
  feature actively misleads a user about what they can order — same
  accuracy bar as `recipes.ts`, just spread across groups/branches instead
  of whole dishes.
- `ingredients.ts` already excludes drinks and stops at "Fountain Drinks" —
  unaffected here, since no build branch needs a drink (the shared "Add a
  Drink?" group is explicitly skipped by the walker).
- The nested `next`-per-choice model means the picker UI is step-by-step,
  not "show every group at once" — materially more UI work than spec 10's
  flat variant selector (dynamic reveal, a multi-select group, an
  exactly-N-of-M group, live-updating totals).
- Quesadilla's non-meat protein slots ("Cheese", "Fajita Veggie") need their
  own `ingredients.ts` mapping (Monterey Jack Cheese, Fajita Vegetables
  respectively) — same alias-table treatment as every other option, just
  flagged here since they don't look like "proteins" at first glance.
