/**
 * Maps an item's category to a compact emoji badge, by keyword match against
 * the category name. Shared with the (future) category-filter UI (spec 05),
 * so this stays pure lookup logic — no JSX.
 */
const RULES: Array<{ match: RegExp; icon: string }> = [
    { match: /burger/i, icon: '🍔' },
    { match: /chicken|wing|tender|nugget/i, icon: '🍗' },
    { match: /salad/i, icon: '🥗' },
    { match: /dessert|cookie|cake|ice ?cream|sweet/i, icon: '🍰' },
    { match: /drink|beverage|juice|soda|shake|cocktail|beer|cider|wine|coffee|tea/i, icon: '🥤' },
    { match: /sub|wrap|burrito|taco/i, icon: '🥪' },
    { match: /sauce|condiment|topping|extra/i, icon: '🧂' },
    { match: /side|fries|dip/i, icon: '🍟' }
]

const FALLBACK_ICON = '🍽️'

/**
 * The emoji badge for a category, or `null` when there's no category to show
 * (uncategorized items render no badge at all — no fallback noise).
 */
export function categoryIcon (category: string | undefined): string | null {
    if (!category) return null
    return RULES.find((r) => r.match.test(category))?.icon ?? FALLBACK_ICON
}
