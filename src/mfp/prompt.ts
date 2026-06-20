import * as readline from 'readline/promises'
import chalk from 'chalk'

import { OptimizationResults } from '../types'

export interface Selection {
    restaurant: string
    optionIndex: number
}

export async function promptSelection (
    results: OptimizationResults
): Promise<Selection | null> {
    const restaurants = Object.keys(results)
    if (restaurants.length === 0) return null

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    })

    try {
        while (true) {
            const hint = restaurants
                .map((r) => `${r}(1-${results[r].length})`)
                .join(', ')
            console.log(
                chalk.cyan(
                    `\n📤 Push to MyFitnessPal Dinner? Available: ${hint}`
                )
            )
            const answer = (
                await rl.question(
                    chalk.cyan('   Format "<restaurant> <option#>", or blank to skip: ')
                )
            ).trim()

            if (answer === '' || answer.toLowerCase() === 'skip') return null

            const parts = answer.split(/\s+/)
            if (parts.length !== 2) {
                console.log(chalk.yellow('   ⚠️  Expected "<restaurant> <option#>". Try again.'))
                continue
            }

            const [restRaw, idxRaw] = parts
            const matchKey = restaurants.find(
                (r) => r.toLowerCase() === restRaw.toLowerCase()
            )
            if (!matchKey) {
                console.log(
                    chalk.yellow(
                        `   ⚠️  Unknown restaurant "${restRaw}". Choose from: ${restaurants.join(', ')}`
                    )
                )
                continue
            }

            const idx = Number.parseInt(idxRaw, 10)
            if (!Number.isInteger(idx) || idx < 1 || idx > results[matchKey].length) {
                console.log(
                    chalk.yellow(
                        `   ⚠️  Option must be 1-${results[matchKey].length} for ${matchKey}.`
                    )
                )
                continue
            }

            return { restaurant: matchKey, optionIndex: idx - 1 }
        }
    } finally {
        rl.close()
    }
}
