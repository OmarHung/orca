import { describe, expect, it } from 'vitest'
import type { DatabaseExecuteResult } from '../../../shared/database/database-query-types'
import { ConsoleSchema } from './console-schema'

const COMMAND: DatabaseExecuteResult = {
  results: [{ kind: 'command', command: 'USE', rowCount: null, durationMs: 1 }]
}
const PAGED: DatabaseExecuteResult = {
  results: [{ kind: 'rows', resultId: 'r', columns: [], rows: [], hasMore: true, durationMs: 1 }]
}

function fakeSchema() {
  const calls: string[] = []
  let server: string | null = 'app'
  const schema = new ConsoleSchema({
    apply: async (name) => {
      calls.push(`apply ${name}`)
      server = name
    },
    current: async () => server,
    mayChange: (sql) => /^\s*use\b/i.test(sql)
  })
  return { schema, calls, setServer: (name: string) => (server = name) }
}

describe('ConsoleSchema', () => {
  it('applies a picked schema once, and nothing when none was picked', async () => {
    const { schema, calls } = fakeSchema()
    await schema.prepare(undefined)
    await schema.prepare('sales')
    await schema.prepare('sales')
    expect(calls).toEqual(['apply sales'])
  })

  it('follows a statement that switches schema, without re-applying the old pick', async () => {
    const { schema, calls, setServer } = fakeSchema()
    await schema.prepare('sales')
    setServer('audit')
    expect(await schema.afterRun('use audit', COMMAND)).toBe('audit')
    await schema.prepare('audit')
    expect(calls).toEqual(['apply sales'])
    expect(await schema.afterRun('select 1', COMMAND)).toBeUndefined()
  })

  it('does not ask while a result still holds the session', async () => {
    const { schema } = fakeSchema()
    expect(await schema.afterRun('use audit', PAGED)).toBeUndefined()
  })
})
