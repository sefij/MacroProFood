import {
    PdfNutritionScraper,
    PdfScraperConfig,
    NutritionRow
} from '../pdf/pdf-nutrition-scraper.js'

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
 * The macro columns sit only ~10pt apart with the allergen columns crowding in
 * from the right, so the cell→column tolerance is tightened; and item names
 * never wrap (a very small font fits them on one line), so wrapped-cell merging
 * is disabled to keep a zero-calorie condiment row (name only, no macros) from
 * gluing onto the previous item.
 */
const WENDYS_CONFIG: PdfScraperConfig = {
    name: "Wendy's",
    icon: '🍔',
    url: 'https://www.wendys.com/sites/default/files/2025-06/Wendy%27s%20UK%20Nutrition%20-%2003%20June%202025_1.pdf',
    // x-anchors of the item name + macro columns, from the data rows. The
    // allergen columns to the right (x ≥ ~200) are left unmapped by the tight
    // tolerance below, and carry no text in data rows anyway.
    fixedColumns: [
        { role: 'name', x: 51.7 },
        { role: 'calories', x: 116.8 },
        { role: 'fat', x: 127.4 },
        { role: 'satFat', x: 137.2 },
        { role: 'carbs', x: 147.6 },
        { role: 'sugar', x: 157.4 },
        { role: 'fibre', x: 167.2 },
        { role: 'protein', x: 177.8 },
        { role: 'salt', x: 187.3 }
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
