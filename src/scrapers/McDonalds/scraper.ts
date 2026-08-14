import chalk from 'chalk'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { BrowserContext } from 'playwright'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { normalizeCategory } from '../category'
import { addItem } from '../add-item'

/**
 * McDonald's UK scraper.
 *
 *  - Category pages: HTTP + cheerio (item links are in static markup).
 *  - Item pages: one shared browser context with a bounded page pool, since
 *    the nutrition `<tbody>` is populated by JS after load.
 *  - Real waits on the populated rows; row-by-row parsing keyed on
 *    `.marketing-name`, picking the visible per-portion cell.
 *  - Misses are bucketed (`discontinued`, `no-nutrition-rows`, `nav-timeout`,
 *    …) so it's obvious whether the site lost an item or the scraper did.
 *
 * **Category discovery.** The left-nav on {@link MENU_URL} is crawled live
 * rather than hard-coding each category page — confirmed against a live
 * pull (2026-08) that the hard-coded list had drifted: it was missing
 * Breakfast Menu entirely (22 items — a whole meal period), and its "Happy
 * Meal" entry pointed at a page whose items live under `/meal/...` rather
 * than `/product/...`, so it silently contributed zero items every run.
 * {@link EXCLUDED_CATEGORIES} skips categories confirmed to add no unique
 * items: "What's New" (every item is cross-listed on its real category
 * page — verified directly, e.g. the "hot-honey-mccrispy" What's New entry
 * is also linked from Chicken), "Sauces" (condiments, consistent with every
 * other scraper's exclusion), "Breakfast Saver Menu"/"Vegetarian"/"Vegan"
 * (each a strict subset of items already covered by a real category — e.g.
 * every Vegetarian item is also on Burgers/Fries & Sides/Desserts), "Happy
 * Meal" (its `/meal/...` bundle pages carry no macro breakdown at all, but
 * every component — the burger, the fries, the drink — is already scraped
 * individually under its own real category), and the two purely-beverage
 * categories "Milkshakes & Cold Drinks"/"McCafé".
 */

const MENU_URL = 'https://www.mcdonalds.com/gb/en-gb/menu.html'

/**
 * Category display-text patterns to skip entirely (see docblock above for
 * why each is safe to drop). Matched against the site's own nav label, not
 * the URL slug, since that's the more stable signal across a site redesign.
 */
const EXCLUDED_CATEGORIES = /what.?s new|sauce|breakfast saver|vegetarian|vegan|happy meal|milkshake|mccaf[eé]/i

const ITEM_URL_SKIP_PATTERNS = [
    'coffee',
    'latte',
    'tea',
    'smoothie',
    'slices',
    'veggie',
    'milkshake',
    'salad',
    'cucumber',
    'fish'
]

const REQUEST_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    'Accept-Language': 'en-GB,en;q=0.9'
}

const ITEM_CONCURRENCY = 3
const NAV_TIMEOUT_MS = 25000
const NUTRITION_WAIT_MS = 12000
const HTTP_TIMEOUT_MS = 15000

const NUTRITION_ROWS_SELECTOR =
    '.cmp-nutrition-summary--secondary-table-without-allergens tbody tr, ' +
    '.cmp-nutrition-summary--secondary-table tbody tr'

const NAME_SELECTORS = [
    'span.cmp-product-details-main__heading-title',
    '.cmp-product-details-main__heading-title',
    'h1.cmp-product-details-main__heading'
]

interface ParsedNutrition {
    calories: number
    protein: number
    fat: number
    carbs: number
}

export class McDonaldsScraper extends SourceScraper {
    icon = '🍟'

    async scrape (): Promise<RestaurantData> {
        if (!this.browser) {
            throw new Error('Browser not initialized')
        }

        console.log(chalk.blue(`${this.icon} Loading McDonald's data...`))

        const categories = await this.discoverCategories()
        const itemUrls = await this.collectItemUrls(categories)
        console.log(
            chalk.blue(
                `🍟 Discovered ${itemUrls.size} items across ${categories.length} categories`
            )
        )

        const items: RestaurantData = {}
        const missReasons = new Map<string, number>()
        const bump = (reason: string) =>
            missReasons.set(reason, (missReasons.get(reason) ?? 0) + 1)

        const context = await this.browser.newContext({
            viewport: { width: 1366, height: 768 }
        })

        try {
            await this.runWithConcurrency(
                Array.from(itemUrls),
                ITEM_CONCURRENCY,
                async ([itemUrl, category]) => {
                    const result = await this.scrapeItem(context, itemUrl)
                    if (result.kind === 'ok') {
                        const outcome = addItem(items, result.name, this.buildNutritionData(result.nutrition, category))
                        if (outcome.kind === 'duplicate') bump('duplicate-name')
                        else if (outcome.kind === 'renamed') bump('name-collision-requalified')
                    } else {
                        bump(result.reason)
                    }
                }
            )
        } finally {
            await context.close()
        }

        console.log(
            chalk.green(`✓ Found ${Object.keys(items).length} McDonald's items`)
        )
        if (missReasons.size > 0) {
            const summary = Array.from(missReasons.entries())
                .map(([reason, count]) => `${reason}=${count}`)
                .join(', ')
            console.log(chalk.gray(`  misses: ${summary}`))
        }
        return items
    }

