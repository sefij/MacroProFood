import * as fs from 'fs/promises'
import * as path from 'path'
import chalk from 'chalk'

const CACHE_DIR = path.resolve(process.cwd(), '.cache', 'scrapers')
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

interface CacheEntry<T> {
    savedAt: number
    ttlMs: number
    data: T
}

export interface CacheOptions {
    bypass?: boolean
    ttlMs?: number
}

async function ensureCacheDir (): Promise<void> {
    await fs.mkdir(CACHE_DIR, { recursive: true })
}

function cachePath (key: string): string {
    const safe = key.toLowerCase().replace(/[^a-z0-9_-]+/g, '_')
    return path.join(CACHE_DIR, `${safe}.json`)
}

async function readCache<T> (key: string): Promise<CacheEntry<T> | null> {
    try {
        const raw = await fs.readFile(cachePath(key), 'utf8')
        return JSON.parse(raw) as CacheEntry<T>
    } catch {
        return null
    }
}

async function writeCache<T> (key: string, entry: CacheEntry<T>): Promise<void> {
    await ensureCacheDir()
    await fs.writeFile(cachePath(key), JSON.stringify(entry, null, 2))
}

export async function withCache<T> (
    key: string,
    producer: () => Promise<T>,
    options: CacheOptions = {}
): Promise<T> {
    const ttl = options.ttlMs ?? DEFAULT_TTL_MS

    if (!options.bypass) {
        const cached = await readCache<T>(key)
        if (cached && Date.now() - cached.savedAt < cached.ttlMs) {
            const ageMin = Math.round((Date.now() - cached.savedAt) / 60000)
            console.log(
                chalk.gray(`💾 Using cached ${key} (age: ${ageMin} min)`)
            )
            return cached.data
        }
    } else {
        console.log(chalk.gray(`♻️  Bypassing cache for ${key}`))
    }

    const data = await producer()
    await writeCache(key, { savedAt: Date.now(), ttlMs: ttl, data })
    return data
}
