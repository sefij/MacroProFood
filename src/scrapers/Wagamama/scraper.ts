import chalk from 'chalk'
import axios from 'axios'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { parseNumber } from '../parse-number'

/**
 * Live Wagamama UK scraper.
 *
 * The menu page is a Nuxt app that server-renders the *entire* menu into a
 * `<script id="__NUXT_DATA__">` payload, so a single HTTP GET yields every item
 * — no need to click through category tabs or parse HTML containers.
 *
 * That payload is in Nuxt's "devalue" format: a flat array where every value is
 * an integer index into the same array (so the object graph is deduplicated).
 * We resolve those references, then pick out item objects — they carry a `Name`
 * and a `Nutrs` array of `{ Desc, PerServ }` rows (per-serving nutrition).
 */

const MENU_URL = 'https://www.wagamama.com/menu'

const REQUEST_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.8'
}

const HTTP_TIMEOUT_MS = 20000

// A single macro can't contribute more energy than the item's stated calories
// (protein/carbs ≈ 4 kcal/g, fat ≈ 9 kcal/g); drop feed errors that break this.
const MACRO_CALORIE_TOLERANCE = 1.3

// Menu categories to drop wholesale — drinks aren't meal items for macro fitting.
// Matched against category names like "soft drinks", "freshly made juices",
// "cocktails", "beers + cider", "wine + sake", "coffee + tea".
const DRINK_CATEGORY =
    /\b(drinks?|juices?|cocktails?|beers?|cider|wine|sake|coffee|tea|lemonade|smoothies?|soda)\b/i

/** A raw item object as it appears (pre-resolution) in the Nuxt payload. */
interface WagaItem {
    Name?: number
    Nutrs?: number
}

/** A resolved nutrition row, e.g. `{ Desc: "protein (g)", PerServ: "68.6" }`. */
interface NutrRow {
    Desc?: string
    PerServ?: string | number
}

/** Result of turning one raw item into an optimizer item. */
type BuildResult =
    | { kind: 'ok'; name: string; nutrition: NutritionData }
    | { kind: 'invalid' }
    | { kind: 'excluded' }
    | { kind: 'implausible'; name: string }

export class WagamamaScraper extends SourceScraper {
    name = 'Wagamama'
    icon = '🍜'

    // No browser needed — this scraper is pure HTTP + JSON parsing.
    async initialize (): Promise<void> {}

    async scrape (): Promise<RestaurantData> {
        console.log(chalk.blue(`${this.icon} Scraping Wagamama UK (live)…`))

        const html = await this.fetchPage()
        const payload = this.extractPayload(html)
        const drinkNames = this.collectDrinkNames(payload)

        const items: RestaurantData = {}
        let invalid = 0
        let implausible = 0
        let excluded = 0
        for (const raw of this.findItems(payload)) {
            const built = this.buildItem(payload, raw, drinkNames)
            if (built.kind === 'ok') {
                items[built.name] = built.nutrition
            } else if (built.kind === 'excluded') {
                excluded++
            } else if (built.kind === 'implausible') {
                implausible++
                console.log(chalk.yellow(`  ⚠ dropped "${built.name}" — implausible macros`))
            } else {
                invalid++
            }
        }

        console.log(
            chalk.green(`✓ Found ${Object.keys(items).length} Wagamama items (live)`)
        )
        if (invalid > 0 || implausible > 0 || excluded > 0) {
            console.log(
                chalk.gray(
                    `  skipped ${excluded} (drink category), ` +
                    `${invalid} (no/zero nutrition), ${implausible} (implausible macros)`
                )
            )
        }
        return items
    }

    private async fetchPage (): Promise<string> {
        const response = await axios.get<string>(MENU_URL, {
            headers: REQUEST_HEADERS,
            timeout: HTTP_TIMEOUT_MS,
            responseType: 'text',
            transformResponse: [(d) => d]
        })
        return response.data
    }

    /** Pulls the `__NUXT_DATA__` devalue array out of the page. */
    private extractPayload (html: string): unknown[] {
        const match = html.match(
            /<script type="application\/json" id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
        )
        if (!match) {
            throw new Error('Wagamama: could not find __NUXT_DATA__ in the page')
        }
        let parsed: unknown
        try {
            parsed = JSON.parse(match[1])
        } catch (error) {
            throw new Error(`Wagamama: failed to parse __NUXT_DATA__ JSON: ${error}`)
        }
        if (!Array.isArray(parsed)) {
            throw new Error('Wagamama: __NUXT_DATA__ is not an array')
        }
        return parsed
    }

