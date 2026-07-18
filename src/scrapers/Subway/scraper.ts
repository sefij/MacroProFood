import {
    PdfNutritionScraper,
    PdfScraperConfig,
    NutritionRow
} from '../pdf/pdf-nutrition-scraper'

/**
 * Subway UK & ROI — parsed from the published nutrition information PDF.
 *
 * Like Wendy's, the header rows are unusable for auto-detection (rotated label
 * text whose x-positions don't line up with the data cells), so the column
 * anchors are given directly, read off the data rows. Values are per serving
 * (6" sub / one wrap / one cookie …); each row also carries a per-100 g block
 * (~21 pt to the right of the salt column) that the tight tolerance leaves
 * unmapped. Columns sit ~15 pt apart with ±2.5 pt right-alignment jitter.
 *
 * The document mixes two grids — a menu grid on pages 1–2 (Subs, Toasties,
 * Saver Subs, Wraps, Salads, Spuds, Sides, Cookies) and a narrower ingredients
 * grid on page 3 (breads, proteins, cheese, vegetables, sauces, toppings) —
 * hence `fixedGrids`. The document title and "UK and ROI" banner repeat at the
 * top of every page and must be ignored, or they'd be read as section titles
 * and cut the Salads section in two where it continues onto page 2.
 *
 * Menu-section names are bare ("Bacon", "Chicken Tikka"), which both collides
 * with the page-3 ingredient portions of the same name and reads poorly in
 * results, so {@link buildItemKey} suffixes them with their section ("Bacon
 * Sub", "Chicken Tikka Wrap"). Page-3 ingredient names are kept as published
 * (their section headings are mostly too small for heading detection anyway).
 */
const SUBWAY_CONFIG: PdfScraperConfig = {
    name: 'Subway',
    icon: '🥪',
    url:
        'https://www.subway.com/en-gb/media/emea/europe/uk/nutrition/2026/' +
        'UKI_IngredientsNutritionalInformationJune2026.pdf',
    fixedGrids: [
        // Pages 1–2: menu items.
        [
            { role: 'name', x: 13.2 },
            { role: 'serving', x: 179 },
            { role: 'kj', x: 209.2 },
            { role: 'calories', x: 232.9 },
            { role: 'fat', x: 254 },
            { role: 'satFat', x: 271.7 },
            { role: 'carbs', x: 289 },
            { role: 'sugar', x: 310.8 },
            { role: 'fibre', x: 331 },
            { role: 'protein', x: 348.7 },
            { role: 'salt', x: 365 }
        ],
        // Page 3: ingredients.
        [
            { role: 'name', x: 19.9 },
            { role: 'serving', x: 143.2 },
            { role: 'kj', x: 159 },
            { role: 'calories', x: 175.7 },
            { role: 'fat', x: 191.7 },
            { role: 'satFat', x: 206.4 },
            { role: 'carbs', x: 222 },
            { role: 'sugar', x: 238.5 },
            { role: 'fibre', x: 253.4 },
            { role: 'protein', x: 266.9 },
            { role: 'salt', x: 282.5 }
        ]
    ],
    ignoreTitles: /^(Nutrition Information|UK and ROI|Subway Nutrition)/,
    columnXTolerance: 5,
    // Names never wrap; merging could only glue stray boilerplate onto a row.
    continuationLineGap: 0,
    buildKey: buildItemKey,
    // Guard against feed errors: a single macro can't out-energise the whole
    // item (protein/carbs ≈ 4 kcal/g, fat ≈ 9 kcal/g), with slack for rounding.
    accept: ({ nutrition: n }) => {
        const cap = n.calories * 1.3
        return n.protein * 4 <= cap && n.carbs * 4 <= cap && n.fat * 9 <= cap
    }
}

/** Menu sections whose bare item names get the section suffixed on. */
const SECTION_SUFFIX: Record<string, string> = {
    Subs: 'Sub',
    'Saver Subs': 'Saver Sub',
    Toasties: 'Toastie',
    Wraps: 'Wrap',
    Salads: 'Salad',
    Spuds: 'Spud'
}

function buildItemKey (row: NutritionRow, category: string): string | null {
    const name = clean(row.name)
    if (!name) return null
    const suffix = SECTION_SUFFIX[clean(category)]
    // Skip when already present ("Honey Mustard Deli Toastie" under Toasties).
    if (suffix && !name.toLowerCase().includes(suffix.toLowerCase())) {
        return `${name} ${suffix}`
    }
    return name
}

/** Trims and collapses the internal whitespace left by multi-fragment cells. */
function clean (value: string | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim()
}

export class SubwayScraper extends PdfNutritionScraper {
    protected config = SUBWAY_CONFIG
}
