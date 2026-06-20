import type { OptimizationResult } from '../macro'
import { accuracyColor, accuracyPercent, round } from '../format'
import { avgAccuracyOf } from '../macro'

interface Props {
    combo: OptimizationResult
    selected: boolean
    onSelect: () => void
    onTrack: () => void
}

/** Collapses repeated items ("2× Fries") for a tidier list. */
function groupItems (items: OptimizationResult['items']) {
    const counts = new Map<string, number>()
    const order: string[] = []
    for (const it of items) {
        if (!counts.has(it.name)) order.push(it.name)
        counts.set(it.name, (counts.get(it.name) ?? 0) + 1)
    }
    return order.map((name) => {
        const it = items.find((i) => i.name === name)!
        return { ...it, qty: counts.get(name)! }
    })
}

export function MealBlock ({ combo, selected, onSelect, onTrack }: Props) {
    const avg = avgAccuracyOf(combo)
    const { totalNutrition: t } = combo
    const grouped = groupItems(combo.items)

    return (
        <div
            className={`meal${selected ? ' selected' : ''}`}
            onClick={onSelect}
            role="button"
            tabIndex={0}
        >
            <ul>
                {grouped.map((it) => (
                    <li key={it.name}>
                        {it.qty > 1 ? `${it.qty}× ` : ''}
                        {it.name.replace(/_/g, ' ')}
                        <span className="sub">
                            {' '}— {round(it.calories)} cal
                        </span>
                    </li>
                ))}
            </ul>

            <div className="totals">
                <span className="pill"><b>{round(t.calories)}</b> cal</span>
                <span className="pill"><b>{round(t.protein, 1)}</b>g protein</span>
                <span className="pill"><b>{round(t.carbs, 1)}</b>g carbs</span>
                <span className="pill"><b>{round(t.fat, 1)}</b>g fat</span>
                <span className="pill" style={{ marginLeft: 'auto' }}>
                    {accuracyPercent(avg)}
                </span>
            </div>

            <div className="acc-bar">
                <span
                    style={{
                        width: `${Math.max(6, (1 - avg) * 100)}%`,
                        background: accuracyColor(avg)
                    }}
                />
            </div>

            {selected && (
                <div className="track-row">
                    <button
                        className="btn btn-primary"
                        onClick={(e) => {
                            e.stopPropagation()
                            onTrack()
                        }}
                    >
                        ＋ Track this meal
                    </button>
                </div>
            )}
        </div>
    )
}
