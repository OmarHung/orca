import type { BinaryOperator, Expression, Node, Property, SpreadElement } from 'acorn'
import {
  Binary,
  BSONRegExp,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
  UUID
} from 'mongodb'

/**
 * Turns the literal parts of a mongosh statement (filters, pipelines, options) into values
 * the driver sends. Only literals, objects, arrays, arithmetic on numbers and the shell's
 * type constructors are understood; nothing is evaluated, so a statement can't run code here.
 */

/** A statement Orca can't read; `position` is 1-based within the statement. */
export class MongoShellSyntaxError extends Error {
  readonly position: number

  constructor(message: string, node: Pick<Node, 'start'> | number) {
    super(message)
    this.position = (typeof node === 'number' ? node : node.start) + 1
  }
}

/** A part of a statement that stands for a value: a method argument, field value or element. */
export type ShellNode = Expression | SpreadElement

function stringArgument(node: ShellNode | undefined, what: string, at: Node): string {
  const value = node ? shellValue(node) : undefined
  if (typeof value !== 'string') {
    throw new MongoShellSyntaxError(`${what} takes a string.`, node ?? at)
  }
  return value
}

function numberArgument(node: ShellNode | undefined, what: string, at: Node): number {
  const value = node ? shellValue(node) : undefined
  const number = typeof value === 'string' ? Number(value) : value
  if (typeof number !== 'number' || Number.isNaN(number)) {
    throw new MongoShellSyntaxError(`${what} takes a number.`, node ?? at)
  }
  return number
}

function dateFrom(args: ShellNode[], at: Node): Date {
  if (args.length === 0) {
    return new Date()
  }
  const first = shellValue(args[0])
  // Why local time for parts: `new Date(2024, 0, 1)` means that in JavaScript and mongosh.
  const parts = args.map((arg) => (args.length > 1 ? numberArgument(arg, 'Date', at) : 0))
  const date =
    args.length > 1
      ? new Date(
          parts[0],
          parts[1],
          parts[2] ?? 1,
          parts[3] ?? 0,
          parts[4] ?? 0,
          parts[5] ?? 0,
          parts[6] ?? 0
        )
      : new Date(typeof first === 'number' || typeof first === 'string' ? first : Number.NaN)
  if (Number.isNaN(date.getTime())) {
    throw new MongoShellSyntaxError('Not a valid date.', args[0])
  }
  return date
}

function timestampFrom(args: ShellNode[], at: Node): Timestamp {
  const first = args[0] ? shellValue(args[0]) : undefined
  if (first && typeof first === 'object' && 't' in first && 'i' in first) {
    return new Timestamp({ t: Number(first.t), i: Number(first.i) })
  }
  return new Timestamp({
    t: numberArgument(args[0], 'Timestamp', at),
    i: numberArgument(args[1], 'Timestamp', at)
  })
}

/** The shell's constructors, by name; each reads its own arguments. */
const CONSTRUCTORS: Record<string, (args: ShellNode[], at: Node) => unknown> = {
  ObjectId: (args, at) => {
    if (args.length === 0) {
      return new ObjectId()
    }
    const hex = stringArgument(args[0], 'ObjectId', at)
    if (!ObjectId.isValid(hex) || hex.length !== 24) {
      throw new MongoShellSyntaxError('ObjectId takes 24 hexadecimal characters.', args[0])
    }
    return new ObjectId(hex)
  },
  ISODate: dateFrom,
  Date: dateFrom,
  NumberLong: (args, at) => Long.fromString(String(shellValue(args[0] ?? at))),
  Long: (args, at) => Long.fromString(String(shellValue(args[0] ?? at))),
  NumberInt: (args, at) => new Int32(numberArgument(args[0], 'NumberInt', at)),
  Int32: (args, at) => new Int32(numberArgument(args[0], 'Int32', at)),
  Double: (args, at) => new Double(numberArgument(args[0], 'Double', at)),
  NumberDecimal: (args, at) => Decimal128.fromString(String(shellValue(args[0] ?? at))),
  Decimal128: (args, at) => Decimal128.fromString(String(shellValue(args[0] ?? at))),
  UUID: (args, at) =>
    args.length === 0 ? new UUID() : new UUID(stringArgument(args[0], 'UUID', at)),
  BinData: (args, at) =>
    new Binary(
      Buffer.from(stringArgument(args[1], 'BinData', at), 'base64'),
      numberArgument(args[0], 'BinData', at)
    ),
  HexData: (args, at) =>
    new Binary(
      Buffer.from(stringArgument(args[1], 'HexData', at), 'hex'),
      numberArgument(args[0], 'HexData', at)
    ),
  Timestamp: timestampFrom,
  RegExp: (args, at) =>
    new BSONRegExp(
      stringArgument(args[0], 'RegExp', at),
      args[1] ? stringArgument(args[1], 'RegExp', at) : ''
    ),
  MinKey: () => new MinKey(),
  MaxKey: () => new MaxKey()
}

const NAMED_VALUES: Record<string, unknown> = {
  Infinity: Number.POSITIVE_INFINITY,
  NaN: Number.NaN,
  undefined: null,
  MinKey: new MinKey(),
  MaxKey: new MaxKey()
}

