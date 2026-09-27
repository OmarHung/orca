import { describe, expect, it } from 'vitest'
import type { DatabaseDumpOptions } from '../../../../../shared/database/database-dump-types'
import {
  buildDumpRequest,
  dumpCandidateKey,
  initialDumpSelection,
  suggestedDumpName,
  type DumpCandidateGroup
} from './database-dump-candidates'
import type { DatabaseDumpScope } from './database-jobs-store'

const table = (schema: string, name: string) => {
  const object = { kind: 'table' as const, schema, name }
  return { key: dumpCandidateKey(object), object, icon: 'table' as const }
}

const GROUPS: DumpCandidateGroup[] = [
  { schema: 'public', candidates: [table('public', 'people'), table('public', 'orders')] },
  {
    schema: 'sales',
    candidates: [
      table('sales', 'people'),
      {
        key: dumpCandidateKey({
          kind: 'routine',
          schema: 'sales',
          name: 'people',
          identity: 'sales.people()',
          routineKind: 'function'
        }),
        object: {
          kind: 'routine',
          schema: 'sales',
          name: 'people',
          identity: 'sales.people()',
          routineKind: 'function'
        },
        icon: 'function'
      }
    ]
  }
]

const SCOPE: DatabaseDumpScope = {
  connectionId: 'c1',
  database: 'shop',
  schema: null,
  only: null,
  dataOnly: false,
  label: 'prod › shop'
}

const OPTIONS: DatabaseDumpOptions = {
  contents: 'structure-and-data',
  disableForeignKeys: true,
  layout: 'single-file',
  rowsPerInsert: 100,
  dropExisting: false
}

describe('dump candidates', () => {
  it('checks everything, or only the table the dialog was opened on', () => {
    expect(initialDumpSelection(GROUPS, null).size).toBe(4)
    // The routine of the same name in sales is not the table.
    expect([...initialDumpSelection(GROUPS, { schema: 'sales', name: 'people' })]).toEqual([
      dumpCandidateKey({ kind: 'table', schema: 'sales', name: 'people' })
    ])
  })

  it('builds the request from what is checked, in listed order, in the scope’s database', () => {
    const selected = new Set([GROUPS[1]!.candidates[1]!.key, GROUPS[0]!.candidates[1]!.key])
    const request = buildDumpRequest(SCOPE, GROUPS, selected, OPTIONS)
    expect(request.database).toBe('shop')
    expect(request.objects.map((object) => `${object.schema}.${object.name}`)).toEqual([
      'public.orders',
      'sales.people'
    ])
    expect(
      buildDumpRequest({ ...SCOPE, database: null }, GROUPS, selected, OPTIONS)
    ).not.toHaveProperty('database')
  })

  it('names the file after the narrowest thing it holds and the day', () => {
    const day = new Date(2026, 8, 8)
    expect(suggestedDumpName(SCOPE, day)).toBe('shop-2026-09-08')
    expect(
      suggestedDumpName(
        { ...SCOPE, schema: 'sales', only: { schema: 'sales', name: 'people' }, dataOnly: true },
        day
      )
    ).toBe('people-data-2026-09-08')
  })
})
