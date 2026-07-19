import type { TargetMacros } from '../macro'
import { MacroStatusGrid } from './MacroStatusGrid'

interface Props {
    totals: TargetMacros
    targets: TargetMacros
    onTrack: () => void
    canTrack: boolean
}

/**
 * Always-visible current-vs-target bar for menu mode: bottom-pinned at every
 * width (see the CSS comment on `.sticky-summary` for why a desktop top-pin
 * doesn't work on this page shape). Reused, minus the "Track this meal"
 * button, by `TrackPanel`'s "+ Add from menu" section (spec 07).
 */
export function StickySummary ({ totals, targets, onTrack, canTrack }: Props) {
    return (
        <div className="sticky-summary">
            <MacroStatusGrid totals={totals} targets={targets} />
            <button className="btn btn-primary" onClick={onTrack} disabled={!canTrack}>
                {canTrack ? 'Track this meal' : 'Add an item first'}
            </button>
        </div>
    )
}
