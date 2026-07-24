import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildableTreeFromRoot } from './buildable'
import { DeliverooModifierGroup, DeliverooRoot } from './deliveroo'
import { IngredientNutrition } from './ingredients'

function ingredient (calories: number, protein: number, fat: number, carbs: number): IngredientNutrition {
    return { portion: '113 g', calories, protein, fat, carbs }
}

const INGREDIENTS = new Map<string, IngredientNutrition>([
    ['Chicken', ingredient(185, 27.3, 8.4, 1)],
    ['Sofritas (braised tofu)', ingredient(84, 7, 4.6, 3)],
    ['Coriander-Lime White Rice', ingredient(185, 4.1, 2, 41.5)],
    ['Black Beans', ingredient(95, 7.2, 2.4, 4.9)],
    ['Monterey Jack Cheese', ingredient(94, 5.8, 7.8, 0.1)]
])

function group (over: Partial<DeliverooModifierGroup> & { id: string, name: string }): DeliverooModifierGroup {
    return { minSelection: 0, maxSelection: 0, modifierOptions: [], ...over }
}

test('one-of-one group (min=max=1) resolves to selection "one"', () => {
    const root: DeliverooRoot = {
        items: [{ name: 'Burrito Bowl', modifierGroupIds: ['protein'] }],
        modifierGroups: [
            group({
                id: 'protein',
                name: 'Protein or Veggie',
                minSelection: 1,
                maxSelection: 1,
                modifierOptions: [{ name: 'Chicken', modifierGroupIds: [] }]
            })
        ]
    }
    const tree = buildableTreeFromRoot(root, 'Burrito Bowl', INGREDIENTS)
    assert.equal(tree.selection, 'one')
    assert.equal(tree.count, undefined)
    assert.deepEqual(tree.choices[0], { label: 'Chicken', calories: 185, protein: 27.3, fat: 8.4, carbs: 1 })
})

test('exactly-N group (min=max=N>1) resolves to selection "exactly" with count', () => {
    const root: DeliverooRoot = {
        items: [{ name: 'Quesadilla', modifierGroupIds: ['sides'] }],
        modifierGroups: [
            group({
                id: 'sides',
                name: 'Quesa Sides',
                minSelection: 3,
                maxSelection: 3,
                modifierOptions: [{ name: 'Black Beans', modifierGroupIds: [] }]
            })
        ]
    }
    const tree = buildableTreeFromRoot(root, 'Quesadilla', INGREDIENTS)
    assert.equal(tree.selection, 'exactly')
    assert.equal(tree.count, 3)
})

test('optional/multi group (min<max) resolves to selection "many"', () => {
    const root: DeliverooRoot = {
        items: [{ name: 'Burrito Bowl', modifierGroupIds: ['toppings'] }],
        modifierGroups: [
            group({
                id: 'toppings',
                name: 'Add Your Toppings',
                minSelection: 0,
                maxSelection: 9,
                modifierOptions: [{ name: 'Cheese', modifierGroupIds: [] }]
            })
        ]
    }
    const tree = buildableTreeFromRoot(root, 'Burrito Bowl', INGREDIENTS)
    assert.equal(tree.selection, 'many')
})

test('"No Rice"/"No Beans" resolve to a genuine zero-macro choice, no alias needed', () => {
    const root: DeliverooRoot = {
        items: [{ name: 'Burrito Bowl', modifierGroupIds: ['rice'] }],
        modifierGroups: [
            group({
                id: 'rice',
                name: 'Choose Rice',
                minSelection: 1,
                maxSelection: 1,
                modifierOptions: [{ name: 'No Rice', modifierGroupIds: [] }]
            })
        ]
    }
    const tree = buildableTreeFromRoot(root, 'Burrito Bowl', INGREDIENTS)
    assert.deepEqual(tree.choices[0], { label: 'No Rice', calories: 0, protein: 0, fat: 0, carbs: 0 })
})

test('the "Veggie" protein option is excluded from the picker', () => {
    const root: DeliverooRoot = {
        items: [{ name: 'Burrito Bowl', modifierGroupIds: ['protein'] }],
        modifierGroups: [
            group({
                id: 'protein',
                name: 'Protein or Veggie',
                minSelection: 1,
                maxSelection: 1,
                modifierOptions: [
                    { name: 'Chicken', modifierGroupIds: [] },
                    { name: 'Veggie', modifierGroupIds: [] }
                ]
            })
        ]
    }
    const tree = buildableTreeFromRoot(root, 'Burrito Bowl', INGREDIENTS)
    assert.equal(tree.choices.length, 1)
    assert.equal(tree.choices[0].label, 'Chicken')
})

test('"Extra" and "Add a Drink?" groups are skipped, at the root and nested', () => {
    const root: DeliverooRoot = {
        items: [{ name: 'Burrito Bowl', modifierGroupIds: ['protein', 'drink'] }],
        modifierGroups: [
            group({
                id: 'protein',
                name: 'Protein or Veggie',
                minSelection: 1,
                maxSelection: 1,
                modifierOptions: [{ name: 'Chicken', modifierGroupIds: ['extra', 'rice'] }]
            }),
            group({ id: 'drink', name: 'Add a Drink?', minSelection: 0, maxSelection: 5 }),
            group({ id: 'extra', name: 'Extra', minSelection: 0, maxSelection: 6 }),
            group({
                id: 'rice',
                name: 'Choose Rice',
                minSelection: 1,
                maxSelection: 1,
                modifierOptions: [{ name: 'White Rice', modifierGroupIds: [] }]
            })
        ]
    }
    const tree = buildableTreeFromRoot(root, 'Burrito Bowl', INGREDIENTS)
    // The root-level "Add a Drink?" group is skipped, leaving exactly one top-level group.
    assert.equal(tree.label, 'Protein or Veggie')
    // Chicken's nested "Extra" is skipped; only "Choose Rice" survives.
    const next = tree.choices[0].next
    assert.equal(next?.length, 1)
    assert.equal(next?.[0].label, 'Choose Rice')
})

