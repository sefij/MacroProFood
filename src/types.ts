import { Browser, chromium } from 'playwright'
import { RestaurantData } from './core/types.js'

// Re-export the pure data types from the dependency-free core module so that
// existing `import { ... } from './types'` call sites keep working unchanged.
export * from './core/types.js'

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
    /** Closes the browser launched by {@link initialize}, if any (HTTP-only scrapers never launch one). */
    async close (): Promise<void> {
        await this.browser?.close()
    }
    abstract scrape (): Promise<RestaurantData>
}

// NutritionData, MenuItem, RestaurantData, RestaurantsData, OptimizationResult,
// OptimizationResults and TargetMacros now live in ./core/types and are
// re-exported above via `export * from './core/types'`.
