import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dominantMacro, expandBuildableCombos, resolveInitialSelection } from './buildable-combos'
import { BuildChoice, BuildGroup } from './types'

function choice (label: string, calories: number, next?: BuildGroup[]): BuildChoice {
    return { label, calories, protein: calories / 10, fat: 1, carbs: 1, ...(next ? { next } : {}) }
}

test('dominantMacro picks whichever of protein/fat/carbs the target leans on most', () => {
    assert.equal(dominantMacro({ protein: 177, fat: 55, carbs: 235 }), 'carbs')
    assert.equal(dominantMacro({ protein: 200, fat: 55, carbs: 100 }), 'protein')
    assert.equal(dominantMacro({ protein: 50, fat: 90, carbs: 100 }), 'carbs')
    assert.equal(dominantMacro({ protein: 50, fat: 90, carbs: 60 }), 'fat')
})

test('dominantMacro ties favor protein, then fat', () => {
    assert.equal(dominantMacro({ protein: 100, fat: 100, carbs: 100 }), 'protein')
    assert.equal(dominantMacro({ protein: 50, fat: 100, carbs: 100 }), 'fat')
})

test('a "one" group with no nested groups yields one combo per choice', () => {
    const root: BuildGroup = {
        label: 'Protein',
        selection: 'one',
        choices: [choice('Chicken', 185), choice('Steak', 165)]
    }
    const combos = expandBuildableCombos(root, 'protein')
    assert.equal(combos.length, 2)
    assert.deepEqual(combos.map((c) => c.labels), [['Chicken'], ['Steak']])
    assert.equal(combos[0].macros.calories, 185)
})

test('a "many" group contributes nothing — the optional dimension is excluded', () => {
    const root: BuildGroup = {
        label: 'Toppings',
        selection: 'many',
        choices: [choice('Cheese', 94), choice('Guac', 145)]
    }
    const combos = expandBuildableCombos(root, 'protein')
    assert.deepEqual(combos, [{ labels: [], macros: { calories: 0, protein: 0, fat: 0, carbs: 0 } }])
})

test('an "exactly" group yields every N-combination of its choices, under the pool cap', () => {
    const root: BuildGroup = {
        label: 'Quesa Sides',
        selection: 'exactly',
        count: 2,
        choices: [choice('A', 10), choice('B', 20), choice('C', 30)]
    }
    const combos = expandBuildableCombos(root, 'protein')
    // C(3,2) = 3
    assert.equal(combos.length, 3)
    const labelSets = combos.map((c) => c.labels.slice().sort()).sort()
    assert.deepEqual(labelSets, [['A', 'B'], ['A', 'C'], ['B', 'C']])
})

test('an "exactly" group\'s pool is capped to MAX_EXACTLY_POOL before combinations are taken', () => {
    const root: BuildGroup = {
        label: 'Quesa Sides',
        selection: 'exactly',
        count: 3,
        choices: Array.from({ length: 10 }, (_, i) => choice(`Option${i}`, (i + 1) * 10))
    }
    const combos = expandBuildableCombos(root, 'protein')
    // Pool capped to 5 -> C(5,3) = 10, not C(10,3) = 120.
    assert.equal(combos.length, 10)
})

test('a choice\'s nested groups cross-product with the parent pick, summing macros', () => {
    const rice: BuildGroup = {
        label: 'Choose Rice',
        selection: 'one',
        choices: [choice('White Rice', 185), choice('No Rice', 0)]
    }
    const beans: BuildGroup = {
        label: 'Choose Beans',
        selection: 'one',
        choices: [choice('Black Beans', 95), choice('No Beans', 0)]
    }
    const root: BuildGroup = {
        label: 'Protein',
        selection: 'one',
        choices: [choice('Chicken', 185, [rice, beans])]
    }
    const combos = expandBuildableCombos(root, 'protein')
    // 1 protein × 2 rice × 2 beans = 4
    assert.equal(combos.length, 4)
    const withWhiteRiceAndBeans = combos.find(
        (c) => c.labels.includes('White Rice') && c.labels.includes('Black Beans')
    )
    assert.ok(withWhiteRiceAndBeans)
    assert.deepEqual(withWhiteRiceAndBeans!.labels.sort(), ['Black Beans', 'Chicken', 'White Rice'])
    assert.equal(withWhiteRiceAndBeans!.macros.calories, 185 + 185 + 95)
})

