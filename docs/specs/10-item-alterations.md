# 10 — Item alterations (variant selection) ✅

> Status: **Done**. Shipped as: data + optimizer plumbing (`96c246c`), variant
> selector UI (`8a94be6`), Pizza Hut as first producer (`8c07d46`), and
> retrofits of Nando's (`6182c5a`) and Domino's (`ba25162`). Wingstop (also a
> candidate) stays shelved. The design below is what was built; two small
> refinements landed during implementation — see "Shipped refinements".

## Goal

Let a single menu item carry a set of mutually-exclusive **variants** (sizes,
crusts, counts) that the user picks between, instead of every variant being its
own flat item. `Margherita — 6" Pan`, `Margherita — Large Pan`, … (11 rows)
become one **`Margherita`** item with a size selector.

## The key reframe: this is a presentation change, not an optimizer change

Every variant in our data already carries **absolute** macros (Margherita Large
Pan = 2391 kcal standalone). No scraper produces *additive* modifiers
("+bacon +80 kcal") — Nando's even scrapes the base dish and deliberately drops
bastes/sides. So there is no new nutrition maths here. We already flatten
variants into item names across every scraper (`Domino's: Pepperoni — Thin &
Crispy (Per Whole)`, `Nando's: … (Regular)/(Large)`, Wingstop counts) — 16% of
all current items (294/1852) are variant-style names today. Alterations just
**groups those flattened variants back under a base name and lets the UI pick
one**. The optimizer keeps seeing flat items.

## Decisions (settled)

1. **One flat option list per item**, not multiple independent choice groups.
   Each variant is a full combination with its own absolute macros (Pizza Hut's
   11 size/crust combos are one list). Domino's crust×size stays combined as it
   already is; we do not model Crust and Size as independent axes (only Domino's
   would need it, and its PDF already gives per-combination macros).
2. **Base item shows a calorie range + a default-selected variant** — usable
   immediately, and visibly variable ("Margherita · 530–3170 kcal", Medium
   pre-selected).

## Data model (`src/core/types.ts`)

```ts
export interface ItemVariant {
  label: string            // "Large Pan", "Regular", "6 wings"
  calories: number
  protein: number
  fat: number
  carbs: number
}

export interface SnapshotItem {
  name: string
  category?: string
  // A simple item keeps macros inline (unchanged, fully backward-compatible):
  calories?: number
  protein?: number
  fat?: number
  carbs?: number
  // …or a variant item carries a list instead:
  variants?: ItemVariant[]
  variantLabel?: string    // selector heading, e.g. "Size"; default "Option"
}
```

An item is *simple* (inline macros, `variants` absent) **or** *variant-bearing*
(`variants` present, inline macros absent). Existing snapshots need no change.
`RestaurantData`/`NutritionData` (the optimizer-facing shape) is unchanged; the
variant grouping lives only in the snapshot/UI layer (see optimizer below).

## Scraper layer

- New helper `addVariant(items, baseName, variantLabel, label, nutrition)`
  alongside `addItem` (`src/scrapers/add-item.ts`): upserts a base entry and
  appends a variant, so a scraper can emit grouped variants directly. Collision
  handling (`addItem`'s dedupe/requalify) is preserved for the base name.
- Only variant-producing scrapers opt in. **Pizza Hut is the first user**
  (spec 11). Domino's, Nando's, Wingstop can be retrofitted later, opportunist-
  ically — until then they stay flat, and the app renders both models fine.
- `build-web-data.ts` carries `variants`/`variantLabel` through into
  `SnapshotItem` (currently it copies the four macro fields + category).

## Optimizer (`src/core/optimizer.ts`) — unchanged search

`flattenItems` **expands** each variant into its own `MenuItem`, named
`"Margherita (Large Pan)"` — exactly the flat items the optimizer sees today.
The knapsack search, scoring, pruning and results are untouched; combos and
accuracy come out identical to the current flat data. A picked variant renders
in results as `Margherita (Large Pan)`, same as now.

This is the crux: **the optimizer never learns about variants**; it only ever
sees the same flat list, so there is zero risk to the (carefully tuned) search.

## Web UI (`web/`) — where the real work is

- **`MenuItemList`** (`components/MenuBuilder.tsx`): a variant item renders as
  one row with a compact selector (segmented control for ≤4 options, dropdown
  otherwise) under the name. The row's macro line reflects the **selected**
  variant; the name line shows the calorie **range** across variants. The `+` /
  stepper adds the *selected* variant.
- **Default selection**: the **median-calorie** variant (ties → lower). Purely
  a UI concern; scrapers stay dumb about defaults. Range = min–max calories.
- **Meal state** (`web/src/menu.ts`): `menuItemKey` becomes
  `restaurant::name::variantLabel` so two sizes of the same pizza are distinct
  meal lines (and match the existing "same name, two restaurants" separation).
  `menuTotals` already sums per-entry macros — unaffected once each entry stores
  the chosen variant's macros.
- **`App.tsx`** `addMenuItem`/`removeMenuItem`: operate on the selected variant;
  otherwise unchanged (including the single-restaurant-meal rule from spec 07).
- **`Results`** already renders flat `MenuItem`s → variant names show through
  with no change.

## Shipped refinements (not in the original design)

- **Single-option groups collapse.** A retrofit can leave a "group" with one
  option (most Domino's Main Menu pizzas list a single crust). `toSnapshotItems`
  folds those back to a plain item, merging the option into the name —
  `(Small)` when plain, em-dash-joined when the option already has parens
  (`Bacon Double Cheese — Classic (Per Slice, Large)`).
- **Duplicate option labels disambiguated.** A source can list the same
  name+size twice with different macros (Nando's Spicy Rice / Coleslaw). Both
  are kept; the later option label is suffixed (`Regular (2)`) so the selector
  never shows two indistinguishable options. (`addItem` already drops *identical*
  dups upstream, so any collision here is genuinely distinct.)
- **PDF pipeline variant hook.** `PdfNutritionScraper` gained an optional
  `config.variant(row, category)` returning `{ base, groupLabel, option }`;
  when set it routes through `addVariant`. Domino's uses it.

## Rollout (phased, each independently shippable)

1. **Data + optimizer**: add `ItemVariant`/`variants` to types, `flattenItems`
   expansion, `addVariant`, build-web-data passthrough. No behavior change yet
   (no scraper emits variants) — pure plumbing, fully backward-compatible.
2. **Web UI**: variant selector + variant-aware meal state + range display.
   Still no producer, so verified against a hand-crafted fixture snapshot.
3. **First producer**: Pizza Hut (spec 11) emits variants → the feature goes
   live end-to-end.
4. **Retrofits** (optional, later): convert Domino's / Nando's / Wingstop from
   flattened-name variants to real `variants`, decluttering their menus too.

## Out of scope

- **Freeform modifiers / add-a-topping** ("+ bacon", "no cheese" with a macro
  delta). We have no additive-modifier data — every scraper captured absolute
  variants only. Alterations = *choose among pre-priced variants*, nothing more.
- **Multiple independent choice axes** (Crust × Size as separate selectors).
- **CLI presentation** of variants (the CLI can keep flattening; the optimizer
  already sees flat items, so no CLI change is required).

## Risks / notes

- `menuItemKey` change is the one place a stale meal could mis-key; migration is
  trivial since meals live only in browser state, not persisted snapshots.
- Median-default must be stable/deterministic for the same variant list so the
  UI doesn't jitter between builds.
