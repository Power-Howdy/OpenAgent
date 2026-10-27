import assert from 'node:assert/strict'
import test from 'node:test'
import { rankItems, scoreText, selectMatch, tokens, topK } from '../src/services/match.js'
import {
  canAuthorBlueprint,
  independentWorkstreams,
} from '../src/services/blueprintStore.js'

const skills = [
  { name: 'pdf-tables', description: 'extract tables and figures from pdf documents' },
  { name: 'rust-crate', description: 'create a rust cargo library crate' },
  { name: 'pdf-charts', description: 'extract tables and figures from pdf documents' },
]

test('ranking ignores stopwords and empty queries', () => {
  assert.deepEqual(tokens('to a be'), [])
  assert.equal(scoreText('to', 'a long document'), 0)
  assert.equal(selectMatch('tables', [], item => String(item)), null)
  assert.equal(
    selectMatch('pdf tables', [skills[0]!], item => `${item.name} ${item.description}`)?.name,
    'pdf-tables',
  )
  const ranked = rankItems(
    'pdf tables',
    skills,
    item => `${item.name} ${item.description}`,
  )
  assert.ok(ranked[0]!.score >= ranked[1]!.score)
  assert.equal(
    topK('pdf tables', skills, item => `${item.name} ${item.description}`, 1).length,
    1,
  )
  assert.deepEqual(topK('zzzz-no-overlap', skills, item => item.description), [])
})

test('a clear skill match beats the runner-up', () => {
  const match = selectMatch(
    'extract tables figures pdf documents invoices',
    [
      {
        name: 'pdf-tables',
        description: 'extract tables figures pdf documents invoices',
      },
      { name: 'rust-crate', description: 'create rust cargo library crate' },
    ],
    item => `${item.name} ${item.description}`,
  )
  assert.equal(match?.name, 'pdf-tables')
})

test('weak overlap is not a skill match', () => {
  const match = selectMatch(
    'rename a local variable',
    skills,
    item => `${item.name} ${item.description}`,
  )
  assert.equal(match, null)
})

test('two equally close skills are not a match', () => {
  const match = selectMatch(
    'extract tables and figures from pdf documents',
    skills.filter(item => item.name.startsWith('pdf')),
    item => `${item.name} ${item.description}`,
  )
  assert.equal(match, null)
})

test('a blueprint is authored only for independent work with no stored match', () => {
  assert.equal(independentWorkstreams('fix the typo in the readme'), false)
  assert.equal(
    canAuthorBlueprint(
      '1. count the warehouse widgets in the ledger\n2. paint the bikeshed and leave the widgets alone',
    ),
    true,
  )
  assert.equal(
    canAuthorBlueprint(
      '1. build retrieval augmented generation over enterprise documents\n2. index the enterprise documents and keep the retriever separate',
    ),
    false,
  )
})
