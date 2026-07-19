import chalk from 'chalk'
import axios from 'axios'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { normalizeCategory } from '../category'
import { addItem } from '../add-item'

/**
 * Live Nando's UK scraper.
 *
 * Sourced from the JSON data Gatsby embeds for the menu page. The filename
 * isn't static — `page-data/index/page-data.<hash>.json`, where `<hash>` is
 * the content hash of the site's current "app" JS bundle, changing on every
 * Nando's deploy. (A bare `page-data/index/page-data.json` with no suffix
 * also resolves — but to a stale, long-out-of-date build missing most of the
 * menu; do not use it.) The current hash is recovered from the menu page's
 * own HTML, which embeds it in a `window.___chunkMapping` inline script as
 * the "app" entry's filename — no browser needed, just a second HTTP GET.
 *
 * Each menu item carries its own base nutrition at
 * `nutritionalInfo.factsForPortionSizes[0]`. Items that come in more than one
 * size (Sides' Regular/Large, Drinks' Wine glass sizes) additionally carry a
 * `choose-size-*` modifier (`choose-size-side`, `choose-size-wine`) whose
 * options each embed their own paired nutrition — that's the authoritative
 * source for size variants (confirmed against every multi-size item in a
 * live pull: none lack a matching `choose-size-*` modifier), used in place of
 * the item's own top-level facts when present. Every other modifier (baste/
 * flavour choice, side/drink add-ons, meal-deal bundling, ingredient add/
 * remove) is ignored — see "Out of scope" in spec 09.
 */

const MENU_PAGE_URL = 'https://www.nandos.co.uk/food/menu/'
const MENU_DATA_BASE_URL = 'https://www.nandos.co.uk/food/menu/page-data/index/page-data'

const REQUEST_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    Accept: 'text/html,application/json,*/*'
}

const HTTP_TIMEOUT_MS = 20000

// A single macro can't contribute more energy than the item's stated
// calories (protein/carbs ≈ 4 kcal/g, fat ≈ 9 kcal/g); drop feed errors that
// break this by more than this slack.
const MACRO_CALORIE_TOLERANCE = 1.3

interface NandosPortionFacts {
    energyKcal?: number
    proteinMg?: number
    fatMg?: number
    totalCarbsMg?: number
}

interface NandosModifierOption {
    displayName?: string
    nutritionalInfo?: { factsForPortionSizes?: NandosPortionFacts[] }
}

interface NandosModifier {
    slug?: string
    options?: NandosModifierOption[]
}

interface NandosItem {
    displayName?: string
    nutritionalInfo?: { factsForPortionSizes?: NandosPortionFacts[] }
    modifiers?: NandosModifier[]
}

interface NandosSection {
    displayName?: string
    items?: NandosItem[]
}

interface NandosMenuResponse {
    result?: {
        data?: {
            nandos?: {
                menu?: {
                    sections?: NandosSection[]
                }
            }
        }
    }
}

/** One orderable portion-size variant of a source item: a display-name suffix (`null` for the bare name) and its own facts. */
interface ItemVariant {
    suffix: string | null
    facts: NandosPortionFacts
}

/**
 * Every item's own `factsForPortionSizes[0]` is its base nutrition. Items
 * with more than one size additionally carry a `choose-size-*` modifier
 * whose options are each individually labelled and nutritioned — when
 * present, that's used instead (one variant per option) since it's the only
 * reliable source of which facts belong to which size.
 */
function buildVariants (item: NandosItem): ItemVariant[] {
    const sizeModifier = item.modifiers?.find((m) => m.slug?.startsWith('choose-size-'))
    if (sizeModifier) {
        return (sizeModifier.options ?? [])
            .filter((o) => (o.nutritionalInfo?.factsForPortionSizes?.length ?? 0) > 0)
            .map((o) => ({ suffix: o.displayName ?? null, facts: (o.nutritionalInfo!.factsForPortionSizes as NandosPortionFacts[])[0] }))
    }
    const facts = item.nutritionalInfo?.factsForPortionSizes
    return facts && facts.length > 0 ? [{ suffix: null, facts: facts[0] }] : []
}

