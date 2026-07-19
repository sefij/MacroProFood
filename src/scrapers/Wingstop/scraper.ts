import chalk from 'chalk'
import axios from 'axios'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { normalizeCategory } from '../category'
import { addItem } from '../add-item'

/**
 * Live Wingstop UK scraper.
 *
 * The menu is a plain JSON document (`{ sections: [{ name, items: [...] }] }`)
 * — no HTML/browser needed, a single `axios.get`. Each item's `nutritionals`
 * is per `serving_size` units, and `serving_size` is only ever 100 for items
 * where that's a *normalized* rate (large shareable things — wings, burgers,
 * platters, fries, corn, churros — where one flavour's per-100g profile has
 * to cover many order sizes). For fixed-size single-serve items (milkshakes,
 * most dips), `serving_size` is already the real weight/volume and
 * `nutritionals.calories` is already that item's true total.
 *
 * Rather than branch on what `serving_size` happens to be, we derive the
 * item's true total calories from its free-text `description` (see
 * {@link calorieVariants}) and scale every macro by
 * `trueTotalCalories / nutritionals.calories`. That multiplier comes out to
 * 1 exactly when `nutritionals` already *is* the true total (drinks, dips),
 * and correctly scales up from 100g exactly when it isn't (wings, platters) —
 * one formula, no special-casing on `serving_size` itself.
 */

const MENU_URL =
    'https://live.menu.app.andithas.com/4dfd8702-9ace-4b89-a02a-3cd8861e740c/menu.json'

const REQUEST_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    Accept: 'application/json,*/*'
}

const HTTP_TIMEOUT_MS = 20000

// A single macro can't contribute more energy than the item's stated
// calories (protein/carbs ≈ 4 kcal/g, fat ≈ 9 kcal/g); drop feed errors that
// break this by more than this slack.
const MACRO_CALORIE_TOLERANCE = 1.3

interface WingstopNutritionals {
    calories?: number
    protein?: number
    total_fat?: number
    carbohydrates?: number
}

interface WingstopItem {
    name?: string
    description?: string
    nutritionals?: WingstopNutritionals
}

interface WingstopSection {
    name?: string
    items?: WingstopItem[]
}

interface WingstopMenu {
    sections?: WingstopSection[]
}

/**
 * One derived variant of a source item: a display-name suffix (wrapped in
 * parens onto the base name; `null` for the bare name) and the item's true
 * total calories (`null` means "no total could be parsed — use `nutritionals`
 * exactly as published, unscaled").
 */
interface CalorieVariant {
    suffix: string | null
    totalCalories: number | null
}

/**
 * Derives every real orderable variant of one source item from its free-text
 * `description`, checked in this order (first match wins) — see spec 09 for
 * the full survey this was built from:
 *
 *  1. Two sizes packed into one description ("Regular 175g= 371kcal Large
 *     250g = 531kcal") → two variants, "(Regular)" / "(Large)".
 *  2. Two counts ("4 Cobettes 210kcal or 8 Cobettes 421kcal", "6x 257kcal &
 *     10x 455kcal") → two variants, "(4 Cobettes)"/"(8 Cobettes)" or
 *     "(6x)"/"(10x)".
 *  3. "NNNkcal per person" + the name says "(For N)" → total = perPerson × N.
 *  4. "NNkcal per Wing/Boneless/Tender" (no quantity ever given) → one
 *     single-piece variant, "(per wing, average)" etc. — ordering "6 wings"
 *     is then just adding that one item 6× via the app's existing stepper.
 *  5. Fallback: the first plain "<number>kcal(s)" anywhere in the
 *     description — covers plain totals, "per platter", "from Nkcal*"
 *     (a stated minimum — the Tender Fix items — since the actual varies by
 *     chosen flavour), and milkshakes/dips whose description states the
 *     total directly.
 *  6. No "kcal" anywhere in the description (a handful of small Dips) → use
 *     `nutritionals` unscaled.
 */
function calorieVariants (name: string, description: string): CalorieVariant[] {
    const sized = extractPair(description, /(Regular|Large)[\s\S]*?(\d+(?:\.\d+)?)\s*kcal/gi)
    if (sized) return sized

    const cobettes = extractPair(
        description,
        /(\d+)\s*Cobettes[\s\S]*?(\d+(?:\.\d+)?)\s*kcal/gi,
        (n) => `${n} Cobettes`
    )
    if (cobettes) return cobettes

    const xCounts = extractPair(description, /(\d+)x[\s\S]*?(\d+(?:\.\d+)?)\s*kcal/gi, (n) => `${n}x`)
    if (xCounts) return xCounts

    const perPerson = description.match(/(\d+(?:\.\d+)?)\s*kcal\s*per\s*person/i)
    const forN = name.match(/\(For\s+(\d+)\)/i)
    if (perPerson && forN) {
        return [{ suffix: null, totalCalories: parseFloat(perPerson[1]) * parseInt(forN[1], 10) }]
    }

    const perPiece = description.match(/(\d+(?:\.\d+)?)\s*kcal\s*per\s*(Wing|Boneless|Tender)/i)
    if (perPiece) {
        return [{ suffix: `per ${perPiece[2].toLowerCase()}, average`, totalCalories: parseFloat(perPiece[1]) }]
    }

    const plain = description.match(/(\d+(?:\.\d+)?)\s*kcals?\b/i)
    if (plain) return [{ suffix: null, totalCalories: parseFloat(plain[1]) }]

    return [{ suffix: null, totalCalories: null }]
}

