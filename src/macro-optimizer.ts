import chalk from 'chalk'
import {
    MenuItem,
    NutritionData,
    OptimizationResult,
    OptimizationResults,
    RestaurantsData,
    TargetMacros
} from './types'

export class MacroOptimizer {
    private allItems: MenuItem[] = []

    constructor (private restaurantsData: RestaurantsData) {
        this.setupItems()
    }

    private setupItems (): void {
        for (const [restaurant, items] of Object.entries(
            this.restaurantsData
        )) {
            if (!items) continue
            for (const [itemName, nutrition] of Object.entries(items)) {
                this.allItems.push({
                    restaurant,
                    name: itemName,
                    calories: nutrition.calories,
                    protein: nutrition.protein,
                    fat: nutrition.fat,
                    carbs: nutrition.carbs
                })
            }
        }
    }

    findBestCombinations (
        targets: TargetMacros,
        maxItems: number = 5,
        optionsPerRestaurant: number = 3
    ): OptimizationResults {
        const results: OptimizationResults = {}

        // Find top-N combinations for each restaurant
        Object.keys(this.restaurantsData).map((restaurant) => {
            const restaurantItems = this.allItems.filter(
                (item) => item.restaurant === restaurant
            )
            if (restaurantItems.length === 0) return null
            const combos = this.optimizeRestaurant(
                restaurantItems,
                targets,
                maxItems,
                optionsPerRestaurant
            )
            if (combos.length > 0) {
                results[restaurant] = combos
            }
        })

        return results
    }