/** Trims and collapses the internal whitespace the source data litters names with. */
function clean (value: string | undefined): string {
    return (value ?? '').replace(/\s+/g, ' ').trim()
}

function buildNutrition (facts: NandosPortionFacts, category: string | undefined): NutritionData | 'implausible' | null {
    const calories = facts.energyKcal
    if (!Number.isFinite(calories) || (calories as number) <= 0) return null

    const protein = (facts.proteinMg ?? 0) / 1000
    const fat = (facts.fatMg ?? 0) / 1000
    const carbs = (facts.totalCarbsMg ?? 0) / 1000

    const cap = (calories as number) * MACRO_CALORIE_TOLERANCE
    if (protein * 4 > cap || carbs * 4 > cap || fat * 9 > cap) return 'implausible'

    return {
        calories: calories as number,
        protein,
        fat,
        carbs,
        ProteinTCalRatio: protein / (calories as number),
        CarbToCalRatio: carbs / (calories as number),
        category
    }
}

export class NandosScraper extends SourceScraper {
    name = "Nando's"
    icon = '🌶️'

    // No browser needed — this scraper is pure HTTP + JSON parsing.
    async initialize (): Promise<void> {}

    async scrape (): Promise<RestaurantData> {
        console.log(chalk.blue(`${this.icon} Scraping Nando's UK (live)…`))

        const sections = await this.fetchSections()

        const items: RestaurantData = {}
        let invalid = 0
        let implausible = 0
        let duplicates = 0
        let renamed = 0

        for (const section of sections) {
            const category = normalizeCategory(section.displayName)
            for (const raw of section.items ?? []) {
                const name = clean(raw.displayName)
                const variants = name ? buildVariants(raw) : []
                if (variants.length === 0) {
                    invalid++
                    continue
                }

                for (const variant of variants) {
                    const built = buildNutrition(variant.facts, category)
                    if (built === null) {
                        invalid++
                        continue
                    }
                    if (built === 'implausible') {
                        implausible++
                        console.log(chalk.yellow(`  ⚠ dropped "${name}" — implausible macros`))
                        continue
                    }
                    const key = variant.suffix ? `${name} (${variant.suffix})` : name
                    const outcome = addItem(items, key, built)
                    if (outcome.kind === 'duplicate') duplicates++
                    else if (outcome.kind === 'renamed') renamed++
                }
            }
        }

        console.log(
            chalk.green(`✓ Found ${Object.keys(items).length} Nando's items (live)`)
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

    /**
     * The menu JSON's URL is content-hashed and changes on every deploy — the
     * hash is recovered from the menu page's own HTML (`window.___chunkMapping`
     * embeds it as the "app" bundle's filename), rather than trusting the
     * unsuffixed `page-data/index/page-data.json`, which resolves but to a
     * stale, long-out-of-date build.
     */
    private async fetchCurrentDataUrl (): Promise<string> {
        const response = await axios.get<string>(MENU_PAGE_URL, {
            headers: REQUEST_HEADERS,
            timeout: HTTP_TIMEOUT_MS,
            responseType: 'text'
        })
        const chunkMappingMatch = response.data.match(/window\.___chunkMapping=(\{.*?\});/)
        const appHash = chunkMappingMatch && JSON.parse(chunkMappingMatch[1]).app?.[0]?.match(/app-(\d+)\.js/)?.[1]
        if (!appHash) {
            throw new Error("Nando's: couldn't recover the current page-data hash from the menu page HTML")
        }
        return `${MENU_DATA_BASE_URL}.${appHash}.json`
    }

    private async fetchSections (): Promise<NandosSection[]> {
        const dataUrl = await this.fetchCurrentDataUrl()
        const response = await axios.get<NandosMenuResponse>(dataUrl, {
            headers: REQUEST_HEADERS,
            timeout: HTTP_TIMEOUT_MS,
            responseType: 'json'
        })
        return response.data.result?.data?.nandos?.menu?.sections ?? []
    }
}
