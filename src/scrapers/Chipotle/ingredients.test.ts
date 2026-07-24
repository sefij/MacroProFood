import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIngredientRows } from './ingredients'
import { PdfLine, PdfCell } from '../pdf/pdf-lines'

/** Builds a {@link PdfLine} from cell strings; x/xEnd/height don't matter to this parser. */
function line (y: number, ...cellStrs: string[]): PdfLine {
    const cells: PdfCell[] = cellStrs.map((str) => ({ x: 0, xEnd: 0, height: 0, str }))
    return { page: 1, y, cells }
}

// A full 9-value macro block: kJ, kcal, fat, sat-fat, carbs, sugar, fibre, protein, salt.
const CHICKEN_VALUES = ['775', '185', '8,4', '2,1', '1', '0,3', '0,2', '27,3', '0,4']

test('parses a normal name+portion+9-values row', () => {
    const table = parseIngredientRows([line(100, 'Chicken', '113 g', ...CHICKEN_VALUES)])
    assert.deepEqual(table.get('Chicken'), {
        portion: '113 g',
        calories: 185,
        fat: 8.4,
        carbs: 1,
        protein: 27.3
    })
})

test('reads European comma-decimal values, not thousands-separated ones', () => {
    // "8,8" must parse as 8.8 (a tortilla's fat), not 88 or NaN.
    const table = parseIngredientRows([
        line(100, 'Flour Tortilla', '1 Ea (95 g)', '1243', '297', '8,8', '2,3', '49,2', '5,1', '2,8', '7,9', '1,1')
    ])
    const got = table.get('Flour Tortilla')
    assert.equal(got?.fat, 8.8)
    assert.equal(got?.carbs, 49.2)
    assert.equal(got?.protein, 7.9)
})

test('skips a stray allergen-tick cell between name and portion', () => {
    const table = parseIngredientRows([line(100, 'Chicken', 'X', '113 g', ...CHICKEN_VALUES)])
    assert.equal(table.get('Chicken')?.calories, 185)
})

test('pairs an orphan portion+values line with the name-only line that follows it', () => {
    // The Romaine Lettuce case: values come first, the name is on the next line down.
    const table = parseIngredientRows([
        line(200, '85 g', '63', '15', '0', '0', '0', '0', '0', '0', '0'),
        line(199, 'Romaine Lettuce (salad/topping)')
    ])
    assert.deepEqual(table.get('Romaine Lettuce (salad/topping)'), {
        portion: '85 g',
        calories: 15,
        fat: 0,
        carbs: 0,
        protein: 0
    })
})

test('an orphan portion+values line with no following name-only line contributes nothing', () => {
    const table = parseIngredientRows([
        line(200, '85 g', '63', '15', '0', '0', '0', '0', '0', '0', '0'),
        line(199, 'Some Product', '113 g', ...CHICKEN_VALUES) // a normal row, not a bare name
    ])
    assert.equal(table.size, 1)
    assert.ok(table.has('Some Product'))
})

test('stops before the Fountain Drinks section', () => {
    const table = parseIngredientRows([
        line(100, 'Chicken', '113 g', ...CHICKEN_VALUES),
        line(90, 'Fountain Drinks'),
        line(80, 'Coca-Cola', '330 ml', '600', '140', '0', '0', '35', '35', '0', '0', '0')
    ])
    assert.equal(table.size, 1)
    assert.ok(table.has('Chicken'))
    assert.ok(!table.has('Coca-Cola'))
})

test('drops a row whose value block is short (unparseable), without throwing', () => {
    const table = parseIngredientRows([line(100, 'Broken Row', '113 g', '775', '185')])
    assert.equal(table.size, 0)
})

test('drops a row whose calories value is zero or non-numeric', () => {
    const zeroCalRow = ['775', '0', '8,4', '2,1', '1', '0,3', '0,2', '27,3', '0,4']
    const table = parseIngredientRows([line(100, 'Water', '250 ml', ...zeroCalRow)])
    assert.equal(table.size, 0)
})

test('ignores blank lines', () => {
    const table = parseIngredientRows([
        { page: 1, y: 100, cells: [] },
        line(90, 'Chicken', '113 g', ...CHICKEN_VALUES)
    ])
    assert.equal(table.size, 1)
})
