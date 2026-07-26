import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { normalizeCategory } from '../category'
import { addItem, addVariant } from '../add-item'
import { extractPdfLines, PdfCell, PdfLine } from '../pdf/pdf-lines'

/**
 * Papa John's UK — parsed from a committed copy of their nutrition PDF.
 *
 * This is the **only restaurant scraper that reads a local file instead of
 * fetching one**. papajohns.co.uk sits behind Akamai, and `axios`/`curl`
 * reliably get `403 Access Denied` on the PDF — but that turned out to be an
 * HTTP-client/TLS fingerprint check, not an IP geofence: Node's native
 * `fetch()` gets the file fine, from the same network path, no special
 * headers needed (see README.md). `tools/update-papajohns-pdf.ts` relies on
 * that to check for and fetch updates; this scraper still reads the
 * committed file rather than fetching live, deliberately — a
 * fingerprint-based bypass is less stable than a real unblock, and this
 * scraper running in a scheduled job is a worse failure mode than a manual
 * refresh being merely inconvenient (see README.md, "Should this go live
 * again?").
 *
 * Past that one difference, this is an ordinary PDF nutrition scraper, same
 * family as Domino's/Wendy's/Subway (`src/scrapers/pdf/`) and Pizza Hut
 * (`extractPdfLines` directly). It doesn't use the shared header-driven
 * pipeline because the layout doesn't fit it: each page draws its own
 * multi-line, sometimes-two-tables-side-by-side header, which the pipeline's
 * single-header-row auto-detection can't reconstruct. So this reads raw
 * positioned lines and rebuilds rows itself — see {@link extractPageRows}.
 *
 * (An earlier version of this scraper worked from a much older, image-only
 * copy of this PDF via a vision LLM, since that copy had no text layer at
 * all. The current PDF — dated JUNE26 on every item page — has a normal text
 * layer, so that's no longer needed; see README.md for the history.)
 *
 * **Page shapes.** A product's "VALUES PER 100G" and "VALUES PER PORTION" (or
 * "PER SLICE") headers sit on the same baseline when a page has room to draw
 * both tables side by side — true for every pizza-family page (many
 * size/crust rows) and some single-row pages. There, each data row already
 * carries all 16 figures (10 per-100g + 6 per-portion) together, read by
 * {@link readCombinedRow}. Other single-row-per-product pages (papadias,
 * sides, desserts — one or two products per page) stack the two tables
 * instead, so a row's two halves must be found independently and paired; see
 * {@link readStackedProduct}. Two products sharing a page are told apart by
 * x-position, split at the gap between their two title blocks.
 *
 * **Validation.** Every row is checked against the two equations the source
 * table itself asserts — `per100g_kcal × weight / 100 == totalKcal` (±2%) and
 * Atwater `4×protein + 4×carbs + 9×fat == per100g_kcal` (±12%). A row that
 * fails either is dropped, *unless* exactly one candidate fix (the source
 * PDF occasionally drops a decimal point, e.g. prints "135" for "13.5") makes
 * both hold — accepting only a unique fix matters: a wrong repair that merely
 * satisfies the tolerance is still wrong, and more than one candidate passing
 * is proof the check can't tell which field is actually broken (see
 * {@link repair}). Rejected rows are logged and skipped.
 *
 * **Scope decisions**, matching the rest of the project:
 *  - "Recently Delisted" (the source PDF's own category for discontinued
 *    products, kept in for allergen/compliance reasons per its own page
 *    footer) is parsed but dropped — it can't be ordered, so surfacing it
 *    would let the optimizer recommend something off the real menu.
 *  - "CYO Ingredients" and "Drinks" pages are out of scope by decision (no
 *    "VALUES PER 100G" table on those pages anyway, so they're naturally
 *    skipped as non-item pages).
 *  - Sizes/crusts become **variants** of one product (`addVariant`), matching
 *    Pizza Hut; a genuine single-row product (a Papadia, a side, a dessert)
 *    is added via `addItem` instead, so the app doesn't show a "Size & Crust"
 *    picker with one "Standard" option.
 *
 * Macros are for the **whole product** — `calories` is the printed total,
 * protein/fat/carbs are the per-100g column scaled by the printed total
 * product weight (rounded to 1 decimal) — matching Pizza Hut: you order a
 * pizza, not a slice.
 */

