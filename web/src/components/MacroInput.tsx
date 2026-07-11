import type { TargetMacros } from '../macro'
import { ConnectMfp } from './ConnectMfp'
import { ScreenshotInput } from './ScreenshotInput'

export type InputMode = 'manual' | 'mfp' | 'screenshot'

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

// Chrome Web Store listing for the MacroPro MyFitnessPal Companion extension.
const EXTENSION_URL =
    'https://chromewebstore.google.com/detail/kmdghdedmhabhnhehomcfeknegcjgmbd?utm_source=item-share-cb'

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
                    className={`${mode === 'mfp' ? 'active' : ''}${
                        extAvailable ? '' : ' locked'
                    }`}
                    onClick={() =>
                        extAvailable
                            ? onModeChange('mfp')
                            : window.open(
                                  EXTENSION_URL,
                                  '_blank',
                                  'noopener,noreferrer'
                              )
                    }
                    title={
                        extAvailable
                            ? undefined
                            : 'Requires the MacroPro MyFitnessPal Companion extension — click to install'
                    }
                >
                    📥 From MyFitnessPal{extAvailable ? '' : ' 🔒'}
                </button>
                <button
                    className={mode === 'screenshot' ? 'active' : ''}
                    onClick={() => onModeChange('screenshot')}
                >
                    📷 From screenshot
                </button>
            </div>

            {mode === 'mfp' && (
                <ConnectMfp extAvailable={extAvailable} onMacros={onChange} />
            )}

            {mode === 'screenshot' && (
                <ScreenshotInput macros={macros} onChange={onChange} />
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
