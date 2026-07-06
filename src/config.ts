/**
 * Environment configuration.
 *
 * Loads a project-root `.env` file into `process.env` (without any extra
 * dependency) and exposes typed helpers for reading it. Importing this module
 * for its side effect is enough to make `.env` values available.
 */

import * as path from 'path'
import * as fs from 'fs'

/**
 * Minimal `.env` loader — reads `KEY=VALUE` pairs from the project-root
 * `.env` file into `process.env`. Values already present in `process.env`
 * take precedence (so real environment variables win). A missing `.env`
 * file is not an error.
 */
function loadDotEnv (): void {
    const envPath = path.resolve(process.cwd(), '.env')

    let content: string
    try {
        content = fs.readFileSync(envPath, 'utf8')
    } catch {
        return // no .env file — nothing to load
    }

    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue

        const eq = line.indexOf('=')
        if (eq === -1) continue

        const key = line.slice(0, eq).trim()
        let value = line.slice(eq + 1).trim()

        // Strip a single layer of matching surrounding quotes.
        if (
            value.length >= 2 &&
            ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'")))
        ) {
            value = value.slice(1, -1)
        }

        if (key && !(key in process.env)) {
            process.env[key] = value
        }
    }
}

loadDotEnv()

/** Interprets common truthy spellings (`true`, `1`, `yes`, `on`). */
function isTrue (value: string | undefined): boolean {
    if (!value) return false
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

/** Restaurant identifiers, used to build the `DISABLE_<KEY>` env var name. */
export type RestaurantKey =
    | 'POPEYES'
    | 'KFC'
    | 'WENDYS'
    | 'MCDONALDS'
    | 'SUBWAY'
    | 'TACOBELL'
    | 'WAGAMAMA'

/**
 * Returns `true` when `DISABLE_<RESTAURANT>` is set to a truthy value.
 *
 * @example
 *   // .env contains: DISABLE_SUBWAY=true
 *   isScraperDisabled('SUBWAY') // => true
 */
export function isScraperDisabled (restaurant: RestaurantKey): boolean {
    return isTrue(process.env[`DISABLE_${restaurant}`])
}
