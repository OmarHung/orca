import type { Document } from 'mongodb'
import { isDocument } from './mongodb-documents'

/**
 * MongoDB has no read-only session, so the console runs only methods and commands that read:
 * a write method, a pipeline with $out or $merge, or a command off this list is refused.
 */

/** A statement that would write; refused like the SQL consoles' read-only guard. */
export class MongoReadOnlyRefusal extends Error {
  constructor(what: string) {
    super(`Orca's database tool is read-only: ${what} is not allowed.`)
  }
}

// Lower case; a runCommand's command name is its first field.
const READ_COMMANDS = new Set([
  'aggregate',
  'buildinfo',
  'collstats',
  'connectionstatus',
  'connpoolstats',
  'count',
  'currentop',
  'datasize',
  'dbstats',
  'distinct',
  'explain',
  'find',
  'getcmdlineopts',
  'getlog',
  'getparameter',
  'hello',
  'hostinfo',
  'ismaster',
  'listcollections',
  'listcommands',
  'listdatabases',
  'listindexes',
  'listshards',
  'lockinfo',
  'ping',
  'replsetgetconfig',
  'replsetgetstatus',
  'rolesinfo',
  'serverstatus',
  'top',
  'usersinfo',
  'whatsmyuri'
])

export const WRITE_METHODS = new Set([
  'bulkWrite',
  'createIndex',
  'createIndexes',
  'deleteMany',
  'deleteOne',
  'drop',
  'dropIndex',
  'dropIndexes',
  'findAndModify',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'insert',
  'insertMany',
  'insertOne',
  'remove',
  'renameCollection',
  'replaceOne',
  'save',
  'update',
  'updateMany',
  'updateOne'
])

/** Refuses any stage or field that writes ($out, $merge), at any depth of a pipeline. */
export function assertReadOnlyValue(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertReadOnlyValue)
    return
  }
  if (value === null || typeof value !== 'object' || '_bsontype' in value) {
    return
  }
  for (const [key, inner] of Object.entries(value)) {
    if (key === '$out' || key === '$merge') {
      throw new MongoReadOnlyRefusal(`a pipeline with ${key}`)
    }
    assertReadOnlyValue(inner)
  }
}

export function assertReadCommand(command: Document): void {
  const name = Object.keys(command)[0]
  if (!name || !READ_COMMANDS.has(name.toLowerCase())) {
    throw new MongoReadOnlyRefusal(`the ${name ?? 'empty'} command`)
  }
  if (name.toLowerCase() === 'explain') {
    const inner: unknown = command[name]
    if (!isDocument(inner)) {
      throw new MongoReadOnlyRefusal('explain without a command')
    }
    assertReadCommand(inner)
  }
  assertReadOnlyValue(command)
}
