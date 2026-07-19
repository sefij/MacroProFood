import { useEffect, useMemo, useState } from 'react'
import type {
    MenuItem,
    OptimizationResult,
    OptimizationResults,
    RestaurantIndexEntry,
    SnapshotItem,
    TargetMacros
} from './macro'
import { findBestCombinations } from './macro'
import { loadData, toRestaurantsData, type LoadedData } from './data'
import { buildClipboardToken, parseRemainingHash } from './bookmarklets'
import { detectExtension, trackMeal as extTrackMeal } from './mfpExtension'
import { MacroInput, type InputMode } from './components/MacroInput'
import { RestaurantPicker } from './components/RestaurantPicker'
import type { RestaurantCategoryGroup } from './components/CategoryFilters'
import { Results } from './components/Results'
import { TrackPanel } from './components/TrackPanel'
import { MenuBuilder } from './components/MenuBuilder'
import { StickySummary } from './components/StickySummary'
import type { RestaurantCategoryFilter } from '../../src/core/category-filter'
import { menuItemKey, menuRestaurant, menuTotals, type MenuState } from './menu'

type AppMode = 'optimize' | 'menu'

const EMPTY: TargetMacros = { calories: 0, protein: 0, carbs: 0, fat: 0 }

// Persists the per-restaurant category filter selection across visits.
// Unlike the CLI's EXCLUDE_CATEGORIES env default, the web app starts
// unfiltered ('all' for every restaurant) — this key simply remembers
// whatever the user last chose.
const CATEGORY_FILTERS_KEY = 'macropro:categoryFilters'

function loadCategoryFilters (): Record<string, RestaurantCategoryFilter> {
    try {
        const raw = localStorage.getItem(CATEGORY_FILTERS_KEY)
        return raw ? JSON.parse(raw) : {}
    } catch {
        return {}
    }
}

// Swap-suggestion tuning. The optimizer never exceeds its target, so to give
// swaps "room for overage" we inflate the freed-up macros before searching:
//   - OVERAGE: how far past the gap a suggestion may reach (1.5 = up to +50%).
//   - MIN_HEADROOM: a per-macro floor (fraction of the original target) so
//     options still surface even when one macro is already near target.
//   - MAX_SUGGESTIONS: how many distinct items to offer.
const SWAP_OVERAGE = 1.5
const SWAP_MIN_HEADROOM = 0.2
const SWAP_MAX_SUGGESTIONS = 10

const COFFEE_URL = 'https://buymeacoffee.com/sefij'
const SUGGEST_URL = 'https://github.com/sefij/MacroProFood/issues/new'

