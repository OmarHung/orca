import { describe, expect, it } from 'vitest'
import type { DatabaseColumn } from '../../../../../shared/database/database-query-types'
import { viewerValue } from './database-value-format'

const text: DatabaseColumn = { name: 'body', typeName: 'text' }
const jsonb: DatabaseColumn = { name: 'doc', typeName: 'jsonb' }

describe('viewerValue', () => {
  it('reports NULL separately from an empty string', () => {
    expect(viewerValue(null, text)).toEqual({ kind: 'null' })
    expect(viewerValue('', text)).toMatchObject({ kind: 'text', text: '' })
  })

  it('pretty-prints JSON objects in json columns and JSON-looking text', () => {
    expect(viewerValue('{"a":1}', jsonb)).toEqual({
      kind: 'text',
      text: '{\n  "a": 1\n}',
      isJson: true,
      truncatedFrom: null
    })
    expect(viewerValue('[1,2]', text)).toMatchObject({ isJson: true, text: '[\n  1,\n  2\n]' })
  })

  it('keeps scalars and invalid JSON verbatim', () => {
    expect(viewerValue('"quoted"', jsonb)).toMatchObject({ isJson: false, text: '"quoted"' })
    expect(viewerValue('{not json', text)).toMatchObject({ isJson: false, text: '{not json' })
  })

  it('shows a truncated preview as-is with its full length', () => {
    expect(viewerValue({ preview: '{"a":', length: 90_000 }, jsonb)).toEqual({
      kind: 'text',
      text: '{"a":',
      isJson: false,
      truncatedFrom: 90_000
    })
  })
})
