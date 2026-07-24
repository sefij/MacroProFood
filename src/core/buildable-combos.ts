/**
 * Expands a build-your-own item's choice tree (spec 12) into flat,
 * required-choices-only candidate rows the automatic optimizer can search —
 * the same idea as a variant item's `variants[]` already expanding into one
 * flat row per option (spec 10, see `web/src/data.ts`'s `toRestaurantsData`),
 * just generalized from a flat list to a tree.
 *
 * Only `'one'` and `'exactly'` groups are expanded (the tree's *required*
 * choices, e.g. Protein, Rice, Beans, Quesadilla's pick-3 "Quesa Sides");
 * `'many'` groups (Toppings, Salad's Vinaigrette) are skipped entirely —
 * fully optional, and Chipotle's real option space is combinatorially far
 * too large to search in full even before Toppings (Quesadilla's own pick-3
 * alone is C(10,3) = 120). Toppings stay a Menu-Mode-only refinement a user
 * can still layer onto whatever the optimizer proposes.
 *
 * **Every group with more choices than `MAX_GROUP_CHOICES` is capped**,
 * target-aware: given whichever of protein/fat/carbs the request's own
 * target macros lean on most (`dominantMacro`, the same "which macro is
 * highest" rule `core/optimizer.ts`'s own candidate sort already uses), a
 * group's choices are ranked by *that macro's* per-calorie ratio and an even
 * spread is kept across the range — the highest-ratio choice, the lowest,
 * and points between. A macro-fitting search benefits far more from a real
 * high/low spread on the metric it actually needs than from several
 * similar-ratio choices clustered together, and this only costs a parameter
 * threaded through from the request (`toRestaurantsData` already runs fresh
 * per search, not baked into a static snapshot, so there's no caching cost
 * either). This replaced an earlier, non-target-aware version of this same
 * cap (always ranked by protein-to-calorie ratio, or by raw calories for the
 * `'exactly'` group) after a follow-up conversation about improving match
 * quality.
 *
 * The cap was originally added for a different reason — pure candidate-count
 * control. Even after the `'many'`-group exclusion above, the full cross
 * product (6-8 proteins × rice × beans × …) still pushed one restaurant's
 * total candidate count past what the search below can explore quickly — a
 * real report of the automatic optimizer hanging (and pegging CPU) traced
 * back to exactly this. `core/optimizer.ts` also gained a hard time-based
 * search budget as a second, independent safety net — this cap is about
 * keeping typical results fast *and* well-matched to the request, that
 * budget is about guaranteeing the search can never hang regardless of
 * candidate count.
 *
 * All of the above is automatic-mode-only — the manual builder (Menu Mode)
 * still offers every live option Deliveroo has for every group.
 */

import { BuildChoice, BuildGroup, TargetMacros } from './types'

/** The macro shape one expanded combo carries — the caller stamps on a name/restaurant/category. */
export interface ComboMacros {
    calories: number
    protein: number
    fat: number
    carbs: number
}

/** One fully-resolved required-choices-only path through the tree. */
export interface ComboCandidate {
    /** Chosen labels, in pick order (e.g. `["Chicken", "White Rice", "Black Beans"]`). */
    labels: string[]
    macros: ComboMacros
}

/** The macro a request's target leans on most — the axis candidate-capping should spread across. */
export type DominantMacro = 'protein' | 'fat' | 'carbs'

/** A group with more choices than this is capped to a diverse, dominant-macro-ranked spread — see module docblock. */
const MAX_GROUP_CHOICES = 3
/** An `'exactly'` group's *pool* (choices combinations are drawn from) is capped more generously than a `'one'` group's own choice count, since a combination needs room to vary. */
const MAX_EXACTLY_POOL = 5

const ZERO_MACROS: ComboMacros = { calories: 0, protein: 0, fat: 0, carbs: 0 }
const EMPTY_COMBO: ComboCandidate = { labels: [], macros: ZERO_MACROS }

/**
 * Which of protein/fat/carbs a target leans on most, by raw target grams —
 * the same rule `core/optimizer.ts` already uses to decide its own candidate
 * sort order, reused here for consistency. Ties favor protein, then fat.
 */
export function dominantMacro (targets: Pick<TargetMacros, 'protein' | 'fat' | 'carbs'>): DominantMacro {
    if (targets.protein >= targets.fat && targets.protein >= targets.carbs) return 'protein'
    if (targets.fat >= targets.carbs) return 'fat'
    return 'carbs'
}

function addMacros (a: ComboMacros, b: ComboMacros): ComboMacros {
    return {
        calories: a.calories + b.calories,
        protein: a.protein + b.protein,
        fat: a.fat + b.fat,
        carbs: a.carbs + b.carbs
    }
}

function crossProduct (a: ComboCandidate[], b: ComboCandidate[]): ComboCandidate[] {
    const merged: ComboCandidate[] = []
    for (const x of a) {
        for (const y of b) {
            merged.push({ labels: [...x.labels, ...y.labels], macros: addMacros(x.macros, y.macros) })
        }
    }
    return merged
}

/** Every `size`-length combination of `items`, as index arrays (order-independent — the tree's option order isn't meaningful here). */
function combinations (items: number[], size: number): number[][] {
    if (size === 0) return [[]]
    if (items.length < size) return []
    const [first, ...rest] = items
    const withFirst = combinations(rest, size - 1).map((c) => [first, ...c])
    const withoutFirst = combinations(rest, size)
    return [...withFirst, ...withoutFirst]
}

