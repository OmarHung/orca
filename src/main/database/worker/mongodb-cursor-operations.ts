import { isDocument } from './mongodb-documents'
import type {
  CallStep,
  InDatabase,
  MongoExplainVerbosity,
  MongoFindOptions,
  MongoOperation,
  Step
} from './mongodb-operation-types'
import { assertReadOnlyValue } from './mongodb-read-only-rules'
import {
  collationArgument,
  documentArgument,
  explainVerbosity,
  numberArgument
} from './mongodb-shell-arguments'
import { MongoShellSyntaxError, shellValue } from './mongodb-shell-values'

/** find() and aggregate() with the cursor methods mongosh chains after them. */

const CURSOR_OPTIONS: Record<string, keyof MongoFindOptions> = {
  sort: 'sort',
  skip: 'skip',
  limit: 'limit',
  projection: 'projection',
  project: 'projection',
  hint: 'hint',
  collation: 'collation',
  maxTimeMS: 'maxTimeMS',
  comment: 'comment'
}

export function findOperation(
  target: InDatabase,
  call: CallStep,
  rest: Step[],
  one: boolean
): MongoOperation {
  const [filterNode, projectionNode] = call.args
  let options: MongoFindOptions = {
    ...(projectionNode ? { projection: documentArgument(projectionNode, 'The projection') } : {}),
    ...(one ? { limit: 1 } : {})
  }
  let count: 'none' | 'all' | 'window' = 'none'
  let explain: MongoExplainVerbosity | null = null
  for (const step of rest) {
    if (step.kind !== 'call') {
      throw new MongoShellSyntaxError(
        `Expected a cursor method after find(), not .${step.name}.`,
        step.node
      )
    }
    const option = Object.hasOwn(CURSOR_OPTIONS, step.name) ? CURSOR_OPTIONS[step.name] : undefined
    const [argument] = step.args
    if (option === 'skip' || option === 'limit' || option === 'maxTimeMS') {
      options = { ...options, [option]: numberArgument(argument, step.name, step.node) }
    } else if (option === 'hint') {
      const hint = argument ? shellValue(argument) : undefined
      options = {
        ...options,
        hint: typeof hint === 'string' ? hint : documentArgument(argument, 'hint')
      }
    } else if (option === 'comment') {
      options = { ...options, comment: argument ? shellValue(argument) : undefined }
    } else if (option === 'collation') {
      options = { ...options, collation: collationArgument(argument, step.node) }
    } else if (option === 'sort' || option === 'projection') {
      options = { ...options, [option]: documentArgument(argument, step.name) }
    } else if (step.name === 'count' || step.name === 'size') {
      count = step.name === 'count' ? 'all' : 'window'
    } else if (step.name === 'explain') {
      explain = explainVerbosity(argument)
    } else if (
      !['toArray', 'pretty', 'batchSize', 'allowDiskUse', 'noCursorTimeout'].includes(step.name)
    ) {
      throw new MongoShellSyntaxError(
        `.${step.name}() is not a cursor method Orca knows.`,
        step.node
      )
    }
  }
  return {
    ...target,
    kind: 'find',
    filter: documentArgument(filterNode, 'The filter'),
    options,
    count,
    explain
  }
}

export function aggregateOperation(
  target: InDatabase,
  call: CallStep,
  rest: Step[]
): MongoOperation {
  const [pipelineNode, optionsNode] = call.args
  const pipeline = pipelineNode ? shellValue(pipelineNode) : []
  if (!Array.isArray(pipeline) || !pipeline.every(isDocument)) {
    throw new MongoShellSyntaxError(
      'aggregate() takes an array of stages.',
      pipelineNode ?? call.node
    )
  }
  assertReadOnlyValue(pipeline)
  const options = documentArgument(optionsNode, 'The options')
  assertReadOnlyValue(options)
  let explain: MongoExplainVerbosity | null = null
  for (const step of rest) {
    if (step.kind === 'call' && step.name === 'explain') {
      explain = explainVerbosity(step.args[0])
    } else if (!(step.kind === 'call' && ['toArray', 'pretty'].includes(step.name))) {
      throw new MongoShellSyntaxError(`.${step.name} can't follow aggregate().`, step.node)
    }
  }
  return { ...target, kind: 'aggregate', pipeline, options, explain }
}
