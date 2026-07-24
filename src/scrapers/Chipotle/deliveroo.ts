/**
 * Deliveroo's Chipotle Islington listing → two things this app needs, both
 * pulled from the same `__NEXT_DATA__` blob:
 *
 *  1. **The raw candidate dish list** ({@link dishesFromRoot}) — named,
 *     pre-composed listings with a fixed-composition description, the
 *     "dishes" half of spec 11's architecture.
 *  2. **The live build-your-own choice tree** ({@link DeliverooModifierGroup}
 *     et al.) — spec 12's data source for Chipotle's actual ordering flow
 *     (Protein → Rice → Beans → Toppings, …), consumed by `buildable.ts`.
 *
 * Chipotle is a build-your-own concept, so most of the menu's ~140 raw
 * listings are scaffolding (the format itself — "Burrito", "Bowl",
 * "Quesadilla" — plus every protein/topping choice re-listed as its own
 * zero-macro modifier option). A smaller set (~60) *are* named, pre-composed
 * dishes — "Go-To Chicken Bowl", "Wholesome Bowl" — each carrying an explicit
 * ingredient list in its `description`; `dishesFromRoot` surfaces exactly
 * those, minus a handful of listings whose "description" is a backend
 * placeholder rather than real text ({@link isJunkDescription} — the literal
 * string `"None"`, or a bare number like `"11.4"`, both seen in a live pull).
 * `recipes.ts` is the hand-verified subset actually shipped from this list;
 * `scraper.ts` uses this module's dish output only to confirm a recipe's dish
 * is still listed before trusting the hand-pinned composition for it.
 *
 * The *scaffolding* listings this module otherwise discards are exactly what
 * `buildable.ts` wants: each format's root item (e.g. "Burrito Bowl") carries
 * `modifierGroupIds` pointing into `root.modifierGroups` — Deliveroo's own
 * encoding of "pick a protein, which unlocks pick a rice, …". Each option
 * within a group carries its *own* `modifierGroupIds` too (a protein choice
 * unlocks its own next groups), so the real structure is a tree, not a flat
 * per-item list — see `buildable.ts` for the walk.
 *
 * The page is a Next.js app; the full menu ships server-rendered in that
 * `__NEXT_DATA__` JSON blob, so no browser is needed. It 403s without a
 * `fulfillment_method` + `geohash` query pair (verified live) — those encode
 * a specific London branch, not a session; Chipotle UK's menu doesn't vary
 * by branch the way some other chains' does, so one representative branch
 * page is used for the whole country.
 */

import axios from 'axios'
import * as cheerio from 'cheerio'

const MENU_URL =
    'https://deliveroo.co.uk/menu/london/angel/chipotle-islington?fulfillment_method=delivery&geohash=gcpvjyzcd'

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

/** One option within a {@link DeliverooModifierGroup}, e.g. "Chicken", "White Rice", "No Beans". */
export interface DeliverooModifierOption {
    name: string
    /** Rough calorie hint Deliveroo shows next to the option (no protein/fat/carbs) — a cross-check, not a macro source. See spec 12 on why the PDF wins on disagreement. */
    energyKcal?: number
    /** Groups this specific option unlocks — recurse to keep walking the tree. */
    modifierGroupIds: string[]
}

/** One step of Chipotle's real ordering flow for a build-your-own item, e.g. "Protein or Veggie", "Add Your Toppings", "Quesa Sides". */
export interface DeliverooModifierGroup {
    id: string
    name: string
    minSelection: number
    maxSelection: number
    modifierOptions: DeliverooModifierOption[]
}

interface DeliverooRootItem {
    name?: string
    description?: string
    /** Present on build-your-own scaffolding items (spec 12) — absent on pre-composed dishes. */
    modifierGroupIds?: string[]
}

/** The menu page's full parsed root: every listing plus every modifier group definition. */
export interface DeliverooRoot {
    items: DeliverooRootItem[]
    modifierGroups: DeliverooModifierGroup[]
}

interface NextDataModifierOption {
    name?: string
    nutritionalInfo?: { energyFormatted?: string }
    modifierGroupIds?: string[]
}

