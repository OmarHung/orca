import { describe, expect, it } from 'vitest'
import { sqlServerCommentStatement } from './sqlserver-ddl'

describe('sqlServerCommentStatement', () => {
  it('names the object by its schema, type and name, as N-strings with quotes doubled', () => {
    expect(
      sqlServerCommentStatement({
        schema: 'sales',
        type: 'TABLE',
        name: "o'rders]",
        column: null,
        comment: "it's 中文 🎉\nnext"
      })
    ).toBe(
      `EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'it''s 中文 🎉\nnext', @level0type = N'SCHEMA', @level0name = N'sales', @level1type = N'TABLE', @level1name = N'o''rders]';`
    )
  })

  it('adds the column as level 2', () => {
    expect(
      sqlServerCommentStatement({
        schema: 'dbo',
        type: 'VIEW',
        name: 'people_view',
        column: 'name',
        comment: 'shown'
      })
    ).toMatch(
      /@level1type = N'VIEW', @level1name = N'people_view', @level2type = N'COLUMN', @level2name = N'name';$/
    )
  })
})
