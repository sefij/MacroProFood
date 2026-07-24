/**
 * Chipotle UK's per-ingredient nutrition PDF → a name → macros lookup.
 *
 * Unlike every other PDF scraper in this project, this PDF isn't a menu of
 * orderable items — it's a "nutrition calculator" table, one row per
 * buildable component (Chicken, Coriander-Lime White Rice, Black Beans, Fresh
 * Tomato Salsa, …), each with its own **per-stated-serving** macros. That's
 * exactly the shape `Chipotle/scraper.ts` needs: it composes a dish's total
 * macros by summing the rows a hand-verified recipe (`recipes.ts`) says that
 * dish contains.
 *
 * Two things make this table not fit the shared header-driven PDF pipeline
 * (`pdf/pdf-nutrition-scraper.ts`):
 *
 *  - **Comma-decimal numbers.** Values are written the European way — "8,8"
 *    means 8.8, not 8800 or a thousands-grouped 88. The project's shared
 *    {@link ../parse-number.ts} assumes the opposite convention (comma =
 *    thousands separator, as every other scraper's source uses), so reusing
 *    it here would silently corrupt every value (`"8,8"` → strips the comma →
 *    `88`). This file has its own `parseCommaDecimal`.
 *  - **A handful of rows split their values onto an adjacent line**, rather
 *    than keeping name + portion + macros together on one line — see
 *    {@link parseIngredientRows} below for the two patterns found (verified
 *    against a live pull, January 2026 edition).
 *
 * Scope: this only parses the food/ingredient rows (tortillas through the
 * "Limited Time Offer" proteins) and stops at "Fountain Drinks" — the drinks
 * section uses a materially different multi-portion layout (each drink has
 * two sizes, sharing one name line), and no dish recipe in `recipes.ts`
 * references a drink, so there's no need to solve that shape too.
 */

import axios from 'axios'
import { extractPdfLines, PdfLine } from '../pdf/pdf-lines'

const PDF_URL =
    'https://www.chipotle.co.uk/content/dam/chipotle/menu/nutrition/2026/january/Allergen%20UK160126.pdf'

const REQUEST_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    Accept: 'application/pdf,*/*'
}

const HTTP_TIMEOUT_MS = 30000

/** The heading that starts the section this parser doesn't attempt (see class docblock). */
const DRINKS_SECTION_HEADING = /^Fountain Drinks$/i

/** A cell whose text names a stated serving, e.g. `"113 g"`, `"1 Ea (95 g)"`, `"40g"`, `"59 ml"`. */
const PORTION_PATTERN = /\d\s*(g|ml|Ea)/i

/** Per-serving macros for one PDF ingredient row, keyed by the row's product name. */
export interface IngredientNutrition {
    portion: string
    calories: number
    protein: number
    fat: number
    carbs: number
}

/** European decimal comma ("8,8" = 8.8), unlike the project's default `parseNumber` (comma = thousands). */
function parseCommaDecimal (value: string | undefined): number {
    if (!value) return NaN
    return Number(value.trim().replace(',', '.'))
}

/**
 * The 9 per-serving macro columns, left→right per the header row: Energy
 * (kJ), Energy (kcal), Total Fat, Of Which Saturates, Carbohydrates, Of Which
 * Sugars, Fibre, Protein, Salt. Only the four this app tracks are kept.
 */
function macrosFromValues (values: string[]): Omit<IngredientNutrition, 'portion'> | null {
    if (values.length < 9) return null
    const calories = parseCommaDecimal(values[1])
    const fat = parseCommaDecimal(values[2])
    const carbs = parseCommaDecimal(values[4])
    const protein = parseCommaDecimal(values[7])
    if (!Number.isFinite(calories) || calories <= 0) return null
    return {
        calories,
        protein: Number.isFinite(protein) ? protein : 0,
        fat: Number.isFinite(fat) ? fat : 0,
        carbs: Number.isFinite(carbs) ? carbs : 0
    }
}

/** A line's cells as plain strings, in x order — the unit this parser reasons about. */
function cellTexts (line: PdfLine): string[] {
    return line.cells.map((c) => c.str.trim()).filter(Boolean)
}

/**
 * Parses the ingredient table from the document's raw lines (before drinks).
 * Handles two line shapes, found by inspecting a live pull:
 *
 *  1. **Normal**: name, then somewhere after it a portion cell, then the 9
 *     per-serving values immediately following the portion — all on one
 *     line. A stray single "X" cell (an allergen tick) can sit between name
 *     and portion; it's skipped since it never matches {@link PORTION_PATTERN}.
 *     This covers the large majority of rows, including ones whose per-100g
 *     block spills onto a following line (Guacamole (topping/side)) — this
 *     parser only ever reads the 9 values right after the portion, so an
 *     overflowing/absent per-100g block downstream doesn't matter.
 *  2. **Name-and-values-swapped** (Romaine Lettuce is the one row in scope
 *     that does this): a line with *only* a portion + 9 values (no name) is
 *     immediately followed by a line with *only* a name (no portion of its
 *     own). The values belong to the name on the next line down.
 *
 * Rows this can't confidently parse are skipped, not guessed at.
 */
export function parseIngredientRows (lines: PdfLine[]): Map<string, IngredientNutrition> {
    const table = new Map<string, IngredientNutrition>()
    let pendingPortionRow: { portion: string, macros: Omit<IngredientNutrition, 'portion'> } | null = null

    for (const line of lines) {
        const cells = cellTexts(line)
        if (cells.length === 0) continue
        if (DRINKS_SECTION_HEADING.test(cells[0])) break

        const portionIndex = cells.findIndex((c) => PORTION_PATTERN.test(c))
        const hasName = portionIndex !== 0 && !/^[\d,.]+$/.test(cells[0])

        if (hasName && portionIndex > 0) {
            // Normal row: name, then a portion, then its 9 values.
            const name = cells[0]
            const macros = macrosFromValues(cells.slice(portionIndex + 1))
            pendingPortionRow = null
            if (macros) table.set(name, { portion: cells[portionIndex], ...macros })
        } else if (!hasName && portionIndex === 0) {
            // Orphan portion+values row — remember it for the next line.
            const macros = macrosFromValues(cells.slice(1))
            pendingPortionRow = macros ? { portion: cells[0], macros } : null
        } else if (hasName && portionIndex === -1 && pendingPortionRow) {
            // Name-only line right after an orphan row: pair them.
            table.set(cells[0], { portion: pendingPortionRow.portion, ...pendingPortionRow.macros })
            pendingPortionRow = null
        } else {
            pendingPortionRow = null
        }
    }

    return table
}

async function download (): Promise<Uint8Array> {
    const response = await axios.get<ArrayBuffer>(PDF_URL, {
        headers: REQUEST_HEADERS,
        timeout: HTTP_TIMEOUT_MS,
        responseType: 'arraybuffer'
    })
    return new Uint8Array(response.data)
}

/** Fetches and parses Chipotle's ingredient nutrition PDF. */
export async function fetchIngredients (): Promise<Map<string, IngredientNutrition>> {
    const pdf = await download()
    const lines = await extractPdfLines(pdf)
    return parseIngredientRows(lines)
}
