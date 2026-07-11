/**
 * Reads "remaining macros" out of a MyFitnessPal screenshot, entirely on the
 * user's device (Tesseract.js runs in-browser — the image never leaves it).
 *
 * Three layouts are supported, all producing the same {calories, protein,
 * carbs, fat} remaining values:
 *
 *  1. MFP web diary — a table whose "Remaining" row holds the numbers, in the
 *     column order given by the header (Calories, Carbs, Fat, Protein, …).
 *  2. iOS app "used / total" card — each line reads `used / total`; remaining
 *     is `total − used`.
 *  3. iOS app "left" card — each line already reads the remaining value
 *     (`76 g left`), taken as-is.
 *
 * OCR is fuzzy, so callers should treat the result as a best-effort prefill the
 * user confirms in the editable grid — hence the `warnings` list.
 */
import type { TargetMacros } from './macro'

export interface ScreenshotResult {
    /** Whatever we could read; keys we couldn't are left absent. */
    macros: Partial<TargetMacros>
    /** Raw OCR text, handy for debugging / a "show details" affordance. */
    raw: string
    /** Human-readable notes about what couldn't be read. */
    warnings: string[]
}

/** Macro columns as MyFitnessPal orders them, used as the web-table fallback. */
const COLUMN_KEYS = ['calories', 'carbs', 'fat', 'protein', 'sodium', 'sugar'] as const
type ColumnKey = (typeof COLUMN_KEYS)[number]

/** The four macros we actually feed the optimizer. */
const TARGET_KEYS: (keyof TargetMacros)[] = ['calories', 'protein', 'carbs', 'fat']

/** The word we match to locate a macro's line (calories/calorie both count). */
const KEYWORD: Record<ColumnKey, string> = {
    calories: 'calorie',
    carbs: 'carb',
    fat: 'fat',
    protein: 'protein',
    sodium: 'sodium',
    sugar: 'sugar'
}

/** Pull every integer-ish number from a string, dropping thousands commas. */
function numbersIn (s: string): number[] {
    const matches = s.match(/\d[\d,]*(?:\.\d+)?/g)
    if (!matches) return []
    return matches
        .map((m) => Math.round(parseFloat(m.replace(/,/g, ''))))
        .filter((n) => Number.isFinite(n))
}

/**
 * Reads a single macro value from one OCR line, in priority order:
 *   - `<n> / <m>`      → total − used (iOS "used/total")
 *   - `<n> … left`     → n            (iOS "left")
 *   - two numbers      → |b − a|      (used/total whose "/" OCR dropped)
 *   - one number       → n            (already a remaining value)
 */
function valueFromLine (line: string): number | null {
    const slash = line.match(/(\d[\d,]*)\s*(?:g|cal|kcal|mg)?\s*\/\s*(\d[\d,]*)/)
    if (slash) {
        const used = parseInt(slash[1].replace(/,/g, ''), 10)
        const total = parseInt(slash[2].replace(/,/g, ''), 10)
        return Math.max(total - used, 0)
    }
    const left = line.match(/(\d[\d,]*)\s*(?:g|cal|kcal|mg)?\s*(?:left|remaining)/)
    if (left) return parseInt(left[1].replace(/,/g, ''), 10)

    const nums = numbersIn(line)
    if (nums.length >= 2) return Math.abs(nums[1] - nums[0])
    if (nums.length === 1) return nums[0]
    return null
}

/**
 * If a header line naming ≥3 macros is present, return the columns in the order
 * they appear there (robust to MFP reordering); otherwise null.
 */
function detectColumnOrder (lines: string[]): ColumnKey[] | null {
    const header = lines.find(
        (l) => COLUMN_KEYS.filter((k) => l.includes(KEYWORD[k])).length >= 3
    )
    if (!header) return null
    return COLUMN_KEYS.map((k) => ({ k, i: header.indexOf(KEYWORD[k]) }))
        .filter((x) => x.i >= 0)
        .sort((a, b) => a.i - b.i)
        .map((x) => x.k)
}

