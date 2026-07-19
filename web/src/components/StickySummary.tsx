import type { TargetMacros } from '../macro'
import { macroStatusColor } from '../format'

interface Props {
    totals: TargetMacros
    targets: TargetMacros
    onTrack: () => void
    canTrack: boolean
}

const FIELDS: { key: keyof TargetMacros; label: string; decimals: number }[] = [
    { key: 'calories', label: 'Cal', decimals: 0 },
    { key: 'protein', label: 'Protein', decimals: 1 },
    { key: 'carbs', label: 'Carbs', decimals: 1 },
    { key: 'fat', label: 'Fat', decimals: 1 }
]

/**
 * Always-visible current-vs-target bar for menu mode: sticky to the bottom
 * of the viewport on narrow screens (thumb-reachable while browsing the
 * menu), pinned near the top on wider ones. Reusable by spec 07, which
 * surfaces the same bar inside normal mode's substitution flow.
 */
export function StickySummary ({ totals, targets, onTrack, canTrack }: Props) {
    return (
        <div className="sticky-summary">
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
            <button className="btn btn-primary" onClick={onTrack} disabled={!canTrack}>
                {canTrack ? 'Track this meal' : 'Add an item first'}
            </button>
        </div>
    )
}
