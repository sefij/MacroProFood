import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDeliverooDishes } from './deliveroo'

function pageWithItems (items: unknown[]): string {
    const nextData = { props: { initialState: { menuPage: { menu: { metas: { root: { items } } } } } } }
    return `<html><body><script id="__NEXT_DATA__">${JSON.stringify(nextData)}</script></body></html>`
}

test('keeps items with a real name and description', () => {
    const html = pageWithItems([
        { name: 'Hamburger', description: 'Two fresh, juicy high-quality beef patties hot off the grill.', productMeta: '678 kcal' }
    ])
    const dishes = parseDeliverooDishes(html)
    assert.deepEqual(dishes.get('Hamburger'), {
        name: 'Hamburger',
        description: 'Two fresh, juicy high-quality beef patties hot off the grill.'
    })
})

test('drops items with no description (build-your-own scaffolding)', () => {
    const html = pageWithItems([{ name: 'Burger Bun' }, { name: 'Add Cheese', description: '' }])
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
        { name: 'Diet Coke', description: 'first' },
        { name: 'Diet Coke', description: 'second' }
    ])
    const dishes = parseDeliverooDishes(html)
    assert.equal(dishes.get('Diet Coke')?.description, 'first')
})

test('throws when the page has no __NEXT_DATA__ script', () => {
    assert.throws(() => parseDeliverooDishes('<html><body>no data here</body></html>'))
})
