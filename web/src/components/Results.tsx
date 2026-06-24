import type { OptimizationResults } from '../macro'
import { avgAccuracyOf } from '../macro'
import { accuracyPercent } from '../format'
import { MealBlock } from './MealBlock'

interface Props {
    results: OptimizationResults
    iconFor: (restaurant: string) => string
    selected: { restaurant: string; index: number } | null
    onSelect: (restaurant: string, index: number) => void
    /** Clears the selection and returns to the full list. */
    onClear: () => void
}

export function Results ({ results, iconFor, selected, onSelect, onClear }: Props) {
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

    // Once a meal is chosen, collapse to just its restaurant; other options in
    // that group render as slim rows so you can still switch with one tap.
    const visibleGroups = selected
        ? groups.filter(([restaurant]) => restaurant === selected.restaurant)
        : groups

    return (
        <section className="results">
            <div className="results-head">
                <h2>{selected ? 'Your pick' : 'Pick a meal'}</h2>
                {selected && (
                    <button className="btn btn-ghost small" onClick={onClear}>
                        ← All options
                    </button>
                )}
            </div>

            {visibleGroups.map(([restaurant, combos]) => (
                <div className="rest-group" key={restaurant}>
                    <div className="rest-title">
                        <span>{iconFor(restaurant)}</span>
                        <span>{restaurant}</span>
                        <span className="acc">best {accuracyPercent(avgAccuracyOf(combos[0]))}</span>
                    </div>
                    {combos.map((combo, i) => {
                        const isSelected = selected?.restaurant === restaurant && selected?.index === i
                        return (
                            <MealBlock
                                key={i}
                                combo={combo}
                                selected={isSelected}
                                // Once a pick is made every option collapses to a slim row;
                                // the chosen meal is edited in the Track panel below.
                                compact={!!selected}
                                onSelect={() => onSelect(restaurant, i)}
                            />
                        )
                    })}
                </div>
            ))}
        </section>
    )
}
