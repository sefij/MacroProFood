import { useMemo, useState } from 'react'
import type { DietaryRestriction } from '../../../src/core/item-filters'
import type { RestaurantCategoryFilter } from '../../../src/core/category-filter'
import { CATEGORY_PRESETS, matchingCategories, isPresetActive, type CategoryPreset } from '../../../src/core/category-presets'
import { CategoryFilters, type RestaurantCategoryGroup } from './CategoryFilters'

const RESTRICTION_LABEL: Record<DietaryRestriction, string> = {
    none: 'No restriction',
    vegetarian: 'Vegetarian',
    vegan: 'Vegan'
}

// How many matching dish names to list individually before collapsing the
// rest into a "+N more" count — enough to be useful, not enough to dwarf
// the rest of the card for a broad term like "chicken".
const MAX_SUGGESTIONS = 8

interface Props {
    /**
     * Whether to show the dietary-restriction toggle at all. Only McDonald's
     * has real vegetarian/vegan data (see `core/item-filters.ts`'s docblock),
     * so this is currently off — App.tsx also pins `restriction` to `'none'`
     * whenever this is false, so a stale `'vegetarian'`/`'vegan'` value left
     * over from before it was disabled can't silently keep filtering with no
     * way to undo it.
     */
    dietaryEnabled: boolean
    restriction: DietaryRestriction
    onRestrictionChange: (restriction: DietaryRestriction) => void
    excludedDishes: string[]
    onExcludedDishesChange: (dishes: string[]) => void
    /** Restaurant display names with any confirmed dietary data — derived live from the loaded snapshots, never hard-coded. */
    restaurantsWithData: Set<string>
    /** Every distinct item name across every loaded restaurant, for live match feedback as the user types. */
    allDishNames: string[]
    /**
     * Category-level filters (Quick filters + Categories) only mean anything
     * in Optimize mode — Menu Mode's `MenuBuilder` never applies
     * `categoryFilters` (see `data.ts`), so showing them there would offer a
     * control with no effect. Mirrors `MacroInput`'s `showOptimizerConfig`.
     */
    showCategoryFilters: boolean
    categoryGroups: RestaurantCategoryGroup[]
    categoryFilters: Record<string, RestaurantCategoryFilter>
    onCategoryModeChange: (restaurant: string, mode: RestaurantCategoryFilter['mode']) => void
    onToggleCategory: (restaurant: string, category: string) => void
    onTogglePreset: (preset: CategoryPreset) => void
}

/**
 * All item-level and category-level filtering in one card: dietary
 * restriction, a personal dish/ingredient exclude-list, one-click category
 * presets ("No sides" etc.), and per-restaurant category include/exclude —
 * previously split across a standalone "Dietary & exclusions" card and a
 * "Quick filters"/"Advanced filters" pair buried inside the restaurant
 * picker, which made "what's currently filtered" hard to see at a glance.
 * `RestaurantPicker` keeps only restaurant selection now; every filter lives
 * here, ending in the collapsible per-restaurant "Categories" section (see
 * `CategoryFilters`). See `core/item-filters.ts` and `core/category-presets.ts`
 * for the filtering logic itself.
 *
 * The exclude-list input is a plain substring match, deliberately not
 * restricted to picking a menu item verbatim — a broad ingredient-level
 * term ("mushroom") is a legitimate, useful exclusion just as much as one
 * specific dish. What was missing was any feedback on what a term actually
 * catches before committing to it; the match preview below the input uses
 * the exact same case-insensitive substring test `filterSnapshotItems`
 * itself applies, so what's shown here is exactly what gets excluded, not
 * a separate heuristic that could drift from the real filter.
 */
