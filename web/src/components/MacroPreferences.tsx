import type { OptimizerConfig, TargetMacros } from '../macro'
import { Fader } from './Fader'

type MacroKey = keyof OptimizerConfig

const MACROS: { key: MacroKey; label: string }[] = [
    { key: 'calories', label: 'Calories' },
    { key: 'protein', label: 'Protein' },
    { key: 'carbs', label: 'Carbs' },
    { key: 'fat', label: 'Fat' }
]

/** Fader range, in percent — fixed regardless of state, per the class docblock. */
const MIN_PERCENT = 0
const MAX_PERCENT = 150

interface Props {
    macros: TargetMacros
    config: OptimizerConfig
    onChange: (config: OptimizerConfig) => void
    defaultConfig: OptimizerConfig
    title: string
}

function isDefault (config: OptimizerConfig, defaultConfig: OptimizerConfig): boolean {
    return (Object.keys(defaultConfig) as MacroKey[]).every(
        (key) => config[key].weight === defaultConfig[key].weight && config[key].overflow === defaultConfig[key].overflow
    )
}

/** `"44g"` for protein/carbs/fat, `"720"` (no unit) for calories — matches how the macro-entry fields above label themselves. */
function formatEffective (key: MacroKey, value: number): string {
    const rounded = Math.round(value)
    return key === 'calories' ? `${rounded}` : `${rounded}g`
}

/**
 * Collapsible macro-tuning section. Each fader sets a macro's `weight`,
 * which the optimizer (see core/optimizer.ts) uses to scale that macro's
 * *effective* target for the search — 80% on a 55g fat target means 44g
 * becomes the real ceiling, not "55g but cared about less." Maps onto
 * `OptimizerConfig` (see core/types.ts), but there's only one control per
 * macro here, not two: the fader always spans a fixed 0-150%, and passing
 * the 100% mark (a faint tick on the track) *is* what allows that macro to
 * overflow its original target — `setWeight` below derives `overflow` from
 * the weight directly (`> 1` → 'allowed') rather than tracking it as a
 * separate, independently-set toggle. Past 100%, the readout gets a visibly
 * different colour so "this one can go over" reads at a glance without a
 * second widget. The effective gram/kcal figure (`macros[key] * weight`) is
 * shown alongside the percentage so the abstract dial maps back to a real
 * number without doing the multiplication in your head.
 *
 * All four macros sit in one row (wrapping to two on narrow screens rather
 * than squeezing).
 */
export function MacroPreferences ({ macros, config, onChange, defaultConfig, title }: Props) {
    const setWeight = (key: MacroKey, weight: number) => {
        onChange({ ...config, [key]: { weight, overflow: weight > 1 ? 'allowed' : 'strict' } })
    }

    const customized = !isDefault(config, defaultConfig)

    return (
        <details className="filters">
            <summary>{title}{customized ? ' — customized' : ''}</summary>

            <div className="macro-dial-row">
                {MACROS.map(({ key, label }) => {
                    const pref = config[key]
                    const percent = Math.round(pref.weight * 100)
                    const over = percent > 100
                    const effective = formatEffective(key, macros[key] * pref.weight)
                    return (
                        <div className="macro-dial" key={key}>
                            <span className="macro-dial-label">{label}</span>
                            <span className={`macro-dial-percent${over ? ' over' : ''}`}>
                                {percent}% <span className="macro-dial-effective-inline">· {effective}</span>
                            </span>
                            <Fader
                                value={percent}
                                min={MIN_PERCENT}
                                max={MAX_PERCENT}
                                step={10}
                                onChange={(v) => setWeight(key, v / 100)}
                                label={`${label} priority`}
                            />
                        </div>
                    )
                })}
            </div>

            {customized && (
                <button type="button" className="link-btn" onClick={() => onChange(defaultConfig)}>
                    Reset to defaults
                </button>
            )}
        </details>
    )
}
