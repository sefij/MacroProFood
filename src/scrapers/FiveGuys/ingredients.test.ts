import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIngredientRows } from './ingredients'
import { PdfLine, PdfCell } from '../pdf/pdf-lines'

/** Builds a {@link PdfLine} from cell strings; x/xEnd/height don't matter to this parser. */
function line (page: number, y: number, ...cellStrs: string[]): PdfLine {
    const cells: PdfCell[] = cellStrs.map((str) => ({ x: 0, xEnd: 0, height: 0, str }))
    return { page, y, cells }
}

const HEADING = 'NUTRITION GUIDE - UK LOCATIONS ONLY'

// A full 18-value row: 9 per-serving + 9 per-100g, kJ/kcal/fat/sat/carbs/sugar/fibre/protein/salt each.
const PATTY_VALUES = ['812', '195', '14', '5.6', '0', '0', '0', '18', '0.13', '1212', '291', '21', '8.3', '0', '0', '0', '27', '0.19']

test('ignores everything before the NUTRITION GUIDE heading (allergen matrix)', () => {
    const table = parseIngredientRows([
        line(1, 800, 'ALLERGEN GUIDE - UK LOCATIONS ONLY'),
        line(1, 700, 'Beef Burger Patty', '1', '1', '1'), // allergen tick row, not macros
        line(5, 700, HEADING),
        line(5, 660, 'Beef Burger Patty', ...PATTY_VALUES)
    ])
    assert.deepEqual(table.get('Beef Burger Patty'), { calories: 195, fat: 14, carbs: 0, protein: 18 })
})

test('parses a normal name+18-values row (per-serving block only)', () => {
    const table = parseIngredientRows([line(5, 700, HEADING), line(5, 660, 'Beef Burger Patty', ...PATTY_VALUES)])
    assert.deepEqual(table.get('Beef Burger Patty'), { calories: 195, fat: 14, carbs: 0, protein: 18 })
})

test('parses a row with only a 9-value per-serving block, no per-100g repeat', () => {
    const nineValues = ['2462', '594', '43', '7.0', '25', '5.0', '11', '25', '1.9']
    const table = parseIngredientRows([
        line(5, 700, HEADING),
        line(5, 660, 'Bulk Peanuts Without Shell ***', ...nineValues)
    ])
    assert.deepEqual(table.get('Bulk Peanuts Without Shell ***'), { calories: 594, fat: 43, carbs: 25, protein: 25 })
})

test('joins multiple leading name cells (a trademark symbol or qualifier split into its own cell)', () => {
    const table = parseIngredientRows([
        line(5, 700, HEADING),
        line(5, 660, 'Cheese', '(pasteurised)', ...PATTY_VALUES)
    ])
    assert.ok(table.has('Cheese (pasteurised)'))
})

test('skips a section-heading line with no numeric cells', () => {
    const table = parseIngredientRows([
        line(5, 700, HEADING),
        line(5, 680, 'MEAT'),
        line(5, 660, 'Beef Burger Patty', ...PATTY_VALUES)
    ])
    assert.equal(table.size, 1)
    assert.ok(table.has('Beef Burger Patty'))
})

test('first occurrence wins when a name repeats with different values', () => {
    // "Pistachio***" and "Jimmy's Iced Coffee" each appear twice in the real
    // PDF (a full-size row, then a smaller "Little" mix-in row under the same
    // name) — the full-size figure must win since recipes.ts relies on it.
    const table = parseIngredientRows([
        line(5, 700, HEADING),
        line(5, 90, 'Pistachio***', '803', '194', '17', '2.1', '2.1', '1.5', '2.1', '7.8', '0'),
        line(6, 430, 'Pistachio***', '401', '97', '8.3', '1.1', '1.1', '0.8', '1.1', '3.9', '0.0')
    ])
    assert.equal(table.get('Pistachio***')?.calories, 194)
})

test('drops a row whose value block is short (unparseable), without throwing', () => {
    const table = parseIngredientRows([line(5, 700, HEADING), line(5, 660, 'Broken Row', '812', '195')])
    assert.equal(table.size, 0)
})

test('drops a row whose calories value is zero or non-numeric', () => {
    const zeroCalRow = ['323', '0', '5.5', '2.2', '0.7', '0', '0', '6.4', '0.92']
    const table = parseIngredientRows([line(5, 700, HEADING), line(5, 660, 'Water', ...zeroCalRow)])
    assert.equal(table.size, 0)
})

test('ignores blank lines', () => {
    const table = parseIngredientRows([
        line(5, 700, HEADING),
        { page: 5, y: 690, cells: [] },
        line(5, 660, 'Beef Burger Patty', ...PATTY_VALUES)
    ])
    assert.equal(table.size, 1)
})

test('never emits a row before any NUTRITION GUIDE heading is seen', () => {
    const table = parseIngredientRows([line(1, 700, 'Beef Burger Patty', ...PATTY_VALUES)])
    assert.equal(table.size, 0)
})
