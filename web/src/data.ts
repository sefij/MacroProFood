/**
 * Data layer: loads the per-restaurant nutrition snapshots produced by
 * `yarn build:data` (served from `/data/*.json`) and adapts them into the
 * `RestaurantsData` shape the optimizer core expects.
 */
import type {
    DataIndex,
    RestaurantSnapshot,
    RestaurantsData
} from './macro'

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
 * display name (which the optimizer surfaces back in results).
 */
export function toRestaurantsData (
    snapshots: Record<string, RestaurantSnapshot>,
    selectedKeys: string[]
): RestaurantsData {
    const out: RestaurantsData = {}
    for (const key of selectedKeys) {
        const snap = snapshots[key]
        if (!snap || snap.items.length === 0) continue
        const items: RestaurantsData[string] = {}
        for (const it of snap.items) {
            items[it.name] = {
                calories: it.calories,
                protein: it.protein,
                fat: it.fat,
                carbs: it.carbs,
                ProteinTCalRatio: it.protein / it.calories || 1,
                CarbToCalRatio: it.carbs / it.calories || 1,
                category: it.category
            }
        }
        out[snap.restaurant] = items
    }
    return out
}
