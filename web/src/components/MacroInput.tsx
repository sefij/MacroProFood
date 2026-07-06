import type { TargetMacros } from '../macro'
import { ConnectMfp } from './ConnectMfp'

export type InputMode = 'manual' | 'mfp'

interface Props {
    mode: InputMode
    onModeChange: (m: InputMode) => void
    macros: TargetMacros
    onChange: (m: TargetMacros) => void
    /** True when the MacroPro MyFitnessPal Companion extension is installed (enables 1-click pull). */
    extAvailable: boolean
}

const FIELDS: { key: keyof TargetMacros; label: string }[] = [
    { key: 'calories', label: 'Calories' },
    { key: 'protein', label: 'Protein (g)' },
    { key: 'carbs', label: 'Carbs (g)' },
    { key: 'fat', label: 'Fat (g)' }
]

export function MacroInput ({ mode, onModeChange, macros, onChange, extAvailable }: Props) {
    const set = (key: keyof TargetMacros, raw: string) => {
        const value = raw === '' ? 0 : Number(raw)
        if (Number.isNaN(value)) return
        onChange({ ...macros, [key]: value })
    }

    return (
        <section className="card">
            <h2>Your remaining macros</h2>

            <div className="segmented" role="tablist">
                <button
                    className={mode === 'manual' ? 'active' : ''}
                    onClick={() => onModeChange('manual')}
                >
                    ✍️ Enter manually
                </button>
                <button
                    className={mode === 'mfp' ? 'active' : ''}
                    onClick={() => onModeChange('mfp')}
                >
                    📥 From MyFitnessPal
                </button>
            </div>

            {mode === 'mfp' && (
                <ConnectMfp extAvailable={extAvailable} onMacros={onChange} />
            )}

            <div className="macro-grid">
                {FIELDS.map(({ key, label }) => (
                    <div className="macro-field" key={key}>
                        <label htmlFor={`macro-${key}`}>{label}</label>
                        <input
                            id={`macro-${key}`}
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={macros[key] === 0 ? '' : macros[key]}
                            placeholder="0"
                            onChange={(e) => set(key, e.target.value)}
                        />
                    </div>
                ))}
            </div>
        </section>
    )
}
