import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconciliationGap, RECONCILIATION_WARNING_THRESHOLD } from './scraper'

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
