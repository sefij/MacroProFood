import {
    PdfNutritionScraper,
    PdfScraperConfig,
    NutritionRow
} from '../pdf/pdf-nutrition-scraper'

/**
 * Domino's UK — parsed from their published nutrition PDF.
 *
 * The PDF is a stack of tables grouped into numbered sections (Gluten Free
 * Pizzas, Plant Based, Sides, Chick 'N' Dip, Wraps, Dips, …). Most tables share
 * the macro columns `Cal · Fat · Sat · Carb · Sug · Fib · Pro · Salt`; they
 * differ only in the leading descriptor columns:
 *
 *   - Pizza tables lead with `Pizza` and, variably, `Crust` and/or `Size`.
 *   - Sides / Chick 'N' Dip lead with `Side Item` / `Item` + a `Serves` count.
 *   - Wraps, Dips, Combos lead with a single `Wrap` / `Dip` / `Combo` column.
 *
 * Every header label is mapped below so the shared header-driven pipeline
 * learns each table's layout on its own. `Sat`/`Sug`/`Fib`/`Salt`/`Serves` are
 * matched (so headers parse) but their roles are ignored downstream.
 */
const DOMINOS_CONFIG: PdfScraperConfig = {
    name: "Domino's",
    icon: '🍕',
    url: 'https://dominosmenu.co.uk/wp-content/uploads/2026/07/dominos-nutrition-menu.md_compressed.pdf',
    // Matchers are tried in order; the first to match a header cell wins, so the
    // specific columns come first and the name catch-all comes last.
    columns: [
        // Optional descriptor columns that distinguish product variants.
        { role: 'crust', match: /^crust$/i },
        { role: 'size', match: /^size$/i },
        { role: 'serves', match: /^serves$/i },
        // Macro columns (only calories/fat/carbs/protein are used downstream).
        // "Cal" on most tables, "Cal/Slice" on the per-slice Main Menu table.
        { role: 'calories', match: /^cal\b/i },
        { role: 'fat', match: /^fat$/i },
        { role: 'satFat', match: /^sat$/i },
        { role: 'carbs', match: /^carb$/i },
        { role: 'sugar', match: /^sug$/i },
        { role: 'fibre', match: /^fib$/i },
        { role: 'protein', match: /^pro$/i },
        { role: 'salt', match: /^salt$/i },
        // Leading descriptor column — the item name. Whatever the table calls it
        // (Pizza, Side Item, Wrap, Dip, Dessert, …) it's the one word-headed
        // column left once the columns above are claimed. Matches any header
        // starting with a letter; data cells (numbers, "34.7g") never do, so
        // this can't turn a data row into a false header.
        { role: 'name', match: /^[A-Za-z]/ }
    ],
    buildKey: buildDominosKey,
    category: dominosCategory,
    // Guard against feed errors: a single macro can't out-energise the whole
    // item (protein/carbs ≈ 4 kcal/g, fat ≈ 9 kcal/g), with slack for rounding.
    accept: ({ nutrition: n }) => {
        const cap = n.calories * 1.3
        return n.protein * 4 <= cap && n.carbs * 4 <= cap && n.fat * 9 <= cap
    }
}

/**
 * Composes a unique item key from the descriptor columns. The same pizza in a
 * different crust or size has different macros, so those fold into the key to
 * keep variants distinct: `"Delight Vegi — Thin & Crispy (Large)"`.
 *
 * Some pizza tables carry no `Size` column because their serving basis lives in
 * the section title instead — the Main Menu table is *per slice of a Large*,
 * the Specialty table *per whole Large*, the Personal table *per whole*. Those
 * would otherwise collide on `name — crust`, so when there's no size column we
 * fold that serving basis (parsed from the title) in instead.
 */
function buildDominosKey (row: NutritionRow, category: string): string | null {
    const name = clean(row.name)
    if (!name) return null

    const crust = clean(row.crust)
    const size = clean(row.size)
    let key = name
    if (crust) key += ` — ${crust}`
    if (size) {
        key += ` (${size})`
    } else {
        const serving = pizzaServingBasis(category)
        if (serving) key += ` (${serving})`
    }
    return key
}

/**
 * Pulls a short pizza serving-basis tag from a section title's parenthetical,
 * or `''` for non-pizza tables. `"… (Per Slice – Large)"` → `"Per Slice, Large"`,
 * `"… (Per Whole Pizza)"` → `"Per Whole"`, `"… (Per Whole Pizza – Large)"` →
 * `"Per Whole, Large"`. Only parentheticals mentioning slice/whole qualify, so
 * sides, wraps, dips and desserts keep their plain names.
 */
function pizzaServingBasis (category: string): string {
    const match = category.match(/\(([^)]*(?:slice|whole)[^)]*)\)/i)
    if (!match) return ''
    return match[1]
        .replace(/pizza/gi, '')
        .replace(/\s*[–-]\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .trim()
}

/** Trims and collapses the internal whitespace left by multi-line merges. */
function clean (value: string | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Strips a table title down to its display category. Titles come in two
 * shapes: pizza tables read "Domino's Pizza Nutrition – <Category> (<Serving>)"
 * (category after the dash); everything else reads "Domino's <Category>
 * Nutrition (<Serving>)?" (category before "Nutrition"). Continuation tables
 * with no "Domino's … Nutrition" wrapper at all (e.g. "Chick 'N' Dip Combos")
 * pass through unchanged.
 */
function dominosCategory (title: string): string {
    const stripped = title
        .replace(/^\d+\.\s*/, '')
        .replace(/^Domino'?s\s*/i, '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim()
    const afterDash = stripped.match(/^Pizza Nutrition\s*[–-]\s*(.+)$/i)
    if (afterDash) return afterDash[1].trim()
    return stripped.replace(/\s*Nutrition\s*$/i, '').trim()
}

export class DominosScraper extends PdfNutritionScraper {
    protected config = DOMINOS_CONFIG
}
