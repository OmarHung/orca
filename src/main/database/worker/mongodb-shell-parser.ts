import { parse, type Expression, type Node, type Program } from 'acorn'
import { aggregateOperation, findOperation } from './mongodb-cursor-operations'
import type { CallStep, InDatabase, MongoOperation, Step } from './mongodb-operation-types'
import { assertReadCommand, MongoReadOnlyRefusal, WRITE_METHODS } from './mongodb-read-only-rules'
import { documentArgument, stringArgument } from './mongodb-shell-arguments'
import { MongoShellSyntaxError, shellValue } from './mongodb-shell-values'

export type { MongoOperation } from './mongodb-operation-types'
export { MongoReadOnlyRefusal } from './mongodb-read-only-rules'

/**
 * Reads one mongosh-style statement (`db.users.find({…}).sort({…})`, `show dbs`, `use shop`)
 * into an operation Orca runs with the driver. Only reads parse: a write method, a pipeline
 * with $out or $merge, or a command off the read list is refused before anything is sent.
 */

const SHOW = /^show\s+(dbs|databases|collections|tables)\s*;?\s*$/i
const USE = /^use\s+([^\s;]+)\s*;?\s*$/i

function memberName(property: Expression, computed: boolean): string {
  const value = computed
    ? shellValue(property)
    : property.type === 'Identifier'
      ? property.name
      : undefined
  if (typeof value !== 'string') {
    throw new MongoShellSyntaxError('Expected a name here.', property)
  }
  return value
}

/** `db.a.find(x).sort(y)` as its root name and the steps after it, left to right. */
function chainOf(node: Expression): { root: string; rootNode: Node; steps: Step[] } {
  if (node.type === 'Identifier') {
    return { root: node.name, rootNode: node, steps: [] }
  }
  if (node.type === 'MemberExpression' && node.object.type !== 'Super') {
    const inner = chainOf(node.object)
    if (node.property.type === 'PrivateIdentifier') {
      throw new MongoShellSyntaxError('Expected a name here.', node.property)
    }
    return {
      ...inner,
      steps: [...inner.steps, { kind: 'get', name: memberName(node.property, node.computed), node }]
    }
  }
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
    const callee = node.callee
    if (callee.object.type === 'Super' || callee.property.type === 'PrivateIdentifier') {
      throw new MongoShellSyntaxError('Expected a method call here.', callee)
    }
    const inner = chainOf(callee.object)
    const name = memberName(callee.property, callee.computed)
    return { ...inner, steps: [...inner.steps, { kind: 'call', name, args: node.arguments, node }] }
  }
  throw new MongoShellSyntaxError('Start with db, e.g. db.users.find({}).', node)
}

type ChainContext = { database: string | undefined; steps: Step[]; at: Node }

function databaseOperation(
  name: string,
  step: CallStep,
  database: string | undefined
): MongoOperation {
  const [first] = step.args
  switch (name) {
    case 'getCollectionNames':
      return { kind: 'collectionNames', database }
    case 'getCollectionInfos':
      return { kind: 'collectionInfos', database, filter: documentArgument(first, name) }
    case 'stats':
      return { kind: 'databaseStats', database }
    case 'version':
      return { kind: 'command', database, admin: true, command: { buildInfo: 1 } }
    case 'serverStatus':
      return { kind: 'command', database, admin: true, command: { serverStatus: 1 } }
    case 'hostInfo':
      return { kind: 'command', database, admin: true, command: { hostInfo: 1 } }
    case 'runCommand':
    case 'adminCommand': {
      const command = documentArgument(first, name)
      assertReadCommand(command)
      return { kind: 'command', database, admin: name === 'adminCommand', command }
    }
    default:
      throw new MongoShellSyntaxError(`db.${name}() is not something Orca can run.`, step.node)
  }
}

