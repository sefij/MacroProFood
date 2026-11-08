import test from 'node:test'
import assert from 'node:assert/strict'
import { assessScrape } from './scrape-health'

test('an empty scrape is never healthy', () => {
    assert.deepEqual(assessScrape('SUBWAY', 0, 185), { ok: false, reason: 'returned no items' })
    assert.equal(assessScrape('SUBWAY', 0, undefined).ok, false)
})

test('a first-ever scrape with no previous snapshot is accepted', () => {
    assert.equal(assessScrape('SUBWAY', 12, undefined).ok, true)
    assert.equal(assessScrape('SUBWAY', 12, 0).ok, true)
})

test('a modest change in either direction is accepted', () => {
    assert.equal(assessScrape('SUBWAY', 135, 185).ok, true) // the real Sept 2026 menu change, -27%
    assert.equal(assessScrape('SUBWAY', 250, 185).ok, true)
})

test('exactly half is the boundary: kept at 50%, flagged below it', () => {
    assert.equal(assessScrape('SUBWAY', 93, 185).ok, true)
    assert.equal(assessScrape('SUBWAY', 92, 185).ok, false)
})

test('the partial Subway parse (12 of 185) is flagged with counts in the reason', () => {
    const verdict = assessScrape('SUBWAY', 12, 185)
    assert.equal(verdict.ok, false)
    assert.match((verdict as { reason: string }).reason, /12 items, down from 185/)
})

test('a reviewed drop can be allowed per restaurant or for all', () => {
    assert.equal(assessScrape('SUBWAY', 12, 185, 'subway').ok, true)
    assert.equal(assessScrape('SUBWAY', 12, 185, 'KFC, subway').ok, true)
    assert.equal(assessScrape('SUBWAY', 12, 185, 'all').ok, true)
    assert.equal(assessScrape('SUBWAY', 12, 185, 'KFC').ok, false)
})

test('the allow list never excuses an empty scrape', () => {
    assert.equal(assessScrape('SUBWAY', 0, 185, 'all').ok, false)
})
