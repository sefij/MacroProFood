import { McDonaldsScraper } from './McDonalds/scraper'
import { KFCScraper } from './KFC/scraper'
import { WendysScraper } from './Wendys/scraper'
import { PopeyesScraper } from './Popeyes/scraper'
import { SubwayScraper } from './Subway/scraper'
import { TacoBellScraper } from './TacoBell/scraper'
import { WagamamaScraper } from './Wagamama/scraper'
import { DominosScraper } from './Dominos/scraper'
import { NandosScraper } from './Nandos/scraper'
import { ItsuScraper } from './Itsu/scraper'
import { YoSushiScraper } from './YoSushi/scraper'
import { SlimChickensScraper } from './SlimChickens/scraper'
import { BurgerKingScraper } from './BurgerKing/scraper'
import { PizzaHutScraper } from './PizzaHut/scraper'
import { RestaurantData, RestaurantsData, SourceScraper } from '../types'
import { withCache } from '../cache'
import { RestaurantKey, isScraperDisabled } from '../config'
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

    async scrapeItsu (): Promise<RestaurantData> {
        return this.scrapeIfEnabled('ITSU', 'itsu', () =>
            this.cached('itsu', () => this.runScraper(new ItsuScraper())))
    }

    async scrapeYoSushi (): Promise<RestaurantData> {
        return this.scrapeIfEnabled('YOSUSHI', 'YO! Sushi', () =>
            this.cached('yosushi', () => this.runScraper(new YoSushiScraper())))
    }

    async scrapeSlimChickens (): Promise<RestaurantData> {
        return this.scrapeIfEnabled('SLIMCHICKENS', 'Slim Chickens', () =>
            this.cached('slimchickens', () => this.runScraper(new SlimChickensScraper())))
    }

    async scrapeBurgerKing (): Promise<RestaurantData> {
        return this.scrapeIfEnabled('BURGERKING', 'Burger King', () =>
            this.cached('burgerking', () => this.runScraper(new BurgerKingScraper())))
    }

    async scrapePizzaHut (): Promise<RestaurantData> {
        return this.scrapeIfEnabled('PIZZAHUT', 'Pizza Hut', () =>
            this.cached('pizzahut', () => this.runScraper(new PizzaHutScraper())))
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
            nandosResults,
            itsuResults,
            yoSushiResults,
            slimChickensResults,
            burgerKingResults,
            pizzaHutResults
        ] = await Promise.all([
            this.scrapePopeyes(),
            this.scrapeKFC(),
            this.scrapeWendys(),
            this.scrapeMcdonalds(),
            this.scrapeSubway(),
            this.scrapeTacoBell(),
            this.scrapeWagamama(),
            this.scrapeDominos(),
            this.scrapeNandos(),
            this.scrapeItsu(),
            this.scrapeYoSushi(),
            this.scrapeSlimChickens(),
            this.scrapeBurgerKing(),
            this.scrapePizzaHut()
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
        this.restaurants.Itsu = itsuResults
        this.restaurants.YoSushi = yoSushiResults
        this.restaurants.SlimChickens = slimChickensResults
        this.restaurants.BurgerKing = burgerKingResults
        this.restaurants.PizzaHut = pizzaHutResults

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
            case 'itsu':
                return this.scrapeItsu()
            case 'yosushi':
            case 'yo sushi':
            case 'yo! sushi':
                return this.scrapeYoSushi()
            case 'slimchickens':
            case 'slim chickens':
                return this.scrapeSlimChickens()
            case 'burgerking':
            case 'burger king':
            case 'bk':
                return this.scrapeBurgerKing()
            case 'pizzahut':
            case 'pizza hut':
                return this.scrapePizzaHut()
            default:
                console.log(chalk.red(`\n❌ Unknown restaurant: ${restaurant}`))
                return
        }
    }
}
