import type { OptimizationResult, OptimizationResults } from '../macro'
import { avgAccuracyOf } from '../macro'
import { accuracyPercent } from '../format'
import { MealBlock } from './MealBlock'

interface Props {
    results: OptimizationResults
    iconFor: (restaurant: string) => string
    selected: { restaurant: string; index: number } | null
    onSelect: (restaurant: string, index: number) => void
    onTrack: (combo: OptimizationResult) => void
}

export function Results ({ results, iconFor, selected, onSelect, onTrack }: Props) {
    const groups = Object.entries(results)
        .filter(([, combos]) => combos.length > 0)
        // best (lowest avg delta) restaurants first
        .sort(([, a], [, b]) => avgAccuracyOf(a[0]) - avgAccuracyOf(b[0]))

    if (groups.length === 0) {
        return (
            <section className="card center">
                <p className="muted">
                    No combinations fit those targets. Try raising your macros, or pick more
                    restaurants.
                </p>
            </section>
        )
    }

    return (
        <section className="results">
            <h2>Pick a meal</h2>
            {groups.map(([restaurant, combos]) => (
                <div className="rest-group" key={restaurant}>
                    <div className="rest-title">
                        <span>{iconFor(restaurant)}</span>
                        <span>{restaurant}</span>
                        <span className="acc">best {accuracyPercent(avgAccuracyOf(combos[0]))}</span>
                    </div>
                    {combos.map((combo, i) => (
                        <MealBlock
                            key={i}
                            combo={combo}
                            selected={selected?.restaurant === restaurant && selected?.index === i}
                            onSelect={() => onSelect(restaurant, i)}
                            onTrack={() => onTrack(combo)}
                        />
                    ))}
                </div>
            ))}
        </section>
    )
}
