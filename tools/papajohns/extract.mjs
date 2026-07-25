/*
 * Offline extractor for Papa John's committed nutrition PDF — vision LLM version.
 *
 * Supersedes an OCR pipeline (Tesseract, then PaddleOCR) tried first and kept
 * only as history in this repo's git log. Both failed on their own terms —
 * Tesseract measured 93% raw cell accuracy and needed an arithmetic
 * validate-and-repair pass (below) just to reach usable quality; PaddleOCR
 * measured 60% with a worse failure mode, whole table rows merging across
 * different products. Sending Claude the rendered page directly, with a JSON
 * schema instead of a page of loose text, measured **100% exact match** against
 * a hand transcription, and cleared two cases that broke every OCR attempt
 * outright: a page whose title OCR always returned an empty string despite the
 * heading being plainly legible, and the two-products-per-page layout OCR's
 * grid-detection code never successfully parsed. One of those was independently
 * corroborated against a by-eye read of the source page, not just self-consistent.
 *
 * Deliberately NOT part of the scraper. This is a one-off job (a few dollars,
 * a few minutes) run by hand whenever the source PDF changes — see
 * ../../src/scrapers/PapaJohns/README.md. Sits outside src/ so this project's
 * TypeScript build and CLI dependency list stay untouched by dev-only tooling
 * (@anthropic-ai/sdk, @napi-rs/canvas, pdfjs-dist).
 *
 * Nothing here trusts a single vision call blindly, even though nothing failed
 * in testing. Every row must still satisfy the two equations the source table
 * itself asserts — this check is unrelated to *how* the numbers were read, and
 * carries over unchanged from the OCR pipeline:
 *
 *   energy   per100g_kcal x totalWeight / 100  ==  totalKcal      (+/-2%)
 *   Atwater  4*protein + 4*carbs + 9*fat       ==  per100g_kcal   (+/-12%)
 *
 * A row failing either is dropped and recorded under `rejected`, never guessed.
 *
 *   yarn install                        (installs @anthropic-ai/sdk, @napi-rs/canvas)
 *   ant auth login                      (or set ANTHROPIC_API_KEY)
 *   node tools/papajohns/extract.mjs --pages 7-64 --out src/scrapers/PapaJohns/nutrition.json
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Anthropic } from '@anthropic-ai/sdk'

const REPO = path.resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const { createCanvas } = require('@napi-rs/canvas')
// pdf.mjs is ESM, so it needs a dynamic import of the resolved file URL rather
// than require().
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href)

// --- config -----------------------------------------------------------------

const PDF_PATH = path.join(REPO, 'src/scrapers/PapaJohns/nutritional-information.pdf')
// ~2340x1620 for this page size (780x540pt). Vision doesn't need OCR's
// near-1000dpi digit legibility — page 44 read correctly even at scale 2 in
// testing — but stays comfortably inside Claude's ~2576px high-res long edge
// so nothing gets silently downscaled before the model sees it.
const RENDER_SCALE = 3
const ENERGY_TOL = 0.02
const ATWATER_TOL = 0.12
const MODEL = 'claude-opus-5'
const CONCURRENCY = 4
/** Not a hard stop — just loud, in case something loops or retries unexpectedly. */
const COST_WARN_USD = 10

const args = process.argv.slice(2)
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : fallback
}
const [firstPage, lastPage] = flag('pages', '7-64').split('-').map(Number)
const outPath = flag('out', path.join(REPO, 'src/scrapers/PapaJohns/nutrition.json'))

// --- rendering ----------------------------------------------------------

async function renderPage (doc, pageNum) {
    const page = await doc.getPage(pageNum)
    const viewport = page.getViewport({ scale: RENDER_SCALE })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    page.cleanup()
    return canvas.toBuffer('image/png')
}

// --- schema ---------------------------------------------------------------
// Only the columns the app's schema actually uses (see NEEDED in the old OCR
// pipeline's history) — sugars/saturates/fibre/sodium/salt are on the source
// page but never read downstream, so there's no reason to spend tokens on them.

const variantSchema = {
    type: 'object',
    properties: {
        label: { type: 'string', description: 'Size/crust label, or "Standard" for a single-variant product' },
        kcal: { type: 'number', description: 'per 100g' },
        protein: { type: 'number', description: 'per 100g' },
        carbs: { type: 'number', description: 'per 100g' },
        fat: { type: 'number', description: 'per 100g' },
        totalKcal: { type: 'number', description: 'kcal for the whole product, as printed' },
        totalWeightG: { type: 'number', description: 'total product weight in grams, as printed' },
        unitsPerProduct: { type: 'number', description: 'slices/pieces/portions that make up the whole product' }
    },
    required: ['label', 'kcal', 'protein', 'carbs', 'fat', 'totalKcal', 'totalWeightG', 'unitsPerProduct'],
    additionalProperties: false
}