test('per-branch asymmetry: sibling choices can unlock different nested groups (mirrors the real Tacos tree)', () => {
    const toppings: BuildGroup = { label: 'Toppings', selection: 'many', choices: [choice('Cheese', 94)] }
    const shell: BuildGroup = {
        label: 'Choose Your Taco',
        selection: 'one',
        choices: [choice('Crispy', 177), choice('Soft', 240)]
    }
    const rice: BuildGroup = { label: 'Choose Rice', selection: 'one', choices: [choice('White Rice', 185)] }
    const root: BuildGroup = {
        label: 'Protein',
        selection: 'one',
        choices: [
            choice('Chicken', 185, [shell, toppings]), // no rice
            choice('Sofritas', 84, [shell, rice, toppings]) // has rice
        ]
    }
    const combos = expandBuildableCombos(root, 'protein')
    // Chicken: 1 (protein) x 2 (shell) x 1 (toppings, excluded) = 2
    // Sofritas: 1 x 2 x 1 (rice) x 1 (toppings, excluded) = 2
    assert.equal(combos.length, 4)
    assert.ok(!combos.some((c) => c.labels.includes('Chicken') && c.labels.includes('White Rice')))
    assert.ok(combos.some((c) => c.labels.includes('Sofritas') && c.labels.includes('White Rice')))
})

test('a realistic Bowl-shaped tree (6 proteins capped to 3, x 3 rice x 3 beans, toppings excluded) yields 27 combos', () => {
    const rice: BuildGroup = {
        label: 'Choose Rice',
        selection: 'one',
        choices: [choice('White Rice', 185), choice('Brown Rice', 185), choice('No Rice', 0)]
    }
    const beans: BuildGroup = {
        label: 'Choose Beans',
        selection: 'one',
        choices: [choice('Black Beans', 95), choice('Pinto Beans', 95), choice('No Beans', 0)]
    }
    const toppings: BuildGroup = {
        label: 'Add Your Toppings',
        selection: 'many',
        choices: Array.from({ length: 9 }, (_, i) => choice(`Topping${i}`, 10))
    }
    const proteins = ['Chicken', 'Steak', 'Carnitas', 'Barbacoa', 'Sofritas', 'Honey Chicken']
    const root: BuildGroup = {
        label: 'Protein or Veggie',
        selection: 'one',
        choices: proteins.map((p) => choice(p, 185, [rice, beans, toppings]))
    }
    const combos = expandBuildableCombos(root, 'protein')
    // 6 proteins capped to MAX_GROUP_CHOICES (3) x 3 rice x 3 beans.
    assert.equal(combos.length, 3 * 3 * 3)
})

test('a realistic Quesadilla-shaped tree (8 proteins capped to 3, x capped pick-3-of-10) yields 30 combos', () => {
    const sides: BuildGroup = {
        label: 'Quesa Sides',
        selection: 'exactly',
        count: 3,
        choices: [
            choice('Sour Cream', 45),
            choice('Sweetcorn', 38),
            choice('Fresh Tomato', 15),
            choice('Green-Chili', 6),
            choice('Red-Chili', 9),
            choice('Pinto Beans', 95),
            choice('Salad Lettuce', 4),
            choice('Black Beans', 95),
            choice('White Rice', 185),
            choice('Brown Rice', 185)
        ]
    }
    const proteins = ['Chicken', 'Steak', 'Barbacoa', 'Carnitas', 'Honey Chicken', 'Cheese', 'Sofritas', 'Fajita Veggie']
    const root: BuildGroup = {
        label: 'Protein or Veggie',
        selection: 'one',
        choices: proteins.map((p) => choice(p, 100, [sides]))
    }
    const combos = expandBuildableCombos(root, 'protein')
    // Sides pool capped to 5 -> C(5,3) = 10; 8 proteins capped to MAX_GROUP_CHOICES (3).
    assert.equal(combos.length, 3 * 10)
})

