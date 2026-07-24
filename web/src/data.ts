/**
 * Data layer: loads the per-restaurant nutrition snapshots produced by
 * `yarn build:data` (served from `/data/*.json`) and adapts them into the
 * `RestaurantsData` shape the optimizer core expects.
 */
import type {
    DataIndex,
    RestaurantSnapshot,
    RestaurantsData,
    TargetMacros
} from './macro'
import {
    filterCategoriesByRestaurant,
    type RestaurantCategoryFilter
} from '../../src/core/category-filter'
import { dominantMacro, expandBuildableCombos } from '../../src/core/buildable-combos'

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

export interface LoadedData {
    index: DataIndex
    /** key -> full snapshot (only for restaurants that have items). */
    snapshots: Record<string, RestaurantSnapshot>
}

async function getJson<T> (path: string): Promise<T> {
    const res = await fetch(`${BASE}/data/${path}`)
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`)
    return (await res.json()) as T
}

/** Loads the index and every restaurant snapshot that actually has items. */
export async function loadData (): Promise<LoadedData> {
    const index = await getJson<DataIndex>('index.json')

    const withItems = index.restaurants.filter((r) => r.itemCount > 0)
    const loaded = await Promise.all(
        withItems.map((r) => getJson<RestaurantSnapshot>(`${r.key.toLowerCase()}.json`))
    )

    const snapshots: Record<string, RestaurantSnapshot> = {}
    for (const snap of loaded) snapshots[snap.key] = snap

    return { index, snapshots }
}

/**
 * Adapts the selected restaurants' snapshots into `RestaurantsData` keyed by
 * display name (which the optimizer surfaces back in results). `categoryFilters`
 * (keyed by that same display name — see {@link RestaurantCategoryFilter})
 * is applied here so both the main compute path and swap suggestions share
 * the same per-restaurant filtering. `targets` drives which macro a
 * build-your-own item's candidate expansion is capped/ranked around (spec
 * 12's `dominantMacro` — whichever of protein/fat/carbs this request leans
 * on most); this runs fresh per call, so the expansion is always matched to
 * the request actually being made, not a fixed default.
 */
export function toRestaurantsData (
    snapshots: Record<string, RestaurantSnapshot>,
    selectedKeys: string[],
    targets: TargetMacros,
    categoryFilters: Record<string, RestaurantCategoryFilter> = {}
): RestaurantsData {
    const macro = dominantMacro(targets)
    const out: RestaurantsData = {}
    for (const key of selectedKeys) {
        const snap = snapshots[key]
        if (!snap || snap.items.length === 0) continue
        const items: RestaurantsData[string] = {}
        for (const it of snap.items) {
            // A variant item (spec 10) expands back into one flat optimizer
            // entry per option, keyed "<base> (<option>)" — exactly what a
            // pre-alterations scraper produced — so the optimizer stays
            // variant-unaware. A build-your-own item (spec 12) expands the
            // same way, into one entry per required-choices-only combination
            // (`expandBuildableCombos` — Toppings and other optional groups
            // excluded; see that module for why). A simple item contributes
            // a single entry.
            const flat = it.variants
                ? it.variants.map((v) => ({
                    name: `${it.name} (${v.label})`,
                    calories: v.calories,
                    protein: v.protein,
                    fat: v.fat,
                    carbs: v.carbs
                }))
                : it.build
                    ? expandBuildableCombos(it.build, macro).map((combo) => ({
                        name: `${it.name} — ${combo.labels.join(', ')}`,
                        calories: combo.macros.calories,
                        protein: combo.macros.protein,
                        fat: combo.macros.fat,
                        carbs: combo.macros.carbs
                    }))
                    : [it]
            for (const f of flat) {
                items[f.name] = {
                    calories: f.calories,
                    protein: f.protein,
                    fat: f.fat,
                    carbs: f.carbs,
                    ProteinTCalRatio: f.protein / f.calories || 1,
                    CarbToCalRatio: f.carbs / f.calories || 1,
                    category: it.category
                }
            }
        }
        out[snap.restaurant] = items
    }
    return filterCategoriesByRestaurant(out, categoryFilters)
}
