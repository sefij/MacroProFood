/**
 * Decides whether a freshly scraped restaurant looks healthy enough to replace
 * its previous snapshot. A scraper that returns nothing, or a small fraction
 * of what it returned last time, has almost certainly broken (a layout change
 * that only matched a few rows, a pagination bug) rather than the menu
 * genuinely shrinking, so its old data is kept and the run is failed loudly.
 */

/** A scrape below this fraction of the previous item count is treated as broken. */
export const MIN_ITEM_RATIO = 0.5

export type ScrapeVerdict =
    | { ok: true }
    | { ok: false, reason: string }

/**
 * `allowDrop` is the comma-separated `ALLOW_ITEM_DROP` value: restaurant keys
 * (or "all") whose count drop has been reviewed and is genuine, so the new,
 * smaller scrape should be accepted.
 */
export function assessScrape (
    key: string,
    newCount: number,
    previousCount: number | undefined,
    allowDrop = ''
): ScrapeVerdict {
    if (newCount === 0) return { ok: false, reason: 'returned no items' }
    if (previousCount === undefined || previousCount === 0) return { ok: true }
    if (newCount >= previousCount * MIN_ITEM_RATIO) return { ok: true }

    const allowed = allowDrop.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    if (allowed.includes('ALL') || allowed.includes(key.toUpperCase())) return { ok: true }

    return {
        ok: false,
        reason: `returned ${newCount} items, down from ${previousCount} (below ${MIN_ITEM_RATIO * 100}%)`
    }
}