interface NextDataModifierGroup {
    id?: string
    name?: string
    minSelection?: number
    maxSelection?: number
    modifierOptions?: NextDataModifierOption[]
}

interface NextData {
    props?: {
        initialState?: {
            menuPage?: {
                menu?: {
                    metas?: {
                        root?: {
                            items?: DeliverooRootItem[]
                            modifierGroups?: NextDataModifierGroup[]
                        }
                    }
                }
            }
        }
    }
}

/** Parses `"185 kcal"` → `185`; anything else (absent, "no known allergens", …) → `undefined`. */
function parseEnergyKcal (formatted: string | undefined): number | undefined {
    const match = formatted?.match(/(\d+(?:\.\d+)?)\s*kcal/i)
    return match ? Number(match[1]) : undefined
}

/** A description that carries no real information — a backend placeholder or a bare data-entry glitch, not ingredient text. */
function isJunkDescription (description: string): boolean {
    return description === 'None' || /^[\d.]+$/.test(description)
}

/**
 * Parses the menu page's raw HTML into its full root (dishes + modifier
 * tree). Pure and synchronous so it's unit-testable without a network call —
 * see {@link fetchDeliverooRoot} for the live entry point.
 */
export function parseDeliverooRoot (html: string): DeliverooRoot {
    const $ = cheerio.load(html)
    const script = $('#__NEXT_DATA__').html()
    if (!script) {
        throw new Error('Chipotle (Deliveroo): __NEXT_DATA__ script not found on the menu page')
    }

    const data = JSON.parse(script) as NextData
    const root = data.props?.initialState?.menuPage?.menu?.metas?.root

    const items = root?.items ?? []
    const modifierGroups: DeliverooModifierGroup[] = (root?.modifierGroups ?? [])
        .filter((g): g is Required<Pick<NextDataModifierGroup, 'id' | 'name'>> & NextDataModifierGroup =>
            typeof g.id === 'string' && typeof g.name === 'string')
        .map((g) => ({
            id: g.id,
            name: g.name,
            minSelection: g.minSelection ?? 0,
            maxSelection: g.maxSelection ?? 0,
            modifierOptions: (g.modifierOptions ?? [])
                .filter((o): o is Required<Pick<NextDataModifierOption, 'name'>> & NextDataModifierOption =>
                    typeof o.name === 'string')
                .map((o) => ({
                    name: o.name,
                    energyKcal: parseEnergyKcal(o.nutritionalInfo?.energyFormatted),
                    modifierGroupIds: o.modifierGroupIds ?? []
                }))
        }))

    return { items, modifierGroups }
}

/** Filters a parsed root down to named, pre-composed dishes (spec 11) — the fixed-description subset, junk placeholders dropped. */
export function dishesFromRoot (root: DeliverooRoot): Map<string, DeliverooDish> {
    const dishes = new Map<string, DeliverooDish>()
    for (const item of root.items) {
        const name = item.name?.trim()
        const description = item.description?.trim()
        if (!name || !description || isJunkDescription(description)) continue
        // A handful of names repeat verbatim (e.g. drink cans across delivery
        // vs pickup sections); first occurrence wins, matching every other
        // scraper's "first write stays" convention for exact duplicates.
        if (!dishes.has(name)) dishes.set(name, { name, description })
    }
    return dishes
}

/** Extracts the candidate dish list directly from raw HTML. Equivalent to `dishesFromRoot(parseDeliverooRoot(html))`. */
export function parseDeliverooDishes (html: string): Map<string, DeliverooDish> {
    return dishesFromRoot(parseDeliverooRoot(html))
}

/** Fetches and parses the menu page's full root (dishes + build-your-own modifier tree) — one live HTTP call feeds both spec 11 and spec 12. */
export async function fetchDeliverooRoot (): Promise<DeliverooRoot> {
    const response = await axios.get<string>(MENU_URL, {
        headers: REQUEST_HEADERS,
        timeout: HTTP_TIMEOUT_MS,
        responseType: 'text'
    })
    return parseDeliverooRoot(response.data)
}

/** Fetches the menu page and returns every listing that carries a fixed-composition description. */
export async function fetchDeliverooDishes (): Promise<Map<string, DeliverooDish>> {
    return dishesFromRoot(await fetchDeliverooRoot())
}
