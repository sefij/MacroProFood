import type { TargetMacros } from '../macro'
import { macroStatusColor } from '../format'

interface Props {
    totals: TargetMacros
    targets: TargetMacros
}

const FIELDS: { key: keyof TargetMacros; label: string; decimals: number }[] = [
    { key: 'calories', label: 'Cal', decimals: 0 },
    { key: 'protein', label: 'Protein', decimals: 1 },
    { key: 'carbs', label: 'Carbs', decimals: 1 },
    { key: 'fat', label: 'Fat', decimals: 1 }
]

/**
 * The current/target/remaining tiles shared by `StickySummary` (menu mode's
 * build screen) and `TrackPanel`'s "+ Add from menu" section (spec 07) — the
 * bare grid, with no "Track this meal" action, since a `TrackPanel` is
 * already tracking the meal it's showing this inside of.
 */
export function MacroStatusGrid ({ totals, targets }: Props) {
    return (
        <div className="sticky-summary-grid">
            {FIELDS.map(({ key, label, decimals }) => {
                const current = totals[key]
                const target = targets[key]
                const remaining = target - current
                const color = macroStatusColor(current, target)
                return (
                    <div className="ss-tile" key={key}>
                        <span className="ss-label">{label}</span>
                        <span className="ss-value" style={{ color }}>
                            {current.toFixed(decimals)}
                            <span className="ss-target"> / {target.toFixed(decimals)}</span>
                        </span>
                        <span className="ss-remaining">
                            {remaining >= 0
                                ? `${remaining.toFixed(decimals)} left`
                                : `${Math.abs(remaining).toFixed(decimals)} over`}
                        </span>
                    </div>
                )
            })}
        </div>
    )
}