function propertyKey(property: Property): string {
  const { key } = property
  if (!property.computed && key.type === 'Identifier') {
    return key.name
  }
  if (key.type === 'Literal' && (typeof key.value === 'string' || typeof key.value === 'number')) {
    return String(key.value)
  }
  throw new MongoShellSyntaxError('Field names must be plain names or strings.', key)
}

function objectValue(
  node: Extract<Expression, { type: 'ObjectExpression' }>
): Record<string, unknown> {
  const object: Record<string, unknown> = {}
  for (const property of node.properties) {
    if (property.type === 'SpreadElement' || property.kind !== 'init' || property.method) {
      throw new MongoShellSyntaxError('Only `field: value` pairs are allowed here.', property)
    }
    if (property.shorthand) {
      throw new MongoShellSyntaxError('Give the field a value, e.g. `name: "Ada"`.', property)
    }
    // Why defineProperty: a field named __proto__ must stay a field, not replace the prototype.
    Object.defineProperty(object, propertyKey(property), {
      value: shellValue(property.value),
      enumerable: true,
      writable: true,
      configurable: true
    })
  }
  return object
}

const ARITHMETIC: Partial<Record<BinaryOperator, (left: number, right: number) => number>> = {
  '+': (left, right) => left + right,
  '-': (left, right) => left - right,
  '*': (left, right) => left * right,
  '/': (left, right) => left / right,
  '%': (left, right) => left % right
}

function binaryValue(node: Extract<Expression, { type: 'BinaryExpression' }>): number {
  const left = node.left.type === 'PrivateIdentifier' ? undefined : shellValue(node.left)
  const right = shellValue(node.right)
  const apply = ARITHMETIC[node.operator]
  if (!apply) {
    throw new MongoShellSyntaxError(`The ${node.operator} operator isn't supported here.`, node)
  }
  if (typeof left !== 'number' || typeof right !== 'number') {
    throw new MongoShellSyntaxError('Arithmetic works on numbers only.', node)
  }
  return apply(left, right)
}

function callValue(
  node: Extract<Expression, { type: 'CallExpression' | 'NewExpression' }>
): unknown {
  const { callee } = node
  // Date.now(), which mongosh users reach for in date filters.
  if (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'Date' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'now' &&
    node.arguments.length === 0
  ) {
    return Date.now()
  }
  const name = callee.type === 'Identifier' ? callee.name : null
  const construct = name && Object.hasOwn(CONSTRUCTORS, name) ? CONSTRUCTORS[name] : undefined
  if (!construct) {
    throw new MongoShellSyntaxError(
      'Only the shell’s value constructors (ObjectId, ISODate, NumberLong, …) can be called here.',
      callee
    )
  }
  // Why `Date()` alone is a string: that is what JavaScript (and mongosh) returns.
  if (name === 'Date' && node.type === 'CallExpression') {
    return new Date().toString()
  }
  return construct(node.arguments, node)
}

function literalValue(node: Extract<Expression, { type: 'Literal' }>): unknown {
  if (node.regex) {
    return new BSONRegExp(node.regex.pattern, node.regex.flags)
  }
  return typeof node.value === 'bigint' ? Long.fromBigInt(node.value) : node.value
}

function arrayValue(node: Extract<Expression, { type: 'ArrayExpression' }>): unknown[] {
  return node.elements.map((element) => {
    if (element === null || element.type === 'SpreadElement') {
      throw new MongoShellSyntaxError('Arrays take plain values here.', element ?? node)
    }
    return shellValue(element)
  })
}

function unaryValue(node: Extract<Expression, { type: 'UnaryExpression' }>): unknown {
  const value = shellValue(node.argument)
  if ((node.operator === '-' || node.operator === '+') && typeof value === 'number') {
    return node.operator === '-' ? -value : value
  }
  if (node.operator === '-' && value instanceof Long) {
    return value.negate()
  }
  throw new MongoShellSyntaxError(`The ${node.operator} operator isn't supported here.`, node)
}

function templateValue(node: Extract<Expression, { type: 'TemplateLiteral' }>): string {
  if (node.expressions.length > 0) {
    throw new MongoShellSyntaxError('Template strings can’t hold ${…} here.', node)
  }
  return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('')
}

function namedValue(node: Extract<Expression, { type: 'Identifier' }>): unknown {
  if (Object.hasOwn(NAMED_VALUES, node.name)) {
    return NAMED_VALUES[node.name]
  }
  throw new MongoShellSyntaxError(`Unknown name ${node.name}.`, node)
}

/** The value a literal part of a statement stands for. */
export function shellValue(node: ShellNode): unknown {
  if (node.type === 'Literal') {
    return literalValue(node)
  }
  if (node.type === 'ObjectExpression') {
    return objectValue(node)
  }
  if (node.type === 'ArrayExpression') {
    return arrayValue(node)
  }
  if (node.type === 'UnaryExpression') {
    return unaryValue(node)
  }
  if (node.type === 'BinaryExpression') {
    return binaryValue(node)
  }
  if (node.type === 'TemplateLiteral') {
    return templateValue(node)
  }
  if (node.type === 'Identifier') {
    return namedValue(node)
  }
  if (node.type === 'CallExpression' || node.type === 'NewExpression') {
    return callValue(node)
  }
  if (node.type === 'ParenthesizedExpression') {
    return shellValue(node.expression)
  }
  throw new MongoShellSyntaxError(
    'Only values (strings, numbers, objects, arrays…) are allowed here.',
    node
  )
}
