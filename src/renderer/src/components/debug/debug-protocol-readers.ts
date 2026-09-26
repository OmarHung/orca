import type { DebugProtocol } from '@vscode/debugprotocol'

// Why: adapter responses cross the IPC boundary as untyped JSON; pick known fields
// instead of casting so a misbehaving adapter can't put surprising shapes in state.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function records(body: unknown, key: string): Record<string, unknown>[] {
  const list = isRecord(body) ? body[key] : undefined
  return Array.isArray(list) ? list.filter(isRecord) : []
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function readThreadIds(body: unknown): number[] {
  return records(body, 'threads').flatMap((thread) =>
    typeof thread.id === 'number' ? [thread.id] : []
  )
}

export function readStackFrames(body: unknown): DebugProtocol.StackFrame[] {
  return records(body, 'stackFrames').flatMap((frame) => {
    if (
      typeof frame.id !== 'number' ||
      typeof frame.name !== 'string' ||
      typeof frame.line !== 'number'
    ) {
      return []
    }
    const source = isRecord(frame.source) ? frame.source : null
    const path = source ? optionalString(source.path) : undefined
    return [
      {
        id: frame.id,
        name: frame.name,
        line: frame.line,
        column: typeof frame.column === 'number' ? frame.column : 1,
        ...(source ? { source: { name: optionalString(source.name), path } } : {})
      }
    ]
  })
}

export function readScopes(body: unknown): DebugProtocol.Scope[] {
  return records(body, 'scopes').flatMap((scope) =>
    typeof scope.name === 'string' && typeof scope.variablesReference === 'number'
      ? [
          {
            name: scope.name,
            variablesReference: scope.variablesReference,
            expensive: scope.expensive === true
          }
        ]
      : []
  )
}

export function readVariables(body: unknown): DebugProtocol.Variable[] {
  return records(body, 'variables').flatMap((variable) =>
    typeof variable.name === 'string' &&
    typeof variable.value === 'string' &&
    typeof variable.variablesReference === 'number'
      ? [
          {
            name: variable.name,
            value: variable.value,
            type: optionalString(variable.type),
            variablesReference: variable.variablesReference
          }
        ]
      : []
  )
}

export type DebugOutputCategory = 'stdout' | 'stderr' | 'console'

/** Returns null for categories the console should not show (e.g. telemetry). */
export function readOutputEvent(
  body: unknown
): { category: DebugOutputCategory; text: string } | null {
  if (!isRecord(body) || typeof body.output !== 'string') {
    return null
  }
  const category = body.category ?? 'console'
  if (category === 'telemetry' || category === 'important') {
    return null
  }
  return {
    category: category === 'stdout' || category === 'stderr' ? category : 'console',
    text: body.output
  }
}

export function readStoppedEvent(
  body: unknown
): { threadId: number | null; reason: string } | null {
  if (!isRecord(body) || typeof body.reason !== 'string') {
    return null
  }
  return { threadId: typeof body.threadId === 'number' ? body.threadId : null, reason: body.reason }
}

export type EvaluateResult = { value: string; type?: string; variablesReference: number }

/** An `evaluate` response, or null when the adapter sent nothing usable. */
export function readEvaluateResult(body: unknown): EvaluateResult | null {
  if (!isRecord(body) || typeof body.result !== 'string') {
    return null
  }
  return {
    value: body.result,
    type: optionalString(body.type),
    variablesReference: typeof body.variablesReference === 'number' ? body.variablesReference : 0
  }
}
