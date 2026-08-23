import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withRetry } from './http-retry'

test('returns the result on the first successful attempt', async () => {
    let calls = 0
    const result = await withRetry('test', async () => {
        calls++
        return 'ok'
    })
    assert.equal(result, 'ok')
    assert.equal(calls, 1)
})

test('retries after a failure and returns the eventual success', async () => {
    let calls = 0
    const result = await withRetry(
        'test',
        async () => {
            calls++
            if (calls < 2) throw new Error('transient')
            return 'ok'
        },
        { baseDelayMs: 1 }
    )
    assert.equal(result, 'ok')
    assert.equal(calls, 2)
})

test('throws the last error once every attempt is exhausted', async () => {
    let calls = 0
    await assert.rejects(
        () =>
            withRetry(
                'test',
                async () => {
                    calls++
                    throw new Error(`fail ${calls}`)
                },
                { attempts: 3, baseDelayMs: 1 }
            ),
        /fail 3/
    )
    assert.equal(calls, 3)
})

test('delay doubles between attempts', async () => {
    let calls = 0
    const start = Date.now()
    await withRetry(
        'test',
        async () => {
            calls++
            if (calls < 4) throw new Error('transient')
            return 'ok'
        },
        { attempts: 4, baseDelayMs: 10 }
    )
    // Three retries at 10ms, 20ms, 40ms — floor at their sum (70ms), no
    // upper bound asserted since CI scheduling can pad real elapsed time.
    assert.ok(Date.now() - start >= 70, 'expected delays to roughly double (10ms, 20ms, 40ms)')
})
