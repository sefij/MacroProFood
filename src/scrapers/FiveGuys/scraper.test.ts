import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconciliationGap, anchorToStatedCalories, RECONCILIATION_WARNING_THRESHOLD } from './scraper'
import { NutritionData } from '../../types'

test('reconciliationGap is undefined when Deliveroo has no stated calories to check against', () => {
    assert.equal(reconciliationGap(628, undefined), undefined)
    assert.equal(reconciliationGap(628, 0), undefined)
})

test('reconciliationGap is the absolute fractional difference from the stated figure', () => {
    assert.equal(reconciliationGap(628, 678), (678 - 628) / 678)
    assert.equal(reconciliationGap(834, 904), (904 - 834) / 904)
})

test('every documented recipe gap in this project (fries exact, burgers ~8%, hot dogs ~18%) sits at or under the warning threshold', () => {
    assert.ok(reconciliationGap(1073, 1073)! <= RECONCILIATION_WARNING_THRESHOLD) // fries: exact
    assert.ok(reconciliationGap(628, 678)! <= RECONCILIATION_WARNING_THRESHOLD) // Hamburger: ~7.4%
    assert.ok(reconciliationGap(407, 483)! <= RECONCILIATION_WARNING_THRESHOLD) // All Beef Hot Dog: ~15.7%
})

test('a materially missing ingredient (e.g. a whole missing bun) trips the warning threshold', () => {
    // Hamburger without its bun: 2 patties only, still compared against the real dish's stated 678 kcal.
    const missingBun = 2 * 195
    assert.ok(reconciliationGap(missingBun, 678)! > RECONCILIATION_WARNING_THRESHOLD)
})

function nutrition (partial: Partial<NutritionData> & { calories: number, protein: number, fat: number, carbs: number }): NutritionData {
    return { ProteinTCalRatio: 0, CarbToCalRatio: 0, ...partial }
}

test('anchorToStatedCalories rescales calories exactly and protein/fat/carbs by the same ratio', () => {
    // Hamburger: raw sum 628 kcal / 42g protein / 35.5g fat / 38g carbs, anchored to Deliveroo's stated 678.
    const raw = nutrition({ calories: 628, protein: 42, fat: 35.5, carbs: 38 })
    const anchored = anchorToStatedCalories(raw, 678)
    const ratio = 678 / 628
    assert.equal(anchored.calories, 678)
    assert.equal(anchored.protein, 42 * ratio)
    assert.equal(anchored.fat, 35.5 * ratio)
    assert.equal(anchored.carbs, 38 * ratio)
})

test('anchorToStatedCalories keeps the ratios internally consistent (Atwater still adds up)', () => {
    const raw = nutrition({ calories: 628, protein: 42, fat: 35.5, carbs: 38 })
    const anchored = anchorToStatedCalories(raw, 678)
    assert.equal(anchored.ProteinTCalRatio, anchored.protein / 678)
    assert.equal(anchored.CarbToCalRatio, anchored.carbs / 678)
})

test('anchorToStatedCalories preserves other fields (e.g. category) untouched', () => {
    const raw = nutrition({ calories: 628, protein: 42, fat: 35.5, carbs: 38, category: 'Burgers' })
    const anchored = anchorToStatedCalories(raw, 678)
    assert.equal(anchored.category, 'Burgers')
})

test('an exact match is a no-op', () => {
    const raw = nutrition({
        calories: 1073,
        protein: 16,
        fat: 63,
        carbs: 115,
        ProteinTCalRatio: 16 / 1073,
        CarbToCalRatio: 115 / 1073
    })
    const anchored = anchorToStatedCalories(raw, 1073)
    assert.deepEqual(anchored, raw)
})
