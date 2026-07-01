import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchAllRows } from '../../supabase-admin'

// A fake paged source of `total` rows served in 1000-row pages — proves the
// C-Suite data readers (which now wrap their reads in fetchAllRows) do NOT stop
// at the silent PostgREST 1000-row cap.
function fakeSource(total: number, opts: { errorAtFrom?: number } = {}) {
  return async (from: number, to: number): Promise<{ data: { i: number }[] | null; error: { message: string } | null }> => {
    if (opts.errorAtFrom !== undefined && from >= opts.errorAtFrom) return { data: null, error: { message: 'boom' } }
    const rows: { i: number }[] = []
    for (let i = from; i <= to && i < total; i++) rows.push({ i })
    return { data: rows, error: null }
  }
}

test('returns ALL rows across multiple 1000-row pages (past the cap)', async () => {
  const { rows, error } = await fetchAllRows(fakeSource(2500))
  assert.equal(error, null)
  assert.equal(rows.length, 2500)
})

test('stops when a short page signals exhaustion', async () => {
  const { rows } = await fetchAllRows(fakeSource(500))
  assert.equal(rows.length, 500)
})

test('handles an exact 1000-row single page', async () => {
  const { rows } = await fetchAllRows(fakeSource(1000))
  assert.equal(rows.length, 1000)
})

test('propagates a page error and returns rows gathered so far', async () => {
  const { rows, error } = await fetchAllRows(fakeSource(3000, { errorAtFrom: 1000 }))
  assert.equal(error, 'boom')
  assert.equal(rows.length, 1000)
})
