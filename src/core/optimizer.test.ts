import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findBestCombinations, DEFAULT_OPTIMIZER_CONFIG } from './optimizer'
import { RestaurantsData, OptimizerConfig } from './types'

/** A fresh copy of the default config with one macro's field overridden. */
function withOverride (macro: keyof OptimizerConfig, override: Partial<OptimizerConfig[keyof OptimizerConfig]>): OptimizerConfig {
    return {
        calories: { ...DEFAULT_OPTIMIZER_CONFIG.calories },
        protein: { ...DEFAULT_OPTIMIZER_CONFIG.protein },
        fat: { ...DEFAULT_OPTIMIZER_CONFIG.fat },
        carbs: { ...DEFAULT_OPTIMIZER_CONFIG.carbs },
        [macro]: { ...DEFAULT_OPTIMIZER_CONFIG[macro], ...override }
    }
}

/**
 * A large set of near-identical candidates (small variations on the same
 * base macros) — the shape that defeats the search's admissible-bound prune,
 * since almost every partial combo scores close enough to the running best
 * to stay unpruned. This mirrors what happened for real: Chipotle's
 * build-your-own combos (spec 12) are systematically generated from a small
 * set of ingredients, which produced exactly this shape and hung the search
 * (and pegged the CPU) before the time budget in `optimizeRestaurant` was
 * added. Reproduced here with synthetic data so the regression doesn't
 * depend on live-scraped Chipotle output.
 */
function nearIdenticalCandidates (count: number): RestaurantsData {
    const items: RestaurantsData[string] = {}
    for (let i = 0; i < count; i++) {
        items[`Item ${i}`] = {
            calories: 180 + (i % 7),
            protein: 20 + (i % 5) * 0.5,
            fat: 8 + (i % 3) * 0.3,
            carbs: 15 + (i % 4) * 0.7,
            ProteinTCalRatio: 1,
            CarbToCalRatio: 1
        }
    }
    return { Restaurant: items }
}

test('a large near-identical candidate set completes within the search time budget, not hanging', () => {
    const restaurantsData = nearIdenticalCandidates(300)
    const targets = { calories: 900, protein: 90, fat: 40, carbs: 90 }

    const start = Date.now()
    const results = findBestCombinations(restaurantsData, targets, 5, 3)
    const elapsedMs = Date.now() - start

    // Generous ceiling — the budget itself is 1.5s; this just confirms the
    // guard actually bounds wall time instead of the search running away.
    assert.ok(elapsedMs < 5000, `search took ${elapsedMs}ms, expected it to be bounded by the time budget`)
    assert.ok((results.Restaurant?.length ?? 0) > 0, 'a budget-truncated search should still return a best-effort result')
})

test('a small, ordinary candidate set is unaffected by the time budget (fast, normal results)', () => {
    const restaurantsData: RestaurantsData = {
        Restaurant: {
            'Grilled Chicken': { calories: 300, protein: 40, fat: 8, carbs: 5, ProteinTCalRatio: 1, CarbToCalRatio: 1 },
            'Rice Bowl': { calories: 250, protein: 6, fat: 3, carbs: 50, ProteinTCalRatio: 1, CarbToCalRatio: 1 },
            Salad: { calories: 120, protein: 4, fat: 6, carbs: 10, ProteinTCalRatio: 1, CarbToCalRatio: 1 }
        }
    }
    const targets = { calories: 600, protein: 50, fat: 15, carbs: 60 }

    const start = Date.now()
    const results = findBestCombinations(restaurantsData, targets, 5, 3)
    const elapsedMs = Date.now() - start

    assert.ok(elapsedMs < 100, `expected a tiny candidate set to resolve near-instantly, took ${elapsedMs}ms`)
    assert.ok((results.Restaurant?.length ?? 0) > 0)
})

test('omitting config is equivalent to passing DEFAULT_OPTIMIZER_CONFIG explicitly', () => {
    const restaurantsData: RestaurantsData = {
        Restaurant: {
            A: { calories: 300, protein: 30, fat: 10, carbs: 20, ProteinTCalRatio: 1, CarbToCalRatio: 1 },
            B: { calories: 250, protein: 10, fat: 8, carbs: 40, ProteinTCalRatio: 1, CarbToCalRatio: 1 }
        }
    }
    const targets = { calories: 600, protein: 40, fat: 20, carbs: 60 }

    const implicit = findBestCombinations(restaurantsData, targets, 3, 3)
    const explicit = findBestCombinations(restaurantsData, targets, 3, 3, DEFAULT_OPTIMIZER_CONFIG)
    assert.deepEqual(implicit, explicit)
})

test('a weight below 1 shrinks the effective target and is enforced strictly', () => {
    // The scenario that motivated this design: a 55g fat target at 80%
    // weight must mean "44g is the real ceiling," not "55g still, just
    // cared about less" — otherwise a combo using the full 55g keeps
    // showing up, which is exactly the bug report this fixed.
    const restaurantsData: RestaurantsData = {
        Restaurant: {
            'Full Fat Combo': { calories: 500, protein: 30, fat: 50, carbs: 30, ProteinTCalRatio: 1, CarbToCalRatio: 1 },
            'Lower Fat Combo': { calories: 500, protein: 30, fat: 40, carbs: 30, ProteinTCalRatio: 1, CarbToCalRatio: 1 }
        }
    }
    const targets = { calories: 1000, protein: 100, fat: 55, carbs: 100 }

    const result = findBestCombinations(restaurantsData, targets, 1, 3, withOverride('fat', { weight: 0.8 }))
    const names = (result.Restaurant ?? []).map((c) => c.items[0].name)
    assert.ok(!names.includes('Full Fat Combo'), 'Full Fat Combo has 50g fat, over the 44g effective ceiling (55 * 0.8) — must be excluded')
    assert.ok(names.includes('Lower Fat Combo'), 'Lower Fat Combo (40g) is under the 44g effective ceiling — should be included')
})

