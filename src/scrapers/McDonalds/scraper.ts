import chalk from 'chalk'
import * as cheerio from 'cheerio'
import { chromium, BrowserContext } from 'playwright'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { normalizeCategory } from '../category'
import { addItem } from '../add-item'

/**
 * McDonald's UK scraper.
 *
 *  - Category pages AND item pages both go through the same Playwright
 *    browser context. Category-page HTML is static once loaded
 *    (`page.content()` straight into cheerio); item pages need a real
 *    wait, since their nutrition `<tbody>` is populated by JS after load.
 *  - Real waits on the populated rows; row-by-row parsing keyed on
 *    `.marketing-name`, picking the visible per-portion cell.
 *  - Misses are bucketed (`discontinued`, `no-nutrition-rows`, `nav-timeout`,
 *    …) so it's obvious whether the site lost an item or the scraper did.
 *
 * **Why this scraper launches its own headed browser (2026-08), unlike
 * every other Playwright-based scraper here.** CI's refresh-data.yml
 * scraped McDonald's fine every day through 2026-08-10, then every run
 * since 2026-08-11 failed — originally diagnosed as an axios timeout/IP
 * block (see git history), but that theory didn't survive contact with a
 * real test: switching category-page fetching to headless Playwright
 * *still* failed identically (`net::ERR_HTTP2_PROTOCOL_ERROR`), both with
 * the default lightweight headless-shell binary AND with the full Chromium
 * binary's newer headless architecture. Only genuinely headed mode
 * (`headless: false`) got through — verified directly, repeatedly, from
 * the same machine/IP that headless mode failed from, which rules out a
 * pure IP-based block: mcdonalds.com's Akamai WAF is fingerprinting
 * headless Chromium specifically (any variant), not blocking a source IP.
 * This also better explains why three *unrelated* networks (a sandbox, CI,
 * and Anthropic's own fetch infra) all broke on the same date — a WAF rule
 * change targeting headless automation fits that better than three
 * independent IP-blocklist hits.
 *
 * CI has no display server, so `headless: false` needs `xvfb-run` wrapping
 * the workflow step (see `.github/workflows/refresh-data.yml`) to give
 * Chromium a virtual display to render into.
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
 *
 * **Category assignment for cross-listed items (2026-08).** McDonald's own
 * site lists plenty of items under more than one category — a Saver Menu
 * cheeseburger, a chicken wrap that's also on the Chicken page. Assigning
 * whichever category's fetch happened to finish first (the original,
 * simplest approach) produced real, silently-wrong results: confirmed live,
 * wraps and salads were landing under "Chicken" instead of "Wraps & Salads"
 * depending on fetch-race timing. {@link collectItemUrls} now resolves this
 * deterministically via {@link CATEGORY_PRIORITY} and a {@link baseSlug}
 * match for size-variant siblings that aren't directly cross-listed (a Saver
 * Menu Mini McFlurry inherits "Desserts" from its regular-size sibling) —
 * see the docblocks on those two and on {@link BUNDLE_CATEGORIES}.
 */

const MENU_URL = 'https://www.mcdonalds.com/gb/en-gb/menu.html'

/**
 * Category display-text patterns to skip entirely (see docblock above for
 * why each is safe to drop). Matched against the site's own nav label, not
 * the URL slug, since that's the more stable signal across a site redesign.
 */
const EXCLUDED_CATEGORIES = /what.?s new|sauce|breakfast saver|vegetarian|vegan|happy meal|milkshake|mccaf[eé]/i

/**
 * Excluded categories that get crawled anyway — not for their items, but to
 * build a set of known-drink product URLs (see {@link baseSlug}). "Saver
 * Menu" lists its own drink options as `-small` variants (e.g.
 * `coca-cola-zero-sugar-small`) that don't appear anywhere on the real
 * drinks pages by that exact URL (those list `-medium`), so a plain
 * "is this URL in the drinks category" check misses them; comparing
 * size-stripped base slugs instead catches every size.
 */
const DRINK_PROBE_CATEGORIES = /milkshake|mccaf[eé]/i

/**
 * "Saver Menu" and "Sharers & Bundles" aren't real food-type categories —
 * they're value/format overlays on items that already have a truer category
 * elsewhere (a Saver Menu cheeseburger is still, fundamentally, a burger).
 * Ranked lowest in {@link CATEGORY_PRIORITY} and used as the trigger for
 * base-slug inheritance in {@link collectItemUrls}.
 */
const BUNDLE_CATEGORIES = new Set(['Saver Menu', 'Sharers & Bundles'])

/**
 * Tie-breaker for an item cross-listed under more than one real category
 * (confirmed live: a chicken-protein wrap or salad is listed under both
 * Chicken and Wraps & Salads). Without this, whichever category's page
 * happened to finish fetching first won — a silent, non-deterministic
 * mis-categorization (wraps landing under "Chicken") rather than a
 * considered choice. Lower index wins. Bundle categories rank last since
 * they're the ones {@link collectItemUrls} tries to route *away* from.
 */
