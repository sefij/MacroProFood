/**
 * Shared insertion helper for every scraper's `RestaurantData` map.
 *
 * `RestaurantData` is keyed by item name, so two genuinely distinct items
 * sharing a name (e.g. Wendy's listing "4 Pc Chicken Nuggets" under two
 * different menus with different macros) would otherwise silently overwrite
 * one another — losing a candidate from the optimizer and misreporting the
 * scraped count. Every scraper routes insertions through {@link addItem}
 * instead of assigning `items[name] = nutrition` directly.
 */
import chalk from 'chalk'
import { NutritionData, RestaurantData } from '../core/types'

export type AddItemOutcome =
    /** No prior entry under this name (or any of its qualified variants). */
    | { kind: 'inserted'; key: string }
    /** Same name, identical macros as an existing entry — almost certainly
     *  the same product listed twice (e.g. under two menu sections); the
     *  existing entry is kept and this one is dropped silently. */
    | { kind: 'duplicate' }
    /** Same name, different macros — a distinct item. Inserted under a
     *  requalified key (by category if available and free, else a numeric
     *  suffix); the first collision also moves the original entry. */
    | { kind: 'renamed'; key: string }

const MACRO_KEYS = ['calories', 'protein', 'fat', 'carbs'] as const

function sameMacros (a: NutritionData, b: NutritionData): boolean {
    return MACRO_KEYS.every((k) => a[k] === b[k])
}

function escapeRegExp (value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Every key already in `items` that belongs to `name`'s family: itself, or a `"name (…)"` variant. */
function variantKeysOf (items: RestaurantData, name: string): string[] {
    const qualified = new RegExp(`^${escapeRegExp(name)} \\(.+\\)$`)
    return Object.keys(items).filter((key) => key === name || qualified.test(key))
}

export function addItem (
    items: RestaurantData,
    name: string,
    nutrition: NutritionData
): AddItemOutcome {
    const variants = variantKeysOf(items, name)

    if (variants.length === 0) {
        items[name] = nutrition
        return { kind: 'inserted', key: name }
    }

    // A duplicate of *any* existing variant (not just the bare name — a third
    // occurrence of an already-split name must check the split-off entries
    // too, or it would wrongly be treated as a fresh, distinct item) is the
    // same product listed again: keep what's there, drop the newcomer.
    if (variants.some((key) => sameMacros(items[key], nutrition))) {
        return { kind: 'duplicate' }
    }

    // Genuine new variant. When the bare name is itself the colliding entry
    // and both items have distinct categories, neither is more "primary" —
    // both move to a category-qualified key. Otherwise (categories missing,
    // equal, or the bare name was already moved by an earlier collision) the
    // established entry keeps its key untouched, and only the newcomer gets
    // the next free numeric suffix — so an item's display name doesn't churn
    // just because something else with the same name showed up later.
    const bareEntry = items[name]
    if (bareEntry && bareEntry.category && nutrition.category && bareEntry.category !== nutrition.category) {
        const existingKey = `${name} (${bareEntry.category})`
        const newKey = `${name} (${nutrition.category})`
        delete items[name]
        items[existingKey] = bareEntry
        items[newKey] = nutrition
        console.log(chalk.yellow(`  ⚠ "${name}" collides — split into "${existingKey}" / "${newKey}"`))
        return { kind: 'renamed', key: newKey }
    }

    let n = 2
    while (items[`${name} (${n})`]) n++
    const newKey = `${name} (${n})`
    items[newKey] = nutrition
    console.log(chalk.yellow(`  ⚠ "${name}" collides — added as "${newKey}"`))
    return { kind: 'renamed', key: newKey }
}

/**
 * Inserts one variant of a base item (spec 10) — e.g. `addVariant(items,
 * "Margherita", "Size", "Large Pan", nutrition)`.
 *
 * The entry is stored flat, keyed `"<base> (<option>)"`, so the optimizer and
 * every existing consumer treat it as an ordinary item (a picked variant reads
 * "Margherita (Large Pan)" in results). The base/group/option names are also
 * stamped onto the nutrition so `build-web-data` can regroup the flat entries
 * into one variant {@link SnapshotItem} without parsing keys. Collision
 * handling is inherited from {@link addItem} on the composed key.
 */
export function addVariant (
    items: RestaurantData,
    baseName: string,
    groupLabel: string,
    optionLabel: string,
    nutrition: NutritionData
): AddItemOutcome {
    nutrition.variantOf = baseName
    nutrition.variantGroupLabel = groupLabel
    nutrition.variantOption = optionLabel
    return addItem(items, `${baseName} (${optionLabel})`, nutrition)
}