test('a weight above 1 raises the effective target, and — with overflow allowed — the optimizer seeks the higher amount', () => {
    const restaurantsData: RestaurantsData = {
        Restaurant: {
            'Protein Bar': { calories: 200, protein: 100, fat: 5, carbs: 5, ProteinTCalRatio: 1, CarbToCalRatio: 1 },
            'Big Protein Bar': { calories: 200, protein: 150, fat: 5, carbs: 5, ProteinTCalRatio: 1, CarbToCalRatio: 1 }
        }
    }
    const targets = { calories: 1000, protein: 100, fat: 100, carbs: 100 }

    // At the default weight/strict overflow, Big Protein Bar (150g) exceeds
    // the 100g target and is excluded entirely.
    const strict = findBestCombinations(restaurantsData, targets, 1, 3)
    assert.equal((strict.Restaurant ?? []).some((c) => c.items[0].name === 'Big Protein Bar'), false)

    // Weighting protein to 150% (effective target 150g) and allowing
    // overflow — matching what the UI does once a fader crosses 100% — both
    // permits Big Protein Bar and prefers it: 150/150 fully saturates the
    // protein term while Protein Bar's 100/150 doesn't.
    const boosted = findBestCombinations(
        restaurantsData,
        targets,
        1,
        3,
        withOverride('protein', { weight: 1.5, overflow: 'allowed' })
    )
    assert.equal(boosted.Restaurant[0].items[0].name, 'Big Protein Bar')
})

test('weight: 0 makes a macro not influence ranking at all', () => {
    const restaurantsData: RestaurantsData = {
        Restaurant: {
            'More Protein': { calories: 200, protein: 50, fat: 10, carbs: 10, ProteinTCalRatio: 1, CarbToCalRatio: 1 },
            'Less Protein': { calories: 200, protein: 10, fat: 10, carbs: 10, ProteinTCalRatio: 1, CarbToCalRatio: 1 }
        }
    }
    const targets = { calories: 1000, protein: 100, fat: 100, carbs: 100 }

    // By default, "More Protein" should outrank "Less Protein" (better protein ratio, everything else equal).
    const defaultResult = findBestCombinations(restaurantsData, targets, 1, 2)
    assert.equal(defaultResult.Restaurant[0].items[0].name, 'More Protein')

    // With protein weighted to 0, the two items should score identically (both present, order no longer meaningful by protein).
    const noProteinWeight = findBestCombinations(restaurantsData, targets, 1, 2, withOverride('protein', { weight: 0 }))
    assert.equal(noProteinWeight.Restaurant.length, 2)
})

test("overflow: 'strict' (the default) excludes a combo that overshoots one macro", () => {
    const restaurantsData: RestaurantsData = {
        Restaurant: {
            'Big Burger': { calories: 900, protein: 40, fat: 90, carbs: 40, ProteinTCalRatio: 1, CarbToCalRatio: 1 }
        }
    }
    const targets = { calories: 1000, protein: 50, fat: 50, carbs: 50 } // fat: 90 > 50

    const result = findBestCombinations(restaurantsData, targets, 1, 3)
    assert.equal(result.Restaurant, undefined, 'a fat-overshooting combo should be excluded entirely under strict overflow')
})

test("overflow: 'allowed' lets a combo overshoot that specific macro without being excluded", () => {
    const restaurantsData: RestaurantsData = {
        Restaurant: {
            'Big Burger': { calories: 900, protein: 40, fat: 90, carbs: 40, ProteinTCalRatio: 1, CarbToCalRatio: 1 }
        }
    }
    const targets = { calories: 1000, protein: 50, fat: 50, carbs: 50 } // fat: 90 > 50

    const result = findBestCombinations(restaurantsData, targets, 1, 3, withOverride('fat', { overflow: 'allowed' }))
    assert.equal(result.Restaurant?.length, 1)
    assert.equal(result.Restaurant?.[0].items[0].name, 'Big Burger')
    assert.equal(result.Restaurant?.[0].totalNutrition.fat, 90)
})

test("overflow: 'allowed' on one macro still enforces strict on the others", () => {
    const restaurantsData: RestaurantsData = {
        Restaurant: {
            'Double Trouble': { calories: 900, protein: 90, fat: 90, carbs: 40, ProteinTCalRatio: 1, CarbToCalRatio: 1 }
        }
    }
    // Both protein and fat exceed target; only fat is allowed to overflow.
    const targets = { calories: 1000, protein: 50, fat: 50, carbs: 50 }

    const result = findBestCombinations(restaurantsData, targets, 1, 3, withOverride('fat', { overflow: 'allowed' }))
    assert.equal(result.Restaurant, undefined, 'protein still exceeds target and is still strict — combo should be excluded')
})
