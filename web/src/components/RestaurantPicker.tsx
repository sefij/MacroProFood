import type { RestaurantIndexEntry } from '../macro'
import type { DietaryRestriction } from '../../../src/core/item-filters'
import { staleness } from '../format'

interface Props {
    restaurants: RestaurantIndexEntry[]
    selected: Set<string>
    onToggle: (key: string) => void
    useAll: boolean
    onUseAll: (v: boolean) => void
    dietaryRestriction: DietaryRestriction
    /** Restaurant display names with any confirmed dietary data. */
    restaurantsWithDietaryData: Set<string>
}

/**
 * Restaurant selection only — which restaurants are in scope. Every actual
 * filter (dietary, dish exclusions, category quick/advanced filters) lives
 * in `Filters`, rendered once above the Optimize/Menu Mode split.
 */
export function RestaurantPicker ({
    restaurants,
    selected,
    onToggle,
    useAll,
    onUseAll,
    dietaryRestriction,
    restaurantsWithDietaryData
}: Props) {
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
                    const noDietaryData = dietaryRestriction !== 'none' && !restaurantsWithDietaryData.has(r.restaurant)
                    return (
                        <button
                            key={r.key}
                            className={`chip${isOn && !empty ? ' selected' : ''}${noDietaryData ? ' dimmed' : ''}`}
                            disabled={empty || useAll}
                            title={
                                empty
                                    ? 'No data yet — refresh pending'
                                    : noDietaryData
                                        ? `Updated ${label} — no dietary data yet, hidden while a restriction is active`
                                        : `Updated ${label}`
                            }
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
        </section>
    )
}