    /**
     * Crawls {@link MENU_URL}'s left-nav for category pages, skipping the
     * ones matched by {@link EXCLUDED_CATEGORIES}. Replaces a hard-coded
     * list so a category McDonald's adds later shows up without a code
     * change — see the class docblock for what's excluded and why.
     */
    private async discoverCategories (): Promise<Array<{ url: string; category: string }>> {
        try {
            const response = await axios.get<string>(MENU_URL, {
                headers: REQUEST_HEADERS,
                timeout: HTTP_TIMEOUT_MS,
                responseType: 'text',
                transformResponse: [(d) => d]
            })
            const $ = cheerio.load(response.data)
            const seen = new Set<string>()
            const categories: Array<{ url: string; category: string }> = []
            $('a[href*="/menu/"]').each((_, el) => {
                const href = $(el).attr('href')
                const text = cleanCategoryText($(el).text())
                if (!href || !text || EXCLUDED_CATEGORIES.test(text)) return
                const abs = new URL(href, MENU_URL).toString()
                if (seen.has(abs)) return
                seen.add(abs)
                categories.push({ url: abs, category: text })
            })
            return categories
        } catch (error: any) {
            console.log(
                chalk.yellow(`  ⚠ category discovery failed: ${error?.message ?? error}`)
            )
            return []
        }
    }

    /** Item URL → its display category (first category wins if listed twice). */
    private async collectItemUrls (
        categories: Array<{ url: string; category: string }>
    ): Promise<Map<string, string>> {
        const urlCategories = new Map<string, string>()

        await Promise.all(
            categories.map(async ({ url: categoryUrl, category }) => {
                try {
                    const response = await axios.get<string>(categoryUrl, {
                        headers: REQUEST_HEADERS,
                        timeout: HTTP_TIMEOUT_MS,
                        responseType: 'text',
                        transformResponse: [(d) => d]
                    })
                    const $ = cheerio.load(response.data)
                    $('.cmp-category__item a[href]').each((_, el) => {
                        const href = $(el).attr('href')
                        if (!href) return
                        const abs = new URL(href, categoryUrl).toString()
                        if (!abs.includes('/product/')) return
                        if (this.shouldSkip(abs)) return
                        if (!urlCategories.has(abs)) urlCategories.set(abs, category)
                    })
                } catch (error: any) {
                    console.log(
                        chalk.yellow(
                            `  ⚠ category fetch failed for ${categoryUrl}: ${error?.message ?? error}`
                        )
                    )
                }
            })
        )

        return urlCategories
    }

    private shouldSkip (url: string): boolean {
        const lower = url.toLowerCase()
        return ITEM_URL_SKIP_PATTERNS.some((p) => lower.includes(p))
    }

