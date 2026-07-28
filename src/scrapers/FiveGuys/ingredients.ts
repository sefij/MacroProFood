/**
 * Five Guys UK's per-ingredient nutrition PDF → a name → macros lookup.
 *
 * Like Chipotle (see ../Chipotle/ingredients.ts), Five Guys UK doesn't
 * publish a per-dish menu for its core burgers/hot dogs — those are built
 * from a small set of components (patty, bun, cheese, bacon, …), and it's
 * the components, not the finished dishes, that carry published macros here.
 * This file parses the "NUTRITION GUIDE" table into a name → macros lookup;
 * `scraper.ts` composes each Deliveroo-listed dish by summing the rows a
 * hand-verified recipe (`recipes.ts`) says it contains.
 *
 * Unlike Chipotle's PDF, this document opens with an **allergen matrix**
 * ("ALLERGEN GUIDE" — presence ticks against 14 allergen categories, no
 * macros at all) and an ingredients-list section before the real nutrition
 * table starts under a "NUTRITION GUIDE" heading; parsing starts there and
 * ignores everything before it.
 *
 * The table's column layout matches Chipotle's exactly — Energy (kJ), Energy
 * (kcal), Total Fat, Of Which Saturates, Carbohydrates, Of Which Sugars,
 * Fibre, Protein, Salt — except every row repeats the same 9 columns a
 * second time for "per 100g" (this file only ever reads the first 9, the
 * per-serving block), and values use plain decimal points ("5.5"), not
 * Chipotle's European decimal commas. There's also no stated serving-size
 * column (Chipotle's "portion", e.g. "113 g") anywhere in this document, so
 * {@link IngredientNutrition} doesn't carry one.
 *
 * Some names span more than one cell before the numbers start — a trademark
 * symbol split into its own cell ("Lotus Biscoff" | "®"), or a qualifier
 * ("Cheese" | "(pasteurised)") — this parser joins every cell before the
 * row's first purely-numeric cell into the name, so both read fine.
 *
 * **A handful of names repeat with different values** — "Pistachio***" and
 * "Jimmy's Iced Coffee" each have a full-size row (under "MILKSHAKES") and a
 * smaller "Little" mix-in row (under "LITTLE MILKSHAKES"), both using the
 * *identical* name (unlike "Five Guys Milkshake Base", which does get a
 * distinct "… Little" name). First occurrence wins — the full-size row comes
 * first in the document — matching the convention every other name-keyed
 * lookup in this project uses (see e.g. `../Chipotle/deliveroo.ts`'s
 * `dishesFromRoot`). `recipes.ts` relies on this: its shake recipes need the
 * full-size figure, not the Little mix-in's.
 *
 * A few rows split their name and values across separate lines in a way this
 * parser doesn't attempt to reassemble (e.g. "Lettuce Wrap", whose total
 * lands on its own line sandwiched between two fragments of wrapped
 * description text) — those rows are simply absent from the table, not
 * guessed at. `recipes.ts` composes that one dish from its raw ingredients
 * instead of relying on the PDF's own total.
 */

import axios from 'axios'
import { extractPdfLines, PdfLine } from '../pdf/pdf-lines'

const PDF_URL =
    'https://www.fiveguys.co.uk/wp-content/uploads/sites/30/2026/06/FGUK_FOH_allergen_ingredient_nutrition_breakfast_A4_DIGITAL_20260622.pdf'

const REQUEST_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    Accept: 'application/pdf,*/*'
}

const HTTP_TIMEOUT_MS = 30000

/** The heading that starts the real nutrition table — everything before it is allergen/ingredient-list content. */
const NUTRITION_SECTION_HEADING = /^NUTRITION GUIDE/i

/** Per-serving macros for one PDF ingredient row, keyed by the row's product name. */
export interface IngredientNutrition {
    calories: number
    protein: number
    fat: number
    carbs: number
}

/** A line's cells as plain strings, in x order — the unit this parser reasons about. */
function cellTexts (line: PdfLine): string[] {
    return line.cells.map((c) => c.str.trim()).filter(Boolean)
}

const PURE_NUMBER = /^\d+(\.\d+)?$/

/**
 * The first 9 per-serving macro columns, left→right per the header row:
 * Energy (kJ), Energy (kcal), Total Fat, Of Which Saturates, Carbohydrates,
 * Of Which Sugars, Fibre, Protein, Salt — a "per 100g" repeat of the same 9
 * columns may follow but is never read. Only the four this app tracks are
 * kept.
 */
function macrosFromValues (values: string[]): IngredientNutrition | null {
    if (values.length < 9) return null
    const calories = Number(values[1])
    const fat = Number(values[2])
    const carbs = Number(values[4])
    const protein = Number(values[7])
    if (!Number.isFinite(calories) || calories <= 0) return null
    return {
        calories,
        protein: Number.isFinite(protein) ? protein : 0,
        fat: Number.isFinite(fat) ? fat : 0,
        carbs: Number.isFinite(carbs) ? carbs : 0
    }
}

/**
 * Parses the nutrition table from the document's raw lines (from the
 * "NUTRITION GUIDE" heading onward). Every ingredient row is name cells
 * followed by numeric cells — the name ends and the macro block starts at
 * the row's first purely-numeric cell. Rows with fewer than 9 numeric cells
 * after that point, or no numeric cells at all (section headings like
 * "MEAT", "BUN", footnotes, the table's own header row), are skipped. A name
 * seen twice keeps its first parsed value (see class docblock).
 */
export function parseIngredientRows (lines: PdfLine[]): Map<string, IngredientNutrition> {
    const table = new Map<string, IngredientNutrition>()
    let inTable = false

    for (const line of lines) {
        const cells = cellTexts(line)
        if (cells.length === 0) continue

        if (!inTable) {
            if (NUTRITION_SECTION_HEADING.test(cells[0])) inTable = true
            continue
        }

        const valueIndex = cells.findIndex((c) => PURE_NUMBER.test(c))
        if (valueIndex <= 0) continue // no name, or no numeric block at all

        const name = cells.slice(0, valueIndex).join(' ')
        if (table.has(name)) continue

        const macros = macrosFromValues(cells.slice(valueIndex))
        if (macros) table.set(name, macros)
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

/** Fetches and parses Five Guys' nutrition PDF. */
export async function fetchIngredients (): Promise<Map<string, IngredientNutrition>> {
    const pdf = await download()
    const lines = await extractPdfLines(pdf)
    return parseIngredientRows(lines)
}
