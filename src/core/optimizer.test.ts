import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findBestCombinations } from './optimizer'
import { RestaurantsData } from './types'

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
