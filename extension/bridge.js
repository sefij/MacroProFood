/*
 * Bridge content script — runs on the MacroPro web app's own pages.
 *
 * The web app and the extension can't call each other directly, so this relays
 * messages: window.postMessage (app) <-> chrome.runtime (background). The app
 * never needs the extension ID, and the bridge only runs on the app origins
 * listed in manifest.json.
 */
(() => {
    const TAG = 'macropro-mfp'

    const announce = () => window.postMessage({ __macropro: 'ext-ready', tag: TAG }, '*')

    // Let the app know the extension is present (now and on demand).
    announce()

    window.addEventListener('message', async (event) => {
        if (event.source !== window) return
        const data = event.data
        if (!data || data.__macropro == null) return

        if (data.__macropro === 'ping') {
            announce()
            return
        }

        if (data.__macropro === 'req') {
            try {
                const result = await chrome.runtime.sendMessage(data.payload)
                window.postMessage({ __macropro: 'res', id: data.id, result }, '*')
            } catch (err) {
                window.postMessage(
                    { __macropro: 'res', id: data.id, result: { ok: false, error: String((err && err.message) || err) } },
                    '*'
                )
            }
        }
    })
})()