// One shape for both page layouts: a wide pizza table (one product, many size
// rows) is `products: [{ variants: [...many] }]`; the two-products-per-page
// layout (sides/desserts, stacked per-100g/per-portion tables) is
// `products: [{...}, {...}]` each with one variant. No layout detection code —
// the model reads whichever shape is on the page.
const pageSchema = {
    type: 'object',
    properties: {
        products: {
            type: 'array',
            description: 'Every distinct product on the page. Empty if this page has no nutrition table with size/variant rows (e.g. a create-your-own ingredients list, an allergen key, a section divider, a table of contents).',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    category: { type: 'string', description: 'from the page banner/footer, e.g. Pizzas, Vegan Sides, Desserts' },
                    variants: { type: 'array', items: variantSchema }
                },
                required: ['name', 'category', 'variants'],
                additionalProperties: false
            }
        }
    },
    required: ['products'],
    additionalProperties: false
}

const PROMPT = 'This page is from a UK pizza restaurant nutrition PDF. It may show ONE product ' +
    'with several size/crust rows, or TWO products side by side each with their own per-100g and ' +
    'per-portion tables. Extract every product and every row exactly as printed — read every digit ' +
    'carefully, including leading digits. Category comes from the page banner/footer. If this page ' +
    'is not a nutrition table (create-your-own ingredients, an allergen key, a section divider, ' +
    'table of contents, etc.), return an empty products array rather than guessing.'

// --- validation -----------------------------------------------------------

const near = (a, b, tol) => b !== 0 && Math.abs(a - b) / Math.abs(b) <= tol

function checks (v) {
    const energyOk = near((v.kcal * v.totalWeightG) / 100, v.totalKcal, ENERGY_TOL)
    const atwaterOk = near(4 * v.protein + 4 * v.carbs + 9 * v.fat, v.kcal, ATWATER_TOL)
    return energyOk && atwaterOk
}

/**
 * Vision measured far more accurate than either OCR engine (1 bad field in 67
 * variants in testing, vs. Tesseract's ~35/115), but not perfect — the one
 * failure observed was a dropped leading digit (fat printed as "11.4", read as
 * "1.4"), the exact same fault class Tesseract had. Try restoring it rather
 * than discarding an otherwise-good row outright. Any digit 1-9 is safe to try
 * because a candidate is only accepted if it clears BOTH identities to within
 * their tolerance — a wrong leading digit shifts a value by a factor of ten,
 * which the checks catch reliably.
 */
function candidates (raw) {
    const s = String(raw)
    const out = new Set([raw])
    for (let d = 1; d <= 9; d++) out.add(Number(`${d}${s}`))
    return [...out].filter(Number.isFinite)
}

const REPAIRABLE = ['protein', 'carbs', 'fat', 'kcal', 'totalWeightG', 'totalKcal']

/**
 * Only accept a repair when it's the UNIQUE single-field fix that clears both
 * checks — not the first one found. Trying this on real data caught a case
 * where two different fields each had a candidate that satisfied Atwater
 * (protein 9.5->29.5 *and* fat 1.4->11.4), and the first-found one (a
 * first-found version of this function returned) was a wild outlier against
 * every sibling row on the same page, while the correct fix — fat, confirmed
 * by comparing against those siblings — was the only one that was actually
 * right. Arithmetic alone can't tell the two apart; accepting either without
 * that external check risks writing a wrong macro that merely looks
 * consistent. So: enumerate every candidate across every field, and repair
 * only if exactly one satisfies. Zero or multiple satisfying candidates both
 * mean the row can't be trusted from the equations alone — reject rather than
 * guess, same as OCR's version of this function did.
 */
function repair (v) {
    if (checks(v)) return { value: v, repaired: [] }
    const found = []
    for (const f of REPAIRABLE) {
        for (const c of candidates(v[f])) {
            if (c === v[f]) continue
            const trial = { ...v, [f]: c }
            if (checks(trial)) found.push({ field: f, from: v[f], to: c, value: trial })
        }
    }
    if (found.length === 1) {
        const { field, from, to, value } = found[0]
        return { value, repaired: [`${field}:${from}->${to}`] }
    }
    return { value: v, repaired: null }
}

const cleanText = (s) => (s || '').replace(/[™®]/g, '').replace(/\s+/g, ' ').trim()

// --- main -------------------------------------------------------------------

const pdfBytes = fs.readFileSync(PDF_PATH)
const sha256 = crypto.createHash('sha256').update(pdfBytes).digest('hex')
const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdfBytes), useSystemFonts: true, isEvalSupported: false
}).promise
const client = new Anthropic() // picks up an `ant auth login` profile, or ANTHROPIC_API_KEY

