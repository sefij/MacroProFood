/**
 * Parses the first number out of a scraped value like `"30g"`, `"1,408"`,
 * `"5.08g"`, or a raw `number`. Commas are treated as thousands separators and
 * stripped; unit suffixes are ignored. Returns `NaN` when no number is present.
 *
 * Note: this uses UK/US number conventions (comma = thousands). Feeds that use
 * a decimal comma (e.g. `"1,5"` meaning 1.5) must not use this helper.
 */
export function parseNumber (value: string | number | undefined): number {
    if (typeof value === 'number') return value
    if (typeof value !== 'string') return NaN
    const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
    return match ? parseFloat(match[0]) : NaN
}
