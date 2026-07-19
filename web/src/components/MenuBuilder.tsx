import { useMemo, useState } from 'react'
import type { MenuItem, RestaurantIndexEntry, SnapshotItem } from '../macro'
import { round } from '../format'
import { categoryIcon } from '../category'
import { menuItemKey, type MenuState } from '../menu'

interface Props {
    restaurants: RestaurantIndexEntry[]
    selectedKey: string | null
    onSelectRestaurant: (key: string) => void
    /** The selected restaurant's full item list (empty until one is picked). */
    items: SnapshotItem[]
    /** The selected restaurant's display name — tags items added to the meal. */
    restaurantName: string
    meal: MenuState
    onAdd: (item: MenuItem) => void
    onRemove: (item: MenuItem) => void
}

const prettyName = (name: string) => name.replace(/_/g, ' ')

/**
 * Menu-mode's browse-and-add view: a single-select restaurant row (visually
 * matching `RestaurantPicker`'s chips), a search box, and the menu grouped by
 * category with a `+` button per item that turns into a +/− stepper once
 * added. The meal itself lives in `App` state (`meal`) so the sticky summary
 * can total it live and hand it to `TrackPanel` unchanged across restaurant
 * switches.
 */
export function MenuBuilder ({
    restaurants,
    selectedKey,
    onSelectRestaurant,
    items,
    restaurantName,
    meal,
    onAdd,
    onRemove
}: Props) {
    const [search, setSearch] = useState('')

    const groups = useMemo(() => {
        const q = search.trim().toLowerCase()
        const filtered = q ? items.filter((it) => it.name.toLowerCase().includes(q)) : items
        const byCategory = new Map<string, SnapshotItem[]>()
        for (const it of filtered) {
            const category = it.category ?? 'Other'
            const list = byCategory.get(category) ?? []
            list.push(it)
            byCategory.set(category, list)
        }
        return Array.from(byCategory.entries()).sort(([a], [b]) => a.localeCompare(b))
    }, [items, search])

    return (
        <section className="card">
            <h2>Build your own meal</h2>

            <div className="chips" style={{ marginBottom: selectedKey ? 14 : 0 }}>
                {restaurants
                    .filter((r) => r.itemCount > 0)
                    .map((r) => (
                        <button
                            key={r.key}
                            className={`chip${selectedKey === r.key ? ' selected' : ''}`}
                            onClick={() => onSelectRestaurant(r.key)}
                        >
                            <span className="icon">{r.icon}</span>
                            <span className="name">{r.restaurant}</span>
                        </button>
                    ))}
            </div>

            {!selectedKey && <p className="small muted">Pick a restaurant to browse its menu.</p>}

            {selectedKey && (
                <>
                    <input
                        type="search"
                        className="menu-search"
                        placeholder="Search menu…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />

                    {groups.map(([category, catItems]) => (
                        <div className="menu-group" key={category}>
                            <div className="menu-group-title">{category}</div>
                            <ul className="menu-list">
                                {catItems.map((it) => {
                                    const item: MenuItem = {
                                        restaurant: restaurantName,
                                        name: it.name,
                                        calories: it.calories,
                                        protein: it.protein,
                                        fat: it.fat,
                                        carbs: it.carbs,
                                        category: it.category
                                    }
                                    const qty = meal.get(menuItemKey(item))?.qty ?? 0
                                    const icon = categoryIcon(it.category)
                                    return (
                                        <li className="menu-row" key={it.name}>
                                            <div className="menu-row-info">
                                                <span className="mi-name">
                                                    {prettyName(it.name)}
                                                    {icon && (
                                                        <span className="cat-badge" title={it.category}>
                                                            {icon}
                                                        </span>
                                                    )}
                                                </span>
                                                <span className="menu-row-macros">
                                                    {round(it.calories)} cal · {round(it.protein, 1)}p ·{' '}
                                                    {round(it.fat, 1)}f · {round(it.carbs, 1)}c
                                                </span>
                                            </div>
                                            {qty === 0 ? (
                                                <button
                                                    type="button"
                                                    className="btn-add"
                                                    onClick={() => onAdd(item)}
                                                    aria-label={`Add ${prettyName(it.name)}`}
                                                >
                                                    +
                                                </button>
                                            ) : (
                                                <div className="stepper">
                                                    <button type="button" onClick={() => onRemove(item)}>−</button>
                                                    <span>{qty}</span>
                                                    <button type="button" onClick={() => onAdd(item)}>+</button>
                                                </div>
                                            )}
                                        </li>
                                    )
                                })}
                            </ul>
                        </div>
                    ))}

                    {groups.length === 0 && (
                        <p className="small muted">No items match "{search}".</p>
                    )}
                </>
            )}
        </section>
    )
}