const items = []
const rejected = []
const skipped = []
let totalCost = 0

async function extractPage (pageNum) {
    const png = await renderPage(doc, pageNum)
    const image = png.toString('base64')

    let response
    try {
        response = await client.messages.parse({
            model: MODEL,
            max_tokens: 4096,
            output_config: { effort: 'high', format: { type: 'json_schema', schema: pageSchema } },
            messages: [{
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
                    { type: 'text', text: PROMPT }
                ]
            }]
        })
    } catch (err) {
        console.log(`p${pageNum}: API error — ${err.message}`)
        skipped.push({ page: pageNum, reason: 'api_error', detail: String(err.message) })
        return
    }

    const cost = (response.usage.input_tokens / 1e6) * 5 + (response.usage.output_tokens / 1e6) * 25
    totalCost += cost
    if (totalCost > COST_WARN_USD) {
        console.log(`\n*** cost warning: ~$${totalCost.toFixed(2)} so far — check for a runaway loop ***\n`)
    }

    if (!response.parsed_output) {
        console.log(`p${pageNum}: no parsed_output (stop_reason=${response.stop_reason})`)
        skipped.push({ page: pageNum, reason: 'no_parsed_output', stop_reason: response.stop_reason })
        return
    }

    const products = response.parsed_output.products
    if (products.length === 0) {
        console.log(`p${pageNum}: no nutrition table (skipped by the model)`)
        skipped.push({ page: pageNum, reason: 'not_a_nutrition_table' })
        return
    }

    for (const product of products) {
        const name = cleanText(product.name)
        const category = cleanText(product.category) || 'Pizzas'
        if (!name) {
            skipped.push({ page: pageNum, reason: 'empty_product_name' })
            console.log(`p${pageNum}: SKIPPED a product with no name`)
            continue
        }

        const variants = []
        for (const raw of product.variants) {
            const { value: v, repaired } = repair(raw)
            if (repaired === null) {
                rejected.push({ page: pageNum, product: name, label: raw.label, raw })
                console.log(`p${pageNum}: REJECT ${name} / ${raw.label} — failed validation`)
                continue
            }
            if (repaired.length) {
                console.log(`p${pageNum}: repaired ${name} / ${v.label} (${repaired.join(', ')})`)
            }
            const factor = v.totalWeightG / 100
            variants.push({
                label: v.label,
                calories: v.totalKcal,
                protein: Math.round(v.protein * factor * 10) / 10,
                fat: Math.round(v.fat * factor * 10) / 10,
                carbs: Math.round(v.carbs * factor * 10) / 10,
                weightG: v.totalWeightG,
                slices: v.unitsPerProduct,
                per100g: { kcal: v.kcal, protein: v.protein, carbs: v.carbs, fat: v.fat },
                repaired: repaired.length ? repaired : undefined
            })
        }
        if (variants.length) {
            items.push({ name, category, page: pageNum, variants })
            console.log(`p${pageNum}: ${name} [${category}] ${variants.length} variant(s)`)
        }
    }
}

// Small worker pool — 58 pages sequentially at ~15-20s each would take too
// long; a handful of concurrent requests is well within normal rate limits for
// a one-off run like this.
const pages = []
for (let p = firstPage; p <= Math.min(lastPage, doc.numPages); p++) pages.push(p)
let nextIndex = 0
async function worker () {
    while (nextIndex < pages.length) {
        await extractPage(pages[nextIndex++])
    }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

await doc.destroy()

// Workers finish in whatever order their requests complete, so `items` isn't
// filled in page order — sort before writing so the committed file is
// reproducible across runs (a diff shows only real content changes) and
// nothing downstream can depend on run-to-run request timing.
items.sort((a, b) => a.page - b.page)
rejected.sort((a, b) => a.page - b.page)
skipped.sort((a, b) => a.page - b.page)

const out = {
    source: {
        pdf: 'src/scrapers/PapaJohns/nutritional-information.pdf',
        sha256,
        version: 'OCT22-1',
        pages: `${firstPage}-${lastPage}`,
        extractedAt: new Date().toISOString(),
        extractor: 'vision (claude-opus-5, structured outputs) — see this file\'s header comment',
        note: 'Every row satisfies the energy and Atwater checks; rejected rows are listed rather than guessed.'
    },
    items,
    rejected,
    skipped
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n')
console.log(`\nwrote ${outPath}`)
console.log(`items=${items.length} variants=${items.reduce((s, i) => s + i.variants.length, 0)} rejected=${rejected.length} skipped=${skipped.length}`)
console.log(`total cost: ~$${totalCost.toFixed(2)}`)