// Resolved from the repo root (matching config.ts / build-web-data.ts),
// not __dirname — the compiled dist/ tree doesn't carry non-TS assets along.
// Exported so tools/update-papajohns-pdf.ts writes to the same place it reads.
export const PDF_PATH = path.resolve(process.cwd(), 'src', 'scrapers', 'PapaJohns', 'nutritional-information.pdf')

const SKIP_CATEGORY = /CYO INGREDIENTS|DRINKS/i
const DELISTED_CATEGORY = /RECENTLY DELISTED/i

const NUM = /^-?\d+(\.\d+)?$/
const isNum = (s: string): boolean => NUM.test(s.trim())

/** Column order every 16-number row (10 per-100g + 6 per-portion) shares. */
const ROW_FIELDS = [
    'kcal100', 'kj100', 'protein100', 'fat100', 'sat100', 'carbs100', 'sugars100', 'fibre100', 'sodium100', 'salt100',
    'totalKcal', 'portionKcal', 'weightG', 'portionSizeG', 'portionUnits', 'totalUnits'
] as const

interface Row {
    label: string
    nums: number[]
}

interface PageProduct {
    title: string
    xMin: number
    xMax: number
}

interface ParsedProduct {
    title: string
    category: string
    rows: Row[]
}

function splitByGap<T extends { x: number, xEnd: number }> (cells: T[], minGap: number): [T[], T[]] {
    if (cells.length < 2) return [cells, []]
    let bestIdx = -1
    let bestGap = minGap
    for (let i = 1; i < cells.length; i++) {
        const gap = cells[i].x - cells[i - 1].xEnd
        if (gap > bestGap) { bestGap = gap; bestIdx = i }
    }
    return bestIdx === -1 ? [cells, []] : [cells.slice(0, bestIdx), cells.slice(bestIdx)]
}

/** A cell plus the y of the line it came from — {@link PdfCell} itself carries no y. */
interface PositionedCell extends PdfCell { y: number }

function withY (line: PdfLine): PositionedCell[] {
    return line.cells.map((c) => ({ ...c, y: line.y }))
}

/**
 * Drops leading cells separated from the rest of an (x-sorted) row by an
 * abnormally wide gap. A chemical formula subscript — "SO₂" (Sulphur
 * Dioxide, a common allergen) renders its "2" as its own text run — can land
 * on the same baseline as a real numeric row purely by coincidence, at the
 * sidebar's x rather than the table's. Real inter-column gaps top out around
 * 30-45pt in this document; a gap this wide is never a real column boundary.
 */
const STRAY_CELL_GAP = 80

function stripLeadingOutliers<T extends { x: number, xEnd: number }> (cells: T[]): T[] {
    let start = 0
    while (start < cells.length - 1 && cells[start + 1].x - cells[start].xEnd > STRAY_CELL_GAP) start++
    return cells.slice(start)
}

/** Clusters cells into row-groups by baseline proximity, each sorted left→right. */
function clusterByY (cells: PositionedCell[], tol: number): PositionedCell[][] {
    const sorted = [...cells].sort((a, b) => b.y - a.y || a.x - b.x)
    const groups: PositionedCell[][] = []
    for (const c of sorted) {
        const g = groups[groups.length - 1]
        if (g && Math.abs(g[0].y - c.y) <= tol) g.push(c)
        else groups.push([c])
    }
    return groups.map((g) => g.sort((a, b) => a.x - b.x))
}

/**
 * A row's numbers occasionally wrap onto the next baseline — a long crust
 * label pushes the per-portion cells down a few points, splitting one logical
 * row into two lines of 10 and 6. Merges such a pair when doing so plausibly
 * completes a 16-value row; leaves genuinely distinct rows (much further
 * apart in y) alone.
 */
