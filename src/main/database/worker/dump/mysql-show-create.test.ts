import { describe, expect, it } from 'vitest'
import {
  commentForNoBackslashEscapes,
  creationContext,
  inCreationContext,
  withoutDefiner,
  type CreationContext
} from './mysql-show-create'

const ROUTINE: CreationContext = {
  sqlMode: 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES',
  characterSetClient: 'utf8mb4',
  collationConnection: 'utf8mb4_unicode_ci',
  databaseCollation: 'utf8mb4_0900_ai_ci'
}
const CREATE = { sql: `CREATE FUNCTION "f"() RETURNS text RETURN 'a\\b'`, compound: true }

describe('withoutDefiner', () => {
  it('drops the definer however the server quoted it', () => {
    expect(withoutDefiner('CREATE DEFINER=`root`@`%` PROCEDURE `p`() SELECT 1')).toBe(
      'CREATE PROCEDURE `p`() SELECT 1'
    )
    // Under ANSI_QUOTES the server writes it in double quotes.
    expect(withoutDefiner('CREATE DEFINER="some one"@"localhost" FUNCTION "f"()')).toBe(
      'CREATE FUNCTION "f"()'
    )
  })
})

describe('creationContext', () => {
  it('reads the session SHOW CREATE reports, a view having no sql_mode', () => {
    expect(
      creationContext({
        sql_mode: 'ANSI_QUOTES',
        character_set_client: 'latin1',
        collation_connection: 'latin1_german2_ci',
        'Database Collation': 'latin1_swedish_ci'
      })
    ).toEqual({
      sqlMode: 'ANSI_QUOTES',
      characterSetClient: 'latin1',
      collationConnection: 'latin1_german2_ci',
      databaseCollation: 'latin1_swedish_ci'
    })
    expect(
      creationContext({ character_set_client: 'utf8mb4', collation_connection: 'utf8mb4_bin' })
    ).toMatchObject({ sqlMode: null, databaseCollation: null })
    expect(() => creationContext({ sql_mode: '' })).toThrow(/character set/)
  })
})

describe('inCreationContext', () => {
  it('creates the object in its own session and puts the loading session back', () => {
    const notes: string[] = []
    expect(inCreationContext('Function f', CREATE, ROUTINE, 'utf8mb4_0900_ai_ci', notes)).toEqual([
      {
        sql: "SET @ORCA_SAVED_SQL_MODE = @@SQL_MODE, @ORCA_SAVED_CHARACTER_SET_CLIENT = @@CHARACTER_SET_CLIENT, @ORCA_SAVED_CHARACTER_SET_RESULTS = @@CHARACTER_SET_RESULTS, @ORCA_SAVED_COLLATION_CONNECTION = @@COLLATION_CONNECTION, SQL_MODE = 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES', CHARACTER_SET_CLIENT = 'utf8mb4', CHARACTER_SET_RESULTS = 'utf8mb4', COLLATION_CONNECTION = 'utf8mb4_unicode_ci'"
      },
      CREATE,
      {
        sql: 'SET SQL_MODE = @ORCA_SAVED_SQL_MODE, CHARACTER_SET_CLIENT = @ORCA_SAVED_CHARACTER_SET_CLIENT, CHARACTER_SET_RESULTS = @ORCA_SAVED_CHARACTER_SET_RESULTS, COLLATION_CONNECTION = @ORCA_SAVED_COLLATION_CONNECTION'
      }
    ])
    expect(notes).toEqual([])
  })

  it('leaves sql_mode alone for a view, which keeps none', () => {
    const view = { ...ROUTINE, sqlMode: null, databaseCollation: null }
    const [enter, , leave] = inCreationContext('View v', { sql: 'CREATE VIEW v' }, view, null, [])
    expect(enter?.sql).not.toMatch(/SQL_MODE/)
    expect(leave?.sql).toBe(
      'SET CHARACTER_SET_CLIENT = @ORCA_SAVED_CHARACTER_SET_CLIENT, CHARACTER_SET_RESULTS = @ORCA_SAVED_CHARACTER_SET_RESULTS, COLLATION_CONNECTION = @ORCA_SAVED_COLLATION_CONNECTION'
    )
  })

  it('switches the database collation around an object made under another, noting it once', () => {
    const notes: string[] = []
    const older = { ...ROUTINE, databaseCollation: 'latin1_swedish_ci' }
    const statements = inCreationContext('Function f', CREATE, older, 'utf8mb4_bin', notes)
    expect(statements.map((statement) => statement.sql).slice(1, 4)).toEqual([
      'ALTER DATABASE COLLATE latin1_swedish_ci',
      CREATE.sql,
      'ALTER DATABASE COLLATE utf8mb4_bin'
    ])
    inCreationContext('Function g', CREATE, older, 'utf8mb4_bin', notes)
    expect(notes).toEqual([expect.stringMatching(/then to utf8mb4_bin/)])
  })

  it('loads non-ASCII text written in another character set as the UTF-8 it now is', () => {
    const latin1 = { ...ROUTINE, characterSetClient: 'latin1' }
    const notes: string[] = []
    const [ascii] = inCreationContext('Function f', CREATE, latin1, null, notes)
    expect(ascii?.sql).toContain("CHARACTER_SET_CLIENT = 'latin1'")
    const [accented] = inCreationContext(
      'Function f',
      { sql: "CREATE FUNCTION f() RETURNS text RETURN 'é'" },
      latin1,
      null,
      notes
    )
    expect(accented?.sql).toContain(
      "CHARACTER_SET_CLIENT = 'utf8mb4', CHARACTER_SET_RESULTS = 'utf8mb4'"
    )
    expect(accented?.sql).toContain("COLLATION_CONNECTION = 'utf8mb4_unicode_ci'")
    expect(notes).toEqual([expect.stringMatching(/Function f was written in latin1/)])
  })
})

describe('commentForNoBackslashEscapes', () => {
  // What SHOW CREATE writes for the comment `it's a\b` + newline + `next`.
  const shown = "CREATE PROCEDURE `p`()\n    COMMENT 'it''s a\\\\b\\nnext'\nSELECT 'a\\\\b'"

  it('writes the comment as the routine’s mode reads it, leaving its body alone', () => {
    expect(commentForNoBackslashEscapes(shown, "it's a\\b\nnext")).toBe(
      "CREATE PROCEDURE `p`()\n    COMMENT 'it''s a\\b\nnext'\nSELECT 'a\\\\b'"
    )
  })

  it('keeps a comment that reads the same either way, and gives up on one it can’t find', () => {
    const plain = "CREATE PROCEDURE `p`() COMMENT 'it''s' SELECT 1"
    expect(commentForNoBackslashEscapes(plain, "it's")).toBe(plain)
    expect(commentForNoBackslashEscapes(plain, 'a\\b')).toBeNull()
  })
})
