import {
    PdfNutritionScraper,
    PdfScraperConfig,
    NutritionRow
} from '../pdf/pdf-nutrition-scraper'

/**
 * Wendy's UK — parsed from their published nutrition PDF.
 *
 * Unlike Domino's (many tables, each with its own header), Wendy's is a single
 * dense table: one header at the very top, then the items grouped into
 * large-font category blocks (HAMBURGERS, CHICKEN, WRAPS, …). Two quirks make
 * the header unusable for auto-detection — it's split across two lines ("MENU
 * ITEM" sits above the nutrient labels) and the nutrient labels are wrapped and
 * flanked by a wide block of (text-empty) allergen columns — so we give the
 * column x-anchors directly instead, read off the data rows.
 *
 * The macro columns sit only ~16-18pt apart with the allergen columns crowding
 * in from the right, so the cell→column tolerance is tightened; and item names
 * never wrap (a very small font fits them on one line), so wrapped-cell merging
 * is disabled to keep a zero-calorie condiment row (name only, no macros) from
 * gluing onto the previous item.
 *
 * **2026-08 refresh**: the source PDF was replaced (25 June 2025 → 25 March
 * 2026 revision) and every macro column's x-anchor shifted right by ~70-90pt —
 * this revision also inserted a new "Weight (g)" column right after the item
 * name, which is why the gap widened. Anchors below were re-measured directly
 * off this revision's data rows (162 rows sampled, ≤3pt spread per column);
 * the weight column is deliberately left unmapped (no macro use for it) —
 * it's far enough from every mapped anchor that the tight tolerance drops it
 * silently rather than bleeding into `calories`.
 */
const WENDYS_CONFIG: PdfScraperConfig = {
    name: "Wendy's",
    icon: '🍔',
    url: 'https://www.wendys.com/sites/default/files/2026-04/United-Kingdom-National-Nutrition-Information---3.25.2026-%28002%29.pdf',
    // x-anchors of the item name + macro columns, from the data rows. The
    // weight column (~x 158) and the allergen columns further right are left
    // unmapped by the tight tolerance below, and the latter carry no text in
    // data rows anyway.
    fixedColumns: [
        { role: 'name', x: 52.0 },
        { role: 'calories', x: 191.2 },
        { role: 'fat', x: 208.4 },
        { role: 'satFat', x: 224.9 },
        { role: 'carbs', x: 241.5 },
        { role: 'sugar', x: 258.0 },
        { role: 'fibre', x: 274.7 },
        { role: 'protein', x: 291.2 },
        { role: 'salt', x: 307.1 }
    ],
    columnXTolerance: 6,
    continuationLineGap: 0,
    // Rows sit only ~3pt apart (name 0.5pt above its values), so cluster tightly
    // or adjacent items merge into one line.
    lineYTolerance: 1.5,
    buildKey: (row: NutritionRow) => clean(row.name) || null,
    // Guard against feed errors: a single macro can't out-energise the whole
    // item (protein/carbs ≈ 4 kcal/g, fat ≈ 9 kcal/g), with slack for rounding.
    accept: ({ nutrition: n }) => {
        const cap = n.calories * 1.3
        return n.protein * 4 <= cap && n.carbs * 4 <= cap && n.fat * 9 <= cap
    }
}

/** Trims and collapses the internal whitespace left by multi-fragment cells. */
function clean (value: string | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim()
}

export class WendysScraper extends PdfNutritionScraper {
    protected config = WENDYS_CONFIG
}