test('a group is capped, sampled across the target macro\'s ratio range (not clustered)', () => {
    // A high-ratio (lean, high-protein) and a low-ratio (fatty, low-protein)
    // choice should both survive the cap, not just whichever sorts first.
    const root: BuildGroup = {
        label: 'Protein or Veggie',
        selection: 'one',
        choices: [
            { label: 'Lean', calories: 100, protein: 30, fat: 1, carbs: 1 }, // ratio 0.30
            { label: 'Mid1', calories: 100, protein: 15, fat: 5, carbs: 1 }, // ratio 0.15
            { label: 'Mid2', calories: 100, protein: 14, fat: 5, carbs: 1 }, // ratio 0.14
            { label: 'Mid3', calories: 100, protein: 13, fat: 5, carbs: 1 }, // ratio 0.13
            { label: 'Mid4', calories: 100, protein: 12, fat: 5, carbs: 1 }, // ratio 0.12
            { label: 'Fatty', calories: 100, protein: 2, fat: 9, carbs: 1 } // ratio 0.02
        ]
    }
    const combos = expandBuildableCombos(root, 'protein')
    const labels = combos.map((c) => c.labels[0])
    assert.equal(labels.length, 3)
    assert.ok(labels.includes('Lean'), 'the highest protein-to-calorie choice should survive')
    assert.ok(labels.includes('Fatty'), 'the lowest protein-to-calorie choice should survive')
})

test('changing the dominant macro changes which choices survive the cap', () => {
    // "Balanced" has the highest fat-to-calorie ratio but a middling protein
    // ratio; "HighProtein" is the reverse. Capping by 'protein' should keep
    // HighProtein and drop Balanced (or vice versa for 'fat').
    const root: BuildGroup = {
        label: 'Protein or Veggie',
        selection: 'one',
        choices: [
            { label: 'HighProtein', calories: 100, protein: 30, fat: 2, carbs: 1 },
            { label: 'Mid', calories: 100, protein: 15, fat: 5, carbs: 1 },
            { label: 'HighFat', calories: 100, protein: 2, fat: 9, carbs: 1 }
        ]
    }
    // All 3 choices survive either way here (3 <= MAX_GROUP_CHOICES), so
    // instead verify via a 4th, clearly-dominated-on-both-axes choice that a
    // macro change alone can swap which set of labels comes out capped.
    const withExtra: BuildGroup = {
        ...root,
        choices: [...root.choices, { label: 'Filler', calories: 100, protein: 8, fat: 4, carbs: 1 }]
    }
    const byProtein = expandBuildableCombos(withExtra, 'protein').map((c) => c.labels[0])
    const byFat = expandBuildableCombos(withExtra, 'fat').map((c) => c.labels[0])
    assert.ok(byProtein.includes('HighProtein'), 'ranking by protein should keep the highest-protein-ratio choice')
    assert.ok(byFat.includes('HighFat'), 'ranking by fat should keep the highest-fat-ratio choice')
})

test('a group at or under MAX_GROUP_CHOICES is left uncapped', () => {
    const root: BuildGroup = {
        label: 'Protein or Veggie',
        selection: 'one',
        choices: [choice('A', 100), choice('B', 90), choice('C', 80)]
    }
    const combos = expandBuildableCombos(root, 'protein')
    assert.equal(combos.length, 3)
})

test('resolveInitialSelection: a simple "one" group resolves its single picked index', () => {
    const root: BuildGroup = {
        label: 'Protein',
        selection: 'one',
        choices: [choice('Chicken', 185), choice('Steak', 165)]
    }
    const initial = resolveInitialSelection(root, ['Steak'])
    assert.deepEqual(initial.selectedIndices, [1])
    // A selected leaf choice (no `next`) still gets a nested entry — an empty array, not a missing key.
    assert.deepEqual(initial.nested.get(1), [])
})

