import chalk from 'chalk'
import {
    OptimizationResults,
    RestaurantsData,
    TargetMacros
} from './types'
import { avgAccuracyOf, findBestCombinations } from './core/optimizer'

/**
 * CLI-facing wrapper around the pure optimizer in {@link ./core/optimizer}.
 * The optimization itself is dependency-free (so it can be shared with the web
 * app); this class only adds the terminal rendering in `displayResults`.
 */
export class MacroOptimizer {
    constructor (private restaurantsData: RestaurantsData) {}

    findBestCombinations (
        targets: TargetMacros,
        maxItems: number = 5,
        optionsPerRestaurant: number = 3
    ): OptimizationResults {
        return findBestCombinations(
            this.restaurantsData,
            targets,
            maxItems,
            optionsPerRestaurant
        )
    }

    displayResults (results: OptimizationResults, targets: TargetMacros): void {
        console.log(chalk.cyan('\n' + '='.repeat(80)))
        console.log(chalk.cyan.bold('🎯 TARGET MACROS:'))
        console.log(
            chalk.white(
                `Calories: ${targets.calories} | Protein: ${targets.protein}g | Fat: ${targets.fat}g | Carbs: ${targets.carbs}g`
            )
        )
        console.log(chalk.cyan('='.repeat(80)))

        if (Object.keys(results).length === 0) {
            console.log(chalk.red('❌ No suitable combinations found!'))
            console.log(
                chalk.yellow(
                    '💡 Try adjusting your macro targets or increasing max items per restaurant.'
                )
            )
            return
        }

        // Sort restaurants by their best (first) option's accuracy.
        const sortedResults = Object.entries(results).sort(
            ([, a], [, b]) => avgAccuracyOf(a[0]) - avgAccuracyOf(b[0])
        )

        const formatAccuracy = (value: number) => {
            const percent = (value * 100).toFixed(1)
            const color =
                value < 0.1
                    ? chalk.green
                    : value < 0.2
                        ? chalk.yellow
                        : chalk.red
            return color(`±${percent}%`)
        }

        for (const [restaurant, combos] of sortedResults) {
            const bestAvg = avgAccuracyOf(combos[0])
            const bestPercent = ((1 - bestAvg) * 100).toFixed(1)

            console.log(
                chalk.green(
                    `\n🍽️  ${restaurant.toUpperCase()} (best: ${bestPercent}% accurate, ${combos.length} option${combos.length === 1 ? '' : 's'})`
                )
            )
            console.log(chalk.gray('='.repeat(60)))

            combos.forEach((combo, idx) => {
                const avgAccuracy = avgAccuracyOf(combo)
                const accuracyPercent = ((1 - avgAccuracy) * 100).toFixed(1)
                const overallColor =
                    avgAccuracy < 0.1
                        ? chalk.green
                        : avgAccuracy < 0.2
                            ? chalk.yellow
                            : chalk.red

                console.log(
                    chalk.cyan.bold(
                        `\n  Option ${idx + 1} — ${overallColor(
                            accuracyPercent + '%'
                        )}`
                    )
                )
                console.log(chalk.gray('  ' + '-'.repeat(58)))

                for (const item of combo.items) {
                    console.log(chalk.white(`  • ${item.name}`))
                    console.log(
                        chalk.gray(
                            `    📊 ${item.calories.toFixed(
                                0
                            )} cal | ${item.protein.toFixed(
                                1
                            )}g protein | ${item.fat.toFixed(
                                1
                            )}g fat | ${item.carbs.toFixed(1)}g carbs`
                        )
                    )
                }

                const { totalNutrition, accuracy } = combo
                console.log(chalk.yellow('\n  📈 TOTAL:'))
                console.log(
                    `  ${chalk.white('Calories:')} ${totalNutrition.calories.toFixed(
                        0
                    )} ${formatAccuracy(accuracy.calories)}`
                )
                console.log(
                    `  ${chalk.white('Protein:')} ${totalNutrition.protein.toFixed(
                        1
                    )}g ${formatAccuracy(accuracy.protein)}`
                )
                console.log(
                    `  ${chalk.white('Fat:')} ${totalNutrition.fat.toFixed(
                        1
                    )}g ${formatAccuracy(accuracy.fat)}`
                )
                console.log(
                    `  ${chalk.white('Carbs:')} ${totalNutrition.carbs.toFixed(
                        1
                    )}g ${formatAccuracy(accuracy.carbs)}`
                )
            })
        }

        console.log(chalk.cyan('\n' + '='.repeat(80)))
    }
}
