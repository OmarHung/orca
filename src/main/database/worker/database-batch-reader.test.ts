import { describe, expect, it } from 'vitest'
import { PagedBatchReader } from './database-batch-reader'

function createFlow(): { pause: () => void; resume: () => void; paused: () => boolean } {
  let paused = false
  return {
    pause: () => {
      paused = true
    },
    resume: () => {
      paused = false
    },
    paused: () => paused
  }
}

const columns = [{ name: 'n', typeName: 'int' }]
const row = (value: number): string[] => [String(value)]

describe('PagedBatchReader', () => {
  it('pauses the flow when a result set fills a page and pages through the rest', async () => {
    const flow = createFlow()
    const reader = new PagedBatchReader(flow, 2)
    reader.startResultSet(columns)
    reader.addRow(row(1))
    reader.addRow(row(2))
    expect(flow.paused()).toBe(true)

    const first = await reader.firstPage()
    expect(first.results).toHaveLength(1)
    expect(first.results[0]).toMatchObject({ kind: 'rows', hasMore: true, rows: [['1'], ['2']] })

    const next = reader.nextPage(2)
    expect(flow.paused()).toBe(false)
    reader.addRow(row(3))
    reader.endResultSet()
    reader.finish()
    expect(await next).toEqual({ rows: [['3']], hasMore: false, followingResults: [] })
    expect(reader.isOpen).toBe(false)
  })

  it('returns every result set of a batch that fits in one page', async () => {
    const reader = new PagedBatchReader(createFlow(), 10)
    reader.addCommand('UPDATE', 3)
    reader.startResultSet(columns)
    reader.addRow(row(1))
    reader.startResultSet(columns)
    reader.addRow(row(2))
    reader.finish()
    const { results } = await reader.firstPage()
    expect(results.map((result) => result.kind)).toEqual(['command', 'rows', 'rows'])
    expect(results.every((result) => result.kind === 'command' || !result.hasMore)).toBe(true)
  })

  it('delivers result sets that follow a paged one with the page that finishes it', async () => {
    const flow = createFlow()
    const reader = new PagedBatchReader(flow, 1)
    reader.startResultSet(columns)
    reader.addRow(row(1))
    await reader.firstPage()

    const next = reader.nextPage(1)
    reader.startResultSet([{ name: 'm', typeName: 'int' }])
    reader.addRow(row(9))
    const page = await next
    expect(page.rows).toEqual([])
    expect(page.hasMore).toBe(false)
    expect(page.followingResults).toHaveLength(1)
    expect(page.followingResults?.[0]).toMatchObject({ kind: 'rows', hasMore: true, rows: [['9']] })
    expect(flow.paused()).toBe(true)
  })

  it('reports a statement that returned nothing as a completed command', async () => {
    const reader = new PagedBatchReader(createFlow(), 10)
    reader.finish()
    expect((await reader.firstPage()).results).toEqual([
      expect.objectContaining({ kind: 'command', command: '', rowCount: null })
    ])
  })

  it('rejects with the driver error', async () => {
    const reader = new PagedBatchReader(createFlow(), 10)
    reader.fail(new Error('boom'))
    await expect(reader.firstPage()).rejects.toThrow('boom')
  })

  it('drops remaining rows and resumes the flow when abandoned', async () => {
    const flow = createFlow()
    const reader = new PagedBatchReader(flow, 1)
    reader.startResultSet(columns)
    reader.addRow(row(1))
    await reader.firstPage()
    const abandoned = reader.abandon()
    expect(flow.paused()).toBe(false)
    reader.addRow(row(2))
    reader.fail(new Error('cancelled'))
    await expect(abandoned).resolves.toBeUndefined()
  })
})
