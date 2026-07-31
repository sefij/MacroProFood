/**
 * Pure macro-optimization core — no `chalk`, no Node APIs, no console output.
 *
 * This module is intentionally dependency-free so it can be bundled into a
 * browser (the Cloudflare web app) as well as the CLI. All terminal rendering
 * lives in {@link ../macro-optimizer} (`MacroOptimizer.displayResults`).
 */
import {
    MenuItem,
    NutritionData,
    OptimizationResult,
    OptimizationResults,
    OptimizerConfig,
    RestaurantsData,
    TargetMacros
} from './types'

/** Neutral tuning — every macro's effective target equals its real target, and none may be exceeded. Matches this project's behavior before {@link OptimizerConfig} existed. */
export const DEFAULT_OPTIMIZER_CONFIG: OptimizerConfig = {
    calories: { weight: 1, overflow: 'strict' },
    protein: { weight: 1, overflow: 'strict' },
    fat: { weight: 1, overflow: 'strict' },
    carbs: { weight: 1, overflow: 'strict' }
}

/** Flattens `RestaurantsData` into a single list of `MenuItem`s. */
export function flattenItems (restaurantsData: RestaurantsData): MenuItem[] {
    const allItems: MenuItem[] = []
    for (const [restaurant, items] of Object.entries(restaurantsData)) {
        if (!items) continue
        for (const [itemName, nutrition] of Object.entries(items)) {
            allItems.push({
                restaurant,
                name: itemName,
                calories: nutrition.calories,
                protein: nutrition.protein,
                fat: nutrition.fat,
                carbs: nutrition.carbs,
                category: nutrition.category
            })
        }
    }
    return allItems
}

/**
 * Finds the top-N meal combinations per restaurant that best match `targets`.
 * By default no macro may exceed its target (see {@link DEFAULT_OPTIMIZER_CONFIG});
 * pass `config` to scale specific macros' effective targets up or down, or
 * let them overflow — see {@link OptimizerConfig}. The `accuracy` on each
 * returned result is still measured against the real `targets`, not the
 * weighted ones, regardless of `config`. Pure function — given the same
 * inputs it always returns the same result.
 */
export function findBestCombinations (
    restaurantsData: RestaurantsData,
    targets: TargetMacros,
    maxItems: number = 5,
    optionsPerRestaurant: number = 3,
    config: OptimizerConfig = DEFAULT_OPTIMIZER_CONFIG
): OptimizationResults {
    const allItems = flattenItems(restaurantsData)
    const results: OptimizationResults = {}

    for (const restaurant of Object.keys(restaurantsData)) {
        const restaurantItems = allItems.filter(
            (item) => item.restaurant === restaurant
        )
        if (restaurantItems.length === 0) continue
        const combos = optimizeRestaurant(
            restaurantItems,
            targets,
            maxItems,
            optionsPerRestaurant,
            config
        )
        if (combos.length > 0) {
            results[restaurant] = combos
        }
    }

    return results
}

/**
 * Hard wall-clock ceiling on one restaurant's search (checked periodically,
 * not per-node, to keep the check itself cheap). This is a safety net, not a
 * tuning knob: a well-pruned search over a normal-sized, differentiated menu
 * finishes in milliseconds and never comes close to it. It exists because the
 * admissible-bound prune below assumes candidates are reasonably
 * differentiated — a large set of near-identical candidates (e.g. many
 * systematically-generated combinations of the same few ingredients) can
 * defeat it, since almost every partial combo scores close enough to the
 * running best to stay unpruned. Without this, that shows up as the whole
 * search — and the tab's CPU — hanging indefinitely rather than returning a
 * merely non-exhaustive answer. See spec 12's "Automatic-mode integration"
 * section for the case that surfaced this (Chipotle's build-your-own combos).
 */
const SEARCH_TIME_BUDGET_MS = 1500
/** How many recursive calls between budget checks — cheap enough not to matter, frequent enough to cut off quickly once exceeded. */
const BUDGET_CHECK_INTERVAL = 4096

/** Average of the four per-macro accuracy deltas (lower is better). */
export function avgAccuracyOf (combo: OptimizationResult): number {
    return (
        (combo.accuracy.calories +
            combo.accuracy.protein +
            combo.accuracy.fat +
            combo.accuracy.carbs) /
        4
    )
}

