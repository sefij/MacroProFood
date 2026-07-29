/**
 * Quick, cross-restaurant category-exclusion presets ("No sides", "No
 * drinks", "No desserts") for the web app's restaurant picker.
 *
 * Category names aren't standardized across restaurants — "Drinks" also
 * shows up as "Drinks & Coffee", "Beverages", "Cold Drinks", "Alcoholic
 * Drinks"; "Desserts" as "Krushems & Desserts", "Sourdough Desserts",
 * "Sweet Treats", "Churros", "Cookies" — so a hand-curated per-restaurant
 * mapping would need real per-restaurant upkeep as menus change. Keyword
 * substring-matching (case-insensitive) instead scales to new restaurants
 * for free, checked against every restaurant's real scraped categories
 * (July 2026) to land on a list that's broad enough to catch the real
 * variants above without over-matching:
 *
 *  - `'sweet treat'` (not bare `'sweet'`) — bare `'sweet'` would also catch
 *    Wingstop's "Sweet Potato Fries", a side, not a dessert.
 *  - Genuinely ambiguous categories are left unmatched by every preset
 *    rather than guessed at: "Shakes"/"Milkshakes"/"Handspun Shakes" (Five
 *    Guys, Wingstop, Slim Chickens) could read as either a drink or a
 *    dessert. So can Wendy's "Frosty®" for desserts — a proper-noun product
 *    name no keyword list reasonably predicts.
 *
 * This is a real, documented tradeoff of the keyword approach over a
 * per-category mapping: broad coverage with occasional misses, not
 * precision. See {@link matchingCategories}.
 */
import { RestaurantCategoryFilter } from './category-filter'

export interface CategoryPreset {
    key: string
    label: string
    keywords: string[]
}

export const CATEGORY_PRESETS: CategoryPreset[] = [
    { key: 'sides', label: 'No sides', keywords: ['side'] },
    { key: 'drinks', label: 'No drinks', keywords: ['drink', 'beverage'] },
    { key: 'desserts', label: 'No desserts', keywords: ['dessert', 'sweet treat', 'churro', 'cookie'] }
]

/** One restaurant's available categories, as surfaced by the web app's category-group builder. */
export interface CategoryGroupLike {
    restaurant: string
    categories: string[]
}

/** Categories (case-insensitive substring match against any of the preset's keywords) that this preset catches. */
export function matchingCategories (categories: string[], preset: CategoryPreset): string[] {
    return categories.filter((category) => {
        const lower = category.toLowerCase()
        return preset.keywords.some((keyword) => lower.includes(keyword))
    })
}

/**
 * Whether every category `preset` matches, across every group, is already
 * excluded — i.e. whether the preset currently reads as "on". `false` when
 * the preset matches nothing anywhere (nothing to toggle, so not "active").
 */
export function isPresetActive (
    groups: CategoryGroupLike[],
    filters: Record<string, RestaurantCategoryFilter>,
    preset: CategoryPreset
): boolean {
    let matchedAnything = false
    for (const group of groups) {
        const matches = matchingCategories(group.categories, preset)
        if (matches.length === 0) continue
        matchedAnything = true
        const filter = filters[group.restaurant]
        if (!filter || filter.mode !== 'exclude') return false
        if (!matches.every((c) => filter.categories.includes(c))) return false
    }
    return matchedAnything
}

/**
 * Applies (activating) or lifts (deactivating) a preset's exclusions across
 * every group at once, merging into whatever each restaurant's filter
 * already excludes rather than replacing it. Restaurants currently in
 * `'include'` mode are left untouched — merging a global "no X" preset into
 * a manually-curated include-list would silently discard that list, which is
 * more surprising than just not touching it. Pure — returns a new filters
 * object.
 */
export function togglePreset (
    groups: CategoryGroupLike[],
    filters: Record<string, RestaurantCategoryFilter>,
    preset: CategoryPreset
): Record<string, RestaurantCategoryFilter> {
    const activating = !isPresetActive(groups, filters, preset)
    const next = { ...filters }

    for (const group of groups) {
        const matches = matchingCategories(group.categories, preset)
        if (matches.length === 0) continue

        const current = next[group.restaurant] ?? { mode: 'all' as const, categories: [] }
        if (current.mode === 'include') continue

        if (activating) {
            const merged = Array.from(new Set([...(current.mode === 'exclude' ? current.categories : []), ...matches]))
            next[group.restaurant] = { mode: 'exclude', categories: merged }
        } else {
            const remaining = current.categories.filter((c) => !matches.includes(c))
            next[group.restaurant] =
                remaining.length > 0 ? { mode: 'exclude', categories: remaining } : { mode: 'all', categories: [] }
        }
    }

    return next
}
