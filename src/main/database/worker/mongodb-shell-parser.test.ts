import { Decimal128, ObjectId } from 'mongodb'
import { describe, expect, it } from 'vitest'
import { mongoReadOnlyViolation, parseMongoStatement } from './mongodb-shell-parser'

describe('parseMongoStatement', () => {
  it('reads a find with the shell’s value types and cursor methods', () => {
    const operation = parseMongoStatement(
      'db.getCollection("orders").find({ _id: ObjectId("64b7f0c2a1b2c3d4e5f60718"), total: NumberDecimal("10.50"), views: NumberLong("9007199254740993"), at: { $gte: ISODate("2024-01-02T03:04:05Z") }, n: -2 * 3 }).sort({ at: -1 }).limit(5)'
    )
    expect(operation).toMatchObject({
      kind: 'find',
      collection: 'orders',
      options: { sort: { at: -1 }, limit: 5 },
      count: 'none'
    })
    const filter = operation.kind === 'find' ? operation.filter : {}
    expect(filter._id).toEqual(new ObjectId('64b7f0c2a1b2c3d4e5f60718'))
    expect(filter.total).toEqual(Decimal128.fromString('10.50'))
    expect(String(filter.views)).toBe('9007199254740993')
    expect(filter.at).toEqual({ $gte: new Date('2024-01-02T03:04:05Z') })
    expect(filter.n).toBe(-6)
  })

  it('names dotted collections and switches databases as mongosh does', () => {
    expect(parseMongoStatement('db.getSiblingDB("admin").system.version.findOne()')).toMatchObject({
      kind: 'find',
      database: 'admin',
      collection: 'system.version',
      options: { limit: 1 }
    })
    expect(parseMongoStatement('use shop')).toEqual({ kind: 'use', database: 'shop' })
  })

  it('keeps a field named __proto__ as a field', () => {
    const operation = parseMongoStatement('db.a.find({ __proto__: { $ne: 1 } })')
    const filter = operation.kind === 'find' ? operation.filter : {}
    expect(Object.keys(filter)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(filter)).toBe(Object.prototype)
  })

  it('runs no code: names and calls outside the shell’s values are syntax errors', () => {
    for (const statement of [
      'db.a.find({ x: process.exit() })',
      'db.a.find({ x: require("fs") })',
      'db.a.find({ x: (() => 1)() })',
      'db.a.find({ x: constructor })',
      'print(db)'
    ]) {
      expect(() => parseMongoStatement(statement), statement).toThrow()
      expect(mongoReadOnlyViolation(statement), statement).toBeNull()
    }
  })
})

describe('mongoReadOnlyViolation', () => {
  it('refuses writes, including $out and $merge anywhere in a pipeline', () => {
    for (const statement of [
      'db.a.insertOne({})',
      'db.a.updateMany({}, { $set: { x: 1 } })',
      'db.a.aggregate([{ $out: "b" }])',
      'db.a.aggregate([{ $facet: { all: [{ $merge: "b" }] } }])',
      'db.runCommand({ delete: "a", deletes: [] })',
      'db.runCommand({ explain: { update: "a", updates: [] } })',
      'db.adminCommand({ shutdown: 1 })'
    ]) {
      expect(mongoReadOnlyViolation(statement), statement).toContain('read-only')
    }
  })

  it('lets reads through', () => {
    for (const statement of [
      'show collections',
      'db.a.aggregate([{ $match: { out: "$out" } }])',
      'db.runCommand({ find: "a", filter: {} })',
      'db.a.find().explain("executionStats")'
    ]) {
      expect(mongoReadOnlyViolation(statement), statement).toBeNull()
    }
  })
})
