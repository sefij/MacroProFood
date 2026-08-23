/**
 * Retries a network call with exponential backoff. Added after this project's
 * "Refresh nutrition data" CI runs turned up intermittent `AggregateError`s
 * (Node's dual-stack connection attempt failing) hitting different,
 * unrelated scrapers on different days — Domino's, Subway, Chipotle, Five
 * Guys — never the same host twice in a row, which points to generic
 * GitHub Actions runner network flakiness rather than any one site blocking
 * or rate-limiting this project specifically. A single failed attempt was
 * previously treated as "this restaurant has no data today"; retrying a
 * handful of times a few seconds apart is cheap insurance against that,
 * without masking a genuine, persistent failure (a real block or a changed
 * URL still exhausts every retry and throws, same as before).
 *
 * Every call site wraps only the network request itself (`axios.get(...)`),
 * not the surrounding parse/transform logic — retrying a parse failure would
 * just repeat the same wrong result.
 */
import chalk from 'chalk'

export interface RetryOptions {
    /** Total attempts, including the first — not the retry count. Default 3. */
    attempts?: number
    /** Delay before the first retry; doubles each subsequent attempt. Default 1000ms. */
    baseDelayMs?: number
}

function sleep (ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

/** `label` identifies the call in a retry's console warning, e.g. "KFC nutrition page". */
export async function withRetry<T> (
    label: string,
    fn: () => Promise<T>,
    { attempts = 3, baseDelayMs = 1000 }: RetryOptions = {}
): Promise<T> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn()
        } catch (error) {
            if (attempt === attempts) throw error
            const delay = baseDelayMs * 2 ** (attempt - 1)
            console.log(
                chalk.yellow(
                    `  ⚠ ${label}: attempt ${attempt}/${attempts} failed (${error}) — retrying in ${delay}ms`
                )
            )
            await sleep(delay)
        }
    }
    // Unreachable — the loop always either returns or throws on its last attempt.
    throw new Error(`${label}: retry loop exited without returning or throwing`)
}
