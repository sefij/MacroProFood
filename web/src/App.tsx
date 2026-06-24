import { useEffect, useMemo, useState } from 'react'
import type {
    MenuItem,
    OptimizationResult,
    OptimizationResults,
    RestaurantIndexEntry,
    TargetMacros
} from './macro'
import { findBestCombinations } from './macro'
import { loadData, toRestaurantsData, type LoadedData } from './data'
import { buildClipboardToken, parseRemainingHash } from './bookmarklets'
import { detectExtension, trackMeal as extTrackMeal } from './mfpExtension'
import { MacroInput, type InputMode } from './components/MacroInput'
import { RestaurantPicker } from './components/RestaurantPicker'
import { Results } from './components/Results'
import { TrackPanel } from './components/TrackPanel'

const EMPTY: TargetMacros = { calories: 0, protein: 0, carbs: 0, fat: 0 }

// Swap-suggestion tuning. The optimizer never exceeds its target, so to give
// swaps "room for overage" we inflate the freed-up macros before searching:
//   - OVERAGE: how far past the gap a suggestion may reach (1.5 = up to +50%).
//   - MIN_HEADROOM: a per-macro floor (fraction of the original target) so
//     options still surface even when one macro is already near target.
//   - MAX_SUGGESTIONS: how many distinct items to offer.
const SWAP_OVERAGE = 1.5
const SWAP_MIN_HEADROOM = 0.2
const SWAP_MAX_SUGGESTIONS = 10

