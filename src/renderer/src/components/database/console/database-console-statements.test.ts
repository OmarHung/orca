import { describe, expect, it } from 'vitest'
import { statementsForRun } from './database-console-statements'

const text = 'select 1;\nselect 2;\nselect 3;'

describe('statementsForRun', () => {
  it('runs the statement at the caret when nothing is selected', () => {
    const [statement] = statementsForRun(text, 'current', text.indexOf('2'), null)
    expect(statement?.text).toBe('select 2')
  })

  it('runs every statement inside a selection, with offsets in console coordinates', () => {
    const start = text.indexOf('select 2')
    const statements = statementsForRun(text, 'current', 0, { start, end: text.length })
    expect(statements.map((statement) => statement.text)).toEqual(['select 2', 'select 3'])
    expect(text.slice(statements[0]!.start, statements[0]!.end)).toBe('select 2')
  })

  it('runs the whole console in "all" mode, ignoring the selection', () => {
    expect(statementsForRun(text, 'all', 0, { start: 0, end: 3 })).toHaveLength(3)
  })

  it('returns nothing for an empty console', () => {
    expect(statementsForRun('  \n', 'current', 0, null)).toEqual([])
  })
})
