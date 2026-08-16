import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterSnapshotItems } from './item-filters'
import { SnapshotItem } from './types'

function item (overrides: Partial<SnapshotItem> & { name: string }): SnapshotItem {
    return { calories: 300, protein: 20, fat: 10, carbs: 30, ...overrides }
}

test('no restriction and no exclude terms returns items unchanged', () => {
    const items = [item({ name: 'Big Mac' }), item({ name: 'McPlant', dietary: ['vegetarian', 'vegan'] })]
    const result = filterSnapshotItems(items, 'none', [])
    assert.deepEqual(result, items)
})

test("'vegetarian' restriction drops items with no dietary tag at all", () => {
    const items = [
        item({ name: 'Big Mac' }), // no dietary field
        item({ name: 'Cheese & Bacon McCrispy' }) // no dietary field
    ]
    const result = filterSnapshotItems(items, 'vegetarian', [])
    assert.equal(result.length, 0, 'unconfirmed items must not survive a dietary restriction')
})

test("'vegetarian' restriction keeps vegetarian and vegan items, drops everything else", () => {
    const items = [
        item({ name: 'McPlant', dietary: ['vegetarian', 'vegan'] }),
        item({ name: 'Veggie Dippers', dietary: ['vegetarian'] }),
        item({ name: 'Big Mac' })
    ]
    const result = filterSnapshotItems(items, 'vegetarian', [])
    assert.deepEqual(result.map((i) => i.name), ['McPlant', 'Veggie Dippers'])
})

test("'vegan' restriction excludes a vegetarian-only item", () => {
    const items = [
        item({ name: 'McPlant', dietary: ['vegetarian', 'vegan'] }),
        item({ name: 'Veggie Dippers', dietary: ['vegetarian'] })
    ]
    const result = filterSnapshotItems(items, 'vegan', [])
    assert.deepEqual(result.map((i) => i.name), ['McPlant'])
})

test('exclude-list matches case-insensitively as a substring of the name', () => {
    const items = [
        item({ name: 'Mushroom Swiss Burger' }),
        item({ name: 'Big Mac' })
    ]
    const result = filterSnapshotItems(items, 'none', ['MUSHROOM'])
    assert.deepEqual(result.map((i) => i.name), ['Big Mac'])
})

test('blank exclude terms are ignored rather than matching everything', () => {
    const items = [item({ name: 'Big Mac' })]
    const result = filterSnapshotItems(items, 'none', ['  ', ''])
    assert.equal(result.length, 1)
})

test('dietary restriction and exclude-list compose (AND, not OR)', () => {
    const items = [
        item({ name: 'McPlant', dietary: ['vegetarian', 'vegan'] }),
        item({ name: 'Mushroom McPlant', dietary: ['vegetarian', 'vegan'] }),
        item({ name: 'Big Mac' })
    ]
    const result = filterSnapshotItems(items, 'vegan', ['mushroom'])
    assert.deepEqual(result.map((i) => i.name), ['McPlant'])
})

test('a variant item with no dietary tag is dropped as a whole unit, not per-option', () => {
    const items = [
        item({
            name: 'Fries',
            variants: [
                { label: 'Small', calories: 200, protein: 3, fat: 10, carbs: 25 },
                { label: 'Large', calories: 400, protein: 6, fat: 20, carbs: 50 }
            ]
        })
    ]
    const result = filterSnapshotItems(items, 'vegetarian', [])
    assert.equal(result.length, 0)
})
