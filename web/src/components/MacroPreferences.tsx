import type { OptimizerConfig, TargetMacros } from '../macro'

type MacroKey = keyof OptimizerConfig

const CALORIES: { key: MacroKey; label: string } = { key: 'calories', label: 'Calories' }
const ADVANCED_MACROS: { key: MacroKey; label: string }[] = [
    { key: 'protein', label: 'Protein' },
    { key: 'carbs', label: 'Carbs' },
    { key: 'fat', label: 'Fat' }
]

/** Slider range, in percent — fixed regardless of state, per the class docblock. */
const MIN_PERCENT = 0
const MAX_PERCENT = 150
const STEP_PERCENT = 10
/** Where the fixed 100% mark falls along the track, as a percentage of its width — used to position the tick overlay. */
const HUNDRED_MARK_PERCENT = ((100 - MIN_PERCENT) / (MAX_PERCENT - MIN_PERCENT)) * 100

interface Props {
    macros: TargetMacros
    config: OptimizerConfig
    onChange: (config: OptimizerConfig) => void
    defaultConfig: OptimizerConfig
    title: string
}

function isDefaultFor (keys: MacroKey[], config: OptimizerConfig, defaultConfig: OptimizerConfig): boolean {
    return keys.every(
        (key) => config[key].weight === defaultConfig[key].weight && config[key].overflow === defaultConfig[key].overflow
    )
}

/** `"44g"` for protein/carbs/fat, `"720"` (no unit) for calories — matches how the macro-entry fields above label themselves. */
function formatEffective (key: MacroKey, value: number): string {
    const rounded = Math.round(value)
    return key === 'calories' ? `${rounded}` : `${rounded}g`
}

const ALL_KEYS: MacroKey[] = ['calories', 'protein', 'carbs', 'fat']
const ADVANCED_KEYS: MacroKey[] = ['protein', 'carbs', 'fat']

/**
 * Macro-tuning section. Each slider sets a macro's `weight`, which the
 * optimizer (see core/optimizer.ts) uses to scale that macro's *effective*
 * target for the search — 80% on a 55g fat target means 44g becomes the
 * real ceiling, not "55g but cared about less." Maps onto `OptimizerConfig`
 * (see core/types.ts).
 *
 * This is a native `<input type="range">`, not a custom-built control (a
 * dial, then a vertical fader, were tried first) — with usage expected to
 * be about half mobile, a native slider's built-in touch/keyboard/
 * accessibility handling matters more than a distinctive look, and testing
 * the custom fader surfaced a real problem: its 84px track for a 15-step
 * range gave under 6px of travel per step, unreliable to hit by drag even
 * with a mouse. Themed via `accent-color` rather than the full
 * `::-webkit-slider-thumb`/`::-moz-range-thumb` pseudo-element rabbit hole,
 * so it still stays native (and its already-tuned touch target) underneath.
 *
 * Calories is always visible — it's the macro most people reach for first
 * when tuning how a search should behave. Protein/carbs/fat sit inside a
 * nested "Advanced" reveal instead of always taking up space, mirroring the
 * "Advanced filters" pattern already used elsewhere in this same card,
 * rather than a separate simple/advanced *mode* — nothing here is lost by
 * collapsing it, so a toggle-able reveal is a smaller step than a whole
 * mode concept with its own state.
 *
 * Each slider has only one control, not two: it always spans a fixed
 * 0-150%, and passing the 100% mark (a faint tick on the track) *is* what
 * allows that macro to overflow its original target — `setWeight` below
 * derives `overflow` from the weight directly (`> 1` → 'allowed') rather
 * than tracking it as a separate, independently-set toggle. Past 100%, the
 * readout (and the thumb, via `accent-color`) turns a visibly different
 * colour so "this one can go over" reads at a glance without a second
 * widget; anything else non-default gets a lighter version of the same
 * treatment, so a lowered weight doesn't look identical to "still at
 * default." The effective gram/kcal figure (`macros[key] * weight`) is
 * shown alongside the percentage so the abstract number maps back to a real
 * one without doing the multiplication in your head. A tooltip on the
 * slider spells out the 100%-overflow rule, since nothing on screen states
 * it permanently.
 */
export function MacroPreferences ({ macros, config, onChange, defaultConfig, title }: Props) {
    const setWeight = (key: MacroKey, weight: number) => {
        onChange({ ...config, [key]: { weight, overflow: weight > 1 ? 'allowed' : 'strict' } })
    }

    const allDefault = isDefaultFor(ALL_KEYS, config, defaultConfig)
    const advancedCustomized = !isDefaultFor(ADVANCED_KEYS, config, defaultConfig)

    const renderMacro = ({ key, label }: { key: MacroKey; label: string }) => {
        const pref = config[key]
        const percent = Math.round(pref.weight * 100)
        const over = percent > 100
        const changed = percent !== 100
        const effective = formatEffective(key, macros[key] * pref.weight)
        return (
            <div className="macro-slider-row" key={key}>
                <div className="macro-slider-head">
                    <span className="macro-dial-label">{label}</span>
                    <span className={`macro-dial-percent${over ? ' over' : changed ? ' changed' : ''}`}>
                        {percent}% <span className="macro-dial-effective-inline">· {effective}</span>
                    </span>
                </div>
                <div className="macro-slider-track">
                    <span className="macro-slider-mark" style={{ left: `${HUNDRED_MARK_PERCENT}%` }} />
                    <input
                        type="range"
                        className={`macro-slider${over ? ' over' : ''}`}
                        min={MIN_PERCENT}
                        max={MAX_PERCENT}
                        step={STEP_PERCENT}
                        value={percent}
                        onChange={(e) => setWeight(key, Number(e.target.value) / 100)}
                        aria-label={`${label} priority`}
                        title={`Drag past 100% to let ${label} go over its target.`}
                    />
                </div>
            </div>
        )
    }

    return (
        <div className="macro-prefs">
            <div className="macro-prefs-head">
                <span className="macro-prefs-title">{title}</span>
                {!allDefault && (
                    <button type="button" className="link-btn" onClick={() => onChange(defaultConfig)}>
                        Reset to defaults
                    </button>
                )}
            </div>

            {renderMacro(CALORIES)}

            <details className="filters">
                <summary>Advanced{advancedCustomized ? ' — customized' : ''}</summary>
                {ADVANCED_MACROS.map(renderMacro)}
            </details>
        </div>
    )
}