    private async scrapeItem (
        context: BrowserContext,
        itemUrl: string,
        attempt: number = 0
    ): Promise<
        | { kind: 'ok'; name: string; nutrition: ParsedNutrition }
        | { kind: 'miss'; reason: string }
    > {
        const page = await context.newPage()
        try {
            try {
                await page.goto(itemUrl, {
                    waitUntil: 'domcontentloaded',
                    timeout: NAV_TIMEOUT_MS
                })
            } catch (navError: any) {
                const msg = String(navError?.message ?? navError)
                // ERR_HTTP2_PROTOCOL_ERROR is flaky on McDonald's CDN under
                // a shared connection — one retry usually clears it.
                if (msg.includes('ERR_HTTP2_PROTOCOL_ERROR') && attempt === 0) {
                    await page.close().catch(() => undefined)
                    return this.scrapeItem(context, itemUrl, attempt + 1)
                }
                throw navError
            }

            // Discontinued products redirect to /latest/changes.html
            // ("Sorry it's gone, but not forgotten").
            if (page.url().includes('/latest/changes.html')) {
                return { kind: 'miss', reason: 'discontinued' }
            }

            try {
                await page.waitForSelector(NUTRITION_ROWS_SELECTOR, {
                    timeout: NUTRITION_WAIT_MS
                })
            } catch {
                return { kind: 'miss', reason: 'no-nutrition-rows' }
            }

            const extracted = await page.evaluate(
                ({ nameSelectors, rowSelector }) => {
                    const name = (() => {
                        for (const sel of nameSelectors) {
                            const el = document.querySelector(sel)
                            const text = el?.textContent?.trim()
                            if (text) return text
                        }
                        return null
                    })()

                    const rows = Array.from(document.querySelectorAll(rowSelector))
                    const pairs: Array<{ label: string; perPortion: string }> = []
                    for (const row of rows) {
                        const labelEl =
                            row.querySelector('.marketing-name') ??
                            row.querySelector('th')
                        const label = labelEl?.textContent?.trim() ?? ''
                        // Two .value cells: per-100g (d-none) and per-portion
                        // (visible). Take the visible one; fall back to last td.
                        const valueCells = Array.from(
                            row.querySelectorAll('td.value')
                        ) as HTMLElement[]
                        const visible = valueCells.find(
                            (c) => !c.classList.contains('d-none')
                        )
                        const perPortion = (visible ?? valueCells[valueCells.length - 1])
                            ?.textContent?.trim() ?? ''
                        if (label) pairs.push({ label, perPortion })
                    }
                    return { name, pairs }
                },
                { nameSelectors: NAME_SELECTORS, rowSelector: NUTRITION_ROWS_SELECTOR }
            )

            if (!extracted.name) {
                return { kind: 'miss', reason: 'no-name' }
            }

            const nutrition = pickNutrition(extracted.pairs)
            if (!nutrition) {
                return { kind: 'miss', reason: 'no-macro-rows' }
            }

            if (nutrition.calories <= 0 && nutrition.protein <= 0) {
                return { kind: 'miss', reason: 'zero-values' }
            }

            return { kind: 'ok', name: extracted.name, nutrition }
        } catch (error: any) {
            const message = String(error?.message ?? error)
            if (message.includes('Timeout')) return { kind: 'miss', reason: 'nav-timeout' }
            return { kind: 'miss', reason: 'page-error' }
        } finally {
            await page.close().catch(() => undefined)
        }
    }

    private buildNutritionData (n: ParsedNutrition, category?: string): NutritionData {
        return {
            calories: n.calories,
            protein: n.protein,
            fat: n.fat,
            carbs: n.carbs,
            ProteinTCalRatio: n.calories > 0 ? n.protein / n.calories : 0,
            CarbToCalRatio: n.calories > 0 ? n.carbs / n.calories : 0,
            category: normalizeCategory(category)
        }
    }

    private async runWithConcurrency<T> (
        items: T[],
        limit: number,
        worker: (item: T) => Promise<void>
    ): Promise<void> {
        let index = 0
        const runners = Array.from(
            { length: Math.min(limit, items.length) },
            async () => {
                while (index < items.length) {
                    const i = index++
                    await worker(items[i])
                }
            }
        )
        await Promise.all(runners)
    }
}

/** Strips trademark/registered symbols the site bakes into nav labels ("Saver Menu®"). */
function cleanCategoryText (raw: string): string {
    return raw.replace(/[®™]/g, '').replace(/\s+/g, ' ').trim()
}

function pickNutrition (
    pairs: Array<{ label: string; perPortion: string }>
): ParsedNutrition | null {
    const find = (regex: RegExp): number => {
        // Exclude "of which" rows so we get base macros, not sub-rows.
        const hit = pairs.find(
            (p) => regex.test(p.label) && !/of which/i.test(p.label)
        )
        return hit ? parseNumber(hit.perPortion) : NaN
    }

    const calories = find(/energy[^()]*\(kcal\)/i)
    const protein = find(/^protein/i)
    const fat = find(/^fat/i)
    const carbs = find(/^carbohydrate/i)

    const macros = [calories, protein, fat, carbs]
    if (!macros.some(Number.isFinite)) return null

    return {
        calories: Number.isFinite(calories) ? calories : 0,
        protein: Number.isFinite(protein) ? protein : 0,
        fat: Number.isFinite(fat) ? fat : 0,
        carbs: Number.isFinite(carbs) ? carbs : 0
    }
}

function parseNumber (value: string): number {
    const match = value.match(/-?\d+(?:[.,]\d+)?/)
    if (!match) return NaN
    return parseFloat(match[0].replace(',', '.'))
}
