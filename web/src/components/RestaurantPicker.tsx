import type { RestaurantIndexEntry } from '../macro'
import type { RestaurantCategoryFilter } from '../../../src/core/category-filter'
import { CATEGORY_PRESETS, matchingCategories, isPresetActive, type CategoryPreset } from '../../../src/core/category-presets'
import { staleness } from '../format'
import { CategoryFilters, type RestaurantCategoryGroup } from './CategoryFilters'

interface Props {
    restaurants: RestaurantIndexEntry[]
    selected: Set<string>
    onToggle: (key: string) => void
    useAll: boolean
    onUseAll: (v: boolean) => void
    categoryGroups: RestaurantCategoryGroup[]
    categoryFilters: Record<string, RestaurantCategoryFilter>
    onCategoryModeChange: (restaurant: string, mode: RestaurantCategoryFilter['mode']) => void
    onToggleCategory: (restaurant: string, category: string) => void
    onTogglePreset: (preset: CategoryPreset) => void
}

export function RestaurantPicker ({
    restaurants,
    selected,
    onToggle,
    useAll,
    onUseAll,
    categoryGroups,
    categoryFilters,
    onCategoryModeChange,
    onToggleCategory,
    onTogglePreset
}: Props) {
    // Only offer a preset if it actually matches something in the currently
    // active restaurants — a "No drinks" chip that does nothing (e.g. every
    // active restaurant is Chipotle/Five Guys, neither of which has a drinks
    // category at all) is just confusing.
    const relevantPresets = CATEGORY_PRESETS.filter((preset) =>
        categoryGroups.some((group) => matchingCategories(group.categories, preset).length > 0)
    )

    return (
        <section className="card">
            <div className="picker-head">
                <h2 style={{ margin: 0 }}>Where are you eating?</h2>
                <label className="switch">
                    <span>Use all</span>
                    <input
                        type="checkbox"
                        checked={useAll}
                        onChange={(e) => onUseAll(e.target.checked)}
                    />
                    <span className="track" />
                </label>
            </div>

            <div className="restaurant-grid">
                {restaurants.map((r) => {
                    const empty = r.itemCount === 0
                    const { stale, label } = staleness(r.updatedAt)
                    const isOn = useAll || selected.has(r.key)
                    const badgeClass = empty ? 'badge empty' : stale ? 'badge stale' : 'badge'
                    return (
                        <button
                            key={r.key}
                            className={`chip${isOn && !empty ? ' selected' : ''}`}
                            disabled={empty || useAll}
                            title={empty ? 'No data yet — refresh pending' : `Updated ${label}`}
                            onClick={() => onToggle(r.key)}
                        >
                            <span className="icon">{r.icon}</span>
                            <span className="name">
                                {r.restaurant}
                                {r.composed && (
                                    <span
                                        className="composed-mark"
                                        title="Menu composed from a delivery-app dish list plus this restaurant's own ingredient nutrition data — see the note below"
                                    >
                                        *
                                    </span>
                                )}
                            </span>
                            <span className={badgeClass}>
                                {empty ? 'no data' : stale ? `stale · ${label}` : label}
                            </span>
                        </button>
                    )
                })}
            </div>

            {relevantPresets.length > 0 && (
                <div className="preset-section">
                    <div className="preset-label">Quick filters</div>
                    <div className="preset-row">
                        {relevantPresets.map((preset) => {
                            const active = isPresetActive(categoryGroups, categoryFilters, preset)
                            return (
                                <button
                                    key={preset.key}
                                    type="button"
                                    aria-pressed={active}
                                    className={`preset-chip${active ? ' selected' : ''}`}
                                    onClick={() => onTogglePreset(preset)}
                                >
                                    {preset.label}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}

            <CategoryFilters
                groups={categoryGroups}
                filters={categoryFilters}
                onModeChange={onCategoryModeChange}
                onToggleCategory={onToggleCategory}
            />
        </section>
    )
}
