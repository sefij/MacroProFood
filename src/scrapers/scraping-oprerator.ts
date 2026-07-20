import { McDonaldsScraper } from './McDonalds/scraper.js'
import { KFCScraper } from './KFC/scraper.js'
import { WendysScraper } from './Wendys/scraper.js'
import { PopeyesScraper } from './Popeyes/scraper.js'
import { SubwayScraper } from './Subway/scraper.js'
import { TacoBellScraper } from './TacoBell/scraper.js'
import { WagamamaScraper } from './Wagamama/scraper.js'
import { DominosScraper } from './Dominos/scraper.js'
import { NandosScraper } from './Nandos/scraper.js'
import { RestaurantData, RestaurantsData, SourceScraper } from '../types.js'
import { withCache } from '../cache.js'
import { RestaurantKey, isScraperDisabled } from '../config.js'
import * as fs from 'fs/promises'
import chalk from 'chalk'

export interface ScrapingOperatorOptions {
    bypassCache?: boolean
}

export class ScrapingOperator {
    private restaurants: RestaurantsData = {}
    private bypassCache: boolean

    constructor (options: ScrapingOperatorOptions = {}) {
        this.bypassCache = options.bypassCache ?? false
    }

    private async runScraper (scraper: SourceScraper): Promise<RestaurantData> {
        await scraper.initialize()
        return await scraper.scrape()
    }

    private cached (key: string, producer: () => Promise<RestaurantData>): Promise<RestaurantData> {
        return withCache(key, producer, { bypass: this.bypassCache })
    }

    /**
     * Runs `producer` unless the scraper is disabled via the `DISABLE_<KEY>`
     * env var, in which case it logs a skip notice and returns no items.
     */
    private async scrapeIfEnabled (
        key: RestaurantKey,
        label: string,
        producer: () => Promise<RestaurantData>
    ): Promise<RestaurantData> {
        if (isScraperDisabled(key)) {
            console.log(chalk.gray(`⏭️  Skipping ${label} (DISABLE_${key} is set)`))
            return {}
        }
        return producer()
    }

    async scrapePopeyes (): Promise<RestaurantData> {
        return this.scrapeIfEnabled('POPEYES', 'Popeyes', () =>
            this.cached('popeyes', () => this.runScraper(new PopeyesScraper())))
    }

    async scrapeKFC (): Promise<RestaurantData> {
        return this.scrapeIfEnabled('KFC', 'KFC', () =>
            this.cached('kfc', () => this.runScraper(new KFCScraper())))
    }

    async scrapeWendys (): Promise<RestaurantData> {
        return this.scrapeIfEnabled('WENDYS', "Wendy's", () =>
            this.cached('wendys', () => this.runScraper(new WendysScraper())))
    }

    async scrapeMcdonalds (): Promise<RestaurantData> {
        return this.scrapeIfEnabled('MCDONALDS', "McDonald's", () =>
            this.cached('mcdonalds', () => this.runScraper(new McDonaldsScraper())))
    }

    async scrapeSubway (): Promise<RestaurantData> {
        return this.scrapeIfEnabled('SUBWAY', 'Subway', () =>
            this.cached('subway', () => this.runScraper(new SubwayScraper())))
    }

    async scrapeTacoBell (): Promise<RestaurantData> {
        return this.scrapeIfEnabled('TACOBELL', 'Taco Bell', () =>
            this.cached('tacobell', () => this.runScraper(new TacoBellScraper())))
    }

    async scrapeWagamama (): Promise<RestaurantData> {
        return this.scrapeIfEnabled('WAGAMAMA', 'Wagamama', () =>
            this.cached('wagamama', () => this.runScraper(new WagamamaScraper())))
    }

    async scrapeDominos (): Promise<RestaurantData> {
        return this.scrapeIfEnabled('DOMINOS', "Domino's", () =>
            this.cached('dominos', () => this.runScraper(new DominosScraper())))
    }

    async scrapeNandos (): Promise<RestaurantData> {
        return this.scrapeIfEnabled('NANDOS', "Nando's", () =>
            this.cached('nandos', () => this.runScraper(new NandosScraper())))
    }

    async scrapeAll (): Promise<RestaurantsData> {
        const startTime = performance.now()

        console.log(chalk.yellow('🚀 Starting nutrition data scraping...\n'))

        const [
            popeyesResults,
            kfcResults,
            wendysResults,
            mcdonaldsResults,
            subwayResults,
            tacoBellResults,
            wagamamaResults,
            dominosResults,
            nandosResults
        ] = await Promise.all([
            this.scrapePopeyes(),
            this.scrapeKFC(),
            this.scrapeWendys(),
            this.scrapeMcdonalds(),
            this.scrapeSubway(),
            this.scrapeTacoBell(),
            this.scrapeWagamama(),
            this.scrapeDominos(),
            this.scrapeNandos()
        ])

        this.restaurants.Popeyes = popeyesResults
        this.restaurants.KFC = kfcResults
        this.restaurants.Wendys = wendysResults
        this.restaurants.McDonalds = mcdonaldsResults
        this.restaurants.Subway = subwayResults
        this.restaurants.TacoBell = tacoBellResults
        this.restaurants.Wagamama = wagamamaResults
        this.restaurants.Dominos = dominosResults
        this.restaurants.Nandos = nandosResults

        // Save data to files for debugging and caching
        for (const [restaurant, data] of Object.entries(this.restaurants)) {
            try {
                await fs.writeFile(
                    `${restaurant.toLowerCase()}_nutrition.json`,
                    JSON.stringify(data, null, 2)
                )
            } catch (error) {
                console.error(
                    chalk.red(`Error saving ${restaurant} data: ${error}`)
                )
            }
        }

        const endTime = performance.now()
        const duration = ((endTime - startTime) / 1000).toFixed(1)

        console.log(
            chalk.yellow(`\n⏱️  Scraping completed in ${duration} seconds`)
        )

        return this.restaurants
    }

    async scrapeRestaurant (restaurant: string): Promise<RestaurantData | undefined> {
        switch (restaurant.toLowerCase()) {
            case 'kfc':
                return this.scrapeKFC()
            case 'popeyes':
                return this.scrapePopeyes()
            case 'mcdonalds':
            case "mcdonald's":
                return this.scrapeMcdonalds()
            case 'wendys':
            case "wendy's":
                return this.scrapeWendys()
            case 'subway':
                return this.scrapeSubway()
            case 'tacobell':
            case 'taco bell':
            case 'taco-bell':
                return this.scrapeTacoBell()
            case 'wagamama':
                return this.scrapeWagamama()
            case 'dominos':
            case "domino's":
            case 'dominoes':
                return this.scrapeDominos()
            case 'nandos':
            case "nando's":
                return this.scrapeNandos()
            default:
                console.log(chalk.red(`\n❌ Unknown restaurant: ${restaurant}`))
                return
        }
    }
}
