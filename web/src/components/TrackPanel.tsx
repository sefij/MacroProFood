import { useEffect, useMemo, useRef, useState } from 'react'
import type { MenuItem, OptimizationResult, TargetMacros } from '../macro'
import { buildClipboardToken, trackMealBookmarklet } from '../bookmarklets'
import { round } from '../format'

const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as const

/** A meal totals object (no ratios) — what we log and re-copy as we edit. */
type Nutrition = OptimizationResult['totalNutrition']

/** One row in the editable meal: a menu item plus whether it's currently kept. */
interface Row {
    item: MenuItem
    on: boolean
    /** True for items pulled in from the swap suggestions (not in the original combo). */
    added: boolean
}

/** Sensible default meal based on the local time of day. */
function defaultMeal (): string {
    const h = new Date().getHours()
    if (h < 11) return 'Breakfast'
    if (h < 15) return 'Lunch'
    if (h < 21) return 'Dinner'
    return 'Snacks'
}

const prettyName = (name: string) => name.replace(/_/g, ' ')

function sumNutrition (items: MenuItem[]): Nutrition {
    return items.reduce(
        (s, it) => ({
            calories: s.calories + it.calories,
            protein: s.protein + it.protein,
            fat: s.fat + it.fat,
            carbs: s.carbs + it.carbs
        }),
        { calories: 0, protein: 0, fat: 0, carbs: 0 }
    )
}

interface Props {
    combo: OptimizationResult
    /** The macro targets this meal was optimized against — used to size swap suggestions. */
    targets: TargetMacros
    onClose: () => void
    /** True when the MacroPro MyFitnessPal Companion extension is installed (enables 1-click send). */
    extAvailable: boolean
    /** Sends the (possibly edited) meal to MFP via the extension. Rejects on failure. */
    onSend: (nutrition: Nutrition, mealName: string) => Promise<void>
    /** Suggests items from the same restaurant that fit `remaining`. */
    suggest: (remaining: TargetMacros) => MenuItem[]
}

/**
 * Shown after "Track this meal". Lists the meal's items with checkboxes so you
 * can drop anything you don't want; the totals (and the clipboard token / what
 * gets sent to MFP) update live. Removing items reveals a "Suggest swaps" action
 * that re-runs the optimizer against the freed-up macros so you can fill the gap.
 */
export function TrackPanel ({ combo, targets, onClose, extAvailable, onSend, suggest }: Props) {
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [meal, setMeal] = useState<string>(defaultMeal)
    const [rows, setRows] = useState<Row[]>([])
    const [suggestions, setSuggestions] = useState<MenuItem[] | null>(null)
    const ref = useRef<HTMLElement>(null)

    // Reset the editable rows whenever a different combo is picked.
    useEffect(() => {
        setRows(combo.items.map((item) => ({ item, on: true, added: false })))
        setSuggestions(null)
        setError(null)
    }, [combo])

    // Bring the panel into view so the user lands on the "add" controls.
    useEffect(() => {
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, [combo])

    const kept = useMemo(() => rows.filter((r) => r.on).map((r) => r.item), [rows])
    const total = useMemo(() => sumNutrition(kept), [kept])
    const removedCount = rows.filter((r) => !r.on).length
    const empty = kept.length === 0

    // Keep the clipboard (the bookmarklet/manual fallback) in sync with edits.
    useEffect(() => {
        if (empty) return
        navigator.clipboard.writeText(buildClipboardToken(total)).catch(() => {})
    }, [total, empty])

    const toggle = (idx: number) =>
        setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, on: !r.on } : r)))

    const runSuggest = () => {
        const remaining: TargetMacros = {
            calories: Math.max(0, targets.calories - total.calories),
            protein: Math.max(0, targets.protein - total.protein),
            fat: Math.max(0, targets.fat - total.fat),
            carbs: Math.max(0, targets.carbs - total.carbs)
        }
        const found = suggest(remaining).filter(
            // Don't re-suggest something already on the meal.
            (s) => !rows.some((r) => r.on && r.item.name === s.name)
        )
        setSuggestions(found)
    }

    const addSuggestion = (item: MenuItem) => {
        setRows((prev) => [...prev, { item, on: true, added: true }])
        setSuggestions((prev) => prev?.filter((s) => s.name !== item.name) ?? null)
    }

    const href = trackMealBookmarklet()
    const token = buildClipboardToken(total)

    const send = async () => {
        setSending(true)
        setError(null)
        try {
            await onSend(total, meal)
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

            <ul className="meal-items">
                {rows.map((r, i) => (
                    <li key={`${r.item.name}-${i}`} className={`meal-item${r.on ? '' : ' off'}`}>
                        <label>
                            <input type="checkbox" checked={r.on} onChange={() => toggle(i)} />
                            <span className="mi-name">
                                {prettyName(r.item.name)}
                                {r.added && <span className="mi-tag">added</span>}
                            </span>
                            <span className="mi-cal">{round(r.item.calories)} cal</span>
                        </label>
                    </li>
                ))}
            </ul>

            {removedCount > 0 && (
                <div className="swaps">
                    <button className="btn btn-ghost small" onClick={runSuggest} disabled={empty}>
                        Suggest swaps for what you removed
                    </button>
                    {suggestions && suggestions.length > 0 && (
                        <div className="swap-list">
                            <p className="small muted">Add to fill the remaining macros:</p>
                            {suggestions.map((s) => (
                                <button
                                    key={s.name}
                                    className="swap-chip"
                                    onClick={() => addSuggestion(s)}
                                >
                                    ＋ {prettyName(s.name)}
                                    <span className="sub">
                                        {round(s.calories)} cal · {round(s.protein, 1)}p
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                    {suggestions && suggestions.length === 0 && (
                        <p className="small muted">
                            No items fit the freed-up macros — your meal may already be close to target.
                        </p>
                    )}
                </div>
            )}

            <p className="small muted">
                This meal:{' '}
                <b>
                    {round(total.calories)} cal · {round(total.protein, 1)}p ·{' '}
                    {round(total.carbs, 1)}c · {round(total.fat, 1)}f
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
                    <button className="btn btn-primary" onClick={send} disabled={sending || empty}>
                        {empty
                            ? 'Keep at least one item'
                            : sending
                                ? 'Adding to MyFitnessPal…'
                                : `➜ Add to ${meal}`}
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
