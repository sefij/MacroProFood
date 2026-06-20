import { useEffect, useRef, useState } from 'react'
import type { OptimizationResult } from '../macro'
import { buildClipboardToken, trackMealBookmarklet } from '../bookmarklets'
import { round } from '../format'

const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const

/** Sensible default meal based on the local time of day. */
function defaultMeal (): string {
    const h = new Date().getHours()
    if (h < 11) return 'Breakfast'
    if (h < 15) return 'Lunch'
    if (h < 21) return 'Dinner'
    return 'Snacks'
}

interface Props {
    combo: OptimizationResult
    onClose: () => void
    /** True when the MacPro MyFitnessPal Companion extension is installed (enables 1-click send). */
    extAvailable: boolean
    /** Sends the meal to MFP via the extension. Rejects on failure. */
    onSend: (mealName: string) => Promise<void>
}

/**
 * Shown after "Track this meal". With the extension it's a single "Send to MFP"
 * button; without it, the meal is on the clipboard and the user clicks their MFP
 * "Track" bookmark to autofill Quick Add.
 */
export function TrackPanel ({ combo, onClose, extAvailable, onSend }: Props) {
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [meal, setMeal] = useState<string>(defaultMeal)
    const ref = useRef<HTMLElement>(null)

    // Bring the panel into view so the user lands on the "add" controls.
    useEffect(() => {
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, [combo])

    const href = trackMealBookmarklet()
    const token = buildClipboardToken(combo.totalNutrition)
    const t = combo.totalNutrition

    const send = async () => {
        setSending(true)
        setError(null)
        try {
            await onSend(meal)
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setSending(false)
        }
    }

    return (
        <section className="card" ref={ref}>
            <h2>
                Track in MyFitnessPal
                <button className="btn btn-ghost small" onClick={onClose}>Done</button>
            </h2>

            <p className="small muted">
                This meal:{' '}
                <b>
                    {round(t.calories)} cal · {round(t.protein, 1)}p · {round(t.carbs, 1)}c ·{' '}
                    {round(t.fat, 1)}f
                </b>
            </p>

            {extAvailable ? (
                <>
                    <div className="meal-select">
                        <label htmlFor="meal-name">Log under</label>
                        <select
                            id="meal-name"
                            value={meal}
                            onChange={(e) => setMeal(e.target.value)}
                        >
                            {MEALS.map((m) => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    </div>
                    <button className="btn btn-primary" onClick={send} disabled={sending}>
                        {sending ? 'Adding to MyFitnessPal…' : `➜ Add to ${meal}`}
                    </button>
                    {error && <p className="small err">{error}</p>}
                    <p className="small muted" style={{ marginTop: 10 }}>
                        Quick-adds these macros to your MFP <b>{meal}</b> and saves them. The
                        diary opens so you can double-check.
                    </p>
                </>
            ) : (
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
            )}
        </section>
    )
}
