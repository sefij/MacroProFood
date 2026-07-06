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
    RestaurantsData,
    TargetMacros
} from './types'

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
                carbs: nutrition.carbs
            })
        }
    }
    return allItems
}

/**
 * Finds the top-N meal combinations per restaurant that best match `targets`
 * without exceeding any macro. Pure function — given the same inputs it always
 * returns the same result.
 */
export function findBestCombinations (
    restaurantsData: RestaurantsData,
    targets: TargetMacros,
    maxItems: number = 5,
    optionsPerRestaurant: number = 3
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
            optionsPerRestaurant
        )
        if (combos.length > 0) {
            results[restaurant] = combos
        }
    }

    return results
}

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
    topN: number
): OptimizationResult[] {
    // Helper to check if nutrition exceeds any target
    function exceeds (
        nutrition: Omit<NutritionData, 'ProteinTCalRatio' | 'CarbToCalRatio'>,
        targets: TargetMacros
    ): boolean {
        return (
            nutrition.calories > targets.calories ||
            nutrition.protein > targets.protein ||
            nutrition.fat > targets.fat ||
            nutrition.carbs > targets.carbs
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

    // Helper to score a combination (higher is better, but must not overflow)
    function score (
        nutrition: Omit<NutritionData, 'ProteinTCalRatio' | 'CarbToCalRatio'>,
        targets: TargetMacros
    ): number {
        // Score is the sum of ratios (how much of each macro is covered, capped at 1)
        return (
            Math.min(nutrition.calories / Math.max(targets.calories, 1), 1) +
            Math.min(nutrition.protein / Math.max(targets.protein, 1), 1) +
            Math.min(nutrition.fat / Math.max(targets.fat, 1), 1) +
            Math.min(nutrition.carbs / Math.max(targets.carbs, 1), 1)
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

    // Hoisted: filter+sort depend only on `items` and `targets`, both invariant
    // across the recursion. Compute once.
    // Sort by ProteinToCalRatio desc when protein is the highest target, by
    // CarbToCalRatio desc when carbs is the highest target.
    const proteinTargetHighest =
        targets.protein >= targets.carbs && targets.protein >= targets.fat
    const carbsTargetHighest =
        targets.carbs >= targets.protein && targets.carbs >= targets.fat
    const sortedItems = items
        .filter(
            (item) =>
                item.protein >= 1 &&
                item.carbs >= 1 &&
                item.calories <= targets.calories * 1.3 &&
                item.protein <= targets.protein * 1.3 &&
                item.fat <= targets.fat * 1.3 &&
                item.carbs <= targets.carbs * 1.3
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

    // Unbounded knapsack: items may repeat, but `startIndex` prevents
    // revisiting the same multiset via different orderings.
    function search (startIndex: number) {
        if (exceeds(cur, targets)) return

        recordCombo(score(cur, targets))

        if (combo.length === maxItems) return

        // Admissible upper-bound prune: max additional score reachable in
        // the remaining slots, assuming each could be the macro-maximizing
        // item. Strict `<` keeps the length tiebreak path open on equality.
        const slotsLeft = maxItems - combo.length
        const upper =
            Math.min(1, (cur.calories + slotsLeft * maxCalories) / tCal) +
            Math.min(1, (cur.protein + slotsLeft * maxProtein) / tProt) +
            Math.min(1, (cur.fat + slotsLeft * maxFat) / tFat) +
            Math.min(1, (cur.carbs + slotsLeft * maxCarbs) / tCarbs)
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
