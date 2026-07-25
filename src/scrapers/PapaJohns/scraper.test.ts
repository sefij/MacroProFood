import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PapaJohnsScraper } from './scraper'
import nutrition from './nutrition.json'

/**
 * These cover the scraper's own job — shaping the committed extract into menu
 * items — plus two invariants of the committed data itself.
 *
 * The data invariants matter more than they look. `nutrition.json` is generated
 * by an OCR pipeline (tools/papajohns/extract.mjs), so a regenerated file is
 * exactly where a silently wrong macro would enter. Asserting the same two
 * equations the extractor gates on means a bad regeneration fails the build
 * rather than shipping as food data.
 */

const extract = nutrition as unknown as {
    items: { name: string; category: string; variants: {
        label: string; calories: number; protein: number; fat: number; carbs: number
        weightG: number; per100g?: { kcal: number; protein: number; carbs: number; fat: number }
    }[] }[]
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) / Math.abs(b) <= tol

test('committed extract: every variant is self-consistent on energy', () => {
    // per-100g kcal x total weight / 100 must equal the printed total calories.
    let checked = 0
    for (const item of extract.items) {
        for (const v of item.variants) {
            if (!v.per100g) continue
            checked++
            assert.ok(
                near((v.per100g.kcal * v.weightG) / 100, v.calories, 0.02),
                `${item.name} / ${v.label}: ${v.per100g.kcal}kcal/100g x ${v.weightG}g != ${v.calories}`
            )
        }
    }
    assert.ok(checked > 0, 'expected at least one variant with per-100g figures')
})

test('committed extract: macros satisfy the Atwater identity', () => {
    for (const item of extract.items) {
        for (const v of item.variants) {
            if (!v.per100g) continue
            const p = v.per100g
            assert.ok(
                near(4 * p.protein + 4 * p.carbs + 9 * p.fat, p.kcal, 0.12),
                `${item.name} / ${v.label}: Atwater ${(4 * p.protein + 4 * p.carbs + 9 * p.fat).toFixed(0)} != ${p.kcal}`
            )
        }
    }
})

test('committed extract: whole-product macros scale from per-100g by weight', () => {
    for (const item of extract.items) {
        for (const v of item.variants) {
            if (!v.per100g) continue
            const factor = v.weightG / 100
            for (const macro of ['protein', 'fat', 'carbs'] as const) {
                const expected = Math.round(v.per100g[macro] * factor * 10) / 10
                assert.equal(v[macro], expected, `${item.name} / ${v.label} ${macro}`)
            }
        }
    }
})

test('committed extract: no product is left unnamed', () => {
    // An "Unknown (page N)" name means the title OCR failed and the item would
    // reach the app nameless.
    const unnamed = extract.items.filter((i) => /^unknown/i.test(i.name))
    assert.deepEqual(unnamed.map((i) => i.name), [], 'products with failed title OCR')
})

test('scrape(): emits one variant entry per size/crust, grouped under the product', async () => {
    const items = await new PapaJohnsScraper().scrape()
    const keys = Object.keys(items)
    assert.ok(keys.length > 0, 'expected some items')

    const first = extract.items[0]
    const expectedKey = `${first.name} (${first.variants[0].label})`
    assert.ok(items[expectedKey], `expected key ${expectedKey}`)

    const entry = items[expectedKey]
    assert.equal(entry.variantOf, first.name)
    assert.equal(entry.variantGroupLabel, 'Size & Crust')
    assert.equal(entry.variantOption, first.variants[0].label)
})

test('scrape(): carries calories and macros through unchanged', async () => {
    const items = await new PapaJohnsScraper().scrape()
    const first = extract.items[0]
    const v = first.variants[0]
    const entry = items[`${first.name} (${v.label})`]
    assert.equal(entry.calories, v.calories)
    assert.equal(entry.protein, v.protein)
    assert.equal(entry.fat, v.fat)
    assert.equal(entry.carbs, v.carbs)
})

test('scrape(): sets the ratios the optimizer reads', async () => {
    const items = await new PapaJohnsScraper().scrape()
    for (const entry of Object.values(items)) {
        assert.ok(Number.isFinite(entry.ProteinTCalRatio))
        assert.ok(Number.isFinite(entry.CarbToCalRatio))
        assert.ok(entry.calories > 0)
    }
})

test('scrape(): needs no browser — initialize is a no-op', async () => {
    // The shared runner calls initialize() before scrape(); Papa John's reads a
    // local file, so launching Chromium would be pure waste.
    const scraper = new PapaJohnsScraper()
    await scraper.initialize()
    const items = await scraper.scrape()
    assert.ok(Object.keys(items).length > 0)
})
