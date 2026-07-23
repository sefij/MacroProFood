import axios from 'axios'
import chalk from 'chalk'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { normalizeCategory } from '../category'
import { addItem, addVariant } from '../add-item'
import { parseNumber } from '../parse-number'
import { extractPdfItems, PdfItem } from '../pdf/pdf-lines'

/**
 * Pizza Hut UK — parsed from their published allergen/nutrition PDF.
 *
 * This does **not** use the shared header-driven PDF pipeline: Pizza Hut's
 * table doesn't fit it. The header is stacked across ~8 lines (so no single
 * header row exists to auto-detect), and — the real obstacle — the two label
 * columns are drawn as **90°-rotated text, once per merged group, vertically
 * centered**: the `Category` ("Pizza") spans a whole page-section, and the
 * `Product name` ("Margherita") spans all of a pizza's size rows, neither
 * sitting on any data row. So this scraper works from raw positioned items
 * ({@link extractPdfItems}, which preserves rotation) and reconstructs the
 * table itself:
 *
 *  1. **Rows.** Non-rotated fragments cluster into data rows by baseline; each
 *     row's cells map to fixed x-columns. Only the **whole-product** macro
 *     block is read (the PDF repeats every macro a second time *per serving*
 *     at higher x — deliberately ignored, since you order a whole pizza, not
 *     a serving).
 *  2. **Product grouping (pizzas).** A pizza's size rows are one product; the
 *     boundary is found via the `Serves` column resetting to 1 (every product
 *     leads with a serves-1 size, and serves only climbs within a product).
 *     Each group is named by the rotated `Product name` label falling in its
 *     y-range, and each size becomes a **variant** (`addVariant`) so the app
 *     shows one "Margherita" with a size selector rather than ~11 rows.
 *  3. **Category.** The nearest rotated `Category` label (by vertical centre).
 *
 * **Scope (per product decision): Pizzas, Sides and Chicken only.** Melts,
 * Flatzz, Dips, Desserts and Drinks are dropped — some extract messily from
 * this layout, and Drinks are excluded by the app by default anyway. Sides
 * and Chicken aren't size-variant products (each row is its own item, e.g.
 * "Garlic Bread (4 slices)"), so those emit as plain items.
 *
 * The PDF URL is hosted on Contentful's CDN and hard-coded, matching the
 * other PDF scrapers (Domino's, Wendy's, Subway). Pizza Hut's own
 * `/allergens` page that links it is Akamai bot-walled, so it can't be
 * scraped for the link without a browser; the CDN asset itself serves fine.
 * The URL carries a version tag (`…C3_2026_V1_1.pdf`) and will need updating
 * when Pizza Hut republishes.
 */

const PDF_URL =
    'https://assets.ctfassets.net/gsh8f6v1sw3c/6XUgXQCKklvPyrUmgIVshd/6948068493acdb56f38be1f2360388d0/DELEX_AIN_Booklet_C3_2026_V1_1.pdf'

const REQUEST_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    Accept: 'application/pdf,*/*'
}

const HTTP_TIMEOUT_MS = 30000

// Nutrition tables begin on page 5 (pages 1–4 are cover/intro/allergen key).
const FIRST_DATA_PAGE = 5

// Fixed x-anchors for the whole-product macro block, learned from the page-5
// header. A cell maps to the nearest of these within COLUMN_X_TOLERANCE; the
// per-serving block (higher x) falls outside every anchor and is dropped.
const COLUMNS: Array<{ role: string, x: number }> = [
    { role: 'size', x: 253 },
    { role: 'serves', x: 953 },
    { role: 'calories', x: 1005 },
    { role: 'fat', x: 1071 },
    { role: 'carbs', x: 1197 },
    { role: 'protein', x: 1325 }
]
const COLUMN_X_TOLERANCE = 32
const LINE_Y_TOLERANCE = 3

// Rotated label columns.
const CATEGORY_MAX_X = 110
const NAME_MIN_X = 110
const NAME_MAX_X = 245
// Rotated name fragments whose centres are within this far are one wrapped label.
const NAME_FRAGMENT_GAP = 60

// Only these categories are in scope; everything else is dropped.
const IN_SCOPE = /pizza|sides|chicken/i

// A single macro can't out-energise the whole item (protein/carbs ≈ 4 kcal/g,
// fat ≈ 9 kcal/g); drop feed errors that break this by more than the slack.
const MACRO_CALORIE_TOLERANCE = 1.3

interface DataRow {
    y: number
    size?: string
    serves?: string
    calories?: string
    fat?: string
    carbs?: string
    protein?: string
}

interface RotatedLabel {
    /** Vertical centre of the rotated glyph run. */
    cy: number
    lo: number
    hi: number
    str: string
}

/** Trims and collapses internal whitespace. */
function clean (value: string | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim()
}

function nearestRole (x: number): string | null {
    let best: string | null = null
    let bestDist = Infinity
    for (const col of COLUMNS) {
        const dist = Math.abs(x - col.x)
        if (dist < bestDist) { bestDist = dist; best = col.role }
    }
    return best && bestDist <= COLUMN_X_TOLERANCE ? best : null
}