export function Filters ({
    dietaryEnabled,
    restriction,
    onRestrictionChange,
    excludedDishes,
    onExcludedDishesChange,
    restaurantsWithData,
    allDishNames,
    showCategoryFilters,
    categoryGroups,
    categoryFilters,
    onCategoryModeChange,
    onToggleCategory,
    onTogglePreset
}: Props) {
    const [draft, setDraft] = useState('')

    const matches = useMemo(() => {
        const term = draft.trim().toLowerCase()
        if (!term) return []
        return allDishNames.filter((name) => name.toLowerCase().includes(term))
    }, [draft, allDishNames])

    // Only offer a preset if it actually matches something in the currently
    // active restaurants — a "No drinks" chip that does nothing (e.g. every
    // active restaurant is Chipotle/Five Guys, neither of which has a drinks
    // category at all) is just confusing.
    const relevantPresets = CATEGORY_PRESETS.filter((preset) =>
        categoryGroups.some((group) => matchingCategories(group.categories, preset).length > 0)
    )

    const addTerm = (term: string) => {
        const trimmed = term.trim()
        if (!trimmed) return
        if (!excludedDishes.some((d) => d.toLowerCase() === trimmed.toLowerCase())) {
            onExcludedDishesChange([...excludedDishes, trimmed])
        }
        setDraft('')
    }

    const removeTerm = (term: string) => {
        onExcludedDishesChange(excludedDishes.filter((d) => d !== term))
    }

    return (
        <section className="card">
            <h2>Filters</h2>

            {dietaryEnabled && (
                <>
                    <div className="preset-label">Dietary restriction</div>
                    <div className="mode-select">
                        {(Object.keys(RESTRICTION_LABEL) as DietaryRestriction[]).map((r) => (
                            <button
                                key={r}
                                type="button"
                                className={`mode-btn${restriction === r ? ' active' : ''}`}
                                onClick={() => onRestrictionChange(r)}
                            >
                                {RESTRICTION_LABEL[r]}
                            </button>
                        ))}
                    </div>
                    {restriction !== 'none' && (
                        <p className="small muted">
                            {restaurantsWithData.size > 0
                                ? `Verified for ${Array.from(restaurantsWithData).sort().join(', ')} — other restaurants are hidden while a restriction is active.`
                                : 'No restaurant has published dietary data yet — every restaurant is hidden while a restriction is active.'}
                        </p>
                    )}
                </>
            )}

            <div className={dietaryEnabled ? 'preset-section' : undefined}>
                <div className="preset-label">Exclude a dish or ingredient</div>
                <div className="exclude-input">
                    <input
                        type="text"
                        placeholder="Exclude a dish or ingredient…"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault()
                                addTerm(draft)
                            }
                        }}
                    />
                    <button type="button" className="btn btn-ghost" onClick={() => addTerm(draft)} disabled={!draft.trim()}>
                        Add
                    </button>
                </div>

                {draft.trim() && (
                    <div className="exclude-preview">
                        {matches.length === 0 ? (
                            <p className="small muted">
                                No current menu item matches "{draft.trim()}" — you can still add it as a general term.
                            </p>
                        ) : (
                            <>
                                <p className="small muted">
                                    Matches {matches.length} item{matches.length === 1 ? '' : 's'} right now
                                    {matches.length > MAX_SUGGESTIONS ? ' — pick one, or add the term as-is for all of them:' : ':'}
                                </p>
                                <div className="chips">
                                    {matches.slice(0, MAX_SUGGESTIONS).map((name) => (
                                        <button
                                            key={name}
                                            type="button"
                                            className="filter-chip"
                                            onClick={() => addTerm(name)}
                                            title={`Exclude only "${name}"`}
                                        >
                                            {name}
                                        </button>
                                    ))}
                                    {matches.length > MAX_SUGGESTIONS && (
                                        <span className="small muted">+{matches.length - MAX_SUGGESTIONS} more</span>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}

                {excludedDishes.length > 0 && (
                    <div className="chips">
                        {excludedDishes.map((term) => (
                            <button
                                key={term}
                                type="button"
                                className="filter-chip selected"
                                onClick={() => removeTerm(term)}
                                title={`Remove "${term}"`}
                            >
                                {term} <span aria-hidden="true">×</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {showCategoryFilters && relevantPresets.length > 0 && (
                <div className="preset-section">
                    <div className="preset-label">Quick filters</div>
                    <div className="preset-row">
                        {relevantPresets.map((preset) => {
                            const active = isPresetActive(categoryGroups, categoryFilters, preset)
                            return (
                                <button
                                    key={preset.key}
                                    type="button"
                                    aria-pressed={active}
                                    className={`preset-chip${active ? ' selected' : ''}`}
                                    onClick={() => onTogglePreset(preset)}
                                >
                                    {preset.label}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}

            {showCategoryFilters && (
                <CategoryFilters
                    groups={categoryGroups}
                    filters={categoryFilters}
                    onModeChange={onCategoryModeChange}
                    onToggleCategory={onToggleCategory}
                />
            )}
        </section>
    )
}
