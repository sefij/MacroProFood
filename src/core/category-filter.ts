/**
 * Excludes items whose category matches one of `excludedCategories`
 * (case-insensitive). Items with no category are never excluded.
 *
 * Shared by the CLI (filters scraped `RestaurantsData` before handing it to
 * the optimizer) and the web app (filters inside `toRestaurantsData` as
 * snapshots are loaded) — the same user preference, applied wherever
 * `RestaurantsData` is assembled for optimization. Pure — returns a new
 * object rather than mutating `data`.
 */
import { RestaurantsData } from './types'

export function excludeCategories (
    data: RestaurantsData,
    excludedCategories: string[]
): RestaurantsData {
    if (excludedCategories.length === 0) return data
    const excluded = new Set(excludedCategories.map((c) => c.toLowerCase()))

    const out: RestaurantsData = {}
    for (const [restaurant, items] of Object.entries(data)) {
        if (!items) continue
        const filtered: NonNullable<RestaurantsData[string]> = {}
        for (const [name, nutrition] of Object.entries(items)) {
            if (nutrition.category && excluded.has(nutrition.category.toLowerCase())) continue
            filtered[name] = nutrition
        }
        out[restaurant] = filtered
    }
    return out
}

/**
 * A restaurant's category filter, used by {@link filterCategoriesByRestaurant}.
 *
 * - `'all'` — no filtering; `categories` is ignored.
 * - `'include'` — only items whose category is in `categories` survive. An
 *   uncategorized item never matches an allow-list, so it's dropped.
 * - `'exclude'` — items whose category is in `categories` are dropped;
 *   uncategorized items are never excluded (nothing to match against).
 *
 * An empty `categories` array passes every item through regardless of mode —
 * "include selected" / "exclude selected" with nothing picked yet behaves
 * like "all" rather than hiding (or showing) nothing.
 */
export interface RestaurantCategoryFilter {
    mode: 'all' | 'include' | 'exclude'
    categories: string[]
}

/**
 * Per-restaurant version of {@link excludeCategories}, for the web app's
 * grouped "Advanced filters" UI: each restaurant can independently show
 * everything, opt in to only certain categories, or opt out of certain
 * categories. `filters` is keyed by restaurant display name, matching
 * `RestaurantsData`'s own keys; a restaurant with no entry passes through
 * unfiltered.
 */
export function filterCategoriesByRestaurant (
    data: RestaurantsData,
    filters: Record<string, RestaurantCategoryFilter>
): RestaurantsData {
    const out: RestaurantsData = {}
    for (const [restaurant, items] of Object.entries(data)) {
        if (!items) continue
        const filter = filters[restaurant]
        if (!filter || filter.mode === 'all' || filter.categories.length === 0) {
            out[restaurant] = items
            continue
        }

        const selected = new Set(filter.categories.map((c) => c.toLowerCase()))
        const filtered: NonNullable<RestaurantsData[string]> = {}
        for (const [name, nutrition] of Object.entries(items)) {
            const category = nutrition.category?.toLowerCase()
            const inSelected = category ? selected.has(category) : false
            const keep = filter.mode === 'include' ? inSelected : !inSelected
            if (keep) filtered[name] = nutrition
        }
        out[restaurant] = filtered
    }
    return out
}
