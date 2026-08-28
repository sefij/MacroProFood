import chalk from 'chalk'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import * as cheerio from 'cheerio'
import { addItem, addVariant } from '../add-item'
import { Page } from 'playwright'

/**
 * Taco Bell is scraped live — but from nutritionix.com, a **third-party
 * service** that powers Taco Bell UK's online menu, rather than from Taco Bell
 * directly. Because the figures come from that third party, the macros here
 * **may differ from Taco Bell's official / in-store nutrition values.**
 *
 * **Item alterations (spec 10).** Unlike Pizza Hut/Nando's/Domino's, this
 * source has no dedicated size/crust column — the raw name string itself
 * already encodes a piece-count or meal-size as a trailing `"(N)"`/`"(Large)"`
 * suffix, or occasionally a leading `"Large "`/`"Regular "` prefix (see
 * {@link parseVariant}). Rows are buffered first, then grouped by their
 * parsed base name: a base with **2+ distinct options** becomes one item
 * with a selector (`addVariant`); a name that matches the pattern but turns
 * out to have no sibling stays a plain item under its full, untouched name
 * — a lone `"Nacho Chips (Large)"` isn't silently renamed to `"Nacho Chips"`
 * and doesn't lose the fact it's specifically the large size. Other axes
 * genuinely present in the source (protein choice — beef/chicken/black
 * beans; tender count in a combo meal) are deliberately *not* folded into
 * this selector — they stay part of the distinguishing base name instead,
 * so a group never mixes two independent choices into one flat list (same
 * "don't model independent axes" stance spec 10 already took for crust vs.
 * size elsewhere).
 *
 * **Pagination (added 2026-08-28)**: the source used to publish the whole
 * menu as one unpaginated table — confirmed against a live pull, it's since
 * been split into two separately-paginated tables, 25 rows/page: "Menu
 * Items" ({@link ITEMS_PARAM}, 7 pages) and a second, misleadingly-named
 * "Menu Ingredients" table ({@link INGREDIENTS_PARAM}, 16 pages) that in
 * practice also carries plain items plus meal-deal combos, overlapping
 * "Menu Items" for some names. Reading only page 1 of the first table (the
 * old, pre-redesign behaviour) silently produced 15 items instead of ~290 —
 * caught by a user noticing the drop, not by any scraper-side check, since
 * 15 > 0 never tripped the "no items scraped" fallback. Both tables' every
 * page are now crawled ({@link fetchAllRows}); the page count itself is read
 * from each table's own "Last" pager link rather than hardcoded, so a future
 * menu-size change doesn't quietly truncate results the same way again. The
 * two tables' overlap is left to the existing `addItem` duplicate/requalify
 * handling below — same as any other source with repeated rows.
 *
 * **Category loss (same redesign)**: the old page's fine-grained section
 * headings (Tacos, Burritos, Desserts, Meals, …) are gone — every row now
 * sits under the flat "Menu Items"/"Menu Ingredients" table label, which
 * carries no useful grouping info. Rather than surface that as a category
 * (every item would land in one giant, meaningless bucket) or guess a
 * category from the item name (this project doesn't fabricate data),
 * `category` is left `undefined` here; affected items fall back to
 * whatever the web app already does for uncategorized items.
 *
 * **Sauce/drink filtering, updated for the redesign**: the previous filter
 * checked the (fine-grained) category text for "drink"/"beverage"/"sauce",
 * which no longer exists to check — that filter was silently dead code as
 * of the redesign above, the exact "blanket exclusion stops matching
 * anything" failure mode already seen in a couple of other scrapers'
 * history here. Replaced with name-based checks verified against this same
 * live pull: an explicit "sauce"/"sachet" substring and a `"Dip Pot - "`
 * prefix catch the standalone sauces/dips/condiment sachets; a small brand
 * keyword list (Pepsi, 7Up, Mountain Dew, Lipton, Red Bull, Robinsons,
 * Tango, "bottled water", …) catches the drinks, none of which are prefixes
 * of any real dish name in this menu.
 *
 * **Bugfix alongside the retrofit**: the source litters meal-deal rows with
 * an embedded `"[more info]<long description>"` suffix glued directly onto
 * the name (not just at the very end — `"…(Large)[more info]beef bbq
 * habanero burrito, large fries…"`). The original strip regex only matched
 * `"[more info]"` anchored at end-of-string, so it never actually fired on
 * these rows — confirmed against a live pull, this left ~50 meal-deal item
 * names polluted with their own multi-sentence description text. Fixed to
 * strip `"[more info]"` and everything after it, which also happens to
 * unlock most of the Large/Regular meal-deal variant groups above (their
 * trailing size suffix was only ever visible once the garbage after it was
 * gone).
 */