/**
 * `count` indices evenly spread across `choices` sorted by `macro`-to-calorie
 * ratio (highest to lowest) — keeps both the choice that contributes the
 * most of `macro` and the one that contributes the least, rather than
 * clustering near one extreme. This is deliberately *not* "top N by raw
 * amount" — a search fitting a joint 4-macro target benefits from range,
 * not from several near-identical high-`macro` options.
 */
function diverseIndices (choices: BuildChoice[], count: number, macro: DominantMacro): number[] {
    if (choices.length <= count || count <= 0) return choices.map((_, i) => i)

    const sorted = choices
        .map((choice, index) => ({ index, ratio: choice.calories > 0 ? choice[macro] / choice.calories : 0 }))
        .sort((a, b) => b.ratio - a.ratio)

    const picked = new Set<number>()
    for (let i = 0; i < count; i++) {
        const pos = count === 1 ? 0 : Math.round((i * (sorted.length - 1)) / (count - 1))
        picked.add(sorted[pos].index)
    }
    return [...picked]
}

/** All required-choices-only combinations reachable by continuing from one already-picked choice. */
function expandChoice (choice: BuildChoice, macro: DominantMacro): ComboCandidate[] {
    const own: ComboCandidate = {
        labels: [choice.label],
        macros: { calories: choice.calories, protein: choice.protein, fat: choice.fat, carbs: choice.carbs }
    }
    if (!choice.next || choice.next.length === 0) return [own]

    let unlocked: ComboCandidate[] = [EMPTY_COMBO]
    for (const nextGroup of choice.next) {
        unlocked = crossProduct(unlocked, expandGroup(nextGroup, macro))
    }
    return unlocked.map((combo) => ({
        labels: [...own.labels, ...combo.labels],
        macros: addMacros(own.macros, combo.macros)
    }))
}

/** All required-choices-only combinations for one group (and everything its picks unlock), capped and ranked by `macro`. */
function expandGroup (group: BuildGroup, macro: DominantMacro): ComboCandidate[] {
    if (group.selection === 'many') return [EMPTY_COMBO] // optional — excluded from automatic-mode expansion

    const pickIndices =
        group.selection === 'one'
            ? diverseIndices(group.choices, MAX_GROUP_CHOICES, macro).map((i) => [i])
            : combinations(diverseIndices(group.choices, MAX_EXACTLY_POOL, macro), group.count ?? 0)

    const results: ComboCandidate[] = []
    for (const pick of pickIndices) {
        let combos: ComboCandidate[] = [EMPTY_COMBO]
        for (const index of pick) {
            combos = crossProduct(combos, expandChoice(group.choices[index], macro))
        }
        results.push(...combos)
    }
    return results
}

/** Expands a build-your-own item's root choice group into its automatic-mode candidate rows, capped and ranked for `macro` (see `dominantMacro`). */
export function expandBuildableCombos (root: BuildGroup, macro: DominantMacro): ComboCandidate[] {
    return expandGroup(root, macro)
}

/**
 * Which choices, at every level of a group's tree, were part of one
 * already-composed combo — the inverse of {@link expandGroup}: instead of
 * enumerating every valid pick, it walks the tree matching a specific
 * ordered label list (as produced by `ComboCandidate.labels`, or by the
 * picker UI's own `report.labels`) back onto choice indices. This is what
 * lets the picker UI re-open an already-chosen build-your-own item
 * pre-populated with its existing picks — "edit" instead of "start over" —
 * whether that combo came from the automatic optimizer (which only ever
 * picks from the capped/ranked subset above) or a manual Menu Mode pick.
 * Always resolved against the *full, uncapped* tree (as stored on the
 * `SnapshotItem`), never the automatic-mode-capped one — the capping only
 * affects which combos the optimizer considers, not which choices exist.
 */
export interface InitialSelection {
    /** Indices into this group's own `choices` that this combo picked. */
    selectedIndices: number[]
    /** For each selected choice index, the initial selection for each of its `next` groups, in the same order as `next`. */
    nested: Map<number, InitialSelection[]>
}

const EMPTY_SELECTION: InitialSelection = { selectedIndices: [], nested: new Map() }

export function resolveInitialSelection (group: BuildGroup, labels: string[]): InitialSelection {
    if (group.selection === 'many') return EMPTY_SELECTION // never contributes labels — nothing to resolve

    const count = group.selection === 'one' ? 1 : (group.count ?? 0)
    const consumed = new Set(labels.slice(0, count))
    const selectedIndices = group.choices
        .map((choice, index) => (consumed.has(choice.label) ? index : -1))
        .filter((index) => index !== -1)

    let rest = labels.slice(count)
    const nested = new Map<number, InitialSelection[]>()
    for (const index of selectedIndices) {
        const children: InitialSelection[] = []
        for (const nextGroup of group.choices[index].next ?? []) {
            children.push(resolveInitialSelection(nextGroup, rest))
            const nextCount = nextGroup.selection === 'many' ? 0 : nextGroup.selection === 'one' ? 1 : (nextGroup.count ?? 0)
            rest = rest.slice(nextCount)
        }
        nested.set(index, children)
    }
    return { selectedIndices, nested }
}
