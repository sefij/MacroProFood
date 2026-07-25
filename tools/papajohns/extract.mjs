/*
 * Offline extractor for Papa John's committed nutrition PDF.
 *
 * Deliberately NOT part of the scraper. The PDF's tables are images (see
 * ../../src/scrapers/PapaJohns/README.md), so reading them means rendering pages
 * and OCR'ing cells — minutes per page. That can't happen at scrape time, so
 * this runs by hand and writes a committed JSON file that the scraper reads.
 *
 * It also deliberately sits outside src/, so the repo's TypeScript build and the
 * CLI's dependency list stay untouched by three heavy dev-only packages.
 *
 *   yarn add -D tesseract.js sharp @napi-rs/canvas
 *   node tools/papajohns/extract.mjs --pages 7-64 --out src/scrapers/PapaJohns/nutrition.json
 *
 * Nothing here trusts OCR on its own. Every row must satisfy two independent
 * equations the table itself asserts:
 *
 *   energy   per100g_kcal x totalWeight / 100  ==  totalKcal      (+/-2%)
 *   Atwater  4*protein + 4*carbs + 9*fat       ==  per100g_kcal   (+/-12%)
 *
 * A row that fails is repaired only along the known OCR fault (a dropped
 * leading digit) and only accepted if both equations then hold; otherwise it is
 * recorded as rejected. Bad numbers get dropped, never guessed — a silently
 * wrong macro is worse than a missing item.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const REPO = path.resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)

const sharp = require('sharp')
const { createWorker } = require('tesseract.js')
const { createCanvas } = require('@napi-rs/canvas')
// pdf.mjs is ESM, so it needs a dynamic import of the resolved file URL rather
// than require().
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href)

// --- config ---------------------------------------------------------------

const PDF_PATH = path.join(REPO, 'src/scrapers/PapaJohns/nutritional-information.pdf')
/** Digits are ~8pt tall; below ~10x render scale OCR starts dropping strokes. */
const RENDER_SCALE = 10
const ENERGY_TOL = 0.02
const ATWATER_TOL = 0.12
/**
 * Column layout of a pizza page: label, then 10 per-100g, then 6 per-slice.
 *
 * A small range is accepted rather than an exact count because line detection
 * occasionally finds an extra rule. That's safe: if the extra column shifted the
 * indices, the energy and Atwater checks would both fail and every row on the
 * page would be rejected — so a wrong reading can't be admitted, only a right
 * one recovered.
 */
const PIZZA_COLUMNS_MIN = 17
const PIZZA_COLUMNS_MAX = 19
const COL = { KCAL: 0, PROTEIN: 2, CARBS: 3, FAT: 5, TOTAL_KCAL: 10, WEIGHT: 12, SLICES: 15 }

/**
 * Hand-read product titles, by page.
 *
 * Title OCR fails outright on some pages — it returns an empty string even
 * though the band demonstrably contains the heading, and no page-segmentation
 * mode or rescaling tried so far recovers it. The numbers on those pages extract
 * fine, so rather than lose the product (or ship it nameless), the title is read
 * by eye once and recorded here. Any page that is still unnamed after this is
 * skipped, never emitted — an item called "Unknown (page 12)" is worse than a
 * missing one.
 *
 * To extend: run with PJ_DEBUG=1, note the pages reported as unnamed, open them
 * and add the heading below.
 */
const TITLE_OVERRIDES = {
    11: 'Chicken Club',
    // OCR split the word: read as "TH E GREEK VEGETARIAN".
    14: 'The Greek Vegetarian'
}

const args = process.argv.slice(2)
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : fallback
}
const [firstPage, lastPage] = flag('pages', '7-64').split('-').map(Number)
const outPath = flag('out', path.join(REPO, 'src/scrapers/PapaJohns/nutrition.json'))
const truthPath = flag('truth', null)

// --- image analysis -------------------------------------------------------

function profiles (data, width, height) {
    const col = new Float64Array(width)
    const row = new Float64Array(height)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[y * width + x] < 128) { col[x]++; row[y]++ }
        }
    }
    for (let x = 0; x < width; x++) col[x] /= height
    for (let y = 0; y < height; y++) row[y] /= width
    return { col, row }
}

/**
 * Boundaries from a dark-pixel profile. A thin ridge is a ruled line, so its
 * centre is the boundary; a thick ridge is a filled block (the coloured table
 * header) whose *edges* are the boundaries — using its centre instead swallows
 * the first data row.
 */
