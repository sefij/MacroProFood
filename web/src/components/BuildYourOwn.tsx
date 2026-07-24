import { useEffect, useState } from 'react'
import type { BuildGroup, MenuItem, SnapshotItem } from '../macro'
import { resolveInitialSelection, type InitialSelection } from '../../../src/core/buildable-combos'
import { round } from '../format'
import { categoryIcon } from '../category'

/** Local macro-only shape — the running total as a build-your-own tree is composed. */
interface Totals {
    calories: number
    protein: number
    fat: number
    carbs: number
}

const ZERO_TOTALS: Totals = { calories: 0, protein: 0, fat: 0, carbs: 0 }

function addTotals (a: Totals, b: Totals): Totals {
    return {
        calories: a.calories + b.calories,
        protein: a.protein + b.protein,
        fat: a.fat + b.fat,
        carbs: a.carbs + b.carbs
    }
}

const macroLine = (m: Totals) =>
    `${round(m.calories)} cal · ${round(m.protein, 1)}p · ${round(m.fat, 1)}f · ${round(m.carbs, 1)}c`

/** One group's running state, reported up to whatever rendered it (a parent `BuildStep`, or the top-level picker). */
interface StepReport {
    total: Totals
    /** Chosen labels, in pick order, flattened across this group and everything it revealed. */
    labels: string[]
    /** This group's own selection is complete (per its `selection` kind), and so is everything it revealed. */
    valid: boolean
}

interface BuildStepProps {
    group: BuildGroup
    onReport: (report: StepReport) => void
    /**
     * Pre-selects this group's choices (and, recursively, every nested
     * group's) from an already-composed combo — see
     * `resolveInitialSelection`. Absent means "start unselected," the
     * default when adding a brand-new build-your-own item. Only read once,
     * at mount (via `useState`'s lazy initializer) — this seeds the initial
     * picks, it isn't a controlled value the parent keeps re-driving.
     */
    initial?: InitialSelection
}

/**
 * One step of a build-your-own item's choice tree (spec 12) — a single group
 * (Protein, Rice, Toppings, Quesadilla's exactly-3 "Quesa Sides", …), and
 * recursively, whichever nested groups the current selection unlocks (a
 * choice's own `next` — real Chipotle data means this can genuinely differ
 * between sibling choices, e.g. a Sofritas taco offers Rice/Beans a Chicken
 * taco doesn't). Reports this group's own total/labels/validity, summed with
 * every descendant's, up to its parent on every change — so the top-level
 * picker never needs to know the tree's shape, only the root report.
 */
