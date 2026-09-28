import { describe, expect, it } from 'vitest'
import {
  sequenceCreateStatement,
  sequenceStateStatement,
  valuesHandedOut,
  type SequenceNumbers
} from './sqlserver-dump-sequences'

const UP: SequenceNumbers = {
  start: 1000n,
  increment: 10n,
  minimum: 1000n,
  maximum: 1050n,
  current: 1000n,
  cycling: false
}
const DOWN: SequenceNumbers = {
  start: -5n,
  increment: -2n,
  minimum: -9n,
  maximum: 0n,
  current: -5n,
  cycling: true
}

const row = (changes: Record<string, unknown> = {}): Record<string, unknown> => ({
  sequence_schema: 'sales',
  name: 'order]numbers',
  type_name: 'bigint',
  precision: 19,
  scale: 0,
  alias_schema: null,
  alias_name: 'bigint',
  start_value: '1000',
  increment: '10',
  minimum_value: '1000',
  maximum_value: '1050',
  current_value: '1020',
  last_used_value: '1020',
  is_cycling: false,
  is_cached: true,
  cache_size: 20,
  ...changes
})

describe('valuesHandedOut', () => {
  it('counts the values from the start up to the current one', () => {
    expect(valuesHandedOut(UP)).toBe(1n)
    expect(valuesHandedOut({ ...UP, current: 1030n })).toBe(4n)
    // The last value before the maximum: the next NEXT VALUE FOR fails, as on the source.
    expect(valuesHandedOut({ ...UP, current: 1050n })).toBe(6n)
    expect(valuesHandedOut({ ...DOWN, current: -9n })).toBe(3n)
  })

  it('counts a cycling sequence round its wrap, which starts over at the far end', () => {
    // -5, -7, -9, then 0, -2: descending, it starts over at its maximum.
    expect(valuesHandedOut({ ...DOWN, current: -2n })).toBe(5n)
    expect(valuesHandedOut({ ...DOWN, current: -4n })).toBe(6n)
    expect(valuesHandedOut({ ...UP, cycling: true, minimum: 995n, current: 995n })).toBe(7n)
  })

  it('finds no count when the current value is off the steps from its start', () => {
    // Its increment changed after it handed some values out.
    expect(valuesHandedOut({ ...UP, current: 1025n })).toBeNull()
    expect(valuesHandedOut({ ...UP, start: 1010n, current: 1000n })).toBeNull()
    expect(valuesHandedOut({ ...DOWN, current: -3n })).toBeNull()
  })
})

describe('sequenceCreateStatement', () => {
  it('keeps the type, start, step, range, cycling and cache, creating it only when missing', () => {
    expect(sequenceCreateStatement(row(), true).sql).toBe(
      "IF OBJECT_ID(N'sales.[order]]numbers]', N'SO') IS NULL CREATE SEQUENCE sales.[order]]numbers] AS bigint START WITH 1000 INCREMENT BY 10 MINVALUE 1000 MAXVALUE 1050 NO CYCLE CACHE 20"
    )
    expect(
      sequenceCreateStatement(
        row({
          type_name: 'decimal',
          precision: 12,
          start_value: '-5',
          increment: '-2',
          minimum_value: '-9',
          maximum_value: '0',
          current_value: '-2',
          last_used_value: '-2',
          is_cycling: true,
          is_cached: false,
          cache_size: null
        }),
        true
      ).sql
    ).toMatch(
      /AS decimal\(12,0\) START WITH -5 INCREMENT BY -2 MINVALUE -9 MAXVALUE 0 CYCLE NO CACHE$/
    )
    expect(
      sequenceCreateStatement(
        row({ alias_schema: 'dbo', alias_name: 'ticket', cache_size: null }),
        true
      ).sql
    ).toMatch(/AS dbo\.ticket START WITH .* NO CYCLE CACHE$/)
  })
})

describe('sequenceStateStatement', () => {
  const guard = (start: string, lastUsed = ' OR last_used_value IS NOT NULL') =>
    `IF EXISTS (SELECT 1 FROM sys.sequences WHERE object_id = OBJECT_ID(N'sales.[order]]numbers]') AND (start_value <> ${start} OR current_value <> ${start}${lastUsed})) ALTER SEQUENCE sales.[order]]numbers] RESTART WITH ${start}`

  it('takes every value handed out since its start, restarting only one that moved', () => {
    expect(sequenceStateStatement(row(), true)).toEqual({
      statement: {
        sql: `IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE object_id = OBJECT_ID(N'sales.[order]]numbers]') AND start_value = 1000 AND current_value = 1020 AND last_used_value = 1020)
BEGIN
${guard('1000')};
DECLARE @orca_first_value sql_variant;
EXEC sys.sp_sequence_get_range @sequence_name = N'sales.[order]]numbers]', @range_size = 3, @range_first_value = @orca_first_value OUTPUT;
END`
      },
      note: null
    })
  })

  it('leaves an unused sequence at its start', () => {
    const unused = row({ current_value: '1000', last_used_value: null })
    expect(sequenceStateStatement(unused, true)).toEqual({
      statement: { sql: guard('1000') },
      note: null
    })
    expect(sequenceCreateStatement(unused, true).sql).toMatch(/ START WITH 1000 /)
  })

  it('treats a sequence at its start as used when the server can’t say, and says so', () => {
    const { statement, note } = sequenceStateStatement(
      row({ current_value: '1000', last_used_value: null }),
      false
    )
    // Without last_used_value it can't tell a load of the same dump, so it always restarts.
    expect(statement.sql.startsWith(`${guard('1000', '')};\n`)).toBe(true)
    expect(statement.sql).toContain('@range_size = 1,')
    expect(note).toMatch(/can't tell whether sequence sales\.\[order\]\]numbers\]/)
    // Past its start, it has handed values out whatever the server version.
    expect(sequenceStateStatement(row({ last_used_value: null }), false).note).toBeNull()
  })

  it('starts at the current value when its start can’t reach it, and says so', () => {
    const moved = row({ current_value: '1025' })
    const { statement, note } = sequenceStateStatement(moved, true)
    expect(statement.sql).toContain(`${guard('1025')};`)
    expect(statement.sql).toContain('@range_size = 1,')
    expect(note).toMatch(/start value is 1025/)
    expect(sequenceCreateStatement(moved, true).sql).toMatch(/ START WITH 1025 /)
  })

  it('refuses a value that is not a whole number', () => {
    expect(() => sequenceStateStatement(row({ current_value: '1.5' }), true)).toThrow(
      /current_value of 1\.5/
    )
  })
})
