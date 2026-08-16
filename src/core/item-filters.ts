/**
 * Global, cross-restaurant item filters — a dietary restriction and a
 * personal dish exclude-list. Deliberately separate from
 * `category-filter.ts`: that module is per-restaurant and shared by the CLI
 * and the web app; these are web-session-only user preferences that apply
 * the same way regardless of which restaurant an item belongs to.
 *
 * Both operate on {@link SnapshotItem} — the raw per-restaurant snapshot
 * shape — rather than the optimizer's flattened `RestaurantsData`, so a
 * single call from `toRestaurantsData` (before it explodes a variant/build
 * item into one flattened entry per option) covers the optimizer path, and
 * the same call directly filters what Menu Mode browses. A variant or
 * build-your-own item is kept or dropped as one whole unit — there's no
 * per-option dietary tag or per-option name to exclude against.
 *
 * Known limitation: `dietary` is a whole-item property (see
 * `NutritionData.dietary`'s own docblock). A build-your-own item's
 * individual choices (e.g. Chipotle's chicken vs. sofritas) can't be tagged
 * separately — not a problem today (no `build`-item restaurant has dietary
 * data yet), but worth remembering if that changes.
 */
import { SnapshotItem } from './types'

export type DietaryRestriction = 'none' | 'vegetarian' | 'vegan'

/**
 * Filters `items` by dietary restriction and/or a dish-name exclude-list.
 *
 * Dietary: when `dietaryRestriction` isn't `'none'`, an item with no
 * `dietary` tag at all is **dropped** — the opposite default from
 * `category-filter.ts` ("items with no category are never excluded"), and
 * deliberately so: an absent tag means "unconfirmed," not "confirmed not
 * vegetarian," and this project's scrapers never guess a dietary claim from
 * a name or ingredient list. Until more restaurants publish their own
 * vegetarian/vegan listings, activating a restriction will show nothing
 * from restaurants with no dietary data at all.
 *
 * Exclude-list: `excludedDishes` are matched case-insensitively as a
 * substring of the item's name (e.g. "mushroom" matches "Mushroom Swiss
 * Burger"). Blank/whitespace-only terms are ignored.
 */
export function filterSnapshotItems (
    items: SnapshotItem[],
    dietaryRestriction: DietaryRestriction,
    excludedDishes: string[]
): SnapshotItem[] {
    const excluded = excludedDishes
        .map((term) => term.trim().toLowerCase())
        .filter((term) => term.length > 0)

    if (dietaryRestriction === 'none' && excluded.length === 0) return items

    return items.filter((item) => {
        if (dietaryRestriction !== 'none' && !item.dietary?.includes(dietaryRestriction)) {
            return false
        }
        if (excluded.length > 0) {
            const lower = item.name.toLowerCase()
            if (excluded.some((term) => lower.includes(term))) return false
        }
        return true
    })
}