function boundaries (profile, min, thick = 8) {
    const out = []
    let start = -1
    const flush = (end) => {
        if (end - start + 1 >= thick) out.push(start, end)
        else out.push(Math.round((start + end) / 2))
    }
    for (let i = 0; i < profile.length; i++) {
        const on = profile[i] >= min
        if (on && start < 0) start = i
        if (!on && start >= 0) { flush(i - 1); start = -1 }
    }
    if (start >= 0) flush(profile.length - 1)
    return [...new Set(out)].sort((a, b) => a - b)
}

/** The longest run of boundaries spaced at the modal pitch — i.e. the data rows. */
function dataBoundaries (bounds, tolerance = 0.25) {
    if (bounds.length < 3) return bounds
    const buckets = new Map()
    for (let i = 1; i < bounds.length; i++) {
        const g = bounds[i] - bounds[i - 1]
        if (g < 20) continue
        const k = Math.round(g / 4) * 4
        buckets.set(k, (buckets.get(k) || 0) + 1)
    }
    if (!buckets.size) return bounds
    const pitch = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0][0]
    let best = [], run = [bounds[0]]
    for (let i = 1; i < bounds.length; i++) {
        if (Math.abs(bounds[i] - bounds[i - 1] - pitch) <= pitch * tolerance) run.push(bounds[i])
        else { if (run.length > best.length) best = run; run = [bounds[i]] }
    }
    return run.length > best.length ? run : best
}

/** Cells between boundaries, dropping slivers relative to the median gap. */
function spans (lines) {
    const raw = []
    for (let i = 0; i + 1 < lines.length; i++) raw.push([lines[i], lines[i + 1]])
    if (!raw.length) return []
    const widths = raw.map(([a, b]) => b - a).sort((x, y) => x - y)
    const median = widths[Math.floor(widths.length / 2)]
    return raw.filter(([a, b]) => b - a >= median * 0.5).map(([a, b]) => [a + 2, b - 2])
}

// --- validation and repair ------------------------------------------------

const near = (a, b, tol) => b !== 0 && Math.abs(a - b) / Math.abs(b) <= tol

function checks (v) {
    const energyOk = [v.kcal, v.weight, v.totalKcal].every((n) => typeof n === 'number') &&
        near((v.kcal * v.weight) / 100, v.totalKcal, ENERGY_TOL)
    const atwaterOk = [v.protein, v.carbs, v.fat, v.kcal].every((n) => typeof n === 'number') &&
        near(4 * v.protein + 4 * v.carbs + 9 * v.fat, v.kcal, ATWATER_TOL)
    return { energyOk, atwaterOk, ok: energyOk && atwaterOk }
}

/**
 * Corrections for the one systematic OCR fault: a dropped or misread leading
 * digit (1133 -> 133, 11.7 -> 1.7, 987 -> 087). Trying all nine digits is safe
 * because a candidate must satisfy an independent equation to within 2%, and a
 * wrong leading digit moves the value by a factor of ten.
 */
function candidates (raw) {
    if (typeof raw !== 'number') return []
    const s = String(raw)
    const out = new Set([raw])
    for (let d = 1; d <= 9; d++) out.add(Number(`${d}${s}`))
    if (s.startsWith('0')) for (let d = 1; d <= 9; d++) out.add(Number(`${d}${s.slice(1)}`))
    return [...out].filter(Number.isFinite)
}

const REPAIRABLE = ['weight', 'protein', 'carbs', 'fat', 'kcal', 'totalKcal']

function repair (v) {
    if (checks(v).ok) return { value: v, repaired: [] }
    for (const f of REPAIRABLE) {
        for (const c of candidates(v[f])) {
            if (c === v[f]) continue
            const trial = { ...v, [f]: c }
            if (checks(trial).ok) return { value: trial, repaired: [`${f}:${v[f]}->${c}`] }
        }
    }
    // Two fields at once happens when OCR clips the same glyph twice on a row.
    // Deeper than a pair would be fitting noise rather than fixing a fault.
    for (const f1 of REPAIRABLE) {
        for (const c1 of candidates(v[f1])) {
            if (c1 === v[f1]) continue
            for (const f2 of REPAIRABLE) {
                if (f2 === f1) continue
                for (const c2 of candidates(v[f2])) {
                    if (c2 === v[f2]) continue
                    const trial = { ...v, [f1]: c1, [f2]: c2 }
                    if (checks(trial).ok) {
                        return { value: trial, repaired: [`${f1}:${v[f1]}->${c1}`, `${f2}:${v[f2]}->${c2}`] }
                    }
                }
            }
        }
    }
    return { value: v, repaired: null }
}

// --- rendering and OCR ----------------------------------------------------

const TMP = path.join(REPO, '.cache/papajohns-extract')
fs.mkdirSync(TMP, { recursive: true })

