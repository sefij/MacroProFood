import { useState } from 'react'
import type { TargetMacros } from '../macro'
import { pullRemainingBookmarklet } from '../bookmarklets'
import { pullRemaining } from '../mfpExtension'

interface Props {
    /** True when the MacPro MyFitnessPal Companion extension is installed. */
    extAvailable: boolean
    /** Called with the macros pulled from MyFitnessPal. */
    onMacros: (m: TargetMacros) => void
}

/**
 * "From MyFitnessPal" panel. With the extension installed it's a single button
 * (uses the existing MFP session); without it, the credential-free bookmarklet
 * fallback. Either way no password is ever asked for or stored.
 */
export function ConnectMfp ({ extAvailable, onMacros }: Props) {
    const [pulling, setPulling] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const appUrl = window.location.origin + import.meta.env.BASE_URL
    const href = pullRemainingBookmarklet(appUrl)

    const onPull = async () => {
        setPulling(true)
        setError(null)
        try {
            onMacros(await pullRemaining())
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
        } finally {
            setPulling(false)
        }
    }

    if (extAvailable) {
        return (
            <div className="mfp-connected">
                <p className="small muted">
                    <b className="ok">✓ MyFitnessPal extension connected.</b> We read your
                    remaining macros from your logged-in session — no password needed.
                </p>
                <button className="btn btn-primary" onClick={onPull} disabled={pulling}>
                    {pulling ? 'Reading your diary…' : '📥 Pull my remaining macros'}
                </button>
                {error && <p className="small err">{error}</p>}
            </div>
        )
    }

    return (
        <details className="mfp" open>
            <summary>How "From MyFitnessPal" works (no password needed)</summary>
            <p className="small muted">
                Install the <b>MacPro MyFitnessPal Companion</b> extension for one-click sync, or drag this
                bookmarklet to your bookmarks bar once. On your MFP food diary, click it —
                it reads your <b>Remaining</b> row and sends just those four numbers back here.
            </p>
            {/* eslint-disable-next-line react/jsx-no-script-url */}
            <a className="bookmarklet" href={href} onClick={(e) => e.preventDefault()}>
                ↦ Pull remaining → MacroPro
            </a>
            <ol className="steps">
                <li>Drag the button above into your browser's bookmarks/favourites bar.</li>
                <li>Open your <b>MyFitnessPal food diary</b> (logged in).</li>
                <li>Click the bookmark — this page reopens with your macros filled in.</li>
            </ol>
        </details>
    )
}
