import { describe, expect, it } from 'vitest'
import { splitMongoStatements } from './mongodb-statement-splitter'

const texts = (text: string): string[] =>
  splitMongoStatements(text).map((statement) => statement.text)

describe('splitMongoStatements', () => {
  it('ends a statement at a line break, unless the next line continues the chain', () => {
    expect(texts('db.a.find()\n  .sort({ n: 1 })\n\ndb.b.countDocuments()\nshow dbs')).toEqual([
      'db.a.find()\n  .sort({ n: 1 })',
      'db.b.countDocuments()',
      'show dbs'
    ])
  })

  it('keeps brackets, strings, regexes and comments that hold ; or line breaks together', () => {
    expect(texts('db.a.find({\n  note: "a;b", // why;\n  name: /x;y/i\n}); db.b.find()')).toEqual([
      'db.a.find({\n  note: "a;b", // why;\n  name: /x;y/i\n})',
      'db.b.find()'
    ])
  })

  it('reports where each statement starts and ends, without the semicolon', () => {
    expect(splitMongoStatements('  use shop;\n')).toEqual([
      { start: 2, end: 10, terminatorEnd: 11, text: 'use shop' }
    ])
  })
})
