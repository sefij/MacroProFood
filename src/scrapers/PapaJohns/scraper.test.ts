import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PapaJohnsScraper, fetchLive } from './scraper'

/**
 * Papa Johns tries a live fetch before falling back to a committed PDF (see
 * README.md, "Should this go live again?"), so — unlike every other PDF
 * scraper here — these tests run against a real document on every run
 * instead of a fixture. That's the point: a regenerated/replaced PDF that
 * breaks parsing fails the build instead of shipping silently wrong macros.
 *
 * `PAPAJOHNS_SKIP_LIVE_FETCH` forces every scrape() below onto the committed
 * fallback copy, so the suite is hermetic (deterministic, no dependency on
 * papajohns.co.uk's live availability) rather than making 8 live requests
 * per run. `fetchLive()` reads it at call time (inside scrape(), not at
 * module load), so setting it here — after the import, before any test
 * runs — is sufficient; import order doesn't matter for this.
 */
process.env.PAPAJOHNS_SKIP_LIVE_FETCH = '1'

const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) / Math.abs(b) <= tol

test('scrape(): needs no browser — initialize is a no-op', async () => {
    const scraper = new PapaJohnsScraper()
    await scraper.initialize()
    const items = await scraper.scrape()
    assert.ok(Object.keys(items).length > 0)
})

test('scrape(): covers every menu category, not just pizzas', async () => {
    const items = await new PapaJohnsScraper().scrape()
    const categories = new Set(Object.values(items).map((v) => v.category))
    for (const expected of ['Pizzas', 'Papadias', 'Sides', 'Desserts']) {
        assert.ok(categories.has(expected), `expected a "${expected}" item, got categories: ${[...categories]}`)
    }
})

test('scrape(): sizes and crusts are grouped as variants of one pizza', async () => {
    const items = await new PapaJohnsScraper().scrape()
    const variantEntries = Object.entries(items).filter(([, v]) => v.variantOf === 'ALL THE MEATS')
    assert.ok(variantEntries.length > 5, 'expected several All The Meats size/crust variants')
    for (const [key, entry] of variantEntries) {
        assert.equal(entry.variantGroupLabel, 'Size & Crust')
        assert.ok(key.startsWith('ALL THE MEATS ('), key)
    }
})

test('scrape(): a single-row product (a Papadia) has no spurious variant group', async () => {
    const items = await new PapaJohnsScraper().scrape()
    const fajita = items['FAJITA CHICKEN']
    assert.ok(fajita, 'expected a plain "FAJITA CHICKEN" key')
    assert.equal(fajita.variantOf, undefined)
    assert.equal(fajita.variantGroupLabel, undefined)
    assert.equal(fajita.category, 'Papadias')
})

test('scrape(): whole-product macros match the printed table exactly (hand-verified)', async () => {
    // Cross-checked against the rendered PDF page and against a user-reported
    // real-world value during development — this pins both to a regression.
    const items = await new PapaJohnsScraper().scrape()
    const fajita = items['FAJITA CHICKEN']
    assert.equal(fajita.calories, 610)
    assert.equal(fajita.protein, 31.4)
    assert.equal(fajita.fat, 15.4)
    assert.equal(fajita.carbs, 82.4)
})

test('scrape(): every item satisfies the Atwater identity', async () => {
    // Belt-and-suspenders: the scraper itself gates each row on this (at the
    // per-100g level, ±12%) before emitting it, so a failure here means the
    // gate regressed, not just one row. Checked at the whole-product level,
    // which is the same linear scaling and so the same identity — with a
    // slightly wider tolerance since two roundings (per-100g, then ×weight)
    // compound.
    const items = await new PapaJohnsScraper().scrape()
    let checked = 0
    for (const [key, entry] of Object.entries(items)) {
        checked++
        assert.ok(Number.isFinite(entry.calories) && entry.calories > 0, key)
        assert.ok(
            near(4 * entry.protein + 4 * entry.carbs + 9 * entry.fat, entry.calories, 0.15),
            `${key}: 4(${entry.protein})+4(${entry.carbs})+9(${entry.fat}) vs ${entry.calories}`
        )
    }
    assert.ok(checked > 50, `expected a large menu, got ${checked} items`)
})

test('scrape(): "Recently Delisted" products are excluded', async () => {
    const items = await new PapaJohnsScraper().scrape()
    // These are the source PDF's own discontinued-product examples — kept in
    // the PDF for compliance reasons, but not orderable, so must not appear.
    assert.equal(items['TANDOORI SPICE'], undefined)
    assert.equal(items['YULETIDE YORKIE'], undefined)
})

test('scrape(): sets the ratios the optimizer reads', async () => {
    const items = await new PapaJohnsScraper().scrape()
    for (const entry of Object.values(items)) {
        assert.ok(Number.isFinite(entry.ProteinTCalRatio))
        assert.ok(Number.isFinite(entry.CarbToCalRatio))
        assert.ok(entry.calories > 0)
    }
})

test('fetchLive(): the live fetch path itself works, not just the fallback', async () => {
    // Every scrape() test above forces PAPAJOHNS_SKIP_LIVE_FETCH so the suite
    // doesn't depend on papajohns.co.uk's live availability — but that means
    // scrape() alone can't tell "live fetch worked" from "silently fell
    // back," since both produce a full menu. Testing fetchLive() directly
    // instead makes sure a regression there (or Akamai finally blocking
    // undici's fingerprint too) fails the build instead of only ever being
    // caught by the silent fallback in production.
    delete process.env.PAPAJOHNS_SKIP_LIVE_FETCH
    try {
        const pdf = await fetchLive()
        assert.ok(pdf, 'expected a live-fetched PDF, got null (network issue or a real Akamai block)')
        assert.equal(Buffer.from(pdf.subarray(0, 4)).toString('latin1'), '%PDF')
    } finally {
        process.env.PAPAJOHNS_SKIP_LIVE_FETCH = '1'
    }
})
