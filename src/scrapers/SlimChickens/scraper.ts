import chalk from 'chalk'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { normalizeCategory } from '../category'
import { addItem, addVariant } from '../add-item'
import { parseNumber } from '../parse-number'

/**
 * Live Slim Chickens UK scraper.
 *
 * slimchickens.com's own nutrition page is the **US** site — every
 * restaurant its API returns is `country: "US"` — so it publishes US
 * recipes/portions, not the UK menu this app needs.
 *
 * Slim Chickens UK (operated by Boparan Restaurant Group, hence the `/brg/`
 * path) publishes its own allergen/nutrition info on the same `menus.
 * tenkites.com` platform used for [[YoSushi]], linked from slimchickens.co.uk
 * itself. Unlike YO! Sushi's single flat page, this is a per-branch site
 * picker (`/brg/slimchickensall`) with ~86 UK locations split across a few
 * different page templates (`slimscore`, `slimshubs`, `slimsincbreakfast`,
 * `slimsbelfast`) — no single "all branches" page. `slimscore` is the
 * majority template (the standard full menu; the others are travel-hub/
 * breakfast/NI variants), so this scraper resolves the first `slimscore`
 * branch from the picker and scrapes that one as representative of the UK
 * menu, rather than hardcoding a specific branch that could close.
 *
 * That branch page embeds the entire menu as standard schema.org `Menu`
 * JSON-LD (nested `MenuSection`/`MenuItem`s with full `NutritionInformation`
 * per item) — far cleaner than YO! Sushi's raw HTML table, and the same
 * platform quietly does this for every client, so it's worth checking first
 * on any future Ten Kites-hosted restaurant before falling back to the
 * table-scraping approach.
 *
 * **Item alterations (spec 10).** Same shape of problem as Taco Bell — no
 * dedicated size/count source field, but the source's own item names already
 * encode a piece-count as a **leading** number (`"6 Crispy Wings"`, `"8
 * Crispy Wings"`, `"10 Crispy Wings"`, unlike Taco Bell's trailing `"(N)"`).
 * Items are buffered and grouped by the name with that leading count
 * stripped ({@link parseVariant}); a base name only becomes a variant
 * selector once 2+ distinct counts actually exist for it, so a name that
 * happens to start with a digit but has no sibling (e.g. a one-off combo
 * like `"3 Tender & 3 Crispy Wing"`) stays a plain item under its full,
 * untouched name. A genuinely different product that happens to share a
 * stripped base with an unrelated group never collides here in practice —
 * checked against a live pull — but if one ever did, `addVariant`/`addItem`'s
 * existing collision handling (same macros = duplicate dropped, different
 * macros = requalified) still applies underneath, same as everywhere else.
 *
 * **Known upstream data quirk — "8 Boneless Bites Meal"**: the source's own
 * published nutrition briefly makes this option look worse-value than the
 * 6-piece one (33g protein / 71g carbs at 8pc vs. 40g / 79g at 6pc, with
 * 10pc back up at 65g / 113g — non-monotonic, unlike every other
 * count-variant group here, which scale cleanly). Verified directly against
 * the raw JSON-LD (not a parsing bug on this end — `nutrition.proteinContent`
 * for "8 Boneless Bites Meal" literally reads `"33 grams"`). Left as scraped
 * — faithfully reporting whatever the source publishes, even when it looks
 * internally inconsistent, rather than guessing a "corrected" figure.
 */

const SITE_PICKER_URL = 'https://menus.tenkites.com/brg/slimchickensall'
const MAIN_MENU_TEMPLATE_PATTERN = /\/brg\/slimscore\?/

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

interface SchemaNutritionInfo {
    calories?: string
    proteinContent?: string
    fatContent?: string
    carbohydrateContent?: string
}

interface SchemaMenuItem {
    '@type': 'MenuItem'
    name?: string
    nutrition?: SchemaNutritionInfo
}

interface SchemaMenuSection {
    '@type': 'MenuSection'
    name?: string
    hasMenuItem?: SchemaMenuItem | SchemaMenuItem[]
    hasMenuSection?: SchemaMenuSection | SchemaMenuSection[]
}

interface SchemaMenu {
    '@type': 'Menu'
    hasMenuSection?: SchemaMenuSection | SchemaMenuSection[]
}

/** A JSON-LD field the schema allows as either one object or an array of them. */
function asArray<T> (value: T | T[] | undefined): T[] {
    if (value == null) return []
    return Array.isArray(value) ? value : [value]
}

/** One flattened menu item paired with the name of the section it was listed directly under. */
interface FlatItem {
    category: string | undefined
    name: string
    nutrition: SchemaNutritionInfo | undefined
}

/** Recursively flattens the JSON-LD section tree; an item's category is its immediate parent section. */
function flattenSections (sections: SchemaMenuSection[]): FlatItem[] {
    const items: FlatItem[] = []
    for (const section of sections) {
        for (const item of asArray(section.hasMenuItem)) {
            items.push({ category: section.name, name: item.name ?? '', nutrition: item.nutrition })
        }
        items.push(...flattenSections(asArray(section.hasMenuSection)))
    }
    return items
}

/** Trims and collapses the internal whitespace the source data litters names with. */
function clean (value: string | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim()
}

interface ParsedVariant {
    base: string
    option: string
}

