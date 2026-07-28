/**
 * Deliveroo's Five Guys Oxford Circus listing → the raw candidate dish list
 * (spec 11's "dishes" half), read from the page's `__NEXT_DATA__` blob.
 *
 * Mirrors Chipotle's Deliveroo reader (../Chipotle/deliveroo.ts) — same
 * approach, same shape of data — but only the named, pre-composed dish list
 * is pulled here; Five Guys' build-your-own modifier tree isn't consumed by
 * anything in this project yet, so it isn't extracted.
 *
 * The page 403s without a `fulfillment_method` + `geohash` query pair
 * (verified live, same as Chipotle) — those encode a specific branch, not a
 * session. Five Guys UK's menu doesn't vary by branch the way some chains'
 * does, so one representative branch (Oxford Circus, Soho) stands in for the
 * whole country.
 *
 * Deliveroo also publishes a `productMeta` calorie figure directly on each
 * named dish here (Chipotle's listings don't carry one) — `recipes.ts`'s
 * docblock uses it as an independent cross-check on every hand-built recipe,
 * but this module doesn't read or expose it; it's a one-time verification
 * aid, not something the running scraper needs.
 */

import axios from 'axios'
import * as cheerio from 'cheerio'

const MENU_URL =
    'https://deliveroo.co.uk/menu/london/soho/five-guys-oxford-circus?fulfillment_method=delivery&geohash=gcpvhf09z'

const REQUEST_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    Accept: 'text/html,*/*'
}

const HTTP_TIMEOUT_MS = 30000

/** One named, pre-composed Deliveroo listing with its marketing-copy ingredient description. */
export interface DeliverooDish {
    name: string
    description: string
}

interface DeliverooRootItem {
    name?: string
    description?: string
}

interface NextData {
    props?: {
        initialState?: {
            menuPage?: {
                menu?: {
                    metas?: {
                        root?: {
                            items?: DeliverooRootItem[]
                        }
                    }
                }
            }
        }
    }
}

/** A description that carries no real information — a backend placeholder or a bare data-entry glitch, not ingredient text. */
function isJunkDescription (description: string): boolean {
    return description === 'None' || /^[\d.]+$/.test(description)
}

/**
 * Parses the menu page's raw HTML into its named, pre-composed dish list.
 * Pure and synchronous so it's unit-testable without a network call — see
 * {@link fetchDeliverooDishes} for the live entry point.
 */
export function parseDeliverooDishes (html: string): Map<string, DeliverooDish> {
    const $ = cheerio.load(html)
    const script = $('#__NEXT_DATA__').html()
    if (!script) {
        throw new Error('Five Guys (Deliveroo): __NEXT_DATA__ script not found on the menu page')
    }

    const data = JSON.parse(script) as NextData
    const items = data.props?.initialState?.menuPage?.menu?.metas?.root?.items ?? []

    const dishes = new Map<string, DeliverooDish>()
    for (const item of items) {
        const name = item.name?.trim()
        const description = item.description?.trim()
        if (!name || !description || isJunkDescription(description)) continue
        // First occurrence wins for an exact repeat name (matches every other scraper's convention).
        if (!dishes.has(name)) dishes.set(name, { name, description })
    }
    return dishes
}

/** Fetches the menu page and returns every listing that carries a fixed-composition description. */
export async function fetchDeliverooDishes (): Promise<Map<string, DeliverooDish>> {
    const response = await axios.get<string>(MENU_URL, {
        headers: REQUEST_HEADERS,
        timeout: HTTP_TIMEOUT_MS,
        responseType: 'text'
    })
    return parseDeliverooDishes(response.data)
}
