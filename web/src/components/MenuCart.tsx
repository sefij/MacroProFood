import type { MenuItem, TargetMacros } from '../macro'
import type { MenuState } from '../menu'
import { round } from '../format'
import { categoryIcon } from '../category'
import { MacroStatusGrid } from './MacroStatusGrid'

interface Props {
    meal: MenuState
    totals: TargetMacros
    targets: TargetMacros
    onAdd: (item: MenuItem) => void
    onRemove: (item: MenuItem) => void
    onTrack: () => void
}

const prettyName = (name: string) => name.replace(/_/g, ' ')

/**
 * Desktop-only sticky sidebar next to the menu list (see `.menu-cart` /
 * `.menu-layout` in styles.css) — unlike `StickySummary`'s bottom bar, which
 * only totals the meal, this lists every line so it's actually possible to
 * see what's been added without scrolling back up through a long menu.
 * `StickySummary` still covers narrower widths, where there's no room beside
 * the menu for a sidebar; both drive the same `menuMeal` state in `App.tsx`.
 */
export function MenuCart ({ meal, totals, targets, onAdd, onRemove, onTrack }: Props) {
    const lines = Array.from(meal.entries())

    return (
        <aside className="menu-cart card">
            <h2>Your meal</h2>

            {lines.length === 0 ? (
                <p className="small muted">Add items from the menu to build your meal.</p>
            ) : (
                <ul className="menu-cart-list">
                    {lines.map(([key, { item, qty }]) => (
                        <li key={key} className="menu-cart-row">
                            <div className="menu-cart-row-info">
                                <span className="mi-name">
                                    {prettyName(item.name)}
                                    {categoryIcon(item.category) && (
                                        <span className="cat-badge" title={item.category}>
                                            {categoryIcon(item.category)}
                                        </span>
                                    )}
                                </span>
                                <span className="menu-row-macros">
                                    {round(item.calories * qty)} cal ·{' '}
                                    {round(item.protein * qty, 1)}p ·{' '}
                                    {round(item.fat * qty, 1)}f ·{' '}
                                    {round(item.carbs * qty, 1)}c
                                </span>
                            </div>
                            <div className="stepper">
                                <button type="button" onClick={() => onRemove(item)}>−</button>
                                <span>{qty}</span>
                                <button type="button" onClick={() => onAdd(item)}>+</button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <MacroStatusGrid totals={totals} targets={targets} />
            <button className="btn btn-primary" onClick={onTrack} disabled={lines.length === 0}>
                {lines.length === 0 ? 'Add an item first' : 'Track this meal'}
            </button>
        </aside>
    )
}
