import chalk from 'chalk'
import { Browser, chromium } from 'playwright'
import { RestaurantData } from './core/types'

// Re-export the pure data types from the dependency-free core module so that
// existing `import { ... } from './types'` call sites keep working unchanged.
export * from './core/types'

export abstract class SourceScraper {
    protected browser: Browser | null = null
    async initialize (): Promise<void> {
        this.browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        })
    }
    abstract scrape (): Promise<RestaurantData>
}

/**
 * Base class for restaurants whose nutrition comes from a bundled JSON
 * snapshot (`store.ts`) instead of a live scrape.
 *
 * ⚠️ The snapshot is a hand-captured, point-in-time copy of the restaurant's
 * menu. It does not hit the network, so it is fast and deterministic — but it
 * **will go stale**: menus change, items get reformulated, and figures drift
 * from what the restaurant currently publishes. Re-capture the corresponding
 * `store.ts` periodically to keep the data accurate.
 */
export class JsonScraper<
    T extends {
        name: string
        calories: number
        protein: number
        fat: number
        carbs: number
        proteinToCalRatio: number
        carbToCalRatio: number
    }[]
> extends SourceScraper {
    protected jsonData: T
    protected name: string
    protected icon: string
    async scrape () {
        console.log(chalk.blue(`${this.icon} Loading ${this.name} data from json...`))

        try {
            const items: RestaurantData = {}
            for (const entry of this.jsonData) {
                // Normalize keys and extract nutrition
                const { name, calories, protein, fat, carbs } = entry
                items[name] = {
                    calories,
                    protein,
                    fat,
                    carbs,
                    ProteinTCalRatio: protein / calories || 1,
                    CarbToCalRatio: carbs / calories || 1
                }
            }
            console.log(
                chalk.green(
                    `✓ Loaded ${Object.keys(items).length} ${this.name} items`
                )
            )
            return items
        } catch (error) {
            console.error(
                chalk.red(
                    `Error loading ${this.name.toLowerCase()} json: ${error}`
                )
            )
            return {}
        }
    }
}

// NutritionData, MenuItem, RestaurantData, RestaurantsData, OptimizationResult,
// OptimizationResults and TargetMacros now live in ./core/types and are
// re-exported above via `export * from './core/types'`.
