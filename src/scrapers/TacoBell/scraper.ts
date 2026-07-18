import chalk from 'chalk'
import { RestaurantData, SourceScraper } from '../../types'
import * as cheerio from 'cheerio'
import { normalizeCategory } from '../category'

/**
 * Taco Bell is scraped live — but from nutritionix.com, a **third-party
 * service** that powers Taco Bell UK's online menu, rather than from Taco Bell
 * directly. Because the figures come from that third party, the macros here
 * **may differ from Taco Bell's official / in-store nutrition values.**
 */
export class TacoBellScraper extends SourceScraper {
    icon = '🌮'
    async scrape() {
        console.log(chalk.blue(`${this.icon} Scraping Taco Bell UK...`))

        if (!this.browser) {
            throw new Error('Browser not initialized')
        }

        const page = await this.browser.newPage()
        const items: RestaurantData = {}

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
                    .replace(/\[more info\]\s*$/i, '')
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
                    currentCategory.includes('dessert') ||
                    name.includes('churro') ||
                    name.includes('cinnabon') ||
                    name.includes('shake') ||
                    name.includes('freeze') ||
                    name.includes('pepsi') ||
                    name.includes('water')
                ) {
                    return
                }

                items[name] = {
                    calories,
                    protein,
                    fat,
                    carbs,
                    ProteinTCalRatio: protein / calories,
                    CarbToCalRatio: carbs / calories,
                    category: normalizeCategory(currentCategoryLabel)
                }
            })
        } catch (error) {
            console.error(chalk.red(`Error scraping Taco Bell: ${error}`))
        } finally {
            await page.close()
        }

        console.log(
            chalk.green(`✓ Found ${Object.keys(items).length} Taco Bell items`)
        )
        return items
    }
}
