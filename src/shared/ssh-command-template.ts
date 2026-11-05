import { quotePosixShellUnlessPlain } from './shell-argument-quoting'
import {
  hasSshCommandControlCharacter,
  SSH_COMMAND_KEY_PATTERN,
  type SshCommandParam
} from './ssh-command-types'
import type { SshRemotePlatform } from './ssh-types'

const BRACE_TOKEN = /\{\{([^{}]*)\}\}/g
const PLAIN_VALUE = /^[A-Za-z0-9_./@:-]+$/
const NUMBER_VALUE = /^-?\d+(\.\d+)?$/

const CLOCK_KEYS: ReadonlySet<string> = new Set(['date', 'time'])
const BUILTIN_KEYS: ReadonlySet<string> = new Set([
  'host',
  'user',
  'path',
  'selected',
  ...CLOCK_KEYS
])

export type SshCommandBuiltins = {
  host: string
  user: string
  /** The folder the tab's files pane shows; null until it has been opened. */
  path: string | null
  selected: readonly string[]
}

export type SshCommandExpansionInput = {
  template: string
  params: readonly SshCommandParam[]
  values: Readonly<Record<string, string>>
  builtins: SshCommandBuiltins
  /** The moment `{{date}}` and `{{time}}` show, on the computer running Orca. */
  now: Date
  remotePlatform?: SshRemotePlatform
  /** Going to several hosts, where one tab's folder and selection mean nothing. */
  isMultiTarget?: boolean
}

export type SshCommandProblem = {
  kind:
    | 'missingValue'
    | 'controlCharacter'
    | 'notANumber'
    | 'notAnOption'
    | 'windowsNeedsRaw'
    | 'insideQuotes'
    | 'singleTargetOnly'
    | 'noPath'
    | 'noSelection'
    | 'undefinedParam'
  key: string
}

export type SshCommandWarning = { kind: 'leadingDash' | 'rawValue'; key: string }

export type SshCommandExpansion = {
  /** What would be sent. Anything with a problem stays as `{{key}}`, so it can't be mistaken. */
  command: string
  /** Any entry here means the command must not be sent. */
  problems: SshCommandProblem[]
  warnings: SshCommandWarning[]
}

/** Digits only, so unlike other values these can't close quotes around them. */
export function isSshCommandClockKey(key: string): boolean {
  return CLOCK_KEYS.has(key)
}

/** Each parameter once, in the order written. Built-in values are included. */
export function extractSshCommandKeys(template: string): string[] {
  const keys = [...template.matchAll(BRACE_TOKEN)]
    .map((match) => match[1])
    .filter((key) => SSH_COMMAND_KEY_PATTERN.test(key))
  return [...new Set(keys)]
}

/** `{{...}}` that isn't a parameter, which is sent as written. */
export function literalBraceTokens(template: string): string[] {
  return [...template.matchAll(BRACE_TOKEN)]
    .filter((match) => !SSH_COMMAND_KEY_PATTERN.test(match[1]))
    .map((match) => match[0])
}

/** Where each character leaves the quoting state, honoring `\\` and `$'...'` as a shell would. */
function nextQuoteState(
  text: string,
  start: number,
  end: number,
  state: { quote: "'" | '"' | "$'" | null }
): void {
  let index = start
  while (index < end) {
    const character = text[index]
    const isEscapable = state.quote !== "'"
    if (character === '\\' && isEscapable) {
      index += 2
      continue
    }
    if (state.quote === null) {
      if (character === "'") {
        state.quote = text[index - 1] === '$' ? "$'" : "'"
      } else if (character === '"') {
        state.quote = '"'
      }
    } else if (character === (state.quote === '"' ? '"' : "'")) {
      state.quote = null
    }
    index += 1
  }
}

/**
 * Parameters written inside quotes. Their value would get its own quotes in there, which closes the
 * author's instead of protecting anything: `"{{x}}"` with `a"; b; "` runs `b`.
 */
export function findQuotedSshCommandKeys(template: string): string[] {
  const found = new Set<string>()
  const state: { quote: "'" | '"' | "$'" | null } = { quote: null }
  let position = 0
  for (const match of template.matchAll(BRACE_TOKEN)) {
    nextQuoteState(template, position, match.index, state)
    position = match.index + match[0].length
    if (state.quote !== null && SSH_COMMAND_KEY_PATTERN.test(match[1])) {
      found.add(match[1])
    }
  }
  return [...found]
}

function newSshCommandParam(key: string): SshCommandParam {
  return { key, label: key, kind: 'text', defaultValue: '', required: true, quote: 'shell' }
}

function isUntouchedParam(param: SshCommandParam): boolean {
  const untouched = newSshCommandParam(param.key)
  return (
    param.options === undefined &&
    param.label === untouched.label &&
    param.kind === untouched.kind &&
    param.defaultValue === untouched.defaultValue &&
    param.required === untouched.required &&
    param.quote === untouched.quote
  )
}

/**
 * The rows the editor shows: the template's parameters first, then any no longer in it. A row
 * nobody filled in leaves with its parameter, or retyping a name would leave a trail of rows.
 */
export function syncSshCommandParams(
  template: string,
  params: readonly SshCommandParam[]
): { params: SshCommandParam[]; unusedKeys: string[] } {
  const existing = new Map(params.map((param) => [param.key, param]))
  // Why: a command saved before these were built in must keep asking, not silently change.
  const used = extractSshCommandKeys(template).filter(
    (key) => !BUILTIN_KEYS.has(key) || (CLOCK_KEYS.has(key) && existing.has(key))
  )
  const usedSet = new Set(used)
  const unused = params.filter((param) => !usedSet.has(param.key) && !isUntouchedParam(param))
  return {
    params: [...used.map((key) => existing.get(key) ?? newSshCommandParam(key)), ...unused],
    unusedKeys: unused.map((param) => param.key)
  }
}