function collectionOperation(target: InDatabase, steps: Step[], at: Node): MongoOperation {
  const [call, ...rest] = steps
  if (!call || call.kind !== 'call') {
    throw new MongoShellSyntaxError(
      `Call a method on ${target.collection}, e.g. .find({}).`,
      call?.node ?? at
    )
  }
  if (WRITE_METHODS.has(call.name)) {
    throw new MongoReadOnlyRefusal(`${call.name}()`)
  }
  const onlyCall = (): void => {
    const extra = rest.find((step) => !(step.kind === 'call' && step.name === 'pretty'))
    if (extra) {
      throw new MongoShellSyntaxError(`Nothing can follow ${call.name}().`, extra.node)
    }
  }
  const [first, second] = call.args
  switch (call.name) {
    case 'find':
    case 'findOne':
      return findOperation(target, call, rest, call.name === 'findOne')
    case 'aggregate':
      return aggregateOperation(target, call, rest)
    case 'countDocuments':
    case 'count':
      onlyCall()
      return {
        ...target,
        kind: 'countDocuments',
        filter: documentArgument(first, 'The filter'),
        options: documentArgument(second, 'The options')
      }
    case 'estimatedDocumentCount':
      onlyCall()
      return { ...target, kind: 'estimatedCount' }
    case 'distinct':
      onlyCall()
      return {
        ...target,
        kind: 'distinct',
        field: stringArgument(first, 'distinct()', call.node),
        filter: documentArgument(second, 'The filter')
      }
    case 'getIndexes':
    case 'getIndexSpecs':
      onlyCall()
      return { ...target, kind: 'indexes' }
    case 'stats':
      onlyCall()
      return { ...target, kind: 'collectionStats' }
    default:
      throw new MongoShellSyntaxError(
        `.${call.name}() is not a collection method Orca can run.`,
        call.node
      )
  }
}

function operationFromChain({ database, steps, at }: ChainContext): MongoOperation {
  const [head, ...rest] = steps
  if (!head) {
    throw new MongoShellSyntaxError('Say what to read, e.g. db.users.find({}).', at)
  }
  if (head.kind === 'call' && head.name === 'getSiblingDB') {
    return operationFromChain({
      database: stringArgument(head.args[0], 'getSiblingDB()', head.node),
      steps: rest,
      at: head.node
    })
  }
  if (head.kind === 'call' && head.name === 'getCollection') {
    const collection = stringArgument(head.args[0], 'getCollection()', head.node)
    return collectionOperation({ database, collection }, rest, head.node)
  }
  if (head.kind === 'call') {
    if (rest.length > 0) {
      throw new MongoShellSyntaxError(`Nothing can follow db.${head.name}().`, rest[0].node)
    }
    return databaseOperation(head.name, head, database)
  }
  // Why join: `db.system.version.find()` names the collection "system.version", as in mongosh.
  const firstCall = rest.findIndex((step) => step.kind === 'call')
  const names = firstCall === -1 ? rest : rest.slice(0, firstCall)
  const collection = [head.name, ...names.map((step) => step.name)].join('.')
  return collectionOperation(
    { database, collection },
    firstCall === -1 ? [] : rest.slice(firstCall),
    names.at(-1)?.node ?? head.node
  )
}

function parseFailure(error: unknown): MongoShellSyntaxError {
  const position =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'pos') : undefined
  const message =
    error instanceof Error ? error.message.replace(/\s*\(\d+:\d+\)$/, '') : String(error)
  return new MongoShellSyntaxError(message, typeof position === 'number' ? position : 0)
}

/** One console statement as the operation it asks for. */
export function parseMongoStatement(statement: string): MongoOperation {
  const text = statement.trim()
  const show = SHOW.exec(text)
  if (show) {
    const what = show[1].toLowerCase()
    return what === 'dbs' || what === 'databases'
      ? { kind: 'showDatabases' }
      : { kind: 'showCollections', database: undefined }
  }
  const use = USE.exec(text)
  if (use) {
    return { kind: 'use', database: use[1] }
  }
  let program: Program
  try {
    program = parse(statement, { ecmaVersion: 'latest', sourceType: 'script' })
  } catch (error) {
    throw parseFailure(error)
  }
  const [first, ...others] = program.body
  if (!first || others.length > 0 || first.type !== 'ExpressionStatement') {
    throw new MongoShellSyntaxError(
      'Run one statement at a time, e.g. db.users.find({}).',
      others[0] ?? first ?? 0
    )
  }
  const chain = chainOf(first.expression)
  if (chain.root !== 'db') {
    throw new MongoShellSyntaxError('Start with db, e.g. db.users.find({}).', chain.rootNode)
  }
  return operationFromChain({ database: undefined, steps: chain.steps, at: chain.rootNode })
}

/** Why a statement is refused as a write, or null when it reads (or doesn't parse). */
export function mongoReadOnlyViolation(statement: string): string | null {
  try {
    parseMongoStatement(statement)
    return null
  } catch (error) {
    return error instanceof MongoReadOnlyRefusal ? error.message : null
  }
}
