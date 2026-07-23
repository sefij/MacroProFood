import { useMemo, useState } from 'react'
import type { ItemVariant, MenuItem, RestaurantIndexEntry, SnapshotItem } from '../macro'
import { round } from '../format'
import { categoryIcon } from '../category'
import { menuItemKey, type MenuState } from '../menu'

const prettyName = (name: string) => name.replace(/_/g, ' ')

/** The default-selected variant index: the median-calorie option (ties → lower). */
function medianVariantIndex (variants: ItemVariant[]): number {
    const order = variants
        .map((v, i) => [v.calories, i] as const)
        .sort((a, b) => a[0] - b[0])
    return order[Math.floor((order.length - 1) / 2)][1]
}

const macroLine = (m: { calories: number; protein: number; fat: number; carbs: number }) =>
    `${round(m.calories)} cal · ${round(m.protein, 1)}p · ${round(m.fat, 1)}f · ${round(m.carbs, 1)}c`

interface MenuItemListProps {
    /** The restaurant's full item list to search/browse. */
    items: SnapshotItem[]
    /** Tags items added to the meal. */
    restaurantName: string
    meal: MenuState
    onAdd: (item: MenuItem) => void
    onRemove: (item: MenuItem) => void
}

/**
 * The search box + category-grouped, add/stepper item list — the reusable
 * core of menu mode, shared by `MenuBuilder` (the full restaurant-switching
 * browser) and `TrackPanel`'s "+ Add from menu" section (spec 07, scoped to
 * whichever restaurant the tracked meal is already for).
 */
export function MenuItemList ({ items, restaurantName, meal, onAdd, onRemove }: MenuItemListProps) {
    const [search, setSearch] = useState('')
    const hasSearch = search.trim() !== ''

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
        <>
            <input
                type="search"
                className="menu-search"
                placeholder="Search menu…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
            />

            {groups.map(([category, catItems]) => (
                <details className="menu-group" key={category} open={hasSearch}>
                    <summary className="menu-group-title">
                        {category}
                        <span className="menu-group-count">{catItems.length}</span>
                    </summary>
                    <ul className="menu-list">
                        {catItems.map((it) => (
                            <MenuRow
                                key={it.name}
                                item={it}
                                restaurantName={restaurantName}
                                meal={meal}
                                onAdd={onAdd}
                                onRemove={onRemove}
                            />
                        ))}
                    </ul>
                </details>
            ))}

            {groups.length === 0 && (
                <p className="small muted">No items match "{search}".</p>
            )}
        </>
    )
}

interface MenuRowProps {
    item: SnapshotItem
    restaurantName: string
    meal: MenuState
    onAdd: (item: MenuItem) => void
    onRemove: (item: MenuItem) => void
}

/**
 * One item row. A simple item shows its macros directly; a variant item
 * (spec 10) adds a size selector — a segmented control for ≤4 options, a
 * dropdown beyond that — with the median-calorie option selected by default,
 * a calorie range on the name line, and a macro line reflecting the current
 * choice. The `+`/stepper always acts on the *selected* variant, which is
 * added to the meal as a flat `MenuItem` named `"<base> (<option>)"` (so each
 * size is its own meal line and reads correctly in the tracked-meal panel).
 */
function MenuRow ({ item, restaurantName, meal, onAdd, onRemove }: MenuRowProps) {
    const variants = item.variants
    const [sel, setSel] = useState(() =>
        variants ? medianVariantIndex(variants) : 0
    )

    const chosen = variants?.[sel]
    const menuItem: MenuItem = {
        restaurant: restaurantName,
        name: chosen ? `${item.name} (${chosen.label})` : item.name,
        calories: chosen ? chosen.calories : item.calories,
        protein: chosen ? chosen.protein : item.protein,
        fat: chosen ? chosen.fat : item.fat,
        carbs: chosen ? chosen.carbs : item.carbs,
        category: item.category
    }

    const qty = meal.get(menuItemKey(menuItem))?.qty ?? 0
    const icon = categoryIcon(item.category)
    const label = prettyName(item.name)

    let range: string | null = null
    if (variants && variants.length > 0) {
        const cals = variants.map((v) => v.calories)
        range = `${round(Math.min(...cals))}–${round(Math.max(...cals))} kcal`
    }

    return (
        <li className={`menu-row${variants ? ' has-variants' : ''}`}>
            <div className="menu-row-info">
                <span className="mi-name">
                    {label}
                    {range && <span className="mi-range">{range}</span>}
                    {icon && (
                        <span className="cat-badge" title={item.category}>
                            {icon}
                        </span>
                    )}
                </span>
                <span className="menu-row-macros">{macroLine(menuItem)}</span>

                {variants && chosen && (
                    <div className="variant-picker">
                        <span className="variant-label">{item.variantLabel ?? 'Option'}</span>
                        {variants.length <= 4 ? (
                            <div className="variant-seg" role="group" aria-label={item.variantLabel ?? 'Option'}>
                                {variants.map((v, i) => (
                                    <button
                                        key={v.label}
                                        type="button"
                                        className={`variant-seg-btn${i === sel ? ' active' : ''}`}
                                        aria-pressed={i === sel}
                                        onClick={() => setSel(i)}
                                    >
                                        {v.label}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <select
                                className="variant-select"
                                value={sel}
                                aria-label={item.variantLabel ?? 'Option'}
                                onChange={(e) => setSel(Number(e.target.value))}
                            >
                                {variants.map((v, i) => (
                                    <option key={v.label} value={i}>
                                        {v.label} — {round(v.calories)} kcal
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>
                )}
            </div>

            {qty === 0 ? (
                <button
                    type="button"
                    className="btn-add"
                    onClick={() => onAdd(menuItem)}
                    aria-label={`Add ${prettyName(menuItem.name)}`}
                >
                    +
                </button>
            ) : (
                <div className="stepper">
                    <button type="button" onClick={() => onRemove(menuItem)}>−</button>
                    <span>{qty}</span>
                    <button type="button" onClick={() => onAdd(menuItem)}>+</button>
                </div>
            )}
        </li>
    )
}

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

/**
 * Menu-mode's browse-and-add view: a single-select restaurant row (visually
 * matching `RestaurantPicker`'s chips) wrapping `MenuItemList`. The meal
 * itself lives in `App` state (`meal`) so the sticky summary can total it
 * live and hand it to `TrackPanel` unchanged across restaurant switches.
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
    return (
        <section className="card">
            <h2>Build your own meal</h2>

            <div className="restaurant-grid" style={{ marginBottom: selectedKey ? 14 : 0 }}>
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
                <MenuItemList
                    items={items}
                    restaurantName={restaurantName}
                    meal={meal}
                    onAdd={onAdd}
                    onRemove={onRemove}
                />
            )}
        </section>
    )
}
