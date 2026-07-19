/**
 * Pure data types shared by the CLI, the optimizer core, and the browser app.
 *
 * Nothing here imports `chalk`, `playwright`, or any Node API, so this module
 * is safe to bundle into the Cloudflare web app. The scraper base classes
 * (which do need those deps) live in {@link ../types}, which re-exports
 * everything below for backwards compatibility.
 */

export interface NutritionData {
    calories: number
    protein: number
    fat: number
    carbs: number
    ProteinTCalRatio: number
    CarbToCalRatio: number
    /** Menu section the item was scraped under, e.g. "Burgers", "Desserts". Omitted when the source offers none. */
    category?: string
}

export interface MenuItem {
    restaurant: string
    name: string
    calories: number
    protein: number
    fat: number
    carbs: number
    category?: string
}

export interface RestaurantData {
    [itemName: string]: NutritionData
}

export interface RestaurantsData {
    [restaurantName: string]: RestaurantData | undefined
}

export interface OptimizationResult {
    items: MenuItem[]
    // A combo's total/accuracy have no single category, so 'category' is
    // dropped along with the ratio fields rather than inherited as optional.
    totalNutrition: Omit<NutritionData, 'ProteinTCalRatio' | 'CarbToCalRatio' | 'category'>
    accuracy: Omit<NutritionData, 'ProteinTCalRatio' | 'CarbToCalRatio' | 'category'>
}

export interface OptimizationResults {
    [restaurantName: string]: OptimizationResult[]
}

export interface TargetMacros {
    calories: number
    protein: number
    fat: number
    carbs: number
}

// ---------------------------------------------------------------------------
// Web-app data format (produced by src/tools/build-web-data.ts, consumed by the
// React app under web/). One file per restaurant + an index.json summary.
// ---------------------------------------------------------------------------

/** A single menu item as stored in the web snapshot files. */
export interface SnapshotItem {
    name: string
    calories: number
    protein: number
    fat: number
    carbs: number
    category?: string
}

/** How a restaurant's data is sourced. */
export type SnapshotSource = 'snapshot' | 'live'

/** One restaurant's full nutrition snapshot (`web/public/data/<key>.json`). */
export interface RestaurantSnapshot {
    /** Display name, e.g. "McDonald's". */
    restaurant: string
    /** Stable key used in filenames and selection, e.g. "MCDONALDS". */
    key: string
    /** Emoji icon shown in the picker. */
    icon: string
    /** `snapshot` = hand-captured JSON; `live` = scraped from the website. */
    source: SnapshotSource
    /** ISO timestamp the data was last refreshed. Drives the staleness badge. */
    updatedAt: string
    items: SnapshotItem[]
}

/** A lightweight entry in `web/public/data/index.json`. */
export interface RestaurantIndexEntry {
    restaurant: string
    key: string
    icon: string
    source: SnapshotSource
    updatedAt: string
    itemCount: number
}

/** Top-level `web/public/data/index.json` shape. */
export interface DataIndex {
    /** When the build-web-data tool last ran. */
    generatedAt: string
    restaurants: RestaurantIndexEntry[]
}
