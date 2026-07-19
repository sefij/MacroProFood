import type { RestaurantCategoryFilter } from '../../../src/core/category-filter'
import { categoryIcon } from '../category'

type Mode = RestaurantCategoryFilter['mode']

const MODE_LABEL: Record<Mode, string> = {
    all: 'Include all',
    include: 'Include selected',
    exclude: 'Exclude selected'
}

const DEFAULT_FILTER: RestaurantCategoryFilter = { mode: 'all', categories: [] }

/** One restaurant's categories, ready to render as its own filter group. */
export interface RestaurantCategoryGroup {
    /** Display name — also the key into `filters` and `RestaurantsData`. */
    restaurant: string
    icon: string
    /** Every category present in this restaurant's currently loaded items, sorted. */
    categories: string[]
}

interface Props {
    groups: RestaurantCategoryGroup[]
    /** Keyed by restaurant display name; a restaurant with no entry behaves as 'all'. */
    filters: Record<string, RestaurantCategoryFilter>
    onModeChange: (restaurant: string, mode: Mode) => void
    onToggleCategory: (restaurant: string, category: string) => void
}

/**
 * Collapsible "Advanced filters" row nested inside the restaurant picker
 * card, with one filter group per active restaurant — its own mode (include
 * everything / only selected categories / everything but selected
 * categories) and, once a non-"all" mode is picked, its own row of toggleable
 * category chips. Filtering is applied per restaurant via
 * `filterCategoriesByRestaurant` in `toRestaurantsData`.
 */
export function CategoryFilters ({ groups, filters, onModeChange, onToggleCategory }: Props) {
    if (groups.length === 0) return null

    const activeCount = groups.filter((g) => {
        const f = filters[g.restaurant]
        return f && f.mode !== 'all' && f.categories.length > 0
    }).length

    return (
        <details className="filters">
            <summary>
                Advanced filters{activeCount > 0 ? ` — ${activeCount} restaurant${activeCount === 1 ? '' : 's'} filtered` : ''}
            </summary>

            {groups.map((group) => {
                const filter = filters[group.restaurant] ?? DEFAULT_FILTER
                return (
                    <div className="restaurant-filter" key={group.restaurant}>
                        <div className="restaurant-filter-head">
                            <span className="icon">{group.icon}</span>
                            <span className="name">{group.restaurant} categories</span>
                        </div>

                        <div className="mode-select">
                            {(Object.keys(MODE_LABEL) as Mode[]).map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    className={`mode-btn${filter.mode === mode ? ' active' : ''}`}
                                    onClick={() => onModeChange(group.restaurant, mode)}
                                >
                                    {MODE_LABEL[mode]}
                                </button>
                            ))}
                        </div>

                        {filter.mode !== 'all' && (
                            <div className="chips">
                                {group.categories.map((category) => {
                                    const icon = categoryIcon(category)
                                    const isSelected = filter.categories.includes(category)
                                    return (
                                        <button
                                            key={category}
                                            type="button"
                                            className={`filter-chip${isSelected ? ' selected' : ''}`}
                                            onClick={() => onToggleCategory(group.restaurant, category)}
                                        >
                                            {icon && <span className="icon">{icon}</span>}
                                            <span className="name">{category}</span>
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                )
            })}
        </details>
    )
}
