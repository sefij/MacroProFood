import chalk from 'chalk'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { normalizeCategory } from '../category'
import { addItem } from '../add-item'
import { parseNumber } from '../parse-number'

/**
 * Live YO! Sushi UK scraper.
 *
 * yosushi.com's own menu-item pages (`/menu/<slug>`) carry a nutrition
 * accordion, but it only ever publishes Energy, Total fat, Sat fat, Sugars
 * and Salt — protein and total carbs are never present, on any item type
 * (sushi, mains, ramen, desserts all checked). That's unusable for this
 * app's macro optimizer.
 *
 * YO!'s own `/legal/allergen-information` page links out to a third-party
 * compliance portal, `menus.tenkites.com`, which — for this same menu —
 * publishes the full nutrition panel (Energy, Fat, Saturates, Carb, Sugars,
 * Fibre, Starch, Protein, Salt) for every item, all server-rendered into one
 * ~14MB HTML page. That's the source used here instead: one GET, no
 * per-item crawling. Category is recovered by walking the page in document
 * order and tracking the most recent `.k10-w-course__name` section heading
 * (e.g. "Curry", "Ramen", "Street food and sharing") — the same pattern
 * Popeyes/Taco Bell use for their table-section headers.
 */

const TENKITES_URL = 'https://menus.tenkites.com/yosushi/allergenpageyosushi'

const REQUEST_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    Accept: 'text/html,*/*'
}

const HTTP_TIMEOUT_MS = 30000

// A single macro can't contribute more energy than the item's stated
// calories (protein/carbs ≈ 4 kcal/g, fat ≈ 9 kcal/g); drop feed errors that
// break this by more than this slack.
const MACRO_CALORIE_TOLERANCE = 1.3

interface TenkitesItem {
    category: string | undefined
    name: string
    nutrients: Record<string, string>
}

/** Trims and collapses the internal whitespace the source data litters names with. */
function clean (value: string | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim()
}

function buildNutrition (item: TenkitesItem): NutritionData | 'implausible' | null {
    const calories = parseNumber(item.nutrients['Energy (kCal)'])
    if (!Number.isFinite(calories) || calories <= 0) return null

    const protein = parseNumber(item.nutrients['Protein (g)']) || 0
    const fat = parseNumber(item.nutrients['Fat (g)']) || 0
    const carbs = parseNumber(item.nutrients['Carb (g)']) || 0

    const cap = calories * MACRO_CALORIE_TOLERANCE
    if (protein * 4 > cap || carbs * 4 > cap || fat * 9 > cap) return 'implausible'

    return {
        calories,
        protein,
        fat,
        carbs,
        ProteinTCalRatio: protein / calories,
        CarbToCalRatio: carbs / calories,
        category: normalizeCategory(item.category)
    }
}

export class YoSushiScraper extends SourceScraper {
    name = 'YO! Sushi'
    icon = '🍣'

    // No browser needed — this scraper is pure HTTP + JSON parsing.
    async initialize (): Promise<void> {}

    async scrape (): Promise<RestaurantData> {
        console.log(chalk.blue(`${this.icon} Scraping YO! Sushi UK (live)…`))

        const parsed = await this.fetchItems()

        const items: RestaurantData = {}
        let invalid = 0
        let implausible = 0
        let duplicates = 0
        let renamed = 0

        for (const item of parsed) {
            const name = clean(item.name)
            if (!name) {
                invalid++
                continue
            }

            const built = buildNutrition(item)
            if (built === null) {
                invalid++
                continue
            }
            if (built === 'implausible') {
                implausible++
                console.log(chalk.yellow(`  ⚠ dropped "${name}" — implausible macros`))
                continue
            }
            const outcome = addItem(items, name, built)
            if (outcome.kind === 'duplicate') duplicates++
            else if (outcome.kind === 'renamed') renamed++
        }

        console.log(chalk.green(`✓ Found ${Object.keys(items).length} YO! Sushi items (live)`))
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

    /** Fetches and parses the full tenkites nutrition page for this menu. */
    private async fetchItems (): Promise<TenkitesItem[]> {
        const response = await axios.get<string>(TENKITES_URL, {
            headers: REQUEST_HEADERS,
            timeout: HTTP_TIMEOUT_MS,
            responseType: 'text'
        })
        const $ = cheerio.load(response.data)

        // Course headings and item rows interleaved in document order, so a
        // single pass can attribute each item to the section it falls under.
        const nodes = $('.k10-w-course__name, div.k10-recipe.k10-w-recipe.k10-w-recipe__info.k10-recipe_desktop')

        let currentCategory: string | undefined
        const seenRecipeIds = new Set<string>()
        const items: TenkitesItem[] = []

        nodes.each((_, el) => {
            const $el = $(el)
            if ($el.hasClass('k10-w-course__name')) {
                currentCategory = clean($el.text())
                return
            }

            // The same recipe row is repeated (desktop layout, hidden
            // ingredient-breakdown card, mobile layout); the selector above
            // only ever matches the desktop info row, but that row itself
            // can still repeat if it's part of a "build your own" variant —
            // keep only the first occurrence of each recipe id.
            const recipeId = $el.attr('data-recipe-id')
            if (!recipeId || seenRecipeIds.has(recipeId)) return
            seenRecipeIds.add(recipeId)

            const name = $el.find('.k10-recipe__name-value .k10-w-recipe__name').first().text()
            const nutrients: Record<string, string> = {}
            $el.find('> .k10-recipe__label_nutrient').each((_, n) => {
                const $n = $(n)
                const nutrientName = $n.attr('data-nutrient-name')
                if (nutrientName) nutrients[nutrientName] = $n.text().trim()
            })

            items.push({ category: currentCategory, name, nutrients })
        })

        return items
    }
}
