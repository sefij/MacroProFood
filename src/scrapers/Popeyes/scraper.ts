import chalk from 'chalk'
import { RestaurantData, SourceScraper } from '../../types'
import * as cheerio from 'cheerio'
import { normalizeCategory } from '../category'
import { addItem } from '../add-item'

export class PopeyesScraper extends SourceScraper {
    icon = '🍗'
    async scrape() {
        console.log(chalk.blue(`${this.icon} Scraping Popeyes UK...`))

        if (!this.browser) {
            throw new Error('Browser not initialized')
        }

        const page = await this.browser.newPage()
        const items: RestaurantData = {}
        let duplicates = 0
        let renamed = 0

        try {
            // Set user agent and viewport
            await page.setViewportSize({ width: 1366, height: 768 })

            await page.goto(
                'https://allergensandnutritions.popeyesuk.com/nutritional-information',
                {
                    waitUntil: 'networkidle',
                    timeout: 30000
                }
            )

            // Wait for content to load
            // await page.waitForTimeout(2000)

            // Try to find and click accept cookies if present
            try {
                await page.click(
                    '[data-testid="cookie-accept"], .cookie-accept, #accept-cookies',
                    { timeout: 5000 }
                )
                // await page.waitForTimeout(1000)
            } catch (e) {
                // Cookies banner might not be present
            }

            // Get page content
            const content = await page.content()
            const $ = cheerio.load(content)

            // The nutrition table groups items under section header rows
            // ("Boneless", "Breakfast", "Dips", …). A section header is a <tr>
            // with no `.recipe-title` cell; its first cell holds the section
            // name. We walk the rows in order, tracking the current section so
            // we can skip whole categories the user doesn't care about.
            const EXCLUDED_SECTIONS = new Set(['dips', 'drinks', 'whipz'])
            const table = $('.recipe-title').first().closest('table')
            let currentSection = ''
            let currentSectionLabel: string | undefined

            table.find('tr').each((_, element) => {
                const $row = $(element)
                const $title = $row.find('.recipe-title')

                if ($title.length === 0) {
                    const header = $row.children().first().text().trim()
                    if (header) {
                        currentSection = header.toLowerCase()
                        currentSectionLabel = header
                    }
                    return
                }

                if (EXCLUDED_SECTIONS.has(currentSection)) return

                const name = $title.text().toLowerCase()

                const [
                    _name,
                    caloriesContainer,
                    _kj,
                    proteinContainer,
                    carbsContainer,
                    _sugar,
                    fatContainer
                ] = $row.children()

                const calTxt = (caloriesContainer.children[0] as any).data
                const calories = Number(calTxt === '-' ? Infinity : calTxt)

                const proteinTxt = (proteinContainer.children[0] as any).data
                const protein = Number(
                    proteinTxt === '-' ? Infinity : proteinTxt
                )

                const carbsTxt = (carbsContainer.children[0] as any).data
                const carbs = Number(carbsTxt === '-' ? Infinity : carbsTxt)
                const fatTxt = (fatContainer.children[0] as any).data
                const fat = Number(fatTxt === '-' ? Infinity : fatTxt)

                if (
                    calories > 0 &&
                    protein > 1 &&
                    carbs > 0 &&
                    !name.includes('ireland only') &&
                    !name.includes('beans') &&
                    !name.includes('ketchup') &&
                    !name.includes('muffin') &&
                    !name.includes('jam') &&
                    !name.includes('brekkie')
                ) {
                    const outcome = addItem(items, name, {
                        calories,
                        protein,
                        fat,
                        carbs,
                        ProteinTCalRatio: protein / calories,
                        CarbToCalRatio: carbs / calories,
                        category: normalizeCategory(currentSectionLabel)
                    })
                    if (outcome.kind === 'duplicate') duplicates++
                    else if (outcome.kind === 'renamed') renamed++
                }
            })
        } catch (error) {
            console.error(chalk.red(`Error scraping Popeyes: ${error}`))
        } finally {
            await page.close() // Close only the page, not the browser
        }

        console.log(
            chalk.green(`✓ Found ${Object.keys(items).length} Popeyes items`)
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