    private optimizeRestaurant (
        items: MenuItem[],
        targets: TargetMacros,
        maxItems: number,
        topN: number
    ): OptimizationResult[] {
        // Helper to check if nutrition exceeds any target
        function exceeds (
            nutrition: Omit<
                NutritionData,
                'ProteinTCalRatio' | 'CarbToCalRatio'
            >,
            targets: TargetMacros
        ): boolean {
            return (
                nutrition.calories > targets.calories ||
                nutrition.protein > targets.protein ||
                nutrition.fat > targets.fat ||
                nutrition.carbs > targets.carbs
            )
        }

        // Helper to sum nutrition
        function sumNutrition (
            combo: MenuItem[]
        ): Omit<NutritionData, 'ProteinTCalRatio' | 'CarbToCalRatio'> {
            return combo.reduce(
                (sum, item) => ({
                    calories: sum.calories + item.calories,
                    protein: sum.protein + item.protein,
                    fat: sum.fat + item.fat,
                    carbs: sum.carbs + item.carbs
                }),
                { calories: 0, protein: 0, fat: 0, carbs: 0 }
            )
        }

        // Helper to score a combination (higher is better, but must not overflow)
        function score (
            nutrition: Omit<
                NutritionData,
                'ProteinTCalRatio' | 'CarbToCalRatio'
            >,
            targets: TargetMacros
        ): number {
            // Score is the sum of ratios (how much of each macro is covered, capped at 1)
            return (
                Math.min(
                    nutrition.calories / Math.max(targets.calories, 1),
                    1
                ) +
                Math.min(nutrition.protein / Math.max(targets.protein, 1), 1) +
                Math.min(nutrition.fat / Math.max(targets.fat, 1), 1) +
                Math.min(nutrition.carbs / Math.max(targets.carbs, 1), 1)
            )
        }

        // Top-N tracking, sorted by (score desc, length asc).
        type Entry = { items: MenuItem[]; score: number; len: number }
        const topK: Entry[] = []
        const isBetter = (s: number, len: number, e: Entry) =>
            s > e.score || (s === e.score && len < e.len)
        const recordCombo = (s: number) => {
            const len = combo.length
            if (len === 0) return
            if (
                topK.length === topN &&
                !isBetter(s, len, topK[topN - 1])
            ) {
                return
            }
            const snapshot: Entry = { items: combo.slice(), score: s, len }
            let pos = topK.length
            for (let j = 0; j < topK.length; j++) {
                if (isBetter(s, len, topK[j])) {
                    pos = j
                    break
                }
            }
            topK.splice(pos, 0, snapshot)
            if (topK.length > topN) topK.pop()
        }
        const thresholdScore = () =>
            topK.length < topN ? -1 : topK[topN - 1].score

        // Hoisted: filter+sort depend only on `items` and `targets`, both invariant
        // across the recursion. Compute once.
        // Sort by ProteinToCalRatio desc when protein is the highest target, by
        // CarbToCalRatio desc when carbs is the highest target.
        const proteinTargetHighest =
            targets.protein >= targets.carbs &&
            targets.protein >= targets.fat
        const carbsTargetHighest =
            targets.carbs >= targets.protein &&
            targets.carbs >= targets.fat
        const sortedItems = items
            .filter(
                (item) =>
                    item.protein >= 1 &&
                    item.carbs >= 1 &&
                    item.calories <= targets.calories * 1.3 &&
                    item.protein <= targets.protein * 1.3 &&
                    item.fat <= targets.fat * 1.3 &&
                    item.carbs <= targets.carbs * 1.3
            )
            .sort((a, b) => {
                if (proteinTargetHighest) {
                    return (
                        b.protein / Math.max(b.calories, 1) -
                        a.protein / Math.max(a.calories, 1)
                    )
                } else if (carbsTargetHighest) {
                    return (
                        b.carbs / Math.max(b.calories, 1) -
                        a.carbs / Math.max(a.calories, 1)
                    )
                } else {
                    return 0
                }
            })

        if (sortedItems.length === 0) return []

        // Per-macro maxima for the admissible upper-bound prune
        let maxProtein = 0
        let maxFat = 0
        let maxCarbs = 0
        let maxCalories = 0
        for (const it of sortedItems) {
            if (it.protein > maxProtein) maxProtein = it.protein
            if (it.fat > maxFat) maxFat = it.fat
            if (it.carbs > maxCarbs) maxCarbs = it.carbs
            if (it.calories > maxCalories) maxCalories = it.calories
        }

        const tCal = Math.max(targets.calories, 1)
        const tProt = Math.max(targets.protein, 1)
        const tFat = Math.max(targets.fat, 1)
        const tCarbs = Math.max(targets.carbs, 1)

        // Single combo + nutrition state, mutated/restored across recursion
        const combo: MenuItem[] = []
        const cur = { calories: 0, protein: 0, fat: 0, carbs: 0 }

        // Unbounded knapsack: items may repeat, but `startIndex` prevents
        // revisiting the same multiset via different orderings.
        function search (startIndex: number) {
            if (exceeds(cur, targets)) return

            recordCombo(score(cur, targets))

            if (combo.length === maxItems) return

            // Admissible upper-bound prune: max additional score reachable in
            // the remaining slots, assuming each could be the macro-maximizing
            // item. Strict `<` keeps the length tiebreak path open on equality.
            const slotsLeft = maxItems - combo.length
            const upper =
                Math.min(1, (cur.calories + slotsLeft * maxCalories) / tCal) +
                Math.min(1, (cur.protein + slotsLeft * maxProtein) / tProt) +
                Math.min(1, (cur.fat + slotsLeft * maxFat) / tFat) +
                Math.min(1, (cur.carbs + slotsLeft * maxCarbs) / tCarbs)
            if (upper < thresholdScore()) return

            for (let i = startIndex; i < sortedItems.length; i++) {
                const it = sortedItems[i]
                combo.push(it)
                cur.calories += it.calories
                cur.protein += it.protein
                cur.fat += it.fat
                cur.carbs += it.carbs
                search(i)
                cur.calories -= it.calories
                cur.protein -= it.protein
                cur.fat -= it.fat
                cur.carbs -= it.carbs
                combo.pop()
            }
        }

        search(0)

        return topK.map((entry) => {
            const totalNutrition = sumNutrition(entry.items)
            return {
                items: entry.items,
                totalNutrition,
                accuracy: {
                    calories:
                        Math.abs(totalNutrition.calories - targets.calories) /
                        tCal,
                    protein:
                        Math.abs(totalNutrition.protein - targets.protein) /
                        tProt,
                    fat:
                        Math.abs(totalNutrition.fat - targets.fat) / tFat,
                    carbs:
                        Math.abs(totalNutrition.carbs - targets.carbs) / tCarbs
                }
            }
        })
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

        const avgAccuracyOf = (combo: OptimizationResult) =>
            (combo.accuracy.calories +
                combo.accuracy.protein +
                combo.accuracy.fat +
                combo.accuracy.carbs) /
            4

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