export function App () {
    const [data, setData] = useState<LoadedData | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)

    const [mode, setMode] = useState<InputMode>('manual')
    const [macros, setMacros] = useState<TargetMacros>(EMPTY)

    const [useAll, setUseAll] = useState(true)
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

    const [results, setResults] = useState<OptimizationResults | null>(null)
    const [picked, setPicked] = useState<{ restaurant: string; index: number } | null>(null)
    const [tracked, setTracked] = useState<OptimizationResult | null>(null)
    const [toast, setToast] = useState<string | null>(null)
    const [extAvailable, setExtAvailable] = useState(false)

    // Load nutrition data once.
    useEffect(() => {
        loadData().then(setData).catch((e) => setLoadError(String(e)))
    }, [])

    // Detect the optional browser extension (enables 1-click MFP read/write).
    useEffect(() => {
        detectExtension().then(setExtAvailable)
    }, [])

    const showToast = (msg: string) => {
        setToast(msg)
        setTimeout(() => setToast(null), 4000)
    }

    // If the "Pull remaining" bookmarklet sent us macros via the hash, prefill.
    useEffect(() => {
        const parsed = parseRemainingHash(window.location.hash)
        if (parsed) {
            setMode('mfp')
            setMacros(parsed)
            history.replaceState(null, '', window.location.pathname + window.location.search)
        }
    }, [])

    const restaurants: RestaurantIndexEntry[] = data?.index.restaurants ?? []
    const availableKeys = useMemo(
        () => restaurants.filter((r) => r.itemCount > 0).map((r) => r.key),
        [restaurants]
    )

    const iconFor = (restaurantName: string) =>
        restaurants.find((r) => r.restaurant === restaurantName)?.icon ?? '🍽️'

    const toggleKey = (key: string) => {
        setSelectedKeys((prev) => {
            const next = new Set(prev)
            next.has(key) ? next.delete(key) : next.add(key)
            return next
        })
    }

    const hasMacros = macros.calories > 0
    const activeKeys = useAll ? availableKeys : availableKeys.filter((k) => selectedKeys.has(k))
    const canCompute = hasMacros && activeKeys.length > 0 && !!data

    const compute = () => {
        if (!data) return
        const restaurantsData = toRestaurantsData(data.snapshots, activeKeys)
        setResults(findBestCombinations(restaurantsData, macros, 5, 3))
        setPicked(null)
        setTracked(null)
    }

    // Choosing an option collapses the rest and opens the Track panel below.
    const choose = (restaurant: string, index: number) => {
        if (!results) return
        const combo = results[restaurant]?.[index]
        if (!combo) return
        setPicked({ restaurant, index })
        // Copy to clipboard regardless — it's the bookmarklet/manual fallback.
        navigator.clipboard.writeText(buildClipboardToken(combo.totalNutrition)).catch(() => {})
        if (!extAvailable) {
            showToast('Meal copied — open MFP and click your "Track" bookmark')
        }
        setTracked(combo)
    }

    const clearChoice = () => {
        setPicked(null)
        setTracked(null)
    }

    // 1-click path used by TrackPanel when the extension is installed. Receives
    // the (possibly edited) meal totals rather than the original combo.
    const sendToMfp = async (nutrition: OptimizationResult['totalNutrition'], mealName: string) => {
        const res = await extTrackMeal(nutrition, mealName)
        showToast(
            res.confirmed
                ? `✓ Added to MyFitnessPal ${mealName}`
                : `Sent to MFP ${mealName} — check your diary to confirm`
        )
    }

    // Items from the picked restaurant that best fit `remaining`, surfaced in the
    // Track panel as swap suggestions when the user removes items from the meal.
    const suggestSwaps = (remaining: TargetMacros): MenuItem[] => {
        if (!data || !picked) return []
        const key = restaurants.find((r) => r.restaurant === picked.restaurant)?.key
        if (!key) return []
        const restData = toRestaurantsData(data.snapshots, [key])
        // Inflate the gap so suggestions get headroom past the freed-up macros.
        const pad = (rem: number, target: number) =>
            Math.max(rem * SWAP_OVERAGE, target * SWAP_MIN_HEADROOM)
        const widened: TargetMacros = {
            calories: pad(remaining.calories, macros.calories),
            protein: pad(remaining.protein, macros.protein),
            fat: pad(remaining.fat, macros.fat),
            carbs: pad(remaining.carbs, macros.carbs)
        }
        const combos = findBestCombinations(restData, widened, 3, SWAP_MAX_SUGGESTIONS)[
            picked.restaurant
        ] ?? []
        const seen = new Set<string>()
        const out: MenuItem[] = []
        for (const combo of combos) {
            for (const it of combo.items) {
                if (seen.has(it.name)) continue
                seen.add(it.name)
                out.push(it)
            }
        }
        return out.slice(0, SWAP_MAX_SUGGESTIONS)
    }

    return (
        <div className="app">
            <header className="hero">
                <h1>🍔 MacroPro</h1>
                <p>Find a fast-food meal that fits your remaining macros.</p>
            </header>

            {loadError && (
                <div className="card center">
                    <p className="muted">Couldn't load nutrition data.</p>
                    <p className="small muted">{loadError}</p>
                </div>
            )}

            <MacroInput
                mode={mode}
                onModeChange={setMode}
                macros={macros}
                onChange={setMacros}
                extAvailable={extAvailable}
            />

            <RestaurantPicker
                restaurants={restaurants}
                selected={selectedKeys}
                onToggle={toggleKey}
                useAll={useAll}
                onUseAll={setUseAll}
            />

            <button className="btn btn-primary" disabled={!canCompute} onClick={compute}>
                {hasMacros ? 'Find meals' : 'Enter your calories first'}
            </button>

            {results && (
                <div style={{ marginTop: 22 }}>
                    <Results
                        results={results}
                        iconFor={iconFor}
                        selected={picked}
                        onSelect={choose}
                        onClear={clearChoice}
                    />
                </div>
            )}

            {tracked && (
                <TrackPanel
                    combo={tracked}
                    targets={macros}
                    onClose={clearChoice}
                    extAvailable={extAvailable}
                    onSend={(nutrition, mealName) => sendToMfp(nutrition, mealName)}
                    suggest={suggestSwaps}
                />
            )}

            {toast && <div className="toast">{toast}</div>}

            <footer className="foot">
                Nutrition data is community-captured and may be out of date — always
                double-check against the restaurant. Macros and credentials never leave
                your browser.
            </footer>
        </div>
    )
}
