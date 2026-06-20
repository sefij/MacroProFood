import type { RestaurantIndexEntry } from '../macro'
import { staleness } from '../format'

interface Props {
    restaurants: RestaurantIndexEntry[]
    selected: Set<string>
    onToggle: (key: string) => void
    useAll: boolean
    onUseAll: (v: boolean) => void
}

export function RestaurantPicker ({ restaurants, selected, onToggle, useAll, onUseAll }: Props) {
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

            <div className="chips">
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
                            <span className="name">{r.restaurant}</span>
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