interface ParsedVariant {
    base: string
    groupLabel: 'Count' | 'Size'
    option: string
}

function formatSizeOption (raw: string): string {
    return raw.toLowerCase() === 'xl' ? 'XL' : raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
}

/**
 * Recognizes a trailing `"(N)"` piece-count or `"(size)"` suffix, or a
 * leading size-word prefix, as a variant signal — e.g. `"chicken bites (3)"`
 * → base `"chicken bites"`, option `"3 pc"`; `"nacho chips (large)"` → base
 * `"nacho chips"`, option `"Large"`; `"large crispy chicken sharer"` → base
 * `"crispy chicken sharer"`, option `"Large"`. Anything else — no match, or
 * a parenthetical this scraper doesn't recognize as a count/size word —
 * returns `null` and the row stays exactly as scraped.
 */
function parseVariant (name: string): ParsedVariant | null {
    const suffixMatch = name.match(/^(.+?)\s*\((\d+|large|regular|small|medium|xl)\)$/i)
    if (suffixMatch) {
        const [, base, raw] = suffixMatch
        return /^\d+$/.test(raw)
            ? { base: base.trim(), groupLabel: 'Count', option: `${raw} pc` }
            : { base: base.trim(), groupLabel: 'Size', option: formatSizeOption(raw) }
    }
    const prefixMatch = name.match(/^(large|regular|small|medium|xl)\s+(.+)$/i)
    if (prefixMatch) {
        const [, raw, base] = prefixMatch
        return { base: base.trim(), groupLabel: 'Size', option: formatSizeOption(raw) }
    }
    return null
}

interface ParsedRow {
    name: string
    nutrition: NutritionData
    variant: ParsedVariant | null
}

const BASE_URL = 'https://www.nutritionix.com/taco-bell-uk/menu/premium?type=premium'
/** Query param that pages the first ("Menu Items") table. */
const ITEMS_PARAM = 'ip'
/** Query param that pages the second ("Menu Ingredients") table. */
const INGREDIENTS_PARAM = 'inp'

/** Brand/drink keywords checked against the lowercased name; none of these are prefixes of a real dish here (verified against a live pull). */
const DRINK_KEYWORDS = [
    'shake', 'freeze', 'pepsi', 'water', '7up', 'baja blast', 'mountain dew',
    'lipton', 'red bull', 'robinsons', 'tango'
]

/** A raw table row's text cells plus the sub-heading it fell under. */
interface RawRow {
    cells: string[]
    category: string
}

/** Reads a table's rows (subCategory heading rows update `category`, everything else is data). */
function parseTableRows ($: cheerio.CheerioAPI, tableIndex: number): RawRow[] {
    const rows: RawRow[] = []
    let category = ''
    $('table.tblCompare').eq(tableIndex).find('tbody tr').each((_, row) => {
        const $row = $(row)
        if ($row.hasClass('subCategory')) {
            category = $row.text().trim()
            return
        }
        const cells = $row.find('td').map((_, c) => $(c).text().trim()).get()
        if (cells.length < 10) return
        rows.push({ cells, category })
    })
    return rows
}

/** Reads the highest page number linked for `param` (its pager's "Last" link) — 1 if the table isn't paginated at all. HTML-entity-encoded `&amp;` separators included. */
function maxPage (html: string, param: string): number {
    const pattern = new RegExp(`(?:\\?|&(?:amp;)?)${param}=(\\d+)`, 'g')
    let match: RegExpExecArray | null
    let max = 1
    while ((match = pattern.exec(html)) !== null) {
        max = Math.max(max, Number(match[1]))
    }
    return max
}

