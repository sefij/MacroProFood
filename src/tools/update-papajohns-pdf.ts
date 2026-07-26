/**
 * Checks for, and optionally swaps in, a fresh copy of the Papa John's
 * nutrition PDF.
 *
 * Papa John's own site sits behind Akamai — but the block turned out **not**
 * to be the IP-based geofence it looked like. `axios` (Node's legacy `http`
 * module under the hood) and `curl` both reliably get `403 Access Denied`
 * here, from every environment tried; Node's native `fetch()` (built on
 * `undici`, a different TLS implementation) reliably gets `200` on the exact
 * same URL, from the exact same network path, with no special headers or
 * cookies needed. That points at TLS/HTTP-client fingerprinting rather than
 * IP or geography — so this uses `fetch()`, not `axios`, deliberately. It
 * could still stop working if Akamai's fingerprint list changes; if it does,
 * the fallback is the same as always: download the PDF by hand in a real
 * browser and pass the saved file's path instead.
 *
 * Either way, the goal is making "is there actually a new one, and if so use
 * it" a single command instead of a multi-file hand-edit — worth having
 * because a stale copy (OCT22-1 vs the current JUNE26-1) shipped silently
 * wrong macros for a while before a user caught one value by hand.
 *
 * Usage:
 *   yarn papajohns:check                    - try the official URL, report only
 *   yarn papajohns:check <path-or-url>       - report only, no replace
 *   yarn papajohns:update                    - try the official URL, replace if newer
 *   yarn papajohns:update <path-or-url>      - replace if newer
 */
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as os from 'os'
import chalk from 'chalk'
import { extractPdfLines } from '../scrapers/pdf/pdf-lines'
import { PDF_PATH, findVersionStamp } from '../scrapers/PapaJohns/scraper'

const README_PATH = path.resolve(process.cwd(), 'src', 'scrapers', 'PapaJohns', 'README.md')
const OFFICIAL_URL = 'https://www.papajohns.co.uk/static/assets/pdfs/nutritional-information.pdf'

const REQUEST_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    Accept: 'application/pdf,*/*'
}

interface PdfInfo {
    sha256: string
    size: number
    pages: number
    version: string
}

async function describePdf (buf: Buffer): Promise<PdfInfo> {
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex')
    const lines = await extractPdfLines(new Uint8Array(buf))
    const pages = lines.reduce((m, l) => Math.max(m, l.page), 0)
    const version = findVersionStamp(lines) ?? 'unknown'
    return { sha256, size: buf.length, pages, version }
}

/** Fetches a URL, or reads a local path — either way, returns the raw bytes. */
async function readCandidate (source: string): Promise<Buffer> {
    if (!/^https?:\/\//.test(source)) {
        if (!fs.existsSync(source)) throw new Error(`No such file: ${source}`)
        return fs.readFileSync(source)
    }
    console.log(chalk.blue(`Fetching ${source} …`))
    let response: Response
    try {
        response = await fetch(source, { headers: REQUEST_HEADERS })
    } catch (error) {
        throw new Error(
            `Couldn't reach it at all (network error: ${error instanceof Error ? error.message : error}). ` +
            'Fall back to downloading it by hand in a real browser, then re-run this with the saved file\'s path.'
        )
    }
    if (!response.ok) {
        throw new Error(
            `Couldn't fetch it directly (HTTP ${response.status}) — Akamai's fingerprint check may have ` +
            'changed. Fall back to downloading it by hand in a real browser, then re-run this with the ' +
            'saved file\'s path.'
        )
    }
    return Buffer.from(await response.arrayBuffer())
}

function updateReadmeProvenance (info: PdfInfo): void {
    let text = fs.readFileSync(README_PATH, 'utf8')
    text = text.replace(/sha256\s+[0-9a-f]{64}/, `sha256  ${info.sha256}`)
    text = text.replace(/size {4}[\d,]+ bytes/, `size    ${info.size.toLocaleString('en-US')} bytes`)
    text = text.replace(/pages {3}\d+ \(menu items start on page 7\)/, `pages   ${info.pages} (menu items start on page 7)`)
    text = text.replace(/version [A-Z0-9-]+/, `version ${info.version}`)
    fs.writeFileSync(README_PATH, text)
}

async function main (): Promise<void> {
    const args = process.argv.slice(2)
    const checkOnly = args.includes('--check')
    const source = args.find((a) => a !== '--check') ?? OFFICIAL_URL

    console.log(chalk.blue('Reading the committed PDF…'))
    const current = await describePdf(fs.readFileSync(PDF_PATH))

    const candidateBuf = await readCandidate(source)
    const candidate = await describePdf(candidateBuf)

    console.log()
    console.log(`  committed   version ${current.version.padEnd(12)} pages ${String(current.pages).padEnd(4)} sha256 ${current.sha256}`)
    console.log(`  candidate   version ${candidate.version.padEnd(12)} pages ${String(candidate.pages).padEnd(4)} sha256 ${candidate.sha256}`)
    console.log()

    if (current.sha256 === candidate.sha256) {
        console.log(chalk.green('Up to date — byte-identical to the committed copy.'))
        return
    }

    if (current.version === candidate.version) {
        console.log(chalk.yellow(
            `⚠ Same version stamp (${current.version}) but different file contents. That's not the normal ` +
            'shape of a real Papa John\'s update (they bump the stamp), so this might be a re-export or a ' +
            'corrupted download rather than genuinely newer data. Not replacing automatically.'
        ))
        process.exit(1)
    }

    console.log(chalk.cyan(`An update is available: ${current.version} → ${candidate.version}`))

    if (checkOnly) {
        // Keep the fetched bytes around so a plain `--check` still saves the
        // trip of re-downloading once you decide to actually update.
        const savedTo = path.join(os.tmpdir(), `papajohns-${candidate.version}.pdf`)
        fs.writeFileSync(savedTo, candidateBuf)
        console.log(`Saved to ${savedTo} — run \`yarn papajohns:update ${savedTo}\` to apply it.`)
        return
    }

    fs.writeFileSync(PDF_PATH, candidateBuf)
    updateReadmeProvenance(candidate)

    console.log(chalk.green(`✓ Replaced nutritional-information.pdf (${current.version} → ${candidate.version})`))
    console.log(chalk.green('✓ Updated the provenance block in src/scrapers/PapaJohns/README.md'))
    console.log()
    console.log('Next: run `yarn build:data` to regenerate web data, check the scraper\'s own console output')
    console.log('(product/variant counts, any newly rejected rows), run the test suite, and review the diff')
    console.log('before committing — a version bump can shift page numbers and reformulate recipes.')
}

main().catch((err) => {
    console.error(chalk.red(err instanceof Error ? err.message : err))
    process.exit(1)
})
