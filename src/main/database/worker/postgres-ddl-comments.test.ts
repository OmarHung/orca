import { describe, expect, it } from 'vitest'
import { postgresCommentStatement } from './postgres-ddl-comments'

describe('postgresCommentStatement', () => {
  it('writes the comment as a standard string, quotes doubled and everything else as written', () => {
    expect(postgresCommentStatement('TABLE "s"."people"', "it's \\ 50% 中文\nnext")).toBe(
      `COMMENT ON TABLE "s"."people" IS 'it''s \\ 50% 中文\nnext';`
    )
    expect(postgresCommentStatement('COLUMN "s"."people"."Name"', '')).toBe(
      `COMMENT ON COLUMN "s"."people"."Name" IS '';`
    )
  })
})
