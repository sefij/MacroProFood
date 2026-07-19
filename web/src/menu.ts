/**
 * Pure state helpers for menu mode's manual meal builder — kept separate from
 * `App.tsx` so `MenuBuilder`/`StickySummary` can share the same key scheme
 * and totals math without reaching into app state directly.
 */
import type { MenuItem, TargetMacros } from './macro'

export interface MenuEntry {
    item: MenuItem
    qty: number
}

/** Keyed so the same item name from two different restaurants stays distinct. */
export type MenuState = Map<string, MenuEntry>

export function menuItemKey (item: Pick<MenuItem, 'restaurant' | 'name'>): string {
    return `${item.restaurant}::${item.name}`
}

/** The single restaurant a menu-mode meal's items currently belong to, or `null` if empty. */
export function menuRestaurant (meal: MenuState): string | null {
    return meal.values().next().value?.item.restaurant ?? null
}

/** Sums an in-progress menu-mode meal into the same shape the optimizer uses. */
export function menuTotals (meal: MenuState): TargetMacros {
    const totals: TargetMacros = { calories: 0, protein: 0, fat: 0, carbs: 0 }
    for (const { item, qty } of meal.values()) {
        totals.calories += item.calories * qty
        totals.protein += item.protein * qty
        totals.fat += item.fat * qty
        totals.carbs += item.carbs * qty
    }
    return totals
}
