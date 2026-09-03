import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// The guardrail that keeps the book dimension honest.
//
// `book` defaults to 'actual', so every WRITE in this repo was safe the moment the column
// shipped and stays safe untouched. The danger is entirely on the read side, and it is a
// silent one: a query that forgets the filter returns correct results today — because no tax
// rows exist yet — and starts quietly folding book-to-tax adjusting entries into a trial
// balance, a NAV or an LP's capital account the day they do. Nothing fails. The number is just
// wrong.
//
// A convention nothing enforces is a convention that decays, so this is the same shape as
// design-tokens.test.ts and route-domains.test.ts: find every query, and fail on any that has
// not answered the book question. New code cannot add an unguarded read without either adding
// the filter or arguing its way into the exemption list below.

const ROOTS = ['app', 'lib', 'scripts', 'tests']
const EXT = ['.ts', '.tsx']

/**
 * Reads that want every book and say so with no filter at all.
 *
 * Empty, and likely to stay that way. A read spanning several books declares them with
 * `.in('book', [...])`, which the filter below accepts — the K-1 loader's tax-basis read is the
 * standing example, and it needs no exemption because it states its intent in the query.
 *
 * This list is for the case that cannot: a read that genuinely wants whatever books exist. An
 * entry is `file:line` plus a reason. Prefer naming the books.
 */
const CROSS_BOOK_READS: Record<string, string> = {}

interface Site {
  file: string
  line: number
  table: string
  filtered: boolean
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.git') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXT.some(e => name.endsWith(e))) out.push(p)
  }
  return out
}

const FROM_RE = /\.from\(\s*['"](journal_entries|journal_postings)['"]/
const WRITE_RE = /\.(insert|update|upsert|delete)\(/
// A read must SAY which books it wants: `.eq` for one, `.in` for several. Silence is the failure
// this guards — not breadth. Keying the exemption list by line number instead would have made
// every edit above a query break the test it was meant to protect.
const FILTER_RE = /\.(eq|in)\(\s*['"]book['"]\s*,/

/**
 * Every query against the two journal tables, classified.
 *
 * A site is a READ if a `.select(` appears within a few lines of the `.from(` — the chains in
 * this repo are written both inline and broken across lines, so the window covers both. Writes
 * are skipped: the column's default puts them in the actual book without asking.
 */
function collectSites(): Site[] {
  const sites: Site[] = []
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      if (file.endsWith('books.test.ts')) continue
      const lines = readFileSync(file, 'utf8').split('\n')
      for (let i = 0; i < lines.length; i++) {
        const m = FROM_RE.exec(lines[i])
        if (!m) continue
        const window = lines.slice(i, i + 4).join(' ')
        if (!window.includes('.select(')) {
          // A write, or a builder handed off elsewhere. Writes inherit 'actual' by default.
          if (WRITE_RE.test(window)) continue
        }
        sites.push({ file, line: i + 1, table: m[1], filtered: FILTER_RE.test(window) })
      }
    }
  }
  return sites
}

describe('ledger book filter', () => {
  const sites = collectSites()

  it('finds the journal query sites it is meant to be guarding', () => {
    // A sanity check on the collector itself: if a refactor moves these queries behind a helper
    // and this drops to zero, the suite below would pass vacuously and guard nothing.
    expect(sites.length).toBeGreaterThan(40)
  })

  it('every read of journal_entries / journal_postings filters on book', () => {
    const unguarded = sites
      .filter(s => !s.filtered)
      .filter(s => !(`${s.file}:${s.line}` in CROSS_BOOK_READS))
      .map(s => `${s.file}:${s.line} (${s.table})`)

    expect(
      unguarded,
      'These reads would silently include tax-book adjusting entries. Say which books they ' +
        "want: `.eq('book', ACTUAL_BOOK)` (lib/accounting/books.ts) for the real ledger, or " +
        "`.in('book', [...])` to span several — or, failing both, add it to CROSS_BOOK_READS " +
        'with the reason.',
    ).toEqual([])
  })

  it('has no stale exemptions', () => {
    // An exemption pointing at a line that no longer queries the journal is worse than none: it
    // reads as a decision someone made about code that has since moved.
    const live = new Set(sites.map(s => `${s.file}:${s.line}`))
    const stale = Object.keys(CROSS_BOOK_READS).filter(k => !live.has(k))
    expect(stale, 'CROSS_BOOK_READS entries no longer pointing at a journal query').toEqual([])
  })
})