export class TacoBellScraper extends SourceScraper {
    icon = '🌮'
    async scrape () {
        console.log(chalk.blue(`${this.icon} Scraping Taco Bell UK...`))

        if (!this.browser) {
            throw new Error('Browser not initialized')
        }

        const page = await this.browser.newPage()
        const rows: ParsedRow[] = []

        try {
            await page.setViewportSize({ width: 1366, height: 768 })
            const rawRows = await this.fetchAllRows(page)

            // Column order in this table:
            // 0: name, 1: kj, 2: kcal, 3: fat, 4: sat fat,
            // 5: carbs, 6: sugars, 7: fibre, 8: protein, 9: salt
            for (const raw of rawRows) {
                const name = raw.cells[0]
                    .replace(/\[more info\].*$/i, '')
                    .trim()
                    .toLowerCase()
                if (!name) continue

                const parseNum = (s: string) => {
                    const n = Number(s)
                    return Number.isFinite(n) ? n : NaN
                }

                const calories = parseNum(raw.cells[2])
                const fat = parseNum(raw.cells[3])
                const carbs = parseNum(raw.cells[5])
                const protein = parseNum(raw.cells[8])

                if (
                    !Number.isFinite(calories) ||
                    !Number.isFinite(protein) ||
                    !Number.isFinite(fat) ||
                    !Number.isFinite(carbs)
                ) {
                    continue
                }

                if (calories <= 0 || protein < 1) continue

                if (
                    name.includes('sauce') ||
                    name.includes('sachet') ||
                    name.startsWith('dip pot') ||
                    name === 'jalapeno honey mustard' ||
                    DRINK_KEYWORDS.some((keyword) => name.includes(keyword))
                ) {
                    continue
                }

                rows.push({
                    name,
                    nutrition: {
                        calories,
                        protein,
                        fat,
                        carbs,
                        ProteinTCalRatio: protein / calories,
                        CarbToCalRatio: carbs / calories,
                        // Source no longer publishes per-item categories
                        // (see module docblock) — left undefined rather
                        // than fabricated.
                        category: undefined
                    },
                    variant: parseVariant(name)
                })
            }
        } catch (error) {
            console.error(chalk.red(`Error scraping Taco Bell: ${error}`))
            return {}
        } finally {
            await page.close()
        }

        // Group rows sharing a parsed base name — only a group with 2+
        // *distinct* options becomes a real variant selector; a lone
        // suffix/prefix match with no sibling, or no match at all, is
        // emitted under its own full name (see module docblock).
        const groups = new Map<string, ParsedRow[]>()
        for (const row of rows) {
            const key = row.variant ? `${row.variant.groupLabel}::${row.variant.base}` : `plain::${row.name}`
            const list = groups.get(key) ?? []
            list.push(row)
            groups.set(key, list)
        }

        const items: RestaurantData = {}
        let duplicates = 0
        let renamed = 0

        for (const group of groups.values()) {
            const useVariant =
                group.length > 1 &&
                group[0].variant !== null &&
                new Set(group.map((r) => r.variant!.option)).size > 1

            for (const row of group) {
                const outcome = useVariant
                    ? addVariant(items, row.variant!.base, row.variant!.groupLabel, row.variant!.option, row.nutrition)
                    : addItem(items, row.name, row.nutrition)
                if (outcome.kind === 'duplicate') duplicates++
                else if (outcome.kind === 'renamed') renamed++
            }
        }

        console.log(
            chalk.green(`✓ Found ${Object.keys(items).length} Taco Bell items`)
        )
        if (duplicates > 0 || renamed > 0) {
            console.log(
                chalk.gray(
                    `  ${duplicates} duplicate name (same macros) dropped; ` +
                    `${renamed} name collisions requalified`
                )
            )
        }
        return items
    }

    /**
     * Crawls every page of both tables (see module docblock) and returns
     * their rows combined. Each table's own page count comes off its "Last"
     * pager link on the first load, rather than being hardcoded, so a future
     * menu-size change is picked up automatically instead of silently
     * truncating results.
     */
    private async fetchAllRows (page: Page): Promise<RawRow[]> {
        await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 })
        const firstHtml = await page.content()
        const maxItemsPage = maxPage(firstHtml, ITEMS_PARAM)
        const maxIngredientsPage = maxPage(firstHtml, INGREDIENTS_PARAM)

        const rows: RawRow[] = []
        rows.push(...parseTableRows(cheerio.load(firstHtml), 0))
        for (let p = 2; p <= maxItemsPage; p++) {
            await page.goto(`${BASE_URL}&${ITEMS_PARAM}=${p}`, { waitUntil: 'networkidle', timeout: 60000 })
            rows.push(...parseTableRows(cheerio.load(await page.content()), 0))
        }

        rows.push(...parseTableRows(cheerio.load(firstHtml), 1))
        for (let p = 2; p <= maxIngredientsPage; p++) {
            await page.goto(`${BASE_URL}&${INGREDIENTS_PARAM}=${p}`, { waitUntil: 'networkidle', timeout: 60000 })
            rows.push(...parseTableRows(cheerio.load(await page.content()), 1))
        }

        return rows
    }
}