function mergeNumericContinuations (pageLines: PdfLine[]): PdfLine[] {
    const sorted = [...pageLines].sort((a, b) => b.y - a.y)
    const merged: PdfLine[] = []
    let i = 0
    while (i < sorted.length) {
        const line = sorted[i]
        const lineNumCount = line.cells.filter((c) => isNum(c.str)).length
        const next = sorted[i + 1]
        if (lineNumCount >= 6 && lineNumCount < 14 && next) {
            const gap = line.y - next.y
            const nextNumCount = next.cells.filter((c) => isNum(c.str)).length
            const total = lineNumCount + nextNumCount
            if (gap > 0 && gap <= 6 && nextNumCount >= 2 && nextNumCount < 14 && total >= 14 && total <= 16) {
                merged.push({ page: line.page, y: line.y, cells: [...line.cells, ...next.cells] })
                i += 2
                continue
            }
        }
        merged.push(line)
        i++
    }
    return merged
}

function cellsInRange (cells: PdfCell[], xMin: number, xMax: number): PdfCell[] {
    return cells.filter((c) => c.x >= xMin && c.x < xMax)
}

function textOf (cells: PdfCell[]): string {
    return cells.map((c) => c.str).join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Reads the version stamp printed in the top-right corner of every item page
 * (e.g. "JUNE26-1") — three fixed cells, `<MONTH><YY>`, `-`, `<N>`, always the
 * topmost line on the page. Used by `tools/update-papajohns-pdf.ts` to tell
 * whether a freshly hand-downloaded copy is actually newer than the committed
 * one, without needing full page classification just to find it.
 */
export function findVersionStamp (lines: PdfLine[]): string | null {
    const maxPage = lines.reduce((m, l) => Math.max(m, l.page), 0)
    for (let page = 1; page <= maxPage; page++) {
        const pageLines = lines.filter((l) => l.page === page)
        if (pageLines.length === 0) continue
        const topLine = pageLines.reduce((a, b) => (b.y > a.y ? b : a))
        const cells = topLine.cells.map((c) => c.str.trim())
        if (cells.length >= 3 && /^[A-Z]+\d+$/.test(cells[0]) && cells[1] === '-' && /^\d+$/.test(cells[2])) {
            return `${cells[0]}-${cells[2]}`
        }
    }
    return null
}

/** Finds the products on a page: one full-width, or two split by the gap between their titles. */
function findProducts (pageLines: PdfLine[], tablesCount: 1 | 2): PageProduct[] {
    // Titles are the large (but not category-banner-large) headings, below
    // the page-corner version stamp.
    const titleLines = pageLines.filter((l) => l.y > 60 && l.cells.some((c) => c.height >= 18 && c.height < 35))

    if (tablesCount === 1) {
        const title = textOf(titleLines.flatMap((l) => l.cells))
        return [{ title, xMin: -Infinity, xMax: Infinity }]
    }

    const titleCells = titleLines.flatMap((l) => l.cells).sort((a, b) => a.x - b.x)
    const [leftCells, rightCells] = splitByGap(titleCells, 80)
    const splitX = leftCells.length && rightCells.length
        ? (Math.max(...leftCells.map((c) => c.xEnd)) + Math.min(...rightCells.map((c) => c.x))) / 2
        : 400
    return [
        { title: textOf(leftCells), xMin: -Infinity, xMax: splitX },
        { title: textOf(rightCells), xMin: splitX, xMax: Infinity }
    ]
}

/** Combined-layout rows: each data line already carries all 16 figures for one product. */
function readCombinedRow (line: PdfLine, product: PageProduct, needsLabel: boolean, pageLines: PdfLine[]): Row | null {
    const numeric = stripLeadingOutliers(
        cellsInRange(line.cells, product.xMin, product.xMax)
            .filter((c) => isNum(c.str))
            .sort((a, b) => a.x - b.x)
    )
    const nums = numeric.slice(0, 16).map((c) => parseFloat(c.str))
    if (nums.length < 16) return null

    if (!needsLabel) return { label: 'Standard', nums }

    // A real crust/size label sits at the numeric row's own glyph height;
    // stray same-baseline sidebar text (ingredient lists, "MAY CONTAIN:")
    // renders at a visibly different height and must be excluded.
    const dataHeight = numeric[0].height
    const sameLineLabel = cellsInRange(line.cells, product.xMin, numeric[0].x)
        .filter((c) => !isNum(c.str) && Math.abs(c.height - dataHeight) <= 1)
    let label = textOf(sameLineLabel)

    if (!label) {
        // Occasionally the label wraps onto its own line just below the
        // numeric row instead of sharing its baseline.
        const below = pageLines.find((l) => line.y - l.y > 0 && line.y - l.y <= 5 &&
            cellsInRange(l.cells, product.xMin, numeric[0].x).some((c) => !isNum(c.str)))
        if (below) label = textOf(cellsInRange(below.cells, product.xMin, numeric[0].x).filter((c) => !isNum(c.str)))
    }
    return { label: label || 'Standard', nums }
}

/**
 * Stacked-layout single row: per-100g and per-portion cells for `product`
 * live somewhere in `rowGroups` (already clustered by baseline across the
 * whole page) as a 10-cell and a 6-cell group. A page occasionally prints a
 * redundant "per single serving" summary alongside the true whole-product
 * portion row. They are *not* interchangeably valid: for some products both
 * satisfy the energy identity (an even 2×/1× scaling of the same per-100g
 * figures — pick the larger, whole-product one), but for others only the
 * *smaller* row is actually self-consistent (e.g. "Plain Chicken Poppers":
 * the larger candidate implies 392kcal from its own per-100g×weight, an 11%
 * mismatch against its printed 353kcal, while the smaller candidate matches
 * its own printed total exactly). So every candidate is tried against the
 * validity check itself, not assumed from size.
 */
function readStackedProduct (rowGroups: PositionedCell[][], product: PageProduct): Row | null {
    const sideGroups = rowGroups.map((g) => stripLeadingOutliers(cellsInRange(g, product.xMin, product.xMax)))
    const p100Rows = sideGroups.filter((r) => r.length === 10)
    const portRows = sideGroups.filter((r) => r.length === 6)
    for (const g of sideGroups) {
        if (g.length === 16) { p100Rows.push(g.slice(0, 10)); portRows.push(g.slice(10, 16)) }
    }
    if (p100Rows.length === 0 || portRows.length === 0) return null

    const p100Nums = p100Rows[0].map((c) => parseFloat(c.str))
    const candidates = portRows.map((r) => [...p100Nums, ...r.map((c) => parseFloat(c.str))])
    const passing = candidates.filter(checks)
    const nums = passing.length > 0
        // Multiple genuinely-valid candidates (an even serving split) → the
        // larger is the whole product; a single valid candidate is used as-is.
        ? passing.reduce((a, b) => (b[10] > a[10] ? b : a))
        // None pass — fall back to the largest so it still reaches the
        // repair/rejection pipeline (and gets reported) instead of vanishing
        // silently here.
        : candidates.reduce((a, b) => (b[10] > a[10] ? b : a))
    return { label: 'Standard', nums }
}

/**
 * Counts occurrences of the standard column-header run (ENERGY, ENERGY,
 * PROTEIN, FAT — the start of every per-100g/per-portion table's header,
 * appearing once per product on a page) within one line's x-sorted cells.
 * A handful of promotional/kids-menu pages (e.g. "Space Sheriffs Ranger Roni
 * Round Up") print this header row without the usual "VALUES PER 100G"
 * super-label above it, so that text can't be relied on alone to find every
 * table on the page.
 */
function countHeaderRuns (line: PdfLine): number {
    const cells = [...line.cells].sort((a, b) => a.x - b.x)
    let count = 0
    for (let i = 0; i + 3 < cells.length; i++) {
        if (cells[i].str === 'ENERGY' && cells[i + 1].str === 'ENERGY' &&
            cells[i + 2].str === 'PROTEIN' && cells[i + 3].str === 'FAT') count++
    }
    return count
}

function parsePage (pageLines: PdfLine[]): ParsedProduct[] {
    const h100Lines = pageLines.filter((l) => l.cells.some((c) => c.str === 'VALUES PER 100G'))

    let h100Y: number[]
    let h100CellCount: number
    if (h100Lines.length > 0) {
        h100Y = h100Lines.map((l) => l.y)
        h100CellCount = pageLines.reduce(
            (n, l) => n + l.cells.filter((c) => c.str === 'VALUES PER 100G').length, 0
        )
    } else {
        h100Y = []
        h100CellCount = 0
        for (const line of pageLines) {
            const runs = countHeaderRuns(line)
            for (let i = 0; i < runs; i++) h100Y.push(line.y)
            h100CellCount += runs
        }
        if (h100CellCount === 0) return []
    }

    const bannerLine = [...pageLines].filter((l) => l.cells.some((c) => c.height >= 35))
        .sort((a, b) => a.y - b.y)[0]
    const category = bannerLine ? textOf(bannerLine.cells) : ''
    if (SKIP_CATEGORY.test(category)) return []

    const hPortionLines = pageLines.filter((l) => l.cells.some((c) => /^VALUES PER (PORTION|SLICE)$/.test(c.str)))
    const hPortionY = hPortionLines.map((l) => l.y)
    let minDist = Infinity
    for (const a of h100Y) for (const b of hPortionY) minDist = Math.min(minDist, Math.abs(a - b))
    // Headers sharing a baseline usually means each data row combines both
    // blocks too — but occasionally (e.g. a "Sourdough Dippers" page) the
    // headers are combined while the rows still land on two close baselines,
    // so this is a preference, not a guarantee; both paths are tried below.
    const combined = minDist < 20
    const tablesCount: 1 | 2 = h100CellCount >= 2 ? 2 : 1
    const products = findProducts(pageLines, tablesCount)

    const dataLines = combined
        ? mergeNumericContinuations(pageLines).filter((l) => l.cells.filter((c) => isNum(c.str)).length >= 14)
        : []

    const results: ParsedProduct[] = []

    if (combined && dataLines.length > 0) {
        for (const product of products) {
            const matchingLines = dataLines.filter(
                (l) => cellsInRange(l.cells, product.xMin, product.xMax).filter((c) => isNum(c.str)).length >= 14
            )
            // A single row has no real crust/size choice to label.
            const needsLabel = matchingLines.length > 1
            const rows = matchingLines
                .map((l) => readCombinedRow(l, product, needsLabel, pageLines))
                .filter((r): r is Row => r !== null)
            if (rows.length > 0) results.push({ title: product.title, category, rows })
        }
        if (results.length === products.length) return results
        // Fall through to the stacked reader for any product the combined
        // path didn't cover (defensive — not observed in practice).
    }

    const bandTop = Math.min(...h100Y)
    const bandBottom = (bannerLine ? bannerLine.y : 0) + 20
    const dataCells = pageLines.flatMap(withY).filter((c) => isNum(c.str) && c.y < bandTop && c.y > bandBottom)
    const rowGroups = clusterByY(dataCells, 4)

    for (const product of products) {
        if (results.some((r) => r.title === product.title)) continue
        const row = readStackedProduct(rowGroups, product)
        if (row) results.push({ title: product.title, category, rows: [row] })
    }
    return results
}

const near = (a: number, b: number, tol: number): boolean => b !== 0 && Math.abs(a - b) / Math.abs(b) <= tol

function checks (nums: number[]): boolean {
    const [kcal100, , protein100, fat100, , carbs100, , , , , totalKcal, , weightG] = nums
    const energyOk = near((kcal100 * weightG) / 100, totalKcal, 0.02)
    const atwaterOk = near(4 * protein100 + 4 * carbs100 + 9 * fat100, kcal100, 0.12)
    return energyOk && atwaterOk
}

/** Indices (into {@link ROW_FIELDS}/`nums`) worth trying a repair on. */
const REPAIRABLE_IDX = [0, 2, 3, 5, 10, 12] // kcal100, protein100, fat100, carbs100, totalKcal, weightG

/**
 * The source PDF occasionally drops a decimal point (e.g. prints "135" where
 * every sibling row reads "13.5"). Tries un-dropping it (÷10) or the inverse
 * (×10) on each repairable field and accepts a fix only when it is the
 * *unique* candidate that clears both checks — satisfying the tolerance is
 * not proof of correctness when more than one edit satisfies it (found twice
 * during this scraper's development: two different "fixes" separately passed
 * the Atwater check alone). Returns the repaired row, or null if no unique
 * repair exists.
 */
function repair (nums: number[]): { nums: number[], field: string } | null {
    const found: { nums: number[], field: string }[] = []
    for (const idx of REPAIRABLE_IDX) {
        for (const factor of [0.1, 10]) {
            const candidate = [...nums]
            candidate[idx] = Math.round(candidate[idx] * factor * 100) / 100
            if (checks(candidate)) found.push({ nums: candidate, field: ROW_FIELDS[idx] })
        }
    }
    return found.length === 1 ? found[0] : null
}

function toNutrition (nums: number[], category: string): NutritionData {
    const [kcal100, , protein100, fat100, , carbs100, , , , , totalKcal, , weightG] = nums
    const factor = weightG / 100
    const calories = totalKcal
    const protein = Math.round(protein100 * factor * 10) / 10
    const fat = Math.round(fat100 * factor * 10) / 10
    const carbs = Math.round(carbs100 * factor * 10) / 10
    return {
        calories,
        protein,
        fat,
        carbs,
        ProteinTCalRatio: protein / calories || 1,
        CarbToCalRatio: carbs / calories || 1,
        category: normalizeCategory(category)
    }
}

export class PapaJohnsScraper extends SourceScraper {
    name = 'Papa Johns'
    icon = '🍕'

    /** Pure local file + PDF parsing — no browser needed. */
    async initialize (): Promise<void> { }

    async scrape (): Promise<RestaurantData> {
        console.log(chalk.blue(`${this.icon} Scraping Papa Johns UK (committed PDF)…`))

        const items: RestaurantData = {}
        let variants = 0
        let duplicates = 0
        let renamed = 0
        let rejected = 0
        let repaired = 0
        let delistedProducts = 0
        let productsEmitted = 0

        let lines: PdfLine[]
        try {
            const pdf = new Uint8Array(fs.readFileSync(PDF_PATH))
            lines = await extractPdfLines(pdf)
            console.log(chalk.gray(`   ↳ PDF version ${findVersionStamp(lines) ?? 'unknown'}`))
        } catch (error) {
            console.error(chalk.red(`Error reading Papa Johns PDF: ${error}`))
            return {}
        }

        const maxPage = lines.reduce((m, l) => Math.max(m, l.page), 0)
        for (let page = 1; page <= maxPage; page++) {
            const pageLines = lines.filter((l) => l.page === page)
            const products = parsePage(pageLines)

            for (const product of products) {
                if (!product.title) continue
                if (DELISTED_CATEGORY.test(product.category)) { delistedProducts++; continue }

                const validRows: Row[] = []
                for (const row of product.rows) {
                    if (checks(row.nums)) { validRows.push(row); continue }
                    const fix = repair(row.nums)
                    if (fix) {
                        repaired++
                        console.log(
                            chalk.yellow(`  ⚠ repaired "${product.title}" / ${row.label} — ${fix.field} looked wrong`)
                        )
                        validRows.push({ label: row.label, nums: fix.nums })
                    } else {
                        rejected++
                        console.log(
                            chalk.gray(`  ⚠ rejected "${product.title}" / ${row.label} — failed validation, no unique repair`)
                        )
                    }
                }
                if (validRows.length === 0) continue
                productsEmitted++

                for (const row of validRows) {
                    const nutrition = toNutrition(row.nums, product.category)
                    const outcome = validRows.length > 1
                        ? addVariant(items, product.title, 'Size & Crust', row.label, nutrition)
                        : addItem(items, product.title, nutrition)
                    if (outcome.kind === 'duplicate') duplicates++
                    else if (outcome.kind === 'renamed') renamed++
                    else variants++
                }
            }
        }

        console.log(chalk.green(`${this.icon} Papa Johns: ${variants} variants across ${productsEmitted} products`))
        if (duplicates || renamed || rejected || repaired || delistedProducts) {
            console.log(
                chalk.gray(
                    `   ↳ ${duplicates} duplicates, ${renamed} requalified, ${rejected} rows rejected ` +
                    `(failed validation), ${repaired} rows repaired (dropped decimal point), ` +
                    `${delistedProducts} delisted products excluded`
                )
            )
        }
        return items
    }
}
