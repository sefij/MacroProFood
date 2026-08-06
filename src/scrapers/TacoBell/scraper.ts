import chalk from 'chalk'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import * as cheerio from 'cheerio'
import { normalizeCategory } from '../category'
import { addItem, addVariant } from '../add-item'

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

            await page.goto(
                'https://www.nutritionix.com/taco-bell-uk/menu/premium',
                {
                    waitUntil: 'networkidle',
                    timeout: 60000
                }
            )

            const content = await page.content()
            const $ = cheerio.load(content)

            const table = $('table.tblCompare').first()

            // Column order in this table:
            // 0: name, 1: kj, 2: kcal, 3: fat, 4: sat fat,
            // 5: carbs, 6: sugars, 7: fibre, 8: protein, 9: salt
            let currentCategory = ''
            let currentCategoryLabel: string | undefined

            table.find('tbody tr').each((_, row) => {
                const $row = $(row)

                if ($row.hasClass('subCategory')) {
                    const label = $row.text().trim()
                    currentCategory = label.toLowerCase()
                    currentCategoryLabel = label
                    return
                }

                const cells = $row.find('td').map((_, c) => $(c).text().trim()).get()
                if (cells.length < 10) return

                const name = cells[0]
                    .replace(/\[more info\].*$/i, '')
                    .trim()
                    .toLowerCase()
                if (!name) return

                const parseNum = (s: string) => {
                    const n = Number(s)
                    return Number.isFinite(n) ? n : NaN
                }

                const calories = parseNum(cells[2])
                const fat = parseNum(cells[3])
                const carbs = parseNum(cells[5])
                const protein = parseNum(cells[8])

                if (
                    !Number.isFinite(calories) ||
                    !Number.isFinite(protein) ||
                    !Number.isFinite(fat) ||
                    !Number.isFinite(carbs)
                ) {
                    return
                }

                if (calories <= 0 || protein < 1) return

                if (
                    currentCategory.includes('drink') ||
                    currentCategory.includes('beverage') ||
                    currentCategory.includes('sauce') ||
                    name.includes('shake') ||
                    name.includes('freeze') ||
                    name.includes('pepsi') ||
                    name.includes('water')
                ) {
                    return
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
                        category: normalizeCategory(currentCategoryLabel)
                    },
                    variant: parseVariant(name)
                })
            })
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
}
