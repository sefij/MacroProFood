import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDeliverooDishes, parseDeliverooRoot } from './deliveroo'

function pageWithItems (items: unknown[]): string {
    const nextData = { props: { initialState: { menuPage: { menu: { metas: { root: { items } } } } } } }
    return `<html><body><script id="__NEXT_DATA__">${JSON.stringify(nextData)}</script></body></html>`
}

function pageWithRoot (root: unknown): string {
    const nextData = { props: { initialState: { menuPage: { menu: { metas: { root } } } } } }
    return `<html><body><script id="__NEXT_DATA__">${JSON.stringify(nextData)}</script></body></html>`
}

test('keeps items with a real name and description', () => {
    const html = pageWithItems([
        { name: 'Go-To Chicken Bowl', description: 'Adobo chicken with rice, beans, salsa.' }
    ])
    const dishes = parseDeliverooDishes(html)
    assert.deepEqual(dishes.get('Go-To Chicken Bowl'), {
        name: 'Go-To Chicken Bowl',
        description: 'Adobo chicken with rice, beans, salsa.'
    })
})

test('drops items with no description (build-your-own scaffolding)', () => {
    const html = pageWithItems([{ name: 'Burrito Bowl' }, { name: 'Chicken', description: '' }])
    const dishes = parseDeliverooDishes(html)
    assert.equal(dishes.size, 0)
})

test('drops the "None" placeholder description', () => {
    const html = pageWithItems([{ name: 'Some Modifier', description: 'None' }])
    const dishes = parseDeliverooDishes(html)
    assert.equal(dishes.size, 0)
})

test('drops a bare-number description (data-entry glitch, not ingredient text)', () => {
    const html = pageWithItems([{ name: 'Some Modifier', description: '11.4' }])
    const dishes = parseDeliverooDishes(html)
    assert.equal(dishes.size, 0)
})

test('first occurrence wins for a name listed twice', () => {
    const html = pageWithItems([
        { name: 'Coke Zero', description: 'first' },
        { name: 'Coke Zero', description: 'second' }
    ])
    const dishes = parseDeliverooDishes(html)
    assert.equal(dishes.get('Coke Zero')?.description, 'first')
})

test('throws when the page has no __NEXT_DATA__ script', () => {
    assert.throws(() => parseDeliverooDishes('<html><body>no data here</body></html>'))
})

test('parseDeliverooRoot extracts modifierGroups alongside items', () => {
    const html = pageWithRoot({
        items: [{ name: 'Burrito Bowl', modifierGroupIds: ['g1'] }],
        modifierGroups: [
            {
                id: 'g1',
                name: 'Protein or Veggie',
                minSelection: 1,
                maxSelection: 1,
                modifierOptions: [
                    { name: 'Chicken', nutritionalInfo: { energyFormatted: '185 kcal' }, modifierGroupIds: ['g2'] },
                    { name: 'Steak', modifierGroupIds: [] }
                ]
            }
        ]
    })
    const root = parseDeliverooRoot(html)
    assert.equal(root.modifierGroups.length, 1)
    const group = root.modifierGroups[0]
    assert.equal(group.name, 'Protein or Veggie')
    assert.equal(group.minSelection, 1)
    assert.equal(group.maxSelection, 1)
    assert.equal(group.modifierOptions[0].energyKcal, 185)
    assert.deepEqual(group.modifierOptions[0].modifierGroupIds, ['g2'])
    assert.equal(group.modifierOptions[1].energyKcal, undefined)
})

test('parseDeliverooRoot defaults a group missing minSelection/maxSelection to 0', () => {
    const html = pageWithRoot({
        items: [],
        modifierGroups: [{ id: 'g1', name: 'Extra', modifierOptions: [] }]
    })
    const root = parseDeliverooRoot(html)
    assert.equal(root.modifierGroups[0].minSelection, 0)
    assert.equal(root.modifierGroups[0].maxSelection, 0)
})

test('parseDeliverooRoot drops a modifier group missing an id or name', () => {
    const html = pageWithRoot({
        items: [],
        modifierGroups: [{ id: 'g1', modifierOptions: [] }, { name: 'no id', modifierOptions: [] }]
    })
    const root = parseDeliverooRoot(html)
    assert.equal(root.modifierGroups.length, 0)
})