/** Clusters a page's non-rotated fragments into rows and maps cells to columns. */
function buildDataRows (items: PdfItem[]): DataRow[] {
    const flat = items
        .filter((it) => !it.rotated)
        .sort((a, b) => b.y - a.y || a.x - b.x)

    const clustered: Array<{ y: number, cells: PdfItem[] }> = []
    for (const it of flat) {
        const cur = clustered[clustered.length - 1]
        if (cur && Math.abs(cur.y - it.y) <= LINE_Y_TOLERANCE) cur.cells.push(it)
        else clustered.push({ y: it.y, cells: [it] })
    }

    const rows: DataRow[] = []
    for (const line of clustered) {
        const row: Record<string, string> = {}
        for (const cell of line.cells) {
            const role = nearestRole(cell.x)
            if (!role) continue
            const value = cell.str.trim()
            row[role] = row[role] ? `${row[role]} ${value}` : value
        }
        // A data row has a numeric whole-product calories and a size label;
        // stacked-header lines and per-serving-only lines fail one of these.
        if (row.calories && /^\d+$/.test(row.calories) && row.size) {
            rows.push({ y: line.y, ...row })
        }
    }
    return rows
}

/** Merges rotated fragments in a column into labels (wrapped multi-line labels re-joined). */
function buildLabels (items: PdfItem[], minX: number, maxX: number): RotatedLabel[] {
    const frags = items
        .filter((it) => it.rotated && it.x >= minX && it.x < maxX)
        .map((it) => ({ cy: it.y + it.width / 2, lo: it.y, hi: it.y + it.width, x: it.x, str: it.str.trim() }))
        .sort((a, b) => b.cy - a.cy)

    const groups: Array<typeof frags> = []
    for (const f of frags) {
        const g = groups.find((g) => Math.abs(g[0].cy - f.cy) < NAME_FRAGMENT_GAP)
        if (g) g.push(f)
        else groups.push([f])
    }

    return groups.map((parts) => ({
        cy: parts.reduce((s, p) => s + p.cy, 0) / parts.length,
        lo: Math.min(...parts.map((p) => p.lo)),
        hi: Math.max(...parts.map((p) => p.hi)),
        // A wrapped label's lines stack as adjacent rotated columns; the first
        // line sits at the least x, so read them left→right.
        str: parts.slice().sort((a, b) => a.x - b.x).map((p) => p.str).join(' ')
    }))
}

/** Splits rows into product groups: a new group starts when Serves resets to 1. */
function segmentByServes (rows: DataRow[]): DataRow[][] {
    const segments: DataRow[][] = []
    let current: DataRow[] | null = null
    for (const row of rows) {
        const prev = current?.[current.length - 1]
        const resets = row.serves === '1' && !!prev?.serves && prev.serves !== '1'
        if (!current || resets) { current = []; segments.push(current) }
        current.push(row)
    }
    return segments
}

/** Label whose centre falls within [lo, hi] of a group's rows, else the nearest by centre. */
function labelForSpan (labels: RotatedLabel[], lo: number, hi: number): RotatedLabel | undefined {
    const inside = labels.find((l) => l.cy >= lo - 2 && l.cy <= hi + 2)
    if (inside) return inside
    let best: RotatedLabel | undefined
    let bestDist = Infinity
    for (const l of labels) {
        const dist = Math.min(Math.abs(l.cy - lo), Math.abs(l.cy - hi))
        if (dist < bestDist) { bestDist = dist; best = l }
    }
    return best
}

/**
 * Assigns each row's y to a category by section, not by nearest label.
 *
 * A page's category labels are each drawn *centred* in their section, but the
 * sections differ wildly in height (Sides is short, Chicken is tall), so
 * nearest-centre misplaces rows near a seam — a tall section's centre sits far
 * from its own edge rows. Instead, assume the sections tile the page and each
 * centre `C[i]` bisects its section: with the top edge anchored at the
 * highest row, each lower boundary is `B[i] = 2·C[i] − B[i-1]`. A row belongs
 * to the lowest section whose boundary it clears. (Verified against the real
 * page: this lands the Chicken|Dips seam exactly and the Sides|Chicken seam
 * within one row, versus several rows out for nearest-centre.)
 */
function buildCategorySections (
    categories: RotatedLabel[],
    topY: number
): Array<{ label: RotatedLabel, lower: number }> {
    const sorted = [...categories].sort((a, b) => b.cy - a.cy)
    const sections: Array<{ label: RotatedLabel, lower: number }> = []
    let upper = topY
    for (let i = 0; i < sorted.length; i++) {
        const lower = i === sorted.length - 1 ? -Infinity : 2 * sorted[i].cy - upper
        sections.push({ label: sorted[i], lower })
        upper = lower
    }
    return sections
}

