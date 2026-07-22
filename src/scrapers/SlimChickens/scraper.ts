import chalk from 'chalk'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { normalizeCategory } from '../category'
import { addItem } from '../add-item'
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
            const outcome = addItem(items, name, built)
            if (outcome.kind === 'duplicate') duplicates++
            else if (outcome.kind === 'renamed') renamed++
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
