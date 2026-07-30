/**
 * Quick, cross-restaurant category-exclusion presets ("No sides", "No
 * drinks", "No desserts", "No breakfast") for the web app's restaurant
 * picker.
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
 *  - "No sides" also catches dips/sauces/condiments (`'dips'`, `'sauce'`,
 *    `'condiment'`) — someone excluding sides almost certainly wants the
 *    dip-with-fries extras gone too, and without these, the preset was
 *    actually inconsistent: KFC's "Sides & Dips" already matched on `'side'`
 *    alone, but Burger King's/Domino's'/Wingstop's standalone "Dips"
 *    category, Slim Chickens' separate "Sauces", Subway's "Sauces &
 *    Condiments" and Wendy's "Ingredients/Condiments" didn't.
 *  - `'dips'` (not bare `'dip'`) — bare `'dip'` also caught Domino's "Chick
 *    'N' Dip" / "Chick 'N' Dip Combos" on the word alone, which read like a
 *    false positive at first (they're chicken tenders/wings/boneless bites,
 *    and full meal combos up to ~1200 kcal, not literally a dip); Domino's
 *    separately has a genuine plural "Dips" category the plural still
 *    catches. On reflection though, both "Chick 'N' Dip" categories *are*
 *    what Domino's treats as a side — chicken ordered alongside a pizza, the
 *    same role as garlic bread or wedges, combos included. Since that's
 *    true only at Domino's and the phrase is specific enough not to
 *    coincidentally appear anywhere else, it's matched as its own literal
 *    phrase (`"chick 'n' dip"`) rather than folded into a keyword general
 *    enough to risk matching other restaurants' actual chicken mains (e.g.
 *    KFC's "Just Chicken", McDonald's "Chicken") — a one-off, not a pattern.
 *  - `'fries'` — most restaurants file fries under "Sides" (or "Fries &
 *    Sides", "Sides & Dips", already caught by `'side'`), but Five Guys'
 *    fries category is standalone, just "Fries", and Wingstop's are three
 *    standalone categories ("Fries", "Sweet Potato Fries", "Loaded Fries"),
 *    none containing "side" at all — missed entirely until this was added.
 *  - `'extra'` — catches Wagamama's and Nando's bare "Extras" categories
 *    (sauces, pickles, egg, cheese, breakfast add-ons); Nando's "Dips &
 *    Extras" was already caught via `'dips'`.
 *  - `'toppings'` is an *exact* match, not a keyword — Subway's "Toppings"
 *    category (Chilli Flakes, Crispy Onions) is genuinely a side/extra, but a
 *    plain `'topping'` keyword would also match inside Wendy's "Salads
 *    Includes Toppings & Dressings", which is a salad category, not an
 *    extras one. Matching the whole category name instead of a substring
 *    avoids that false positive.
 *  - "No breakfast" needs only bare `'breakfast'` — every real variant found
 *    (Burger King's/itsu's/Popeyes'/Wendy's plain "Breakfast", Nando's
 *    "Breakfast Rolls") already contains the word; no synonym ("morning",
 *    etc.) turned up anywhere in the current data.
 *  - `'shake'` is deliberately in *both* "No drinks" and "No desserts" —
 *    Five Guys' "Shakes", Slim Chickens' "Handspun Shakes" and Wingstop's
 *    "Milkshakes" read as either, so excluding either preset excludes them,
 *    confirmed with the user rather than picked unilaterally.
 *  - Genuinely ambiguous categories are still left unmatched where no
 *    keyword reasonably predicts them: Wendy's "Frosty®" for desserts is a
 *    proper-noun product name, not a describable pattern.
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
    /**
     * Exact (whole-category, case-insensitive) matches, checked alongside
     * `keywords` but never as a substring. Reserved for cases where a plain
     * keyword would also match inside an unrelated, longer category name —
     * see `'toppings'` below.
     */
    exact?: string[]
}

export const CATEGORY_PRESETS: CategoryPreset[] = [
    {
        key: 'sides',
        label: 'No sides',
        keywords: ['side', 'fries', 'dips', 'sauce', 'condiment', "chick 'n' dip", 'extra'],
        exact: ['toppings']
    },
    { key: 'drinks', label: 'No drinks', keywords: ['drink', 'beverage', 'shake'] },
    { key: 'desserts', label: 'No desserts', keywords: ['dessert', 'sweet treat', 'churro', 'cookie', 'shake'] },
    { key: 'breakfast', label: 'No breakfast', keywords: ['breakfast'] }
]

/** One restaurant's available categories, as surfaced by the web app's category-group builder. */
export interface CategoryGroupLike {
    restaurant: string
    categories: string[]
}

/** Categories (case-insensitive substring match against any of the preset's keywords, or exact match against `preset.exact`) that this preset catches. */
export function matchingCategories (categories: string[], preset: CategoryPreset): string[] {
    return categories.filter((category) => {
        const lower = category.toLowerCase()
        if (preset.keywords.some((keyword) => lower.includes(keyword))) return true
        return (preset.exact ?? []).some((phrase) => lower === phrase)
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
