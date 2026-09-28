import { describe, expect, it } from 'vitest'
import { databasePropertiesTargetSchema } from './database-properties-types'

describe('databasePropertiesTargetSchema', () => {
  it('accepts each kind of object the explorer asks about', () => {
    for (const target of [
      { kind: 'server' },
      { kind: 'database', database: 'shop' },
      { kind: 'schema', schema: 'sales' },
      { kind: 'schema', database: 'shop', schema: 'sales' },
      { kind: 'relation', database: 'shop', schema: 'sales', relation: 'orders' }
    ]) {
      expect(databasePropertiesTargetSchema.safeParse(target).success, JSON.stringify(target)).toBe(
        true
      )
    }
  })

  it('refuses a target missing its names or carrying extra fields', () => {
    for (const target of [
      { kind: 'database' },
      { kind: 'relation', schema: 'sales' },
      { kind: 'schema', schema: '' },
      { kind: 'server', database: 'shop' },
      { kind: 'table', schema: 'sales', relation: 'orders' },
      { kind: 'schema', schema: 'x'.repeat(257) }
    ]) {
      expect(databasePropertiesTargetSchema.safeParse(target).success, JSON.stringify(target)).toBe(
        false
      )
    }
  })
})
