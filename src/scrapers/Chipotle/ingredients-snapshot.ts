/**
 * Hand-transcribed copy of Chipotle UK's ingredient nutrition table, used only
 * when the live PDF has no extractable text.
 *
 * The UK270726 edition (27 July 2026) was published as a flattened one-page
 * poster with its text converted to vector outlines, so `extractPdfLines`
 * returns nothing. Values below were read off a rendering of that PDF (per
 * serving: kcal, total fat, carbohydrates, protein) and cross-checked against
 * the PDF's per-100g block (per-100g x serving weight = per-serving figure).
 *
 * Scope matches `ingredients.ts`: food rows only, drinks are not needed.
 * `fetchIngredients` prefers the live parse whenever it yields rows, so this
 * goes unused as soon as Chipotle publishes a text-based PDF again.
 */

import type { IngredientNutrition } from './ingredients'

/** The PDF filename this snapshot was transcribed from. */
export const SNAPSHOT_SOURCE = 'Allergen-UK270726.pdf'

function row (portion: string, calories: number, fat: number, carbs: number, protein: number): IngredientNutrition {
    return { portion, calories, fat, carbs, protein }
}

export const INGREDIENT_SNAPSHOT: Record<string, IngredientNutrition> = {
    'Flour Tortilla (Burrito)': row('1 Ea (95 g)', 297, 8.8, 49.2, 7.9),
    'Flour Tortilla (Taco)': row('3 Ea (75 g)', 240, 7.5, 39.0, 6.0),
    'Hard Shell Taco (Crispy Corn Taco)': row('3 Ea (48 g)', 177, 9.2, 23.0, 2.0),
    'Coriander-Lime White Rice': row('113 g', 185, 2.0, 41.5, 4.1),
    'Coriander-Lime Brown Rice': row('113 g', 185, 1.7, 32.8, 3.8),
    'Black Beans': row('113 g', 95, 2.4, 4.9, 7.2),
    'Pinto Beans': row('113 g', 95, 0.6, 6.2, 6.7),
    'Fajita Vegetables': row('57 g', 21, 1.1, 2.1, 0.4),
    'Barbacoa': row('113 g', 154, 3.8, 1.0, 29.7),
    'Chicken': row('113 g', 185, 8.4, 1.0, 27.3),
    'Carnitas': row('113 g', 210, 11.9, 1.0, 25.8),
    'Steak': row('113 g', 165, 5.5, 1.0, 28.8),
    'Sofritas (braised tofu)': row('113 g', 84, 4.6, 3.0, 7.0),
    'Fresh Tomato Salsa': row('113 g', 15, 0.5, 1.1, 0.8),
    'Chilli-Corn Salsa': row('113 g', 38, 0.8, 5.9, 1.3),
    'Roasted Tomato Green-Chilli Salsa': row('59 g', 6, 0.1, 1.0, 0.3),
    'Roasted Tomato Red-Chilli Salsa': row('59 g', 9, 0.3, 1.4, 0.3),
    'Monterey Jack Cheese': row('28 g', 94, 7.8, 0.1, 5.8),
    'Sour Cream': row('57 g', 45, 3.9, 1.1, 0.9),
    'Guacamole (topping/side)': row('113 g', 145, 13.5, 2.8, 1.5),
    'Guacamole (large)': row('226 g', 290, 27, 5.6, 3),
    'Romaine Lettuce (salad/topping)': row('85 g', 15, 0, 0, 0),
    'Chips (regular)': row('113 g', 417, 21.6, 54.1, 4.6),
    'Chips (large)': row('170 g', 627, 32.5, 81, 6.9),
    'Chips (Kids)': row('40g', 148, 7.6, 19.2, 1.6),
    'Chipotle Honey Vinaigrette': row('59 ml', 259, 22.9, 13.1, 0.2),
    'Super Greens': row('85 g', 15, 0.3, 2.9, 1.2),
    'Queso Blanco': row('85 g', 99, 8.2, 2.8, 3.5),
    'Chicken Al Pastor (LTO)': row('113 g', 207, 9.7, 7.0, 22.6),
    'Chipotle Honey Chicken (LTO)': row('113 g', 165, 9.3, 4.2, 15.9),
    'Pollo Asado (LTO)': row('113 g', 206, 10.2, 2.9, 25.3)
}