/** Parses OCR text into remaining macros. Exported for testing. */
export function parseMacros (text: string): ScreenshotResult {
    const warnings: string[] = []
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean)
    const macros: Partial<TargetMacros> = {}

    // --- Layout 1: MFP web table (a "Remaining" row with ≥4 numbers). ---
    const remaining = lines.find(
        (l) => /\bremaining\b/.test(l) && numbersIn(l).length >= 4
    )
    if (remaining) {
        const order = detectColumnOrder(lines) ?? [...COLUMN_KEYS]
        const values = numbersIn(remaining)
        order.forEach((key, i) => {
            if (i < values.length && (TARGET_KEYS as string[]).includes(key)) {
                macros[key as keyof TargetMacros] = values[i]
            }
        })
        for (const key of TARGET_KEYS) {
            if (macros[key] == null) warnings.push(`Couldn't read ${key} — please fill it in.`)
        }
        return { macros, raw: text, warnings }
    }

    // --- Layouts 2 & 3: iOS cards. Labels often sit on their own line *above*
    // the value, and the three macros can be laid out as side-by-side columns
    // (all labels on one row, all values on the next). Handle both. ---

    const intOf = (s: string) => parseInt(s.replace(/,/g, ''), 10)

    /** Reads up to `n` remaining values out of one value row, in column order. */
    const valuesInRow = (line: string, n: number): (number | null)[] => {
        const pairs = [...line.matchAll(/(\d[\d,]*)\s*(?:g|cal|kcal|mg)?\s*\/\s*(\d[\d,]*)/g)]
        if (pairs.length >= n) {
            return pairs.slice(0, n).map((p) => Math.max(intOf(p[2]) - intOf(p[1]), 0))
        }
        const lefts = [...line.matchAll(/(\d[\d,]*)\s*(?:g|cal|kcal|mg)?\s*(?:left|remaining)/g)]
        if (lefts.length >= n) return lefts.slice(0, n).map((m) => intOf(m[1]))
        const nums = numbersIn(line)
        if (nums.length === n) return nums
        if (nums.length === 2 * n) {
            return Array.from({ length: n }, (_, i) => Math.abs(nums[2 * i + 1] - nums[2 * i]))
        }
        return Array.from({ length: n }, (_, i) => nums[i] ?? null)
    }

    /** From a label line, read the value on it or on the next few lines. */
    const valueNear = (startIdx: number): number | null => {
        for (let j = startIdx; j < Math.min(startIdx + 4, lines.length); j++) {
            if (/\d/.test(lines[j])) return valueFromLine(lines[j])
        }
        return null
    }

    // (a) Side-by-side columns: a row naming ≥2 macros, values on a later row.
    const headerIdx = lines.findIndex(
        (l) => TARGET_KEYS.filter((k) => l.includes(KEYWORD[k as ColumnKey])).length >= 2
    )
    if (headerIdx !== -1) {
        const order = TARGET_KEYS.map((k) => ({ k, i: lines[headerIdx].indexOf(KEYWORD[k as ColumnKey]) }))
            .filter((x) => x.i >= 0)
            .sort((a, b) => a.i - b.i)
            .map((x) => x.k)
        const valueLine = lines.slice(headerIdx + 1).find((l) => /\d/.test(l))
        if (valueLine) {
            const values = valuesInRow(valueLine, order.length)
            order.forEach((k, i) => {
                if (values[i] != null) macros[k] = values[i]!
            })
        }
    }

    // (b) Per-label look-ahead for anything still missing (e.g. Calories, which
    // is usually its own card with the value on the line below the label).
    for (const key of TARGET_KEYS) {
        if (macros[key] != null) continue
        const idx = lines.findIndex((l) => l.includes(KEYWORD[key as ColumnKey]))
        const value = idx === -1 ? null : valueNear(idx)
        if (value == null) warnings.push(`Couldn't read ${key} — please fill it in.`)
        else macros[key] = value
    }
    return { macros, raw: text, warnings }
}

/**
 * Prepares an image for OCR on a canvas: upscales small captures, converts to
 * grayscale, and — crucially for the iOS app's dark cards — inverts when the
 * background is dark so Tesseract always sees dark text on a light ground
 * (which it reads far better). Light captures (MFP web) are left un-inverted.
 * Also applies a mild contrast stretch to separate text from the background.
 */
async function preprocess (image: Blob): Promise<HTMLCanvasElement> {
    const bitmap = await createImageBitmap(image)
    // Upscale ~2× so small text — e.g. the tiny "Remaining" table inside a
    // full-page MFP web capture — is big enough for the recognizer, capping the
    // long edge so huge phone screenshots don't blow up memory/time.
    const longEdge = Math.max(bitmap.width, bitmap.height)
    const MAX_EDGE = 3000
    let scale = 2
    if (longEdge * scale > MAX_EDGE) scale = MAX_EDGE / longEdge
    if (scale < 1) scale = 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const px = img.data

    // First pass: grayscale + average luminance to decide whether to invert.
    let sum = 0
    for (let i = 0; i < px.length; i += 4) {
        const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
        px[i] = px[i + 1] = px[i + 2] = g
        sum += g
    }
    const avg = sum / (px.length / 4)
    const invert = avg < 128

    // Second pass: optional invert + contrast stretch around the midpoint.
    const contrast = 1.4
    for (let i = 0; i < px.length; i += 4) {
        let v = invert ? 255 - px[i] : px[i]
        v = (v - 128) * contrast + 128
        v = v < 0 ? 0 : v > 255 ? 255 : v
        px[i] = px[i + 1] = px[i + 2] = v
    }
    ctx.putImageData(img, 0, 0)
    return canvas
}

/**
 * OCRs an image (File/Blob) on-device and returns the parsed remaining macros.
 * Tesseract.js is dynamically imported so it only downloads when this runs.
 */
export async function extractMacrosFromImage (
    image: Blob,
    onProgress?: (pct: number) => void
): Promise<ScreenshotResult> {
    const { default: Tesseract } = await import('tesseract.js')
    const source = await preprocess(image)
    const { data } = await Tesseract.recognize(source, 'eng', {
        logger: (m: { status: string; progress: number }) => {
            if (m.status === 'recognizing text' && onProgress) {
                onProgress(Math.round(m.progress * 100))
            }
        }
    })
    if (import.meta.env.DEV) console.debug('[screenshot OCR]\n' + data.text)
    return parseMacros(data.text)
}