type KeyExpansion = { text: string | null; problem?: SshCommandProblem['kind'] }

function quoteForHost(value: string, isWindows: boolean): KeyExpansion {
  if (isWindows && !PLAIN_VALUE.test(value)) {
    return { text: null, problem: 'windowsNeedsRaw' }
  }
  return { text: isWindows ? value : quotePosixShellUnlessPlain(value) }
}

/** These come from the server, whose file names may hold anything, so they get the same check. */
function quoteBuiltinValue(value: string, isWindows: boolean): KeyExpansion {
  return hasSshCommandControlCharacter(value)
    ? { text: null, problem: 'controlCharacter' }
    : quoteForHost(value, isWindows)
}

function expandBuiltin(
  key: string,
  builtins: SshCommandBuiltins,
  isWindows: boolean
): KeyExpansion {
  if (key === 'selected') {
    if (builtins.selected.length === 0) {
      return { text: null, problem: 'noSelection' }
    }
    const parts = builtins.selected.map((value) => quoteBuiltinValue(value, isWindows))
    const failed = parts.find((part) => part.problem)
    return failed ?? { text: parts.map((part) => part.text).join(' ') }
  }
  const value = key === 'path' ? builtins.path : key === 'host' ? builtins.host : builtins.user
  if (value === null) {
    return { text: null, problem: 'noPath' }
  }
  if (value === '') {
    return { text: null, problem: 'missingValue' }
  }
  return quoteBuiltinValue(value, isWindows)
}

function clockValue(key: string, now: Date): string {
  const parts =
    key === 'date'
      ? [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      : [now.getHours(), now.getMinutes(), now.getSeconds()]
  return parts.map((part) => String(part).padStart(2, '0')).join('')
}

function expandParam(param: SshCommandParam, value: string, isWindows: boolean): KeyExpansion {
  if (value === '') {
    return param.required ? { text: null, problem: 'missingValue' } : { text: '' }
  }
  if (hasSshCommandControlCharacter(value)) {
    return { text: null, problem: 'controlCharacter' }
  }
  if (param.kind === 'number' && !NUMBER_VALUE.test(value)) {
    return { text: null, problem: 'notANumber' }
  }
  if (param.kind === 'select' && !(param.options ?? []).includes(value)) {
    return { text: null, problem: 'notAnOption' }
  }
  if (param.quote === 'raw') {
    return { text: value }
  }
  if (isWindows) {
    // Why: a number, or an option its author wrote for this shell, needs no quoting here.
    return param.kind === 'text' ? { text: null, problem: 'windowsNeedsRaw' } : { text: value }
  }
  return { text: quotePosixShellUnlessPlain(value) }
}

/**
 * One line to type, since a line break would press Enter on half a command. `\\` and a trailing
 * `&&`, `||` or `|` continue a command; a comment line would swallow everything joined after it.
 */
function flattenTemplateLines(template: string): string {
  return template
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .reduce((joined, line) => {
      if (joined === '') {
        return line
      }
      if (joined.endsWith('\\')) {
        return `${joined.slice(0, -1).trimEnd()} ${line}`
      }
      return /(&&|\|\||\|)$/.test(joined) ? `${joined} ${line}` : `${joined}; ${line}`
    }, '')
}

/** Fills a template in one pass, so a value can never bring in further parameters. */
export function expandSshCommandTemplate(input: SshCommandExpansionInput): SshCommandExpansion {
  const isWindows = input.remotePlatform === 'win32'
  const paramsByKey = new Map(input.params.map((param) => [param.key, param]))
  const problems: SshCommandProblem[] = []
  const warnings: SshCommandWarning[] = []
  const flattened = flattenTemplateLines(input.template)
  const quotedKeys = new Set(findQuotedSshCommandKeys(flattened))
  const addProblem = (kind: SshCommandProblem['kind'], key: string): void => {
    if (!problems.some((problem) => problem.key === key)) {
      problems.push({ kind, key })
    }
  }
  const addWarning = (kind: SshCommandWarning['kind'], key: string): void => {
    if (!warnings.some((warning) => warning.key === key && warning.kind === kind)) {
      warnings.push({ kind, key })
    }
  }
  const command = flattened.replace(BRACE_TOKEN, (token, key: string) => {
    if (!SSH_COMMAND_KEY_PATTERN.test(key)) {
      return token
    }
    const param = paramsByKey.get(key)
    if (!param && !BUILTIN_KEYS.has(key)) {
      addProblem('undefinedParam', key)
      return token
    }
    if (!param && CLOCK_KEYS.has(key)) {
      return clockValue(key, input.now)
    }
    if (quotedKeys.has(key) && param?.quote !== 'raw') {
      addProblem('insideQuotes', key)
      return token
    }
    if (!param && input.isMultiTarget && (key === 'path' || key === 'selected')) {
      addProblem('singleTargetOnly', key)
      return token
    }
    // Why hasOwn: a parameter may be called `constructor`, which every object would answer for.
    const typed = Object.hasOwn(input.values, key) ? input.values[key] : undefined
    const value = param ? (typed ?? param.defaultValue) : ''
    const expanded = param
      ? expandParam(param, value, isWindows)
      : expandBuiltin(key, input.builtins, isWindows)
    if (expanded.problem) {
      addProblem(expanded.problem, key)
      return token
    }
    // Why only free text: a number may be negative, and an option is what its author wrote.
    if (param?.kind === 'text' && param.quote === 'shell' && value.startsWith('-')) {
      addWarning('leadingDash', key)
    }
    if (param?.quote === 'raw' && value !== '') {
      addWarning('rawValue', key)
    }
    return expanded.text ?? token
  })
  return { command, problems, warnings }
}