const CATEGORY_PRIORITY = [
    'Breakfast Menu',
    'Desserts',
    'Wraps & Salads',
    'Chicken',
    'Burgers',
    'Fries & Sides',
    'Sharers & Bundles',
    'Saver Menu'
]

function categoryRank (category: string): number {
    const index = CATEGORY_PRIORITY.indexOf(category)
    return index === -1 ? CATEGORY_PRIORITY.length : index
}

/**
 * An item's product slug with any size/portion token removed — e.g.
 * `coca-cola-zero-sugar-small` and `coca-cola-zero-sugar-medium` both
 * reduce to `coca-cola-zero-sugar`; `smarties-mini-mcflurry` (Saver Menu's
 * slug order) and `smarties-mcflurry` (the regular Desserts product) both
 * reduce to `smarties-mcflurry`. Lets same-drink and same-dessert size
 * variants be matched even though each size is a genuinely distinct
 * product page with its own macros (never merged, only used to decide
 * which category label — or whether to exclude — a variant should get).
 */
const SIZE_TOKEN = /^(small|medium|large|regular|mini)$/i
function baseSlug (url: string): string {
    const match = url.match(/\/product\/([a-z0-9-]+)\.html/i)
    if (!match) return url
    return match[1]
        .split('-')
        .filter((token) => !SIZE_TOKEN.test(token))
        .join('-')
}

// A defensive per-item backstop, not the primary drinks filter — most drinks
// are already kept out by EXCLUDED_CATEGORIES, and the rest by the baseSlug
// cross-reference against DRINK_PROBE_CATEGORIES above; these catch the ones
// that still leak through some other structural path. 'salad'/'cucumber'/
// 'fish' used to be here too and were wrong: verified live that they
// excluded real food with real macros (crispy-chicken-salad,
// crispy-chicken-bacon-salad, shaker-side-salad, cucumber-sticks,
// filet-o-fish, double-filet-o-fish) — nothing about a salad or a fish
// sandwich makes it not a meal item.
const ITEM_URL_SKIP_PATTERNS = [
    'coffee',
    'latte',
    'tea',
    'smoothie',
    'slices',
    'veggie',
    'milkshake'
]

