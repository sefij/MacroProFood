import { useRef, useState } from 'react'
import type { TargetMacros } from '../macro'
import { extractMacrosFromImage } from '../screenshot'

interface Props {
    macros: TargetMacros
    onChange: (m: TargetMacros) => void
}

type Status = 'idle' | 'working' | 'done' | 'error'

/**
 * Upload / paste / drop a MyFitnessPal screenshot; OCR runs on-device and the
 * detected remaining macros are written into the shared macro grid, which the
 * user then verifies. See {@link extractMacrosFromImage}.
 */
export function ScreenshotInput ({ macros, onChange }: Props) {
    const inputRef = useRef<HTMLInputElement>(null)
    const [status, setStatus] = useState<Status>('idle')
    const [progress, setProgress] = useState(0)
    const [warnings, setWarnings] = useState<string[]>([])

    const handleFile = async (file: File | null | undefined) => {
        if (!file) return
        if (!file.type.startsWith('image/')) {
            setStatus('error')
            setWarnings(["That doesn't look like an image."])
            return
        }
        setStatus('working')
        setProgress(0)
        setWarnings([])
        try {
            const { macros: parsed, warnings: warn } = await extractMacrosFromImage(
                file,
                setProgress
            )
            onChange({
                calories: parsed.calories ?? macros.calories,
                protein: parsed.protein ?? macros.protein,
                carbs: parsed.carbs ?? macros.carbs,
                fat: parsed.fat ?? macros.fat
            })
            setWarnings(warn)
            setStatus('done')
        } catch (e) {
            setStatus('error')
            setWarnings([String(e)])
        }
    }

    return (
        <div
            className="screenshot-input"
            onPaste={(e) => {
                const file = Array.from(e.clipboardData.files)[0]
                if (file) handleFile(file)
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
                e.preventDefault()
                handleFile(e.dataTransfer.files[0])
            }}
        >
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <button
                type="button"
                className="btn btn-ghost"
                disabled={status === 'working'}
                onClick={() => inputRef.current?.click()}
            >
                📷 Upload or paste a screenshot
            </button>
            <p className="small muted">
                Works with the MyFitnessPal web diary's "Remaining" row, or the iOS
                app's calories/macros card.{' '}
                <strong>Tip:</strong> crop tight to the numbers — a full-page
                screenshot has small text that's harder to read. The image is read on
                your device and never leaves your browser.
            </p>

            {status === 'working' && (
                <p className="small">Reading screenshot… {progress}%</p>
            )}
            {status === 'done' && (
                <p className="small ok">
                    Filled in below — please double-check the numbers before searching.
                </p>
            )}
            {status === 'error' && (
                <p className="small err">
                    Couldn't read that image. Try a tighter crop, or enter the numbers
                    manually.
                </p>
            )}
            {warnings.length > 0 && status !== 'error' && (
                <ul className="small muted screenshot-warnings">
                    {warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                    ))}
                </ul>
            )}
        </div>
    )
}
