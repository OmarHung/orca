import { describe, expect, it } from 'vitest'
import { postgresSequenceGuard, type PostgresSequenceDefinition } from './postgres-dump-catalog'

const SEQUENCE: PostgresSequenceDefinition = {
  data_type: 'bigint',
  start_value: '1',
  min_value: '-9223372036854775808',
  max_value: '100',
  increment_by: '-2',
  cycle: true,
  cache_size: '5'
}

const DIFFERS = `EXISTS (SELECT 1 FROM pg_catalog.pg_sequence WHERE seqrelid = pg_catalog.to_regclass('"s"."ids"') AND (seqtypid, seqincrement, seqmin, seqmax, seqcache, seqcycle) IS DISTINCT FROM ('bigint'::regtype::oid, '-2'::bigint, '-9223372036854775808'::bigint, '100'::bigint, '5'::bigint, true))`
const MESSAGE = `MESSAGE = 'Sequence "s"."ids" already exists with a definition other than the dumped one.'`

describe('postgresSequenceGuard', () => {
  it('stops a load into a sequence defined otherwise, unless asked to drop what is there', () => {
    expect(postgresSequenceGuard('"s"."ids"', SEQUENCE, false)).toBe(
      `DO $orca$BEGIN IF ${DIFFERS} THEN RAISE EXCEPTION USING ${MESSAGE}, HINT = 'Drop it, or dump again dropping existing objects first.'; END IF; END$orca$`
    )
  })

  it('drops a sequence defined otherwise that nothing else uses, and refuses one in use', () => {
    expect(postgresSequenceGuard('"s"."ids"', SEQUENCE, true)).toBe(
      `DO $orca$BEGIN IF ${DIFFERS} THEN IF EXISTS (SELECT 1 FROM pg_catalog.pg_depend WHERE refclassid = 'pg_catalog.pg_class'::regclass AND refobjid = pg_catalog.to_regclass('"s"."ids"') AND deptype = 'n') THEN RAISE EXCEPTION USING ${MESSAGE}, HINT = 'Other objects use it, so the dump can''t replace it.'; END IF; DROP SEQUENCE "s"."ids"; END IF; END$orca$`
    )
  })

  it('quotes the body with a tag its names don’t contain', () => {
    const guard = postgresSequenceGuard('"s"."a$orca$b"', SEQUENCE, true)
    expect(guard.startsWith('DO $orca1$BEGIN')).toBe(true)
    expect(guard.endsWith('END$orca1$')).toBe(true)
  })
})
