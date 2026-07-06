/**
 * Build the web app's nutrition data.
 *
 * Runs the existing scrapers via {@link ScrapingOperator} and writes one JSON
 * file per restaurant plus an `index.json` summary into `web/public/data/`,
 * which the React app fetches at runtime.
 *
 * Each file carries an `updatedAt` timestamp:
 *  - snapshot restaurants (Wendy's / Subway) use the hand-captured date
 *    exported from their `store.ts`;
 *  - live restaurants (KFC / Popeyes / McDonald's / Taco Bell) are stamped with
 *    the scrape run time, but only when the scrape actually returned items (so a
 *    failed scrape never masquerades as "fresh").
 *
 * Usage: `yarn build:data` (compiles, then runs `dist/tools/build-web-data.js`).
 */
import '../config' // loads .env (e.g. DISABLE_<KEY>) before scrapers read it

import * as fs from 'fs/promises'
import * as path from 'path'
import chalk from 'chalk'

import { ScrapingOperator } from '../scrapers/scraping-oprerator'
import {
    DataIndex,
    RestaurantData,
    RestaurantIndexEntry,
    RestaurantSnapshot,
    SnapshotItem,
    SnapshotSource
} from '../core/types'

import { updatedAt as wendysUpdatedAt } from '../scrapers/Wendys/store'
import { updatedAt as subwayUpdatedAt } from '../scrapers/Subway/store'

interface RestaurantMeta {
    /** Key as produced by ScrapingOperator.scrapeAll(). */
    scrapeKey: string
    /** Stable key used for filenames + UI selection. */
    key: string
    /** Display name. */
    restaurant: string
    icon: string
    source: SnapshotSource
    /** For snapshot restaurants: the hand-captured date from store.ts. */
    snapshotDate?: string
}

const REGISTRY: RestaurantMeta[] = [
    { scrapeKey: 'McDonalds', key: 'MCDONALDS', restaurant: "McDonald's", icon: '🍟', source: 'live' },
    { scrapeKey: 'Popeyes', key: 'POPEYES', restaurant: 'Popeyes', icon: '🐔', source: 'live' },
    { scrapeKey: 'TacoBell', key: 'TACOBELL', restaurant: 'Taco Bell', icon: '🌮', source: 'live' },
    { scrapeKey: 'Wagamama', key: 'WAGAMAMA', restaurant: 'Wagamama', icon: '🍜', source: 'live' },
    { scrapeKey: 'KFC', key: 'KFC', restaurant: 'KFC', icon: '🍗', source: 'live' },
    { scrapeKey: 'Wendys', key: 'WENDYS', restaurant: "Wendy's", icon: '🍔', source: 'snapshot', snapshotDate: wendysUpdatedAt },
    { scrapeKey: 'Subway', key: 'SUBWAY', restaurant: 'Subway', icon: '🥪', source: 'snapshot', snapshotDate: subwayUpdatedAt }
]

const OUTPUT_DIR = path.resolve(process.cwd(), 'web', 'public', 'data')

/** Converts the optimizer-shaped `RestaurantData` into a flat item list. */
function toSnapshotItems (data: RestaurantData | undefined): SnapshotItem[] {
    if (!data) return []
    return Object.entries(data).map(([name, n]) => ({
        name,
        calories: n.calories,
        protein: n.protein,
        fat: n.fat,
        carbs: n.carbs
    }))
}

/** Resolves the ISO `updatedAt` for a restaurant given its freshly scraped items. */
function resolveUpdatedAt (
    meta: RestaurantMeta,
    items: SnapshotItem[],
    runTimeIso: string,
    existing?: RestaurantSnapshot
): string {
    if (meta.source === 'snapshot') {
        // Hand-captured date from store.ts (normalized to ISO).
        return new Date(meta.snapshotDate ?? runTimeIso).toISOString()
    }
    // Live: only claim freshness if this run produced data; otherwise keep the
    // previously committed timestamp so a failed scrape doesn't look current.
    if (items.length > 0) return runTimeIso
    return existing?.updatedAt ?? runTimeIso
}

async function readExisting (key: string): Promise<RestaurantSnapshot | undefined> {
    try {
        const raw = await fs.readFile(path.join(OUTPUT_DIR, `${key.toLowerCase()}.json`), 'utf8')
        return JSON.parse(raw) as RestaurantSnapshot
    } catch {
        return undefined
    }
}

async function main (): Promise<void> {
    console.log(chalk.magenta.bold('🏗️  Building web nutrition data…'))
    await fs.mkdir(OUTPUT_DIR, { recursive: true })

    const operator = new ScrapingOperator({ bypassCache: false })
    const scraped = await operator.scrapeAll()

    const runTimeIso = new Date().toISOString()
    const indexEntries: RestaurantIndexEntry[] = []

    for (const meta of REGISTRY) {
        const items = toSnapshotItems(scraped[meta.scrapeKey])
        if (items.length === 0) {
            console.log(chalk.yellow(`  ⚠️  ${meta.restaurant}: no items scraped`))
        }
        const existing = await readExisting(meta.key)
        const updatedAt = resolveUpdatedAt(meta, items, runTimeIso, existing)

        // For a live restaurant that yielded nothing, keep any previously
        // committed items rather than overwriting good data with an empty list.
        const finalItems =
            items.length === 0 && meta.source === 'live' && existing
                ? existing.items
                : items

        const snapshot: RestaurantSnapshot = {
            restaurant: meta.restaurant,
            key: meta.key,
            icon: meta.icon,
            source: meta.source,
            updatedAt,
            items: finalItems
        }

        await fs.writeFile(
            path.join(OUTPUT_DIR, `${meta.key.toLowerCase()}.json`),
            JSON.stringify(snapshot, null, 2)
        )

        indexEntries.push({
            restaurant: meta.restaurant,
            key: meta.key,
            icon: meta.icon,
            source: meta.source,
            updatedAt,
            itemCount: finalItems.length
        })

        console.log(
            chalk.green(
                `  ✓ ${meta.restaurant} — ${finalItems.length} items (updated ${updatedAt.slice(0, 10)})`
            )
        )
    }

    const index: DataIndex = { generatedAt: runTimeIso, restaurants: indexEntries }
    await fs.writeFile(
        path.join(OUTPUT_DIR, 'index.json'),
        JSON.stringify(index, null, 2)
    )

    console.log(chalk.magenta.bold(`\n✅ Wrote ${indexEntries.length} restaurants → ${OUTPUT_DIR}`))
}

main()
    .catch((error) => {
        console.error(chalk.red(`Fatal error: ${error}`))
        process.exit(1)
    })
    .then(() => process.exit(0))
