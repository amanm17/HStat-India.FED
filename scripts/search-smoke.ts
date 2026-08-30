/*
 * Search vocabulary regression test.
 *
 * The alias CSV is meant to be edited by hand, and a careless edit is
 * invisible until someone searches for the wrong thing. This asserts the
 * organising rule still holds:
 *
 *   generic / plural term  -> answers at HS-4 or HS-2
 *   specific product term  -> answers at HS-6
 *
 * Run after any edit to config/hs_aliases.csv or the sector definition:
 *
 *   python pipeline/build_hs_library.py && npx tsx scripts/search-smoke.ts
 */

import { readFileSync } from 'fs'
import { buildIndex, search } from '../src/lib/search'

const CASES: [string, string][] = [
  // category terms must land on the heading, not on a member
  ['batteries', '8507'],
  ['battery', '8507'],
  ['cables', '8544'],
  ['capacitors', '8532'],
  ['computers', '8471'],
  ['printing machinery', '8443'],
  ['air conditioner', '8415'],
  ['electronics', '85'],
  ['machinery', '84'],
  ['instruments', '90'],

  // specific product terms must land on the six-digit line
  ['laptop', '847130'],
  ['desktop', '847150'],
  ['smartphone', '851713'],
  ['router', '851762'],
  ['processor', '854231'],
  ['memory chip', '854232'],
  ['pcb', '853400'],
  ['led', '854141'],
  ['solar cell', '854142'],
  ['solar panel', '854143'],
  ['lithium ion battery', '850760'],
  ['car battery', '850710'],
  ['optical fibre cable', '854470'],
  ['wiring harness', '854430'],
  ['mlcc', '853224'],
  ['window ac', '841510'],
  ['refrigerator', '841810'],
  ['washing machine', '845011'],
  ['printer', '844332'],
  ['television', '852872'],
  ['monitor', '852852'],
  ['multimeter', '903031'],
  ['smartwatch', '910212'],
  ['heat sink', '761699'],
  ['gasket', '401693'],
  ['screw', '731815'],
]

const library = JSON.parse(
  readFileSync(new URL('../public/data/hs-library.json', import.meta.url), 'utf8'),
)

const index = buildIndex(library)

let passed = 0

const failures: string[] = []

for (const [query, expected] of CASES) {
  const outcome = search(index, query)

  const got = outcome.answer?.item.code ?? outcome.results[0]?.item.code ?? '-'

  if (got === expected) {
    passed += 1
  } else {
    failures.push(`  "${query}" -> ${got}, expected ${expected}`)
  }
}

const withAnswer = library.filter(
  (item: { answerTerms: string[] }) => item.answerTerms.length,
).length

console.log(`search-smoke: ${passed}/${CASES.length} queries answer as intended`)
console.log(`              ${withAnswer}/${library.length} codes carry an answer term`)

if (failures.length) {
  console.error('\nFailures:')
  failures.forEach(line => console.error(line))
  process.exit(1)
}
