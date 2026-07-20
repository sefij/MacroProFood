/**
 * Restaurant Nutrition Scraper & Macro Optimizer
 *
 * This script scrapes nutritional information from Popeyes UK, KFC UK, and McDonald's UK
 * websites and finds the best meal combinations to match specified macro requirements.
 *
 * Usage:
 *   node nutrition-scraper.js --calories 2000 --protein 150 --fat 67 --carbs 250
 */

import './config.js' // loads .env into process.env before anything reads it

import { Command } from 'commander'
import chalk from 'chalk'

import { RestaurantsData, TargetMacros } from './types.js'
import { MacroOptimizer } from './macro-optimizer.js'
import { excludeCategories } from './core/category-filter.js'
import { defaultExcludedCategories } from './config.js'

import { ScrapingOperator } from './scrapers/scraping-oprerator.js'
import { promptSelection } from './mfp/prompt.js'
import { MfpClient } from './mfp/client.js'
import { resolveAuth } from './mfp/auth.js'

async function main (): Promise<void> {
    const program = new Command()

    program
        .name('nutrition-scraper')
        .description('Find restaurant meals matching your macro requirements')
        .option(
            '-c, --calories <number>',
            'Target calories (defaults to MFP remaining)',
            parseFloat
        )
        .option(
            '-p, --protein <number>',
            'Target protein in grams (defaults to MFP remaining)',
            parseFloat
        )
        .option(
            '-f, --fat <number>',
            'Target fat in grams (defaults to MFP remaining)',
            parseFloat
        )
        .option(
            '-r, --carbs <number>',
            'Target carbs in grams (defaults to MFP remaining)',
            parseFloat
        )
        .option('-m, --max-items <number>', 'Maximum items per restaurant', '5')
        .option('-e, --restaurant <string>', 'Restaurant name')
        .option(
            '-x, --exclude-category <name...>',
            'Category to exclude from calculations, e.g. Desserts (defaults to EXCLUDE_CATEGORIES env var)'
        )
        .option('--no-cache', 'Bypass cached scraper results and fetch fresh data')
        .option('--no-mfp', 'Skip the MyFitnessPal push prompt')
        .parse()

    const options = program.opts()

    console.log(
        chalk.magenta.bold('🍔 Restaurant Nutrition Scraper & Macro Optimizer')
    )
    console.log(chalk.magenta('='.repeat(60)))

    const targets = await resolveTargetMacros({
        calories: options.calories,
        protein: options.protein,
        fat: options.fat,
        carbs: options.carbs
    })

    // commander's --no-cache sets options.cache = false
    const bypassCache = options.cache === false
    const operator = new ScrapingOperator({ bypassCache })

    try {
        let restaurantData: RestaurantsData = {}
        // Scrape data
        if (!options.restaurant) {
            restaurantData = await operator.scrapeAll()
        } else {
            restaurantData[options.restaurant.toUpperCase()] =
                await operator.scrapeRestaurant(options.restaurant)
        }

        // Check if we got any data
        const totalItems = Object.values(restaurantData).reduce(
            (sum, items) => sum + Object.keys(items || []).length,
            0
        )

        if (totalItems === 0) {
            console.log(
                chalk.red('\n❌ No nutrition data found. This could be due to:')
            )
            console.log(chalk.yellow('  • Website structure changes'))
            console.log(chalk.yellow('  • Network connectivity issues'))
            console.log(chalk.yellow('  • Anti-bot measures'))
            console.log(
                chalk.yellow('  • Missing dependencies (puppeteer, etc.)')
            )
            return
        }

        console.log(
            chalk.green(
                `\n✅ Successfully scraped ${totalItems} items from ${Object.keys(restaurantData).length
                } restaurants\n`
            )
        )

        // -x/--exclude-category, falling back to EXCLUDE_CATEGORIES when not given.
        const excludedCategories: string[] =
            options.excludeCategory ?? defaultExcludedCategories()
        if (excludedCategories.length > 0) {
            restaurantData = excludeCategories(restaurantData, excludedCategories)
            console.log(
                chalk.gray(`Excluding categories: ${excludedCategories.join(', ')}\n`)
            )
        }

        // Optimize macros
        const optimizer = new MacroOptimizer(restaurantData)
        const results = optimizer.findBestCombinations(
            targets,
            parseInt(options.maxItems)
        )

        // Display results
        optimizer.displayResults(results, targets)

        if (options.mfp !== false) {
            await pushToMyFitnessPal(results)
        }
    } catch (error) {
        console.error(chalk.red(`\n❌ Error: ${error}`))
    }
    // finally {
    //     await operator.cleanup() // Ensure cleanup is called in main
    // }
}

interface MaybeTargets {
    calories?: number
    protein?: number
    fat?: number
    carbs?: number
}

async function resolveTargetMacros (provided: MaybeTargets): Promise<TargetMacros> {
    const isMissing = (v: number | undefined): boolean =>
        v === undefined || !Number.isFinite(v)

    const anyMissing =
        isMissing(provided.calories) ||
        isMissing(provided.protein) ||
        isMissing(provided.fat) ||
        isMissing(provided.carbs)

    if (!anyMissing) {
        return {
            calories: provided.calories as number,
            protein: provided.protein as number,
            fat: provided.fat as number,
            carbs: provided.carbs as number
        }
    }

    const { userDataDir, email, password } = resolveAuth()
    console.log(
        chalk.cyan(
            '\n📥 Macros not fully provided — fetching "Remaining" row from MyFitnessPal…'
        )
    )

    const mfp = await MfpClient.create({ headless: true, userDataDir })
    try {
        await mfp.ensureLoggedIn({ email, password, allowInteractive: true })
        const remaining = await mfp.fetchRemainingMacros()
        const merged: TargetMacros = {
            calories: isMissing(provided.calories) ? remaining.calories : (provided.calories as number),
            protein: isMissing(provided.protein) ? remaining.protein : (provided.protein as number),
            fat: isMissing(provided.fat) ? remaining.fat : (provided.fat as number),
            carbs: isMissing(provided.carbs) ? remaining.carbs : (provided.carbs as number)
        }
        console.log(
            chalk.green(
                `✅ MFP remaining: ${Math.round(remaining.calories)} cal, ` +
                `${remaining.carbs}c / ${remaining.fat}f / ${remaining.protein}p`
            )
        )
        return merged
    } finally {
        await mfp.close()
    }
}

async function pushToMyFitnessPal (
    results: import('./types.js').OptimizationResults
): Promise<void> {
    const selection = await promptSelection(results)
    if (!selection) return

    const combo = results[selection.restaurant][selection.optionIndex]
    const { calories, protein, fat, carbs } = combo.totalNutrition
    const { userDataDir, email, password } = resolveAuth()

    console.log(
        chalk.cyan(
            `\n📤 Pushing ${selection.restaurant} option ${selection.optionIndex + 1} → MFP Dinner…`
        )
    )

    const mfp = await MfpClient.create({ headless: true, userDataDir })
    try {
        await mfp.ensureLoggedIn({ email, password, allowInteractive: true })
        await mfp.quickAddDinner({ calories, protein, fat, carbs })
        console.log(
            chalk.green(
                `✅ MFP: added new Dinner entry — ${Math.round(calories)} cal`
            )
        )
    } finally {
        await mfp.close()
    }
}

main()
    .catch((error) => {
        console.error(chalk.red(`Fatal error: ${error}`))
        process.exit(1)
    })
    .then(() => {
        process.exit(0)
    })