function BuildStep ({ group, onReport, initial }: BuildStepProps) {
    const [selected, setSelected] = useState<number[]>(() => initial?.selectedIndices ?? [])
    // Keyed `${choiceIndex}:${nestedGroupIndex}` — the latest report from each currently-mounted nested group.
    const [nestedReports, setNestedReports] = useState<Map<string, StepReport>>(new Map())

    const toggle = (index: number) => {
        if (group.selection === 'one') {
            setSelected(selected[0] === index ? [] : [index])
            return
        }
        if (selected.includes(index)) {
            setSelected(selected.filter((i) => i !== index))
            return
        }
        if (group.selection === 'exactly' && selected.length >= (group.count ?? 0)) return
        setSelected([...selected, index])
    }

    // Drop stale reports from choices that are no longer selected (a 'one'
    // group swapping choice, or a 'many'/'exactly' one being unchecked).
    useEffect(() => {
        setNestedReports((prev) => {
            let changed = false
            const next = new Map(prev)
            for (const key of next.keys()) {
                if (!selected.includes(Number(key.split(':')[0]))) {
                    next.delete(key)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [selected])

    useEffect(() => {
        let total = ZERO_TOTALS
        const labels: string[] = []
        let valid =
            group.selection === 'many'
                ? true
                : group.selection === 'one'
                    ? selected.length === 1
                    : selected.length === group.count

        for (const index of selected) {
            const choice = group.choices[index]
            total = addTotals(total, choice)
            labels.push(choice.label)
        }
        for (const report of nestedReports.values()) {
            total = addTotals(total, report.total)
            labels.push(...report.labels)
            valid = valid && report.valid
        }

        onReport({ total, labels, valid })
        // Only this group's own state should retrigger the report — `group`
        // is stable for the component's lifetime and `onReport` is expected
        // to be a fresh closure every render (it captures the parent's key).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected, nestedReports])

    return (
        <div className="build-step">
            <div className="build-step-label">
                {group.label}
                {group.selection === 'exactly' && (
                    <span className="build-step-hint"> — pick {group.count} ({selected.length}/{group.count})</span>
                )}
            </div>
            <div className="build-step-choices">
                {group.choices.map((choice, index) => {
                    const isSelected = selected.includes(index)
                    const disabled =
                        group.selection === 'exactly' &&
                        !isSelected &&
                        selected.length >= (group.count ?? 0)
                    return (
                        <label
                            key={choice.label}
                            className={`build-choice${isSelected ? ' selected' : ''}${disabled ? ' disabled' : ''}`}
                        >
                            <input
                                type={group.selection === 'one' ? 'radio' : 'checkbox'}
                                checked={isSelected}
                                disabled={disabled}
                                onChange={() => toggle(index)}
                            />
                            {choice.label}
                            {choice.calories > 0 && (
                                <span className="build-choice-kcal">{round(choice.calories)} kcal</span>
                            )}
                        </label>
                    )
                })}
            </div>

            {selected.flatMap((index) => {
                const choice = group.choices[index]
                return (choice.next ?? []).map((nextGroup, ni) => {
                    const key = `${index}:${ni}`
                    return (
                        <div className="build-step-nested" key={key}>
                            <BuildStep
                                group={nextGroup}
                                initial={initial?.nested.get(index)?.[ni]}
                                onReport={(report) =>
                                    setNestedReports((prev) => {
                                        const next = new Map(prev)
                                        next.set(key, report)
                                        return next
                                    })
                                }
                            />
                        </div>
                    )
                })
            })}
        </div>
    )
}

interface BuildYourOwnRowProps {
    item: SnapshotItem
    restaurantName: string
    onAdd: (item: MenuItem) => void
}

/**
 * A build-your-own item's row (spec 12) — the counterpart to `MenuRow`'s
 * variant picker, for items carrying `build` instead of `variants`. Expands
 * into the step-by-step group tree; "Add to meal" is disabled until every
 * currently-visible group satisfies its own selection rule, and composes one
 * meal-line named from the picks made, same convention as a picked variant
 * (`"<base> — <picks>"` here vs. `"<base> (<option>)"` there).
 */
export function BuildYourOwnRow ({ item, restaurantName, onAdd }: BuildYourOwnRowProps) {
    const [open, setOpen] = useState(false)
    const [report, setReport] = useState<StepReport>({ total: ZERO_TOTALS, labels: [], valid: false })

    if (!item.build) return null
    const icon = categoryIcon(item.category)

    const handleAdd = () => {
        if (!report.valid) return
        onAdd({
            restaurant: restaurantName,
            name: `${item.name} — ${report.labels.join(', ')}`,
            calories: report.total.calories,
            protein: report.total.protein,
            fat: report.total.fat,
            carbs: report.total.carbs,
            category: item.category
        })
        setOpen(false)
        setReport({ total: ZERO_TOTALS, labels: [], valid: false })
    }

    return (
        <li className="menu-row build-row">
            <div className="menu-row-info">
                <span className="mi-name">
                    {item.name}
                    {icon && (
                        <span className="cat-badge" title={item.category}>
                            {icon}
                        </span>
                    )}
                </span>
                <span className="menu-row-macros">
                    {open ? macroLine(report.total) : 'Tap + to build your order'}
                </span>

                {open && (
                    <div className="build-tree">
                        <BuildStep key={item.name} group={item.build} onReport={setReport} />
                        <button type="button" className="btn-build-add" disabled={!report.valid} onClick={handleAdd}>
                            Add to meal — {macroLine(report.total)}
                        </button>
                    </div>
                )}
            </div>

            <button
                type="button"
                className="btn-add"
                aria-label={open ? `Close ${item.name} builder` : `Build ${item.name}`}
                onClick={() => setOpen((o) => !o)}
            >
                {open ? '×' : '+'}
            </button>
        </li>
    )
}

/**
 * Extracts the ordered pick labels from a build-your-own row's composed name
 * (`"<base> — <picks>"`, the convention `BuildYourOwnRow`/`BuildYourOwnEditor`
 * both use), or `null` if `rowName` isn't a composed row for `item` at all —
 * doubling as the "is this meal line editable as a build-your-own item"
 * check a tracked-meal view needs before offering an Edit action on it (a
 * combo the automatic optimizer picked is just as editable as one built by
 * hand in Menu Mode; both produce this same name shape).
 */
export function parseBuildRowLabels (item: SnapshotItem, rowName: string): string[] | null {
    if (!item.build) return null
    const prefix = `${item.name} — `
    if (!rowName.startsWith(prefix)) return null
    return rowName.slice(prefix.length).split(', ')
}

interface BuildYourOwnEditorProps {
    item: SnapshotItem
    restaurantName: string
    /** The tracked meal line's current full name — parsed back into picks via `parseBuildRowLabels`. */
    currentName: string
    onSave: (item: MenuItem) => void
    onCancel: () => void
}

/**
 * Re-opens an already-composed build-your-own combo for editing — the same
 * step-by-step tree as `BuildYourOwnRow`, but pre-populated with the picks
 * `currentName` encodes (via `resolveInitialSelection`) instead of starting
 * unselected. This is how a combo the *automatic optimizer* picked — capped
 * to a narrowed, target-ranked candidate slice (`buildable-combos.ts`) — can
 * still be adjusted to any live option afterward: editing always resolves
 * against the item's full, uncapped `build` tree, same as adding a new one.
 */
export function BuildYourOwnEditor ({ item, restaurantName, currentName, onSave, onCancel }: BuildYourOwnEditorProps) {
    const [report, setReport] = useState<StepReport>({ total: ZERO_TOTALS, labels: [], valid: false })

    if (!item.build) return null
    const initialLabels = parseBuildRowLabels(item, currentName) ?? []
    // Recomputed on every render (cheap — a small tree), but only consumed by
    // BuildStep's useState lazy initializer, which only ever runs once per
    // mounted instance regardless of how many times this prop value changes.
    const initial = resolveInitialSelection(item.build, initialLabels)

    const handleSave = () => {
        if (!report.valid) return
        onSave({
            restaurant: restaurantName,
            name: `${item.name} — ${report.labels.join(', ')}`,
            calories: report.total.calories,
            protein: report.total.protein,
            fat: report.total.fat,
            carbs: report.total.carbs,
            category: item.category
        })
    }

    return (
        <div className="build-tree build-editor">
            <BuildStep key={currentName} group={item.build} initial={initial} onReport={setReport} />
            <div className="build-editor-actions">
                <button type="button" className="btn-build-add" disabled={!report.valid} onClick={handleSave}>
                    Save changes — {macroLine(report.total)}
                </button>
                <button type="button" className="btn btn-ghost small" onClick={onCancel}>
                    Cancel
                </button>
            </div>
        </div>
    )
}
