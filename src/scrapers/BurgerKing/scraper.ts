import chalk from 'chalk'
import axios from 'axios'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { normalizeCategory } from '../category'
import { addItem } from '../add-item'

/**
 * Live Burger King UK scraper.
 *
 * BK UK runs on Restaurant Brands International's platform, which is backed
 * by a **publicly queryable Sanity dataset** (project `czqk28jt`, dataset
 * `prod_bk_gb`) — the same CMS the site's own front end reads from. That
 * means a single GROQ query returns the whole menu as structured JSON, with
 * no HTML parsing and no per-item requests.
 *
 * Each `item` carries a full `nutrition` object (calories, proteins,
 * carbohydrates, fat, plus fibre/salt/sugar/etc.), so unlike several other
 * UK chains there's no calories-only problem here.
 *
 * Two structural details the traversal has to get right:
 *
 *  1. **Which menu.** The dataset holds more than one `menu` document, and
 *     the extra one ("Nutri Explorer Menu") has been stale since 2021 while
 *     the real one is updated continuously. Rather than hardcode a name that
 *     could be renamed, this picks the most recently updated menu — the
 *     actively maintained one by definition. (Same failure mode as Nando's
 *     stale `page-data.json`: a wrong-but-valid source that returns real
 *     data, just years out of date.)
 *  2. **Pickers.** A section's children are `item`, `combo` or `picker`
 *     documents. A `picker` groups the variants of one product (e.g. each
 *     size/build of a burger) and — unlike everything else — wraps its
 *     children in a `pickerOption` indirection, so they're reached via
 *     `options[].option->` rather than `options[]->`. Missing that silently
 *     halves the harvest (47 items instead of 95), with no error.
 *
 * `combo` children (meal bundles) are deliberately skipped: consistent with
 * Nando's, items are scraped "as published" and sides/drinks are their own
 * separate items rather than being folded into a meal.
 */

const SANITY_URL =
    'https://czqk28jt.apicdn.sanity.io/v2023-08-01/data/query/prod_bk_gb'

/**
 * Most-recently-updated menu → its sections → each section's children, with
 * `picker` children resolved through their `pickerOption` wrapper.
 */
const MENU_QUERY = `*[_type == "menu"] | order(_updatedAt desc)[0]{
  "menuName": name.en,
  "sections": options[]->{
    "section": name.en,
    "children": options[]->{
      "name": name.en,
      "type": _type,
      "nutrition": nutrition,
      "pickerOptions": options[].option->{
        "name": name.en,
        "nutrition": nutrition
      }
    }
  }
}`

const REQUEST_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    Accept: 'application/json'
}

const HTTP_TIMEOUT_MS = 45000

// A single macro can't contribute more energy than the item's stated
// calories (protein/carbs ≈ 4 kcal/g, fat ≈ 9 kcal/g); drop feed errors that
// break this by more than this slack.
const MACRO_CALORIE_TOLERANCE = 1.3

interface BkNutrition {
    calories?: number
    proteins?: number
    carbohydrates?: number
    fat?: number
}

interface BkChild {
    name?: string
    type?: string
    nutrition?: BkNutrition
    pickerOptions?: Array<{ name?: string, nutrition?: BkNutrition } | null>
}

interface BkSection {
    section?: string
    children?: Array<BkChild | null>
}

interface BkMenu {
    menuName?: string
    sections?: Array<BkSection | null>
}

interface SanityResponse {
    result?: BkMenu
}

/** One menu item flattened out of the section/picker tree. */
interface FlatItem {
    name: string
    category: string | undefined
    nutrition: BkNutrition | undefined
}

/** Trims and collapses the internal whitespace the source data litters names with. */
function clean (value: string | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Flattens sections into menu items. A section's direct `item` children are
 * taken as-is; `picker` children contribute their wrapped options instead
 * (that's where a picker's real, individually-nutritioned variants live).
 * `combo` children are skipped — see the "Out of scope" note in the class
 * docblock.
 */
function flattenSections (sections: Array<BkSection | null>): FlatItem[] {
    const items: FlatItem[] = []
    for (const section of sections) {
        if (!section) continue
        const category = section.section
        for (const child of section.children ?? []) {
            if (!child || child.type === 'combo') continue

            if (child.nutrition) {
                items.push({ name: clean(child.name), category, nutrition: child.nutrition })
            }
            for (const option of child.pickerOptions ?? []) {
                if (!option?.nutrition) continue
                items.push({ name: clean(option.name), category, nutrition: option.nutrition })
            }
        }
    }
    return items
}

function buildNutrition (
    nutrition: BkNutrition | undefined,
    category: string | undefined
): NutritionData | 'implausible' | null {
    if (!nutrition) return null
    const calories = nutrition.calories
    if (!Number.isFinite(calories) || (calories as number) <= 0) return null

    // Every macro must be *present*, not merely defaulted. The feed publishes
    // a fair number of records (hot drinks, some bottled soft drinks) that
    // carry calories while omitting the macro fields entirely — a Cappuccino
    // with no `proteins`/`carbohydrates`/`fat` keys, a Coca-Cola with
    // `proteins: 0, fat: 0` but no `carbohydrates`. Coercing those absences
    // to 0 would invent macro-free calories and hand the optimizer an item
    // it thinks is "free", so they're dropped as incomplete instead.
    const protein = nutrition.proteins
    const fat = nutrition.fat
    const carbs = nutrition.carbohydrates
    if (!Number.isFinite(protein) || !Number.isFinite(fat) || !Number.isFinite(carbs)) {
        return null
    }

    const cap = (calories as number) * MACRO_CALORIE_TOLERANCE
    if (protein * 4 > cap || carbs * 4 > cap || fat * 9 > cap) return 'implausible'

    return {
        calories: calories as number,
        protein,
        fat,
        carbs,
        ProteinTCalRatio: protein / (calories as number),
        CarbToCalRatio: carbs / (calories as number),
        category: normalizeCategory(category)
    }
}

export class BurgerKingScraper extends SourceScraper {
    name = 'Burger King'
    icon = '👑'

    // No browser needed — this scraper is pure HTTP + JSON parsing.
    async initialize (): Promise<void> {}

    async scrape (): Promise<RestaurantData> {
        console.log(chalk.blue(`${this.icon} Scraping Burger King UK (live)…`))

        const menu = await this.fetchMenu()
        const flatItems = flattenSections(menu.sections ?? [])

        const items: RestaurantData = {}
        let invalid = 0
        let implausible = 0
        let duplicates = 0
        let renamed = 0

        for (const flat of flatItems) {
            if (!flat.name) {
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
                console.log(chalk.yellow(`  ⚠ dropped "${flat.name}" — implausible macros`))
                continue
            }
            const outcome = addItem(items, flat.name, built)
            if (outcome.kind === 'duplicate') duplicates++
            else if (outcome.kind === 'renamed') renamed++
        }

        console.log(
            chalk.green(`✓ Found ${Object.keys(items).length} Burger King items (live)`)
        )
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

    private async fetchMenu (): Promise<BkMenu> {
        const response = await axios.get<SanityResponse>(SANITY_URL, {
            params: { query: MENU_QUERY },
            headers: REQUEST_HEADERS,
            timeout: HTTP_TIMEOUT_MS,
            responseType: 'json'
        })
        const menu = response.data.result
        if (!menu?.sections?.length) {
            throw new Error('Burger King: no menu sections returned from the Sanity dataset')
        }
        return menu
    }
}
