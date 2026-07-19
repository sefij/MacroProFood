/** Small presentation helpers shared across components. */

const DAY = 24 * 60 * 60 * 1000

/** Days old, treating > 90 days as stale. */
export function staleness (iso: string): { days: number; stale: boolean; label: string } {
    const days = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / DAY))
    let label: string
    if (days <= 0) label = 'today'
    else if (days === 1) label = '1 day ago'
    else if (days < 14) label = `${days} days ago`
    else if (days < 60) label = `${Math.round(days / 7)} weeks ago`
    else label = `${Math.round(days / 30)} months ago`
    return { days, stale: days > 90, label }
}

/** 0 = perfect, higher = worse. Returns a CSS color var. */
export function accuracyColor (delta: number): string {
    if (delta < 0.1) return 'var(--good)'
    if (delta < 0.2) return 'var(--warn)'
    return 'var(--bad)'
}

/** Converts an average accuracy delta into a "% accurate" string. */
export function accuracyPercent (avgDelta: number): string {
    return `${((1 - avgDelta) * 100).toFixed(0)}% match`
}

/**
 * Color for a single macro's current-vs-target status (menu mode's sticky
 * summary): green within 5% of target either way, amber under, red over.
 */
export function macroStatusColor (current: number, target: number): string {
    if (target <= 0) return 'var(--muted)'
    const delta = (current - target) / target
    if (Math.abs(delta) <= 0.05) return 'var(--good)'
    return delta < 0 ? 'var(--warn)' : 'var(--bad)'
}

export const round = (n: number, dp = 0): number => {
    const f = 10 ** dp
    return Math.round(n * f) / f
}