/**
 * Recognizes a leading piece-count as a variant signal — e.g. `"6 Crispy
 * Wings"` → base `"Crispy Wings"`, option `"6 pc"`. A name with no leading
 * number (or one that turns out to have no sibling sharing its stripped
 * base) returns `null`/stays a plain item — see module docblock.
 */
function parseVariant (name: string): ParsedVariant | null {
    const match = name.match(/^(\d+)\s+(.+)$/)
    if (!match) return null
    const [, count, base] = match
    return { base: base.trim(), option: `${count} pc` }
}

function buildNutrition (nutrition: SchemaNutritionInfo | undefined, category: string | undefined): NutritionData | 'implausible' | null {
    if (!nutrition) return null
    const calories = parseNumber(nutrition.calories)
    if (!Number.isFinite(calories) || calories <= 0) return null

    const protein = parseNumber(nutrition.proteinContent) || 0
    const fat = parseNumber(nutrition.fatContent) || 0
    const carbs = parseNumber(nutrition.carbohydrateContent) || 0

    const cap = calories * MACRO_CALORIE_TOLERANCE
    if (protein * 4 > cap || carbs * 4 > cap || fat * 9 > cap) return 'implausible'

    return {
        calories,
        protein,
        fat,
        carbs,
        ProteinTCalRatio: protein / calories,
        CarbToCalRatio: carbs / calories,
        category: normalizeCategory(category)
    }
}

export class SlimChickensScraper extends SourceScraper {
    name = 'Slim Chickens'
    icon = '🐓'

    // No browser needed — this scraper is pure HTTP + JSON parsing.
    async initialize (): Promise<void> {}

    async scrape (): Promise<RestaurantData> {
        console.log(chalk.blue(`${this.icon} Scraping Slim Chickens UK (live)…`))

        const branchUrl = await this.fetchMainMenuBranchUrl()
        const flatItems = await this.fetchMenuItems(branchUrl)

        const items: RestaurantData = {}
        let invalid = 0
        let implausible = 0
        let duplicates = 0
        let renamed = 0

        // Buffer first — a name only becomes a variant selector once every
        // row is in hand and its base name's distinct-option count is known
        // (see module docblock / parseVariant).
        const rows: Array<{ name: string, nutrition: NutritionData, variant: ParsedVariant | null }> = []

        for (const flat of flatItems) {
            const name = clean(flat.name)
            if (!name) {
                invalid++
                continue
            }

            const built = buildNutrition(flat.nutrition, flat.category)
            if (built === null) {
                invalid++
                continue
            }
            if (built === 'implausible') {
                implausible++
                console.log(chalk.yellow(`  ⚠ dropped "${name}" — implausible macros`))
                continue
            }
            rows.push({ name, nutrition: built, variant: parseVariant(name) })
        }

        const groups = new Map<string, typeof rows>()
        for (const row of rows) {
            const key = row.variant ? `variant::${row.variant.base}` : `plain::${row.name}`
            const list = groups.get(key) ?? []
            list.push(row)
            groups.set(key, list)
        }

        for (const group of groups.values()) {
            const useVariant =
                group.length > 1 &&
                group[0].variant !== null &&
                new Set(group.map((r) => r.variant!.option)).size > 1

            for (const row of group) {
                const outcome = useVariant
                    ? addVariant(items, row.variant!.base, 'Count', row.variant!.option, row.nutrition)
                    : addItem(items, row.name, row.nutrition)
                if (outcome.kind === 'duplicate') duplicates++
                else if (outcome.kind === 'renamed') renamed++
            }
        }

        console.log(chalk.green(`✓ Found ${Object.keys(items).length} Slim Chickens items (live)`))
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

    /**
     * Resolves the first `slimscore`-template branch from the site picker —
     * the majority (standard full-menu) template, rather than a hardcoded
     * branch name that could close.
     */
    private async fetchMainMenuBranchUrl (): Promise<string> {
        const response = await axios.get<string>(SITE_PICKER_URL, {
            headers: REQUEST_HEADERS,
            timeout: HTTP_TIMEOUT_MS,
            responseType: 'text'
        })
        const $ = cheerio.load(response.data)
        const branchLink = $('.k10-site-selector__option-link')
            .filter((_, el) => MAIN_MENU_TEMPLATE_PATTERN.test($(el).attr('href') ?? ''))
            .first()
        const href = branchLink.attr('href')
        if (!href) {
            throw new Error('Slim Chickens: could not find a slimscore branch in the site picker')
        }
        return href
    }

    /** Fetches one branch's menu page and flattens its embedded schema.org Menu JSON-LD. */
    private async fetchMenuItems (branchUrl: string): Promise<FlatItem[]> {
        const response = await axios.get<string>(branchUrl, {
            headers: REQUEST_HEADERS,
            timeout: HTTP_TIMEOUT_MS,
            responseType: 'text'
        })
        const $ = cheerio.load(response.data)

        let menu: SchemaMenu | undefined
        $('script[type="application/ld+json"]').each((_, el) => {
            if (menu) return
            try {
                const parsed = JSON.parse($(el).contents().text())
                if (parsed?.['@type'] === 'Menu') menu = parsed as SchemaMenu
            } catch {
                // Not JSON, or not the menu block — ignore.
            }
        })
        if (!menu) {
            throw new Error(`Slim Chickens: no Menu JSON-LD found at ${branchUrl}`)
        }

        return flattenSections(asArray(menu.hasMenuSection))
    }
}
