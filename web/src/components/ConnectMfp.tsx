import { pullRemainingBookmarklet } from '../bookmarklets'

/**
 * Explains and renders the "Pull remaining → MacroPro" bookmarklet. The whole
 * MFP integration is client-side and credential-free — see bookmarklets.ts.
 */
export function ConnectMfp () {
    const appUrl = window.location.origin + import.meta.env.BASE_URL
    const href = pullRemainingBookmarklet(appUrl)

    return (
        <details className="mfp" open>
            <summary>How "From MyFitnessPal" works (no password needed)</summary>
            <p className="small muted">
                We never ask for or store your MyFitnessPal login. Instead, drag this
                button to your bookmarks bar once. Then, on your MFP food diary, click it —
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
