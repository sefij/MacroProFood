import type { OptimizationResult } from '../macro'
import { buildClipboardToken, trackMealBookmarklet } from '../bookmarklets'
import { round } from '../format'

interface Props {
    combo: OptimizationResult
    onClose: () => void
}

/**
 * Shown after "Track this meal". The meal totals were copied to the clipboard;
 * the user clicks their MFP "Track" bookmark to autofill the Quick Add form.
 */
export function TrackPanel ({ combo, onClose }: Props) {
    const href = trackMealBookmarklet()
    const token = buildClipboardToken(combo.totalNutrition)
    const t = combo.totalNutrition

    return (
        <section className="card">
            <h2>
                Track in MyFitnessPal
                <button className="btn btn-ghost small" onClick={onClose}>Done</button>
            </h2>

            <p className="small muted">
                Copied this meal to your clipboard:{' '}
                <b>
                    {round(t.calories)} cal · {round(t.protein, 1)}p · {round(t.carbs, 1)}c ·{' '}
                    {round(t.fat, 1)}f
                </b>
            </p>

            <details className="mfp" open>
                <summary>One-time setup &amp; how to log it</summary>
                {/* eslint-disable-next-line react/jsx-no-script-url */}
                <a className="bookmarklet" href={href} onClick={(e) => e.preventDefault()}>
                    ＋ Track this meal → MFP
                </a>
                <ol className="steps">
                    <li>Drag the button above to your bookmarks bar (one time only).</li>
                    <li>In MyFitnessPal, open a meal → <b>Quick Tools → Quick add calories</b>.</li>
                    <li>Click the bookmark — it fills calories &amp; macros from your clipboard.</li>
                    <li>Review the values and hit <b>Add to Diary</b>.</li>
                </ol>
                <p className="small muted">
                    Clipboard blocked? Paste this when prompted: <code>{token}</code>
                </p>
            </details>
        </section>
    )
}