export function App() {
    const [data, setData] = useState<LoadedData | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)

    const [mode, setMode] = useState<InputMode>('manual')
    const [macros, setMacros] = useState<TargetMacros>(EMPTY)

    const [useAll, setUseAll] = useState(true)
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
    const [categoryFilters, setCategoryFilters] =
        useState<Record<string, RestaurantCategoryFilter>>(loadCategoryFilters)

    const [results, setResults] = useState<OptimizationResults | null>(null)
    const [picked, setPicked] = useState<{
        restaurant: string
        index: number
    } | null>(null)
    const [tracked, setTracked] = useState<OptimizationResult | null>(null)
    const [toast, setToast] = useState<string | null>(null)
    const [extAvailable, setExtAvailable] = useState(false)

    const [appMode, setAppMode] = useState<AppMode>('optimize')
    const [menuRestaurantKey, setMenuRestaurantKey] = useState<string | null>(null)
    const [menuMeal, setMenuMeal] = useState<MenuState>(new Map())

    // Load nutrition data once.
    useEffect(() => {
        loadData()
            .then(setData)
            .catch((e) => setLoadError(String(e)))
    }, [])

    // Detect the optional browser extension (enables 1-click MFP read/write).
    useEffect(() => {
        detectExtension().then(setExtAvailable)
    }, [])

    const showToast = (msg: string) => {
        setToast(msg)
        setTimeout(() => setToast(null), 4000)
    }

    // Switching modes starts fresh rather than carrying over a stale
    // Results/TrackPanel from whichever mode was active before.
    const switchAppMode = (next: AppMode) => {
        setAppMode(next)
        setResults(null)
        setPicked(null)
        setTracked(null)
    }

    // If the "Pull remaining" bookmarklet sent us macros via the hash, prefill.
    useEffect(() => {
        const parsed = parseRemainingHash(window.location.hash)
        if (parsed) {
            setMode('mfp')
            setMacros(parsed)
            history.replaceState(
                null,
                '',
                window.location.pathname + window.location.search
            )
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
    const activeKeys = useAll
        ? availableKeys
        : availableKeys.filter((k) => selectedKeys.has(k))
    const canCompute = hasMacros && activeKeys.length > 0 && !!data

    // One group per currently active restaurant that actually has categorized
    // items — recomputed as the restaurant selection changes so a group for a
    // deselected restaurant doesn't linger.
    const categoryGroups = useMemo(() => {
        const groups: RestaurantCategoryGroup[] = []
        for (const key of activeKeys) {
            const snap = data?.snapshots[key]
            if (!snap) continue
            const cats = new Set<string>()
            for (const item of snap.items) if (item.category) cats.add(item.category)
            if (cats.size === 0) continue
            groups.push({
                restaurant: snap.restaurant,
                icon: snap.icon,
                categories: Array.from(cats).sort()
            })
        }
        return groups.sort((a, b) => a.restaurant.localeCompare(b.restaurant))
    }, [activeKeys, data])

    const persistCategoryFilters = (next: Record<string, RestaurantCategoryFilter>) => {
        localStorage.setItem(CATEGORY_FILTERS_KEY, JSON.stringify(next))
    }

    const setCategoryMode = (restaurant: string, mode: RestaurantCategoryFilter['mode']) => {
        setCategoryFilters((prev) => {
            const next = {
                ...prev,
                [restaurant]: { mode, categories: prev[restaurant]?.categories ?? [] }
            }
            persistCategoryFilters(next)
            return next
        })
    }

    const toggleFilterCategory = (restaurant: string, category: string) => {
        setCategoryFilters((prev) => {
            const current = prev[restaurant] ?? { mode: 'exclude' as const, categories: [] }
            const categories = current.categories.includes(category)
                ? current.categories.filter((c) => c !== category)
                : [...current.categories, category]
            const next = { ...prev, [restaurant]: { mode: current.mode, categories } }
            persistCategoryFilters(next)
            return next
        })
    }

    const compute = () => {
        if (!data) return
        const restaurantsData = toRestaurantsData(data.snapshots, activeKeys, categoryFilters)
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
        navigator.clipboard
            .writeText(buildClipboardToken(combo.totalNutrition))
            .catch(() => {})
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
    const sendToMfp = async (
        nutrition: OptimizationResult['totalNutrition'],
        mealName: string
    ) => {
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
        const key = restaurants.find(
            (r) => r.restaurant === picked.restaurant
        )?.key
        if (!key) return []
        const restData = toRestaurantsData(data.snapshots, [key], categoryFilters)
        // Inflate the gap so suggestions get headroom past the freed-up macros.
        const pad = (rem: number, target: number) =>
            Math.max(rem * SWAP_OVERAGE, target * SWAP_MIN_HEADROOM)
        const widened: TargetMacros = {
            calories: pad(remaining.calories, macros.calories),
            protein: pad(remaining.protein, macros.protein),
            fat: pad(remaining.fat, macros.fat),
            carbs: pad(remaining.carbs, macros.carbs)
        }
        const combos =
            findBestCombinations(restData, widened, 3, SWAP_MAX_SUGGESTIONS)[
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

    // The tracked combo's restaurant's full menu, for TrackPanel's "+ Add
    // from menu" section. Optimizer combos are always single-restaurant; a
    // menu-mode-tracked meal could in principle span several, so this just
    // takes the first item's restaurant — good enough for "add more from
    // wherever this meal is mostly from" without over-engineering a rarely
    // mixed case.
    const trackedMenuItems: SnapshotItem[] = useMemo(() => {
        const restaurantName = tracked?.items[0]?.restaurant
        if (!data || !restaurantName) return []
        const key = restaurants.find((r) => r.restaurant === restaurantName)?.key
        return key ? data.snapshots[key]?.items ?? [] : []
    }, [data, tracked, restaurants])

    // Menu mode: the restaurant currently being browsed, and the running
    // totals of whatever's been added so far. Browsing a different
    // restaurant's chip doesn't touch the meal — only adding from it does
    // (see addMenuItem) — so switching around to compare menus is free.
    const menuSnapshot = menuRestaurantKey ? data?.snapshots[menuRestaurantKey] : undefined
    const menuItems = menuSnapshot?.items ?? []
    const menuRestaurantName = menuSnapshot?.restaurant ?? ''
    const menuMealTotals = useMemo(() => menuTotals(menuMeal), [menuMeal])

    // The meal is scoped to one restaurant at a time: adding an item from a
    // different restaurant than what's already in the meal starts a fresh
    // meal rather than mixing the two, with a toast so the reset isn't a
    // silent surprise.
    const addMenuItem = (item: MenuItem) => {
        const currentRestaurant = menuRestaurant(menuMeal)
        if (currentRestaurant && currentRestaurant !== item.restaurant) {
            showToast(`Switched to ${item.restaurant} — cleared your ${currentRestaurant} picks`)
            setMenuMeal(new Map([[menuItemKey(item), { item, qty: 1 }]]))
            return
        }
        setMenuMeal((prev) => {
            const next = new Map(prev)
            const key = menuItemKey(item)
            const qty = (next.get(key)?.qty ?? 0) + 1
            next.set(key, { item, qty })
            return next
        })
    }

    const removeMenuItem = (item: MenuItem) => {
        setMenuMeal((prev) => {
            const key = menuItemKey(item)
            const existing = prev.get(key)
            if (!existing) return prev
            const next = new Map(prev)
            if (existing.qty <= 1) next.delete(key)
            else next.set(key, { item, qty: existing.qty - 1 })
            return next
        })
    }

    // Hands the built meal to the same TrackPanel optimized combos use —
    // expanding qty back into repeated entries so a "3x Fries" pick reads the
    // same way an optimizer combo with three Fries would.
    const trackMenuMeal = () => {
        if (menuMeal.size === 0) return
        const items: MenuItem[] = []
        for (const { item, qty } of menuMeal.values()) {
            for (let i = 0; i < qty; i++) items.push(item)
        }
        const totalNutrition = menuMealTotals
        const tCal = Math.max(macros.calories, 1)
        const tProt = Math.max(macros.protein, 1)
        const tFat = Math.max(macros.fat, 1)
        const tCarbs = Math.max(macros.carbs, 1)
        setResults(null)
        setPicked(null)
        setTracked({
            items,
            totalNutrition,
            accuracy: {
                calories: Math.abs(totalNutrition.calories - macros.calories) / tCal,
                protein: Math.abs(totalNutrition.protein - macros.protein) / tProt,
                fat: Math.abs(totalNutrition.fat - macros.fat) / tFat,
                carbs: Math.abs(totalNutrition.carbs - macros.carbs) / tCarbs
            }
        })
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

            <div className="segmented app-mode-switch" role="tablist">
                <button
                    className={appMode === 'optimize' ? 'active' : ''}
                    onClick={() => switchAppMode('optimize')}
                >
                    🎯 Optimize
                </button>
                <button
                    className={appMode === 'menu' ? 'active' : ''}
                    onClick={() => switchAppMode('menu')}
                >
                    🍽️ Build a meal
                </button>
            </div>

            <MacroInput
                mode={mode}
                onModeChange={setMode}
                macros={macros}
                onChange={setMacros}
                extAvailable={extAvailable}
            />

            {appMode === 'optimize' ? (
                <>
                    <RestaurantPicker
                        restaurants={restaurants}
                        selected={selectedKeys}
                        onToggle={toggleKey}
                        useAll={useAll}
                        onUseAll={setUseAll}
                        categoryGroups={categoryGroups}
                        categoryFilters={categoryFilters}
                        onCategoryModeChange={setCategoryMode}
                        onToggleCategory={toggleFilterCategory}
                    />

                    <button
                        className="btn btn-primary"
                        disabled={!canCompute}
                        onClick={compute}
                    >
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
                </>
            ) : (
                <>
                    <MenuBuilder
                        restaurants={restaurants}
                        selectedKey={menuRestaurantKey}
                        onSelectRestaurant={setMenuRestaurantKey}
                        items={menuItems}
                        restaurantName={menuRestaurantName}
                        meal={menuMeal}
                        onAdd={addMenuItem}
                        onRemove={removeMenuItem}
                    />

                    <StickySummary
                        totals={menuMealTotals}
                        targets={macros}
                        onTrack={trackMenuMeal}
                        canTrack={menuMeal.size > 0}
                    />
                </>
            )}

            {tracked && (
                <TrackPanel
                    combo={tracked}
                    targets={macros}
                    onClose={clearChoice}
                    extAvailable={extAvailable}
                    onSend={(nutrition, mealName) =>
                        sendToMfp(nutrition, mealName)
                    }
                    suggest={suggestSwaps}
                    menuItems={trackedMenuItems}
                />
            )}

            {toast && <div className="toast">{toast}</div>}

            <footer className="foot">
                Nutrition data is community-captured and may be out of date —
                always double-check against the restaurant. Macros and
                credentials never leave your browser.
                <br />
                <span className="foot-links">
                    <a href="/privacy.html">Privacy Policy</a>
                    <a
                        href={SUGGEST_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Suggest a restaurant
                    </a>
                    <a
                        href={COFFEE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        ☕ Buy me a coffee
                    </a>
                </span>
            </footer>
        </div>
    )
}