/**
 * Runs a global two-capture-group regex (label, calories) over `description`
 * and returns exactly two variants, or `null` if it didn't match twice. The
 * lazy `[\s\S]*?` between label and number skips over any intervening
 * "175g=" weight text — such text never itself ends in "kcal", so the lazy
 * expansion keeps growing past it to the real number.
 */
function extractPair (
    description: string,
    pattern: RegExp,
    labelFor: (capturedLabel: string) => string = (l) => l
): CalorieVariant[] | null {
    const out: CalorieVariant[] = []
    let match: RegExpExecArray | null
    while ((match = pattern.exec(description))) {
        out.push({ suffix: labelFor(match[1]), totalCalories: parseFloat(match[2]) })
    }
    return out.length === 2 ? out : null
}

/** Trims and collapses the internal whitespace the source data litters names with. */
function clean (value: string | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim()
}

function buildNutrition (
    base: WingstopNutritionals,
    variant: CalorieVariant,
    category: string | undefined
): NutritionData | 'implausible' | null {
    const baseCalories = base.calories
    if (!Number.isFinite(baseCalories) || (baseCalories as number) <= 0) return null

    const scale = variant.totalCalories != null ? variant.totalCalories / (baseCalories as number) : 1
    const calories = variant.totalCalories ?? (baseCalories as number)
    const protein = (base.protein ?? 0) * scale
    const fat = (base.total_fat ?? 0) * scale
    const carbs = (base.carbohydrates ?? 0) * scale

    const cap = calories * MACRO_CALORIE_TOLERANCE
    if (protein * 4 > cap || carbs * 4 > cap || fat * 9 > cap) return 'implausible'

    return {
        calories,
        protein,
        fat,
        carbs,
        ProteinTCalRatio: protein / calories,
        CarbToCalRatio: carbs / calories,
        category
    }
}

export class WingstopScraper extends SourceScraper {
    name = 'Wingstop'
    icon = '🔥'

    // No browser needed — this scraper is pure HTTP + JSON parsing.
    async initialize (): Promise<void> {}

    async scrape (): Promise<RestaurantData> {
        console.log(chalk.blue(`${this.icon} Scraping Wingstop UK (live)…`))

        const menu = await this.fetchMenu()

        const items: RestaurantData = {}
        let invalid = 0
        let implausible = 0
        let duplicates = 0
        let renamed = 0

        for (const section of menu.sections ?? []) {
            const category = normalizeCategory(section.name)
            for (const raw of section.items ?? []) {
                const name = clean(raw.name)
                const base = raw.nutritionals
                if (!name || !base) {
                    invalid++
                    continue
                }

                for (const variant of calorieVariants(name, raw.description ?? '')) {
                    const built = buildNutrition(base, variant, category)
                    if (built === null) {
                        invalid++
                        continue
                    }
                    if (built === 'implausible') {
                        implausible++
                        console.log(chalk.yellow(`  ⚠ dropped "${name}" — implausible macros`))
                        continue
                    }
                    const key = variant.suffix ? `${name} (${variant.suffix})` : name
                    const outcome = addItem(items, key, built)
                    if (outcome.kind === 'duplicate') duplicates++
                    else if (outcome.kind === 'renamed') renamed++
                }
            }
        }

        console.log(
            chalk.green(`✓ Found ${Object.keys(items).length} Wingstop items (live)`)
        )
        if (invalid > 0 || implausible > 0 || duplicates > 0 || renamed > 0) {
            console.log(
                chalk.gray(
                    `  skipped ${invalid} (missing/zero nutrition), ${implausible} (implausible macros), ` +
                    `${duplicates} (duplicate name, same macros); ${renamed} name collisions requalified`
                )
            )
        }
        return items
    }

    private async fetchMenu (): Promise<WingstopMenu> {
        const response = await axios.get<WingstopMenu>(MENU_URL, {
            headers: REQUEST_HEADERS,
            timeout: HTTP_TIMEOUT_MS,
            responseType: 'json'
        })
        return response.data
    }
}
