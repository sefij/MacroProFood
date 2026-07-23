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
    /**
     * Variant grouping metadata (see spec 10). Set only for entries emitted via
     * `addVariant` — a variant carries its base name here so `build-web-data`
     * can regroup the flat entries into one variant {@link SnapshotItem} without
     * parsing names. The optimizer ignores these fields entirely: a variant is
     * still a plain flat entry keyed `"<base> (<option>)"`, exactly like any
     * other item.
     */
    variantOf?: string
    /** The variant group's selector heading, e.g. "Size". */
    variantGroupLabel?: string
    /** This variant's option label, e.g. "Large Pan". */
    variantOption?: string
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

/** Macro-only view of {@link NutritionData} — the four macros, none of the per-item metadata. */
type MacroTotals = Omit<
    NutritionData,
    'ProteinTCalRatio' | 'CarbToCalRatio' | 'category' | 'variantOf' | 'variantGroupLabel' | 'variantOption'
>

export interface OptimizationResult {
    items: MenuItem[]
    // A combo's total/accuracy have no single category (nor per-item variant
    // metadata), so those are dropped along with the ratio fields rather than
    // inherited as optional.
    totalNutrition: MacroTotals
    accuracy: MacroTotals
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

/** One selectable variant of a menu item (a size/crust/count), with its own absolute macros. */
export interface ItemVariant {
    /** Option label shown in the selector, e.g. "Large Pan", "Regular", "6 wings". */
    label: string
    calories: number
    protein: number
    fat: number
    carbs: number
}

/**
 * A single menu item as stored in the web snapshot files.
 *
 * Simple items carry their macros inline (the common case, unchanged). A
 * *variant item* (spec 10) additionally carries a {@link variants} list — the
 * inline macros then hold the default/representative variant (the
 * median-calorie one), so consumers that read the flat macros still show a
 * sensible value, while variant-aware UI reads {@link variants}.
 */
export interface SnapshotItem {
    name: string
    calories: number
    protein: number
    fat: number
    carbs: number
    category?: string
    /** Present on a variant item: the selectable options. Absent on simple items. */
    variants?: ItemVariant[]
    /** The variant selector's heading, e.g. "Size". Present iff {@link variants} is. */
    variantLabel?: string
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