async function renderPage (doc, pageNum) {
    const page = await doc.getPage(pageNum)
    const viewport = page.getViewport({ scale: RENDER_SCALE })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    const file = path.join(TMP, `p${pageNum}.png`)
    fs.writeFileSync(file, canvas.toBuffer('image/png'))
    page.cleanup()
    return file
}

function makeOcr (worker) {
    return async function ocr (png, { left, top, width, height }, mode) {
        if (width < 6 || height < 6) return ''
        const file = path.join(TMP, 'cell.png')
        let img = sharp(png).extract({ left, top, width, height }).grayscale()
        if (mode === 'banner') img = img.negate() // white text on a colour band
        // Tesseract wants glyphs roughly 30-60px tall. Cell values are tiny at
        // page scale so they're enlarged; titles and banners are the opposite —
        // headline type renders ~250px tall at scale 10 and OCR returns nothing
        // at all, so those bands get scaled *down*.
        const targetWidth = mode === 'number'
            ? Math.max(width, 240)
            : Math.min(width, 1200)
        await img.resize({ width: targetWidth, kernel: 'lanczos3' }).normalise().toFile(file)
        // A title band is mostly white with one or two lines of large text, and
        // PSM 6 ("uniform block") returns nothing at all on some pages. Try
        // progressively sparser segmentations and take the first that reads
        // something, rather than losing the product name.
        const modes = mode === 'number' ? ['7'] : mode === 'title' ? ['6', '7', '11', '12'] : ['6']
        for (const psm of modes) {
            await worker.setParameters({
                tessedit_char_whitelist: mode === 'number' ? '0123456789.' : '',
                tessedit_pageseg_mode: psm
            })
            const { data } = await worker.recognize(file)
            const text = data.text.replace(/\s+/g, mode === 'number' ? '' : ' ').trim()
            if (text) return text
        }
        return ''
    }
}

const titleCase = (s) =>
    s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\s+/g, ' ').trim()

// --- main -----------------------------------------------------------------

const pdfBytes = fs.readFileSync(PDF_PATH)
const sha256 = crypto.createHash('sha256').update(pdfBytes).digest('hex')
const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdfBytes), useSystemFonts: true, isEvalSupported: false
}).promise

const worker = await createWorker('eng')
const ocr = makeOcr(worker)

const items = []
const rejected = []
const skipped = []