const ITEM_CONCURRENCY = 3
// Category pages are far lighter than item pages (no JS-populated table to
// wait on), so a higher concurrency is fine here without straining the
// browser the way 8-9 concurrent item scrapes might.
const CATEGORY_CONCURRENCY = 6
const NAV_TIMEOUT_MS = 25000
const NUTRITION_WAIT_MS = 12000

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

    /**
     * Overrides {@link SourceScraper.initialize} to launch a headed browser
     * instead of the shared headless one every other scraper uses — see the
     * class docblock for why. Needs `xvfb-run` in CI (no real display).
     */
    async initialize (): Promise<void> {
        this.browser = await chromium.launch({
            headless: false,
            channel: 'chromium',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        })
    }

    async scrape (): Promise<RestaurantData> {
        if (!this.browser) {
            throw new Error('Browser not initialized')
        }

        console.log(chalk.blue(`${this.icon} Loading McDonald's data...`))

        const context = await this.browser.newContext({
            viewport: { width: 1366, height: 768 },
            extraHTTPHeaders: { 'Accept-Language': 'en-GB,en;q=0.9' }
        })

        const items: RestaurantData = {}
        const missReasons = new Map<string, number>()
        const bump = (reason: string) =>
            missReasons.set(reason, (missReasons.get(reason) ?? 0) + 1)

        try {
            const allCategories = await this.discoverCategories(context)
            const categories = allCategories.filter((c) => !EXCLUDED_CATEGORIES.test(c.category))
            const drinkProbes = allCategories.filter((c) => DRINK_PROBE_CATEGORIES.test(c.category))
            const itemUrls = await this.collectItemUrls(context, categories, drinkProbes)
            console.log(
                chalk.blue(
                    `🍟 Discovered ${itemUrls.size} items across ${categories.length} categories`
                )
            )

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
     * Loads `url` in a fresh page and returns its rendered HTML — the same
     * browser-context mechanism {@link scrapeItem} already uses for item
     * pages, now shared with category-page fetching (see class docblock).
     * Retries once on `ERR_HTTP2_PROTOCOL_ERROR`, matching {@link scrapeItem}.
     */
    private async fetchHtml (
        context: BrowserContext,
        url: string,
        attempt: number = 0
    ): Promise<string> {
        const page = await context.newPage()
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
            return await page.content()
        } catch (error: any) {
            const msg = String(error?.message ?? error)
            if (msg.includes('ERR_HTTP2_PROTOCOL_ERROR') && attempt === 0) {
                await page.close().catch(() => undefined)
                return this.fetchHtml(context, url, attempt + 1)
            }
            throw error
        } finally {
            await page.close().catch(() => undefined)
        }
    }

    /**
     * Crawls {@link MENU_URL}'s left-nav for every category link, unfiltered
     * — the caller splits the result into the categories actually scraped
     * for items ({@link EXCLUDED_CATEGORIES}) and the ones only probed for
     * known-drink slugs ({@link DRINK_PROBE_CATEGORIES}). Replaces a
     * hard-coded list so a category McDonald's adds later shows up without
     * a code change — see the class docblock for what's excluded and why.
     */
    private async discoverCategories (context: BrowserContext): Promise<Array<{ url: string; category: string }>> {
        try {
            const html = await this.fetchHtml(context, MENU_URL)
            const $ = cheerio.load(html)
            const seen = new Set<string>()
            const categories: Array<{ url: string; category: string }> = []
            $('a[href*="/menu/"]').each((_, el) => {
                const href = $(el).attr('href')
                const text = cleanCategoryText($(el).text())
                if (!href || !text) return
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

    /** Every `.cmp-category__item` product link on `categoryUrl`, as absolute URLs. */
    private async fetchCategoryItemUrls (context: BrowserContext, categoryUrl: string): Promise<string[]> {
        const html = await this.fetchHtml(context, categoryUrl)
        const $ = cheerio.load(html)
        const urls: string[] = []
        $('.cmp-category__item a[href]').each((_, el) => {
            const href = $(el).attr('href')
            if (!href) return
            const abs = new URL(href, categoryUrl).toString()
            if (abs.includes('/product/')) urls.push(abs)
        })
        return urls
    }

    /**
     * Item URL → its display category. An item cross-listed under more than
     * one category (confirmed live — chicken-protein wraps/salads appear
     * under both Chicken and Wraps & Salads) is resolved by
     * {@link CATEGORY_PRIORITY}, not by which page happened to fetch first.
     * A {@link BUNDLE_CATEGORIES} item with no direct cross-listing (a Saver
     * Menu cheeseburger isn't literally listed under Burgers too) still
     * inherits a real category if its {@link baseSlug} matches one — e.g. a
     * Mini McFlurry sold only via Saver Menu gets "Desserts", the same
     * category its regular-size sibling already has. Drinks are excluded
     * outright via the same base-slug match against `drinkProbes`.
     */
    private async collectItemUrls (
        context: BrowserContext,
        categories: Array<{ url: string; category: string }>,
        drinkProbes: Array<{ url: string; category: string }>
    ): Promise<Map<string, string>> {
        const drinkBaseSlugs = new Set<string>()
        await this.runWithConcurrency(drinkProbes, CATEGORY_CONCURRENCY, async ({ url }) => {
            try {
                const urls = await this.fetchCategoryItemUrls(context, url)
                for (const itemUrl of urls) drinkBaseSlugs.add(baseSlug(itemUrl))
            } catch (error: any) {
                console.log(
                    chalk.yellow(`  ⚠ drink-probe fetch failed for ${url}: ${error?.message ?? error}`)
                )
            }
        })

        const rawEntries: Array<{ url: string; category: string }> = []
        await this.runWithConcurrency(categories, CATEGORY_CONCURRENCY, async ({ url: categoryUrl, category }) => {
            try {
                const urls = await this.fetchCategoryItemUrls(context, categoryUrl)
                for (const itemUrl of urls) {
                    if (this.shouldSkip(itemUrl)) continue
                    if (drinkBaseSlugs.has(baseSlug(itemUrl))) continue
                    rawEntries.push({ url: itemUrl, category })
                }
            } catch (error: any) {
                console.log(
                    chalk.yellow(`  ⚠ category fetch failed for ${categoryUrl}: ${error?.message ?? error}`)
                )
            }
        })

        const urlCategories = new Map<string, string>()
        for (const { url, category } of rawEntries) {
            const existing = urlCategories.get(url)
            if (!existing || categoryRank(category) < categoryRank(existing)) {
                urlCategories.set(url, category)
            }
        }

        const baseSlugToCategory = new Map<string, string>()
        for (const [url, category] of urlCategories) {
            if (BUNDLE_CATEGORIES.has(category)) continue
            const slug = baseSlug(url)
            const existing = baseSlugToCategory.get(slug)
            if (!existing || categoryRank(category) < categoryRank(existing)) {
                baseSlugToCategory.set(slug, category)
            }
        }
        for (const [url, category] of urlCategories) {
            if (!BUNDLE_CATEGORIES.has(category)) continue
            const inherited = baseSlugToCategory.get(baseSlug(url))
            if (inherited) urlCategories.set(url, inherited)
        }

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
