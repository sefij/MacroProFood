/**
 * Swaps in a freshly hand-downloaded copy of the Papa John's nutrition PDF.
 *
 * Papa John's own site is Akamai-geofenced to the UK — every datacenter IP,
 * including GitHub Actions runners, gets `403 Access Denied` on it (see
 * src/scrapers/PapaJohns/README.md), so the weekly refresh workflow can never
 * fetch this one automatically. The PDF has to be downloaded by hand from a
 * UK connection and committed; this script makes that manual step a single
 * command instead of a multi-file hand-edit — it verifies the new copy is
 * actually different (and reports it clearly if it isn't), replaces the
 * committed file, and keeps the README's provenance block in sync so it
 * can't quietly go stale the way it did before (a ~4-year-old copy shipped
 * silently wrong macros until a user cross-checked one value by hand).
 *
 * Usage: `yarn papajohns:update <path-to-downloaded-pdf>`
 */
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import chalk from 'chalk'
import { extractPdfLines } from '../scrapers/pdf/pdf-lines'
import { PDF_PATH, findVersionStamp } from '../scrapers/PapaJohns/scraper'

const README_PATH = path.resolve(process.cwd(), 'src', 'scrapers', 'PapaJohns', 'README.md')

interface PdfInfo {
    sha256: string
    size: number
    pages: number
    version: string
}

async function describePdf (filePath: string): Promise<PdfInfo> {
    const buf = fs.readFileSync(filePath)
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex')
    const lines = await extractPdfLines(new Uint8Array(buf))
    const pages = lines.reduce((m, l) => Math.max(m, l.page), 0)
    const version = findVersionStamp(lines) ?? 'unknown'
    return { sha256, size: buf.length, pages, version }
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
    const src = process.argv[2]
    if (!src) {
        console.error('Usage: yarn papajohns:update <path-to-downloaded-pdf>')
        process.exit(1)
    }
    if (!fs.existsSync(src)) {
        console.error(chalk.red(`No such file: ${src}`))
        process.exit(1)
    }

    console.log(chalk.blue('Reading the committed PDF and the candidate…'))
    const current = await describePdf(PDF_PATH)
    const candidate = await describePdf(src)

    console.log()
    console.log(`  committed   version ${current.version.padEnd(12)} pages ${String(current.pages).padEnd(4)} sha256 ${current.sha256}`)
    console.log(`  candidate   version ${candidate.version.padEnd(12)} pages ${String(candidate.pages).padEnd(4)} sha256 ${candidate.sha256}`)
    console.log()

    if (current.sha256 === candidate.sha256) {
        console.log(chalk.green('No change — byte-identical to the committed copy. Nothing to do.'))
        return
    }

    if (current.version === candidate.version) {
        console.log(chalk.yellow(
            `⚠ Same version stamp (${current.version}) but different file contents. That's not the normal ` +
            'shape of a real Papa John\'s update (they bump the stamp), so this might be a re-export or a ' +
            'corrupted download rather than genuinely newer data. Not replacing automatically — check the ' +
            'file and re-run if you\'re confident it should replace the committed copy.'
        ))
        process.exit(1)
    }

    fs.copyFileSync(src, PDF_PATH)
    updateReadmeProvenance(candidate)

    console.log(chalk.green(`✓ Replaced nutritional-information.pdf (${current.version} → ${candidate.version})`))
    console.log(chalk.green('✓ Updated the provenance block in src/scrapers/PapaJohns/README.md'))
    console.log()
    console.log('Next: run `yarn build:data` to regenerate web data, check the scraper\'s own console output')
    console.log('(product/variant counts, any newly rejected rows), run the test suite, and review the diff')
    console.log('before committing — a version bump can shift page numbers and reformulate recipes.')
}

main().catch((err) => {
    console.error(chalk.red(err))
    process.exit(1)
})
