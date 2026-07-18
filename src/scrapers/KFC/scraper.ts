import chalk from 'chalk'
import axios from 'axios'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { normalizeCategory } from '../category'
import { addItem } from '../add-item'

/**
 * Live KFC UK scraper.
 *
 * The KFC nutrition page is a Next.js app that ships the full menu as JSON in a
 * `<script id="__NEXT_DATA__">` blob, so we don't need a browser: a single HTTP
 * GET plus a JSON parse yields every product. We read
 * `props.pageProps.data.mainContent[…id=nutrition_allergen_table].children.products`,
 * each entry of which carries `{ name, nutrition: { kcal, protein, fat, carbohydrates, … } }`.
 */

const NUTRITION_URL = 'https://www.kfc.co.uk/nutrition-allergens'

const REQUEST_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.8'
}

const HTTP_TIMEOUT_MS = 20000

// Physical-sanity tolerance: a single macro can't contribute more energy than
// the item's stated calories (protein/carbs ≈ 4 kcal/g, fat ≈ 9 kcal/g). KFC's
// feed occasionally publishes garbage — e.g. a 95-kcal lemonade listed at 120 g
// protein — so we drop anything that breaks physics by more than this slack.
const MACRO_CALORIE_TOLERANCE = 1.3

// Menu categories to drop wholesale — drinks aren't meal items for macro fitting.
const EXCLUDED_CATEGORIES = new Set(['Drinks'])

/** One product as it appears in the page's `__NEXT_DATA__` JSON. */
interface KfcProduct {
    name?: string
    categories?: string[]
    nutrition?: {
        kcal?: number | string
        protein?: number | string
        fat?: number | string
        carbohydrates?: number | string
    }
}

/** Result of turning one raw product into an optimizer item. */
type BuildResult =
    | { kind: 'ok'; name: string; nutrition: NutritionData }
    | { kind: 'invalid' }
    | { kind: 'implausible'; name: string }

export class KFCScraper extends SourceScraper {
    name = 'KFC'
    icon = '🍗'

    // No browser needed — this scraper is pure HTTP + JSON parsing.
    async initialize (): Promise<void> {}

    async scrape (): Promise<RestaurantData> {
        console.log(chalk.blue(`${this.icon} Scraping KFC UK (live)…`))

        const html = await this.fetchPage()
        const products = this.extractProducts(html)

        const items: RestaurantData = {}
        let invalid = 0
        let implausible = 0
        let excluded = 0
        let duplicates = 0
        let renamed = 0
        for (const product of products) {
            if (product.categories?.some((c) => EXCLUDED_CATEGORIES.has(c))) {
                excluded++
                continue
            }
            const built = this.buildItem(product)
            if (built.kind === 'ok') {
                const outcome = addItem(items, built.name, built.nutrition)
                if (outcome.kind === 'duplicate') duplicates++
                else if (outcome.kind === 'renamed') renamed++
            } else if (built.kind === 'implausible') {
                implausible++
                console.log(chalk.yellow(`  ⚠ dropped "${built.name}" — implausible macros`))
            } else {
                invalid++
            }
        }

        console.log(
            chalk.green(`✓ Found ${Object.keys(items).length} KFC items (live)`)
        )
        if (invalid > 0 || implausible > 0 || excluded > 0 || duplicates > 0 || renamed > 0) {
            console.log(
                chalk.gray(
                    `  skipped ${excluded} (excluded category), ${invalid} (missing/zero nutrition), ` +
                    `${implausible} (implausible macros), ${duplicates} (duplicate name, same macros); ` +
                    `${renamed} name collisions requalified`
                )
            )
        }
        return items
    }

    private async fetchPage (): Promise<string> {
        const response = await axios.get<string>(NUTRITION_URL, {
            headers: REQUEST_HEADERS,
            timeout: HTTP_TIMEOUT_MS,
            responseType: 'text',
            transformResponse: [(d) => d]
        })
        return response.data
    }

    /** Pulls the product list out of the page's `__NEXT_DATA__` JSON blob. */
    private extractProducts (html: string): KfcProduct[] {
        const match = html.match(
            /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
        )
        if (!match) {
            throw new Error('KFC: could not find __NEXT_DATA__ in the page')
        }

        let parsed: any
        try {
            parsed = JSON.parse(match[1])
        } catch (error) {
            throw new Error(`KFC: failed to parse __NEXT_DATA__ JSON: ${error}`)
        }

        const mainContent: any[] = parsed?.props?.pageProps?.data?.mainContent ?? []
        const table = mainContent.find((c) => c?.id === 'nutrition_allergen_table')
        const products: unknown = table?.data?.children?.products
        if (!Array.isArray(products)) {
            throw new Error('KFC: nutrition_allergen_table products not found')
        }
        return products as KfcProduct[]
    }

    /** Builds a single optimizer-shaped item, tagging why it was rejected. */
    private buildItem (product: KfcProduct): BuildResult {
        const name = product.name?.trim()
        const n = product.nutrition
        if (!name || !n) return { kind: 'invalid' }

        const calories = toNumber(n.kcal)
        const protein = toNumber(n.protein)
        const fat = toNumber(n.fat)
        const carbs = toNumber(n.carbohydrates)

        // Require usable energy; everything else (drinks with no protein, etc.)
        // is left for the optimizer to filter downstream.
        if (!Number.isFinite(calories) || calories <= 0) return { kind: 'invalid' }

        // Reject feed errors where a macro's energy exceeds the stated calories.
        const cap = calories * MACRO_CALORIE_TOLERANCE
        const p = Number.isFinite(protein) ? protein : 0
        const f = Number.isFinite(fat) ? fat : 0
        const c = Number.isFinite(carbs) ? carbs : 0
        if (p * 4 > cap || c * 4 > cap || f * 9 > cap) {
            return { kind: 'implausible', name }
        }

        return {
            kind: 'ok',
            name,
            nutrition: {
                calories,
                protein: p,
                fat: f,
                carbs: c,
                ProteinTCalRatio: p / calories,
                CarbToCalRatio: c / calories,
                category: normalizeCategory(product.categories?.[0])
            }
        }
    }
}

/** Coerces the page's string/number nutrition values (e.g. "11.00") to a number. */
function toNumber (value: number | string | undefined): number {
    if (typeof value === 'number') return value
    if (typeof value !== 'string') return NaN
    const match = value.match(/-?\d+(?:[.,]\d+)?/)
    return match ? parseFloat(match[0].replace(',', '.')) : NaN
}