for (let pageNum = firstPage; pageNum <= Math.min(lastPage, doc.numPages); pageNum++) {
    const png = await renderPage(doc, pageNum)
    const { data, info } = await sharp(png).grayscale().raw().toBuffer({ resolveWithObject: true })
    const { col, row } = profiles(data, info.width, info.height)
    const colSpans = spans(boundaries(col, 0.45))
    const hAll = boundaries(row, 0.30)
    const hData = dataBoundaries(hAll)
    const rowSpans = spans(hData)

    // Layout A only for now: one product, one wide table, sizes down the rows.
    // Other layouts (two products per page, per-portion tables) are recorded as
    // skipped rather than half-parsed.
    if (colSpans.length < PIZZA_COLUMNS_MIN || colSpans.length > PIZZA_COLUMNS_MAX || rowSpans.length < 2) {
        skipped.push({ page: pageNum, columns: colSpans.length, rows: rowSpans.length })
        console.log(`p${pageNum}: skipped (columns=${colSpans.length} rows=${rowSpans.length})`)
        continue
    }

    // The product title sits above the table's coloured header block. Bounding
    // the band by the first data row instead pulls the whole header ("VALUES
    // PER 100G", "SIZE & CRUST", every column name) into the title, so find the
    // header block's own top edge: `boundaries` emits both edges of a thick
    // ridge, so it's the entry immediately before the first data-row boundary.
    const firstDataIdx = hAll.indexOf(hData[0])
    const headerTop = firstDataIdx > 0 ? hAll[firstDataIdx - 1] : rowSpans[0][0]
    const titleTop = Math.round(info.height * 0.15)
    const titleHeight = Math.max(40, headerTop - 30 - titleTop)
    const title = await ocr(png, {
        // Start right of the photo and the toppings/allergen column.
        left: Math.round(info.width * 0.22), top: titleTop,
        width: Math.round(info.width * 0.75), height: titleHeight
    }, 'title')
    const category = await ocr(png, {
        left: Math.round(info.width * 0.02), top: Math.round(info.height * 0.88),
        width: Math.round(info.width * 0.45), height: Math.round(info.height * 0.09)
    }, 'banner')

    // The title is whatever comes before the table header, and it can run to two
    // lines ("VEGAN MARMITE AND CHEESE STICKS"). So read lines in order and stop
    // at the first that looks like table furniture, rather than filtering
    // furniture out — when the header block isn't detected as a thick ridge the
    // band still contains the whole header, and filtering then discarded every
    // line and left the product nameless.
    if (process.env.PJ_DEBUG) {
        console.log(`  [debug] p${pageNum} headerTop=${headerTop} band=${titleTop}..${titleTop + titleHeight} raw title=${JSON.stringify(title)}`)
    }
    const titleLines = []
    for (const line of title.split('\n').map((l) => l.trim())) {
        if (!line) continue
        if (/values per|size & crust|energy|kcal|carbohy|saturat|sodium|slice/i.test(line)) break
        titleLines.push(line)
    }
    const productName = TITLE_OVERRIDES[pageNum] ||
        titleCase(titleLines.join(' ').replace(/[^A-Za-z0-9'&+ -]/g, ' '))

    if (!productName) {
        // Numbers may well be fine here, but an unnamed product is not shippable.
        skipped.push({ page: pageNum, reason: 'title-ocr-failed', rows: rowSpans.length })
        console.log(`p${pageNum}: SKIPPED — title OCR failed (add it to TITLE_OVERRIDES)`)
        continue
    }
    const categoryName = titleCase(category.replace(/[^A-Za-z ]/g, ' ')) || 'Pizzas'

    const variants = []
    for (const [top, bottom] of rowSpans) {
        const cells = []
        for (const [left, right] of colSpans) {
            cells.push(await ocr(png, { left, top, width: right - left, height: bottom - top },
                cells.length === 0 ? 'text' : 'number'))
        }
        const n = cells.slice(1).map((s) => (s === '' ? null : Number(s)))
        const raw = {
            label: cells[0].replace(/\s+/g, ' ').trim(),
            kcal: n[COL.KCAL], protein: n[COL.PROTEIN], carbs: n[COL.CARBS], fat: n[COL.FAT],
            totalKcal: n[COL.TOTAL_KCAL], weight: n[COL.WEIGHT], slices: n[COL.SLICES]
        }
        const { value, repaired } = repair(raw)
        if (repaired === null) {
            rejected.push({ page: pageNum, product: productName, label: raw.label, raw })
            console.log(`p${pageNum}: REJECT ${raw.label}`)
            continue
        }
        const factor = value.weight / 100
        variants.push({
            label: value.label,
            // Printed total is authoritative for calories; macros scale from the
            // per-100g column by the printed total product weight.
            calories: value.totalKcal,
            protein: Math.round(value.protein * factor * 10) / 10,
            fat: Math.round(value.fat * factor * 10) / 10,
            carbs: Math.round(value.carbs * factor * 10) / 10,
            weightG: value.weight,
            slices: value.slices,
            per100g: { kcal: value.kcal, protein: value.protein, carbs: value.carbs, fat: value.fat },
            repaired: repaired.length ? repaired : undefined
        })
    }

    if (variants.length) {
        items.push({ name: productName, category: categoryName, page: pageNum, variants })
        console.log(`p${pageNum}: ${productName} [${categoryName}] ${variants.length} variants`)
    }
}

await worker.terminate()
await doc.destroy()

const out = {
    source: {
        pdf: 'src/scrapers/PapaJohns/nutritional-information.pdf',
        sha256,
        version: 'OCT22-1',
        pages: `${firstPage}-${lastPage}`,
        extractedAt: new Date().toISOString(),
        note: 'Generated by tools/papajohns/extract.mjs. Every row satisfies the energy and Atwater checks; rejected rows are listed rather than guessed.'
    },
    items,
    rejected,
    skipped
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n')
console.log(`\nwrote ${outPath}`)
console.log(`items=${items.length} variants=${items.reduce((s, i) => s + i.variants.length, 0)} rejected=${rejected.length} skipped=${skipped.length}`)

if (truthPath) {
    const truth = JSON.parse(fs.readFileSync(truthPath, 'utf8'))
    const item = items.find((i) => i.page === truth.page)
    let bad = 0
    if (!item) {
        console.log('truth check: page not extracted')
    } else {
        truth.rows.forEach((t, i) => {
            const v = item.variants[i]
            if (!v) { console.log(`  row ${i}: missing`); bad++; return }
            const want = {
                calories: t.v[10], weightG: t.v[12], slices: t.v[15],
                protein: Math.round(t.v[2] * (t.v[12] / 100) * 10) / 10,
                carbs: Math.round(t.v[3] * (t.v[12] / 100) * 10) / 10,
                fat: Math.round(t.v[5] * (t.v[12] / 100) * 10) / 10
            }
            for (const k of Object.keys(want)) {
                if (v[k] !== want[k]) { console.log(`  row ${i} ${k}: expected ${want[k]}, got ${v[k]}`); bad++ }
            }
        })
        console.log(bad === 0 ? 'truth check: ALL ROWS MATCH' : `truth check: ${bad} mismatches`)
    }
}