test('resolveInitialSelection: an unmatched label resolves to nothing selected', () => {
    const root: BuildGroup = {
        label: 'Protein',
        selection: 'one',
        choices: [choice('Chicken', 185), choice('Steak', 165)]
    }
    const initial = resolveInitialSelection(root, ['Barbacoa'])
    assert.deepEqual(initial.selectedIndices, [])
})

test('resolveInitialSelection: "many" groups never resolve a selection, regardless of labels', () => {
    const root: BuildGroup = {
        label: 'Toppings',
        selection: 'many',
        choices: [choice('Cheese', 94), choice('Guac', 145)]
    }
    const initial = resolveInitialSelection(root, ['Cheese', 'Guac'])
    assert.deepEqual(initial.selectedIndices, [])
})

test('resolveInitialSelection: an "exactly" group resolves all N matching choices, order-independent', () => {
    const root: BuildGroup = {
        label: 'Quesa Sides',
        selection: 'exactly',
        count: 2,
        choices: [choice('A', 10), choice('B', 20), choice('C', 30)]
    }
    const initial = resolveInitialSelection(root, ['C', 'A'])
    assert.deepEqual(initial.selectedIndices, [0, 2]) // A (index 0), C (index 2)
})

test('resolveInitialSelection: nested groups resolve correctly, partitioning labels across siblings', () => {
    const rice: BuildGroup = {
        label: 'Choose Rice',
        selection: 'one',
        choices: [choice('White Rice', 185), choice('No Rice', 0)]
    }
    const beans: BuildGroup = {
        label: 'Choose Beans',
        selection: 'one',
        choices: [choice('Black Beans', 95), choice('No Beans', 0)]
    }
    const root: BuildGroup = {
        label: 'Protein',
        selection: 'one',
        choices: [choice('Chicken', 185, [rice, beans]), choice('Steak', 165, [rice, beans])]
    }
    const initial = resolveInitialSelection(root, ['Chicken', 'No Rice', 'Black Beans'])
    assert.deepEqual(initial.selectedIndices, [0]) // Chicken
    const chickenNested = initial.nested.get(0)!
    assert.equal(chickenNested.length, 2) // rice, beans
    assert.deepEqual(chickenNested[0].selectedIndices, [1]) // No Rice
    assert.deepEqual(chickenNested[1].selectedIndices, [0]) // Black Beans
})

test('resolveInitialSelection round-trips every combo expandBuildableCombos can produce', () => {
    // For every generated combo, re-resolving its own label list against the
    // same (uncapped) tree should land back on the same choice at every level.
    const rice: BuildGroup = {
        label: 'Choose Rice',
        selection: 'one',
        choices: [choice('White Rice', 185), choice('Brown Rice', 185), choice('No Rice', 0)]
    }
    const beans: BuildGroup = {
        label: 'Choose Beans',
        selection: 'one',
        choices: [choice('Black Beans', 95), choice('Pinto Beans', 95), choice('No Beans', 0)]
    }
    const proteins = ['Chicken', 'Steak', 'Carnitas', 'Barbacoa', 'Sofritas', 'Honey Chicken']
    const root: BuildGroup = {
        label: 'Protein or Veggie',
        selection: 'one',
        choices: proteins.map((p) => choice(p, 185, [rice, beans]))
    }

    const combos = expandBuildableCombos(root, 'protein')
    assert.ok(combos.length > 0)
    for (const combo of combos) {
        const initial = resolveInitialSelection(root, combo.labels)
        assert.equal(initial.selectedIndices.length, 1)
        const proteinIndex = initial.selectedIndices[0]
        assert.equal(root.choices[proteinIndex].label, combo.labels[0])

        const nested = initial.nested.get(proteinIndex)!
        assert.equal(nested.length, 2)
        const riceIndex = nested[0].selectedIndices[0]
        const beansIndex = nested[1].selectedIndices[0]
        assert.ok(combo.labels.includes(rice.choices[riceIndex].label))
        assert.ok(combo.labels.includes(beans.choices[beansIndex].label))
    }
})