function categoryForRow (
    sections: Array<{ label: RotatedLabel, lower: number }>,
    y: number
): string | undefined {
    for (const section of sections) {
        if (y >= section.lower) return section.label.str
    }
    return sections[sections.length - 1]?.label.str
}

function buildNutrition (row: DataRow, category: string | undefined): NutritionData | 'implausible' | null {
    const calories = parseNumber(row.calories)
    if (!Number.isFinite(calories) || calories <= 0) return null
    const protein = parseNumber(row.protein) || 0
    const fat = parseNumber(row.fat) || 0
    const carbs = parseNumber(row.carbs) || 0

    const cap = calories * MACRO_CALORIE_TOLERANCE
    if (protein * 4 > cap || carbs * 4 > cap || fat * 9 > cap) return 'implausible'

    return {
        calories,
        protein,
        fat,
        carbs,
        ProteinTCalRatio: protein / calories,
        CarbToCalRatio: carbs / calories,
        category: normalizeCategory(category)
    }
}

export class PizzaHutScraper extends SourceScraper {
    name = 'Pizza Hut'
    icon = '🛖'

    // No browser needed — pure HTTP download + PDF parsing.
    async initialize (): Promise<void> {}

    async scrape (): Promise<RestaurantData> {
        console.log(chalk.blue(`${this.icon} Scraping Pizza Hut UK (PDF)…`))

        const items: RestaurantData = {}
        let invalid = 0
        let implausible = 0
        let outOfScope = 0
        let duplicates = 0
        let renamed = 0

        let allItems: PdfItem[]
        try {
            const pdf = await this.download()
            allItems = await extractPdfItems(pdf)
        } catch (error) {
            console.error(chalk.red(`Error scraping Pizza Hut: ${error}`))
            return {}
        }

        const maxPage = Math.max(...allItems.map((it) => it.page))
        for (let page = FIRST_DATA_PAGE; page <= maxPage; page++) {
            const pageItems = allItems.filter((it) => it.page === page)
            const rows = buildDataRows(pageItems)
            if (rows.length === 0) continue
            const categories = buildLabels(pageItems, 0, CATEGORY_MAX_X)
            const names = buildLabels(pageItems, NAME_MIN_X, NAME_MAX_X)
            const topY = Math.max(...rows.map((r) => r.y))
            const sections = buildCategorySections(categories, topY)

            for (const segment of segmentByServes(rows)) {
                const ys = segment.map((r) => r.y)
                const lo = Math.min(...ys)
                const hi = Math.max(...ys)
                // A pizza segment's rows all fall in one category (boundaries
                // land between products, not within), so the product label and
                // "is this a pizza" test read off the segment; category itself
                // is resolved per row for robustness near a seam.
                const segCategory = clean(categoryForRow(sections, (lo + hi) / 2))
                const isPizza = /pizza/i.test(segCategory)
                const product = isPizza ? clean(labelForSpan(names, lo, hi)?.str) : ''

                for (const row of segment) {
                    const rawCategory = categoryForRow(sections, row.y)
                    const category = clean(rawCategory)
                    if (!IN_SCOPE.test(category)) { outOfScope++; continue }

                    const size = clean(row.size)
                    const built = buildNutrition(row, rawCategory)
                    if (built === null) { invalid++; continue }
                    if (built === 'implausible') {
                        implausible++
                        console.log(chalk.yellow(`  ⚠ dropped "${product || size}" — implausible macros`))
                        continue
                    }

                    let outcome
                    if (isPizza && product && size) {
                        // A pizza size → a variant of the product.
                        outcome = addVariant(items, product, 'Size', size, built)
                    } else if (size) {
                        // Sides/Chicken: each row is its own item.
                        outcome = addItem(items, size, built)
                    } else {
                        invalid++
                        continue
                    }
                    if (outcome.kind === 'duplicate') duplicates++
                    else if (outcome.kind === 'renamed') renamed++
                }
            }
        }

        // Report distinct base items (a variant group counts once), matching
        // how the app presents them, not the raw flat-variant count.
        const simpleCount = Object.values(items).filter((n) => !n.variantOf).length
        const groupCount = new Set(
            Object.values(items).filter((n) => n.variantOf).map((n) => n.variantOf)
        ).size
        console.log(
            chalk.green(
                `✓ Found ${Object.keys(items).length} Pizza Hut rows across ${simpleCount + groupCount} items (PDF)`
            )
        )
        if (invalid || implausible || outOfScope || duplicates || renamed) {
            console.log(
                chalk.gray(
                    `  skipped ${invalid} (unparseable), ${implausible} (implausible macros), ` +
                    `${outOfScope} (out of scope); ${duplicates} duplicate, ${renamed} requalified`
                )
            )
        }
        return items
    }

    private async download (): Promise<Uint8Array> {
        const response = await axios.get<ArrayBuffer>(PDF_URL, {
            headers: REQUEST_HEADERS,
            timeout: HTTP_TIMEOUT_MS,
            responseType: 'arraybuffer'
        })
        return new Uint8Array(response.data)
    }
}
