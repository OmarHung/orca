import { describe, expect, it } from 'vitest'
import { splitSqlStatements } from '../../../../../shared/database/sql-statement-splitter'
import { offsetOfStatementLine, statementsForRun } from './database-console-statements'

const text = 'select 1;\nselect 2;\nselect 3;'

describe('statementsForRun', () => {
  it('runs the statement at the caret when nothing is selected', () => {
    const [statement] = statementsForRun(text, 'current', text.indexOf('2'), null, 'postgres')
    expect(statement?.text).toBe('select 2')
  })

  it('runs every statement inside a selection, with offsets in console coordinates', () => {
    const start = text.indexOf('select 2')
    const statements = statementsForRun(text, 'current', 0, { start, end: text.length }, 'postgres')
    expect(statements.map((statement) => statement.text)).toEqual(['select 2', 'select 3'])
    expect(text.slice(statements[0]!.start, statements[0]!.end)).toBe('select 2')
  })

  it('runs the whole console in "all" mode, ignoring the selection', () => {
    expect(statementsForRun(text, 'all', 0, { start: 0, end: 3 }, 'postgres')).toHaveLength(3)
  })

  it('sends a SQL Server selection as one batch but runs the caret statement alone', () => {
    const script = 'declare @x int = 1;\nselect @x;'
    const selected = statementsForRun(
      script,
      'current',
      0,
      { start: 0, end: script.length },
      'sqlserver'
    )
    expect(selected.map((statement) => statement.text)).toEqual([script])
    const atCaret = statementsForRun(script, 'current', script.indexOf('@x;'), null, 'sqlserver')
    expect(atCaret.map((statement) => statement.text)).toEqual(['select @x'])
  })

  it('returns nothing for an empty console', () => {
    expect(statementsForRun('  \n', 'current', 0, null, 'postgres')).toEqual([])
  })
})

describe('offsetOfStatementLine', () => {
  it('maps a server-reported line to the first token on that line', () => {
    const script = 'select 1;\n\nselect *\n    from missing'
    const [, statement] = splitSqlStatements(script, 'postgres')
    expect(script.slice(offsetOfStatementLine(statement!, 2))).toBe('from missing')
  })
})
