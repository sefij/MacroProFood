import { useEffect, useMemo, useState } from 'react'
import type {
    OptimizationResult,
    OptimizationResults,
    RestaurantIndexEntry,
    TargetMacros
} from './macro'
import { findBestCombinations } from './macro'
import { loadData, toRestaurantsData, type LoadedData } from './data'
import { buildClipboardToken, parseRemainingHash } from './bookmarklets'
import { MacroInput, type InputMode } from './components/MacroInput'
import { RestaurantPicker } from './components/RestaurantPicker'
import { Results } from './components/Results'
import { TrackPanel } from './components/TrackPanel'

const EMPTY: TargetMacros = { calories: 0, protein: 0, carbs: 0, fat: 0 }

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

    // Load nutrition data once.
    useEffect(() => {
        loadData().then(setData).catch((e) => setLoadError(String(e)))
    }, [])

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

    const trackMeal = async (combo: OptimizationResult) => {
        const token = buildClipboardToken(combo.totalNutrition)
        try {
            await navigator.clipboard.writeText(token)
            setToast('Meal copied — open MFP and click your "Track" bookmark')
            setTimeout(() => setToast(null), 4000)
        } catch {
            /* clipboard blocked — TrackPanel shows the value to copy manually */
        }
        setTracked(combo)
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

            <MacroInput mode={mode} onModeChange={setMode} macros={macros} onChange={setMacros} />

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
                        onSelect={(restaurant, index) => setPicked({ restaurant, index })}
                        onTrack={trackMeal}
                    />
                </div>
            )}

            {tracked && (
                <TrackPanel combo={tracked} onClose={() => setTracked(null)} />
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