    /** Item objects are the ones carrying both a `Name` and a `Nutrs` array. */
    private findItems (payload: unknown[]): WagaItem[] {
        const items: WagaItem[] = []
        for (const entry of payload) {
            if (
                entry !== null &&
                typeof entry === 'object' &&
                !Array.isArray(entry) &&
                'Name' in entry &&
                'Nutrs' in entry
            ) {
                items.push(entry as WagaItem)
            }
        }
        return items
    }

    /**
     * Walks every drink-titled menu category and returns the lowercased names of
     * the items inside them. Wagamama only ever lists a drink under a drink
     * category, so membership is a safe exclusion key (no food collides).
     */
    private collectDrinkNames (payload: unknown[]): Set<string> {
        const names = new Set<string>()
        const visited = new Set<number>()
        for (const entry of payload) {
            if (
                entry === null ||
                typeof entry !== 'object' ||
                Array.isArray(entry) ||
                !('Recipes' in entry) ||
                !('Sections' in entry) ||
                !('Name' in entry)
            ) {
                continue
            }
            const categoryName = resolveRef(payload, (entry as { Name: unknown }).Name)
            if (typeof categoryName === 'string' && DRINK_CATEGORY.test(categoryName)) {
                collectItemNames(payload, entry, names, visited)
            }
        }
        return names
    }

    private buildItem (
        payload: unknown[],
        raw: WagaItem,
        drinkNames: Set<string>
    ): BuildResult {
        const name = String(resolveRef(payload, raw.Name) ?? '').trim()
        const nutrs = resolveRef(payload, raw.Nutrs)
        if (!name || !Array.isArray(nutrs)) return { kind: 'invalid' }
        if (drinkNames.has(name.toLowerCase())) return { kind: 'excluded' }

        const rows = nutrs as NutrRow[]
        const calories = macro(rows, /energy \(kcal\)/i)
        const protein = macro(rows, /^protein \(g\)/i)
        const carbs = macro(rows, /^carb \(g\)/i)
        const fat = macro(rows, /^fat \(g\)/i)

        if (!Number.isFinite(calories) || calories <= 0) return { kind: 'invalid' }

        const cap = calories * MACRO_CALORIE_TOLERANCE
        const p = Number.isFinite(protein) ? protein : 0
        const c = Number.isFinite(carbs) ? carbs : 0
        const f = Number.isFinite(fat) ? fat : 0
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
                CarbToCalRatio: c / calories
            }
        }
    }
}

/**
 * Resolves a Nuxt "devalue" reference: every structural value is an integer
 * index into the flat payload array. Primitives are returned as-is; objects and
 * arrays are resolved recursively. A depth bound guards against reference cycles.
 */
function resolveRef (
    payload: unknown[],
    ref: unknown,
    depth = 0,
    maxDepth = 12
): unknown {
    if (typeof ref !== 'number') return ref
    if (ref < 0 || depth > maxDepth) return undefined
    const value = payload[ref]
    if (value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) {
        return value.map((v) => resolveRef(payload, v, depth + 1, maxDepth))
    }
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
        out[key] = resolveRef(payload, (value as Record<string, unknown>)[key], depth + 1, maxDepth)
    }
    return out
}

/**
 * Walks a devalue subtree (following index references, with a visited guard for
 * cycles) and records the `Name` of every item object (one carrying `Nutrs`).
 */
function collectItemNames (
    payload: unknown[],
    node: unknown,
    out: Set<string>,
    visited: Set<number>,
    depth = 0
): void {
    if (depth > 16) return
    if (typeof node === 'number') {
        if (node < 0 || visited.has(node)) return
        visited.add(node)
        collectItemNames(payload, payload[node], out, visited, depth + 1)
        return
    }
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
        for (const child of node) collectItemNames(payload, child, out, visited, depth + 1)
        return
    }
    const obj = node as Record<string, unknown>
    if ('Name' in obj && 'Nutrs' in obj) {
        const name = resolveRef(payload, obj.Name)
        if (typeof name === 'string') out.add(name.trim().toLowerCase())
    }
    for (const key of Object.keys(obj)) {
        collectItemNames(payload, obj[key], out, visited, depth + 1)
    }
}

/** Reads a per-serving macro value from the resolved `Nutrs` rows. */
function macro (rows: NutrRow[], label: RegExp): number {
    const row = rows.find((r) => label.test(String(r?.Desc ?? '')))
    return row ? parseNumber(row.PerServ) : NaN
}