test('emoji/whitespace variants of the same option name resolve to the same alias', () => {
    const root: DeliverooRoot = {
        items: [{ name: 'Burrito Bowl', modifierGroupIds: ['protein'] }],
        modifierGroups: [
            group({
                id: 'protein',
                name: 'Protein or Veggie',
                minSelection: 1,
                maxSelection: 1,
                modifierOptions: [
                    { name: 'Sofritas 🌱', modifierGroupIds: [] },
                    { name: 'Sofritas🌱', modifierGroupIds: [] }
                ]
            })
        ]
    }
    const tree = buildableTreeFromRoot(root, 'Burrito Bowl', INGREDIENTS)
    assert.equal(tree.choices[0].label, 'Sofritas')
    assert.equal(tree.choices[1].label, 'Sofritas')
    assert.equal(tree.choices[0].calories, 84)
    assert.equal(tree.choices[1].calories, 84)
})

test('a sibling choice can unlock different nested groups than another (per-branch asymmetry)', () => {
    // Mirrors the real Tacos tree: Chicken only gets Toppings, Sofritas also gets Rice.
    const root: DeliverooRoot = {
        items: [{ name: 'Tacos (3)', modifierGroupIds: ['protein'] }],
        modifierGroups: [
            group({
                id: 'protein',
                name: 'Protein or Veggie',
                minSelection: 1,
                maxSelection: 1,
                modifierOptions: [
                    { name: 'Chicken', modifierGroupIds: ['toppings'] },
                    { name: 'Sofritas 🌱', modifierGroupIds: ['toppings', 'rice'] }
                ]
            }),
            group({
                id: 'toppings',
                name: 'Add Your Toppings',
                minSelection: 0,
                maxSelection: 9,
                modifierOptions: [{ name: 'Cheese', modifierGroupIds: [] }]
            }),
            group({
                id: 'rice',
                name: 'Choose Rice',
                minSelection: 1,
                maxSelection: 1,
                modifierOptions: [{ name: 'White Rice', modifierGroupIds: [] }]
            })
        ]
    }
    const tree = buildableTreeFromRoot(root, 'Tacos (3)', INGREDIENTS)
    const [chicken, sofritas] = tree.choices
    assert.equal(chicken.next?.length, 1)
    assert.equal(chicken.next?.[0].label, 'Add Your Toppings')
    assert.equal(sofritas.next?.length, 2)
    assert.deepEqual(
        sofritas.next?.map((g) => g.label).sort(),
        ['Add Your Toppings', 'Choose Rice']
    )
})

test('throws on an option with no known ingredient alias', () => {
    const root: DeliverooRoot = {
        items: [{ name: 'Burrito Bowl', modifierGroupIds: ['protein'] }],
        modifierGroups: [
            group({
                id: 'protein',
                name: 'Protein or Veggie',
                minSelection: 1,
                maxSelection: 1,
                modifierOptions: [{ name: 'Definitely Not A Real Option', modifierGroupIds: [] }]
            })
        ]
    }
    assert.throws(() => buildableTreeFromRoot(root, 'Burrito Bowl', INGREDIENTS), /no ingredient alias/)
})

test('throws when an alias resolves to an ingredient missing from the PDF table', () => {
    const root: DeliverooRoot = {
        items: [{ name: 'Burrito Bowl', modifierGroupIds: ['protein'] }],
        modifierGroups: [
            group({
                id: 'protein',
                name: 'Protein or Veggie',
                minSelection: 1,
                maxSelection: 1,
                modifierOptions: [{ name: 'Chicken', modifierGroupIds: [] }]
            })
        ]
    }
    const emptyIngredients = new Map<string, IngredientNutrition>()
    assert.throws(() => buildableTreeFromRoot(root, 'Burrito Bowl', emptyIngredients), /not in the parsed PDF table/)
})

test('throws when the format\'s root item is not found', () => {
    const root: DeliverooRoot = { items: [], modifierGroups: [] }
    assert.throws(() => buildableTreeFromRoot(root, 'Burrito Bowl', INGREDIENTS), /not found/)
})

test('throws when a root item has zero or multiple top-level choice groups', () => {
    const zeroGroups: DeliverooRoot = {
        items: [{ name: 'Burrito Bowl', modifierGroupIds: [] }],
        modifierGroups: []
    }
    assert.throws(() => buildableTreeFromRoot(zeroGroups, 'Burrito Bowl', INGREDIENTS), /expected exactly one/)

    const twoGroups: DeliverooRoot = {
        items: [{ name: 'Burrito Bowl', modifierGroupIds: ['a', 'b'] }],
        modifierGroups: [
            group({ id: 'a', name: 'A', minSelection: 1, maxSelection: 1, modifierOptions: [{ name: 'Chicken', modifierGroupIds: [] }] }),
            group({ id: 'b', name: 'B', minSelection: 1, maxSelection: 1, modifierOptions: [{ name: 'Chicken', modifierGroupIds: [] }] })
        ]
    }
    assert.throws(() => buildableTreeFromRoot(twoGroups, 'Burrito Bowl', INGREDIENTS), /expected exactly one/)
})
