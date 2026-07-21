import chalk from 'chalk'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { normalizeCategory } from '../category'
import { addItem } from '../add-item'
import { parseNumber } from '../parse-number'
import { ITSU_PRODUCT_QUERY } from './query'

/**
 * Live itsu UK scraper.
 *
 * itsu has no single menu-data endpoint: the menu page
 * (`https://www.itsu.com/menu/`) is a static listing of `<a
 * class="base-lined-card product-listing-card">` cards, one per item, each
 * linking to that item's own page. The actual nutrition lives behind a
 * GraphQL call every product page makes to `cms.itsu.com/graphql`
 * (`DynamicPage`, keyed by the item's `uri`) — so this scraper fetches the
 * listing HTML for the set of product URIs, then issues one GraphQL request
 * per item.
 *
 * The `cms.itsu.com` endpoint allowlists queries by exact document shape: a
 * trimmed-down query asking only for the handful of fields this scraper
 * needs is syntactically valid and returns *no error*, but silently resolves
 * to zero results. Only the full `DynamicPage` document — every fragment the
 * site's own product page requests, unmodified — gets real data back, so
 * {@link ITSU_PRODUCT_QUERY} is that document verbatim; only the `product`
 * selection inside `ProductPageTemplate` is what this scraper actually reads.
 *
 * The bearer token below isn't a secret: it's shipped in the public,
 * unauthenticated `/menu/` page HTML and sent by every visitor's browser.
 */

const MENU_PAGE_URL = 'https://www.itsu.com/menu/'
const GRAPHQL_URL = 'https://cms.itsu.com/graphql'
const SITE_DOMAIN = 'www.itsu.com'

const CMS_BEARER_TOKEN =
    '6f2a3511d08218eb6f97edbce153cb9bff6232dc409b4a9e2eb30eb3d96fa5cc426b3407cd7ee52d0cd2f30a12f4b1f32c415f5850dc3dd78edec0b973ed827bc2cfc538413960b46dd4f8887fc1e85aaff17a2d527f1af93575d65dd3b311ef5da95288f6027ad0eff811a27333b731bdce1e152c9d894d1cbef9788f5f3a80'

const REQUEST_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    Accept: 'text/html,application/json,*/*',
    Origin: 'https://www.itsu.com',
    Referer: 'https://www.itsu.com/'
}

const HTTP_TIMEOUT_MS = 20000

// Product pages are fetched one GraphQL call at a time; this caps how many
// are in flight together so ~130 items don't all hit the CMS at once.
const CONCURRENCY = 6

// A single macro can't contribute more energy than the item's stated
// calories (protein/carbs ≈ 4 kcal/g, fat ≈ 9 kcal/g); drop feed errors that
// break this by more than this slack.
const MACRO_CALORIE_TOLERANCE = 1.3

interface ItsuProduct {
    marketing_title?: string
    calories?: string
    fat?: string
    protein?: string
    carbs?: string
    category?: { name?: string }
}

interface ItsuProductPageTemplate {
    __typename: 'ComponentPageTemplatesProductPageTemplate'
    product?: ItsuProduct
}

interface ItsuPage {
    title?: string
    components?: Array<{ __typename: string } & Partial<ItsuProductPageTemplate>>
}

interface ItsuGraphQLResponse {
    data?: { pages?: ItsuPage[] }
    errors?: Array<{ message: string }>
}

/** Trims and collapses the internal whitespace the source data litters names with. */
function clean (value: string | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim()
}

function buildNutrition (product: ItsuProduct): NutritionData | 'implausible' | null {
    const calories = parseNumber(product.calories)
    if (!Number.isFinite(calories) || calories <= 0) return null

    const protein = parseNumber(product.protein) || 0
    const fat = parseNumber(product.fat) || 0
    const carbs = parseNumber(product.carbs) || 0

    const cap = calories * MACRO_CALORIE_TOLERANCE
    if (protein * 4 > cap || carbs * 4 > cap || fat * 9 > cap) return 'implausible'

    return {
        calories,
        protein,
        fat,
        carbs,
        ProteinTCalRatio: protein / calories,
        CarbToCalRatio: carbs / calories,
        category: normalizeCategory(product.category?.name)
    }
}

/** Runs `fn` over `items` with at most `limit` calls in flight at once. */
async function mapWithConcurrency<T, R> (
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let next = 0
    async function worker (): Promise<void> {
        while (next < items.length) {
            const i = next++
            results[i] = await fn(items[i])
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
    return results
}

export class ItsuScraper extends SourceScraper {
    name = 'itsu'
    icon = '🍱'

    // No browser needed — this scraper is pure HTTP + JSON parsing.
    async initialize (): Promise<void> {}

    async scrape (): Promise<RestaurantData> {
        console.log(chalk.blue(`${this.icon} Scraping itsu UK (live)…`))

        const uris = await this.fetchProductUris()
        const products = await mapWithConcurrency(uris, CONCURRENCY, (uri) => this.fetchProduct(uri))

        const items: RestaurantData = {}
        let invalid = 0
        let implausible = 0
        let duplicates = 0
        let renamed = 0

        for (const product of products) {
            if (!product) {
                invalid++
                continue
            }
            const name = clean(product.marketing_title)
            if (!name) {
                invalid++
                continue
            }

            const built = buildNutrition(product)
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

        console.log(chalk.green(`✓ Found ${Object.keys(items).length} itsu items (live)`))
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

    /** Scrapes the menu listing page for every product card's URI. */
    private async fetchProductUris (): Promise<string[]> {
        const response = await axios.get<string>(MENU_PAGE_URL, {
            headers: REQUEST_HEADERS,
            timeout: HTTP_TIMEOUT_MS,
            responseType: 'text'
        })
        const $ = cheerio.load(response.data)
        const uris = new Set<string>()
        $('a.base-lined-card.product-listing-card').each((_, el) => {
            const href = $(el).attr('href')
            if (href) uris.add(href)
        })
        return Array.from(uris)
    }

    /** Fetches one product's nutrition via the CMS GraphQL endpoint. Returns `null` on any failure. */
    private async fetchProduct (uri: string): Promise<ItsuProduct | null> {
        try {
            const response = await axios.post<ItsuGraphQLResponse>(
                GRAPHQL_URL,
                {
                    query: ITSU_PRODUCT_QUERY,
                    variables: { locale: 'en', site: SITE_DOMAIN, path: uri, uri },
                    operationName: 'DynamicPage'
                },
                {
                    headers: {
                        ...REQUEST_HEADERS,
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${CMS_BEARER_TOKEN}`
                    },
                    timeout: HTTP_TIMEOUT_MS
                }
            )
            if (response.data.errors?.length) {
                console.log(chalk.yellow(`  ⚠ "${uri}" — GraphQL error: ${response.data.errors[0].message}`))
                return null
            }
            const page = response.data.data?.pages?.[0]
            const template = page?.components?.find(
                (c): c is ItsuProductPageTemplate & { __typename: 'ComponentPageTemplatesProductPageTemplate' } =>
                    c.__typename === 'ComponentPageTemplatesProductPageTemplate'
            )
            return template?.product ?? null
        } catch (error) {
            console.log(chalk.yellow(`  ⚠ "${uri}" — request failed: ${error}`))
            return null
        }
    }
}