function optimizeRestaurant (
    items: MenuItem[],
    targets: TargetMacros,
    maxItems: number,
    topN: number,
    config: OptimizerConfig
): OptimizationResult[] {
    // A macro's weight scales its *effective* target for this search — 80%
    // weight on a 55g fat target means the search treats 44g as the ceiling
    // to aim for/not exceed, not "55g still but caring a bit less about it."
    // See OptimizerConfig's docs. `targets` itself (the user's real numbers)
    // is untouched — only used below for the final accuracy report, which
    // should reflect what the user actually asked for, not the weighted search.
    const effectiveTargets: TargetMacros = {
        calories: targets.calories * config.calories.weight,
        protein: targets.protein * config.protein.weight,
        fat: targets.fat * config.fat.weight,
        carbs: targets.carbs * config.carbs.weight
    }
    const eCal = Math.max(effectiveTargets.calories, 1)
    const eProt = Math.max(effectiveTargets.protein, 1)
    const eFat = Math.max(effectiveTargets.fat, 1)
    const eCarbs = Math.max(effectiveTargets.carbs, 1)

    // Helper to check if nutrition exceeds any *strict* effective target — a
    // macro configured with overflow: 'allowed' never disqualifies a combo,
    // and neither does a macro weighted to 0 (its effective target rounds to
    // ~0, which would otherwise reject almost any real combo outright; weight
    // 0 means "ignore this macro," not "must be exactly zero").
    function exceeds (
        nutrition: Omit<NutritionData, 'ProteinTCalRatio' | 'CarbToCalRatio'>
    ): boolean {
        return (
            (config.calories.overflow === 'strict' && config.calories.weight > 0 && nutrition.calories > effectiveTargets.calories) ||
            (config.protein.overflow === 'strict' && config.protein.weight > 0 && nutrition.protein > effectiveTargets.protein) ||
            (config.fat.overflow === 'strict' && config.fat.weight > 0 && nutrition.fat > effectiveTargets.fat) ||
            (config.carbs.overflow === 'strict' && config.carbs.weight > 0 && nutrition.carbs > effectiveTargets.carbs)
        )
    }

    // Helper to sum nutrition
    function sumNutrition (
        combo: MenuItem[]
    ): Omit<NutritionData, 'ProteinTCalRatio' | 'CarbToCalRatio'> {
        return combo.reduce(
            (sum, item) => ({
                calories: sum.calories + item.calories,
                protein: sum.protein + item.protein,
                fat: sum.fat + item.fat,
                carbs: sum.carbs + item.carbs
            }),
            { calories: 0, protein: 0, fat: 0, carbs: 0 }
        )
    }

    // Helper to score a combination (higher is better, but must not overflow).
    // Unweighted sum of fill ratios against the *effective* (already-scaled)
    // targets above — the weighting is baked into what "100%" means for each
    // macro now, not a second multiplier here. A 0-weight macro contributes
    // nothing either way (its ratio against a ~0 target is meaningless).
    function score (
        nutrition: Omit<NutritionData, 'ProteinTCalRatio' | 'CarbToCalRatio'>
    ): number {
        return (
            (config.calories.weight === 0 ? 0 : Math.min(nutrition.calories / eCal, 1)) +
            (config.protein.weight === 0 ? 0 : Math.min(nutrition.protein / eProt, 1)) +
            (config.fat.weight === 0 ? 0 : Math.min(nutrition.fat / eFat, 1)) +
            (config.carbs.weight === 0 ? 0 : Math.min(nutrition.carbs / eCarbs, 1))
        )
    }

    // Top-N tracking, sorted by (score desc, length asc).
    type Entry = { items: MenuItem[]; score: number; len: number }
    const topK: Entry[] = []
    const isBetter = (s: number, len: number, e: Entry) =>
        s > e.score || (s === e.score && len < e.len)
    const recordCombo = (s: number) => {
        const len = combo.length
        if (len === 0) return
        if (topK.length === topN && !isBetter(s, len, topK[topN - 1])) {
            return
        }
        const snapshot: Entry = { items: combo.slice(), score: s, len }
        let pos = topK.length
        for (let j = 0; j < topK.length; j++) {
            if (isBetter(s, len, topK[j])) {
                pos = j
                break
            }
        }
        topK.splice(pos, 0, snapshot)
        if (topK.length > topN) topK.pop()
    }
    const thresholdScore = () =>
        topK.length < topN ? -1 : topK[topN - 1].score

    // Hoisted: filter+sort depend only on `items`, `effectiveTargets` and
    // `config`, all invariant across the recursion. Compute once.
    // Sort by ProteinToCalRatio desc when protein has the highest *effective*
    // target, by CarbToCalRatio desc when carbs does.
    const proteinTargetHighest =
        effectiveTargets.protein >= effectiveTargets.carbs && effectiveTargets.protein >= effectiveTargets.fat
    const carbsTargetHighest =
        effectiveTargets.carbs >= effectiveTargets.protein && effectiveTargets.carbs >= effectiveTargets.fat
    // A macro configured with overflow: 'allowed', or weighted to 0, skips the
    // "no single item over 1.3x effective target" pre-filter — a candidate
    // that's fine to overflow (or that this macro ignores entirely) shouldn't
    // be excluded from consideration just for being large in it.
    const sortedItems = items
        .filter(
            (item) =>
                item.protein >= 1 &&
                item.carbs >= 1 &&
                (config.calories.overflow === 'allowed' || config.calories.weight === 0 || item.calories <= effectiveTargets.calories * 1.3) &&
                (config.protein.overflow === 'allowed' || config.protein.weight === 0 || item.protein <= effectiveTargets.protein * 1.3) &&
                (config.fat.overflow === 'allowed' || config.fat.weight === 0 || item.fat <= effectiveTargets.fat * 1.3) &&
                (config.carbs.overflow === 'allowed' || config.carbs.weight === 0 || item.carbs <= effectiveTargets.carbs * 1.3)
        )
        .sort((a, b) => {
            if (proteinTargetHighest) {
                return (
                    b.protein / Math.max(b.calories, 1) -
                    a.protein / Math.max(a.calories, 1)
                )
            } else if (carbsTargetHighest) {
                return (
                    b.carbs / Math.max(b.calories, 1) -
                    a.carbs / Math.max(a.calories, 1)
                )
            } else {
                return 0
            }
        })

    if (sortedItems.length === 0) return []

    // Per-macro maxima for the admissible upper-bound prune
    let maxProtein = 0
    let maxFat = 0
    let maxCarbs = 0
    let maxCalories = 0
    for (const it of sortedItems) {
        if (it.protein > maxProtein) maxProtein = it.protein
        if (it.fat > maxFat) maxFat = it.fat
        if (it.carbs > maxCarbs) maxCarbs = it.carbs
        if (it.calories > maxCalories) maxCalories = it.calories
    }

    const tCal = Math.max(targets.calories, 1)
    const tProt = Math.max(targets.protein, 1)
    const tFat = Math.max(targets.fat, 1)
    const tCarbs = Math.max(targets.carbs, 1)

    // Single combo + nutrition state, mutated/restored across recursion
    const combo: MenuItem[] = []
    const cur = { calories: 0, protein: 0, fat: 0, carbs: 0 }

    // Search-budget bookkeeping (see SEARCH_TIME_BUDGET_MS docs above).
    const searchStartedAt = Date.now()
    let nodesVisited = 0
    let budgetExceeded = false

    // Unbounded knapsack: items may repeat, but `startIndex` prevents
    // revisiting the same multiset via different orderings.
    function search (startIndex: number) {
        if (budgetExceeded) return
        nodesVisited++
        if (nodesVisited % BUDGET_CHECK_INTERVAL === 0 && Date.now() - searchStartedAt > SEARCH_TIME_BUDGET_MS) {
            budgetExceeded = true
            return
        }

        if (exceeds(cur)) return

        recordCombo(score(cur))

        if (combo.length === maxItems) return

        // Admissible upper-bound prune: max additional score reachable in
        // the remaining slots, assuming each could be the macro-maximizing
        // item. Same shape as score() — effective (already-scaled) targets,
        // a 0-weight macro contributing nothing — so this stays a true upper
        // bound. Strict `<` keeps the length tiebreak path open on equality.
        const slotsLeft = maxItems - combo.length
        const upper =
            (config.calories.weight === 0 ? 0 : Math.min(1, (cur.calories + slotsLeft * maxCalories) / eCal)) +
            (config.protein.weight === 0 ? 0 : Math.min(1, (cur.protein + slotsLeft * maxProtein) / eProt)) +
            (config.fat.weight === 0 ? 0 : Math.min(1, (cur.fat + slotsLeft * maxFat) / eFat)) +
            (config.carbs.weight === 0 ? 0 : Math.min(1, (cur.carbs + slotsLeft * maxCarbs) / eCarbs))
        if (upper < thresholdScore()) return

        for (let i = startIndex; i < sortedItems.length; i++) {
            const it = sortedItems[i]
            combo.push(it)
            cur.calories += it.calories
            cur.protein += it.protein
            cur.fat += it.fat
            cur.carbs += it.carbs
            search(i)
            cur.calories -= it.calories
            cur.protein -= it.protein
            cur.fat -= it.fat
            cur.carbs -= it.carbs
            combo.pop()
        }
    }

    search(0)

    return topK.map((entry) => {
        const totalNutrition = sumNutrition(entry.items)
        return {
            items: entry.items,
            totalNutrition,
            accuracy: {
                calories:
                    Math.abs(totalNutrition.calories - targets.calories) / tCal,
                protein:
                    Math.abs(totalNutrition.protein - targets.protein) / tProt,
                fat: Math.abs(totalNutrition.fat - targets.fat) / tFat,
                carbs: Math.abs(totalNutrition.carbs - targets.carbs) / tCarbs
            }
        }
    })
}
