/**
 * Client for the optional MacroPro MyFitnessPal Companion extension (see /extension).
 *
 * When installed, the extension injects a bridge content script into this app's
 * pages; we talk to it purely over `window.postMessage`, so the app needs no
 * extension ID and no special permissions. When it's absent, callers fall back
 * to the bookmarklet flow in bookmarklets.ts.
 */
import type { TargetMacros } from './macro'

interface Envelope {
    ok: boolean
    result?: unknown
    error?: string
}

let readySeen = false

if (typeof window !== 'undefined') {
    window.addEventListener('message', (e) => {
        if (e.source === window && (e.data as any)?.__macropro === 'ext-ready') {
            readySeen = true
        }
    })
}

/** Resolves true if the extension's bridge answers a ping within `timeout` ms. */
export function detectExtension (timeout = 700): Promise<boolean> {
    if (readySeen) return Promise.resolve(true)
    return new Promise((resolve) => {
        const handler = (e: MessageEvent) => {
            if (e.source === window && (e.data as any)?.__macropro === 'ext-ready') {
                cleanup()
                resolve(true)
            }
        }
        const timer = setTimeout(() => {
            cleanup()
            resolve(readySeen)
        }, timeout)
        const cleanup = () => {
            clearTimeout(timer)
            window.removeEventListener('message', handler)
        }
        window.addEventListener('message', handler)
        window.postMessage({ __macropro: 'ping' }, '*')
    })
}

/** Sends a request through the bridge and resolves the background's result. */
function request<T> (payload: Record<string, unknown>, timeout = 20000): Promise<T> {
    return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).slice(2)
        const handler = (e: MessageEvent) => {
            if (e.source !== window) return
            const d = e.data as any
            if (d?.__macropro !== 'res' || d.id !== id) return
            cleanup()
            const env = d.result as Envelope
            if (!env || env.ok !== true) reject(new Error(env?.error || 'Extension request failed'))
            else resolve(env.result as T)
        }
        const timer = setTimeout(() => {
            cleanup()
            reject(new Error('The extension did not respond. Is it installed and enabled?'))
        }, timeout)
        const cleanup = () => {
            clearTimeout(timer)
            window.removeEventListener('message', handler)
        }
        window.addEventListener('message', handler)
        window.postMessage({ __macropro: 'req', id, payload: { ...payload } }, '*')
    })
}

/** Reads the user's MFP "Remaining" macros via their logged-in session. */
export function pullRemaining (): Promise<TargetMacros> {
    return request<TargetMacros>({ type: 'pull' })
}

export interface TrackResult {
    filled: string[]
    /** Whether "Add to Diary" was clicked. */
    submitted?: boolean
    /** Whether the Quick Add form was observed to close (entry saved). */
    confirmed?: boolean
    meal?: string
}

/**
 * Fills and submits the MFP Quick Add form with the chosen meal, under `mealName`.
 *
 * Tracking waits on several MFP page loads in sequence (up to ~15s for the Quick
 * Add form, ~8s to fill it, ~12s to confirm the save), so it gets a much longer
 * deadline than the 20s default — otherwise a slow diary makes the app report
 * "the extension did not respond" while the worker is still mid-submit.
 */
export function trackMeal (
    meal: { calories: number; protein: number; fat: number; carbs: number },
    mealName: string
): Promise<TrackResult> {
    return request<TrackResult>({ type: 'track', meal, mealName }, 60000)
}
