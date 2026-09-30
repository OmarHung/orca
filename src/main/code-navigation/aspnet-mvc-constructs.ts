import type {
  CodeNavigationDocument,
  CodeNavigationPosition
} from '../../shared/code-navigation/code-navigation-types'

/** Where a view, controller or action reference was written, as far as ASP.NET conventions go. */
export type MvcContext = { controller: string | null; area: string | null; action: string | null }

export type MvcConstruct =
  /** `name: null` means the action's own view (`return View()`). */
  | { kind: 'view'; name: string | null; partial: boolean; context: MvcContext }
  | { kind: 'action'; action: string; controller: string | null; area: string | null }
  | { kind: 'controller'; controller: string; area: string | null }

type Literal = { value: string; quoteIndex: number }
type Call = { callee: string; args: string[]; argIndex: number }

// Why bounded: a call's argument list is short; never scan a whole file per keystroke.
const MAX_CALL_SCAN_CHARS = 2_000
const VIEW_METHODS = new Set(['View', 'PartialView'])
const PARTIAL_HELPERS = new Set(['Partial', 'PartialAsync', 'RenderPartial', 'RenderPartialAsync'])
const METHOD_SIGNATURE =
  /^\s*(?:\[[^\]]*\]\s*)*(?:(?:public|protected|internal|private|static|virtual|override|async|new|sealed)\s+)+[\w<>[\],.?\s]*?\b([A-Za-z_]\w*)\s*\(/

function offsetAt(text: string, position: CodeNavigationPosition): number {
  let offset = 0
  for (let line = 0; line < position.line; line += 1) {
    const next = text.indexOf('\n', offset)
    if (next === -1) {
      return text.length
    }
    offset = next + 1
  }
  return offset + position.character
}

// What precedes an argument or attribute value: `(`, `,`, `=` or a named argument's `:`.
const VALUE_OPENING = /[(,=:]\s*@?$/

/**
 * The innermost string literal around `offset` on its line. Innermost, because Razor nests C#
 * strings inside attribute quotes (`href="@Url.Action("Details")"`); views also allow `'`.
 */
function literalAt(text: string, offset: number, quotes: string): Literal | null {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  const lineEnd = text.indexOf('\n', offset)
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd)
  const column = offset - lineStart
  let best: Literal | null = null
  for (const quote of quotes) {
    const open = line.lastIndexOf(quote, column - 1)
    const close = line.indexOf(quote, column)
    if (open === -1 || close === -1) {
      continue
    }
    const value = line.slice(open + 1, close)
    // Why the opening check: between two strings the nearest quotes enclose `, ` instead.
    if ([...quotes].some((q) => value.includes(q)) || !VALUE_OPENING.test(line.slice(0, open))) {
      continue
    }
    if (!best || lineStart + open > best.quoteIndex) {
      best = { value, quoteIndex: lineStart + open }
    }
  }
  return best
}

/** Top-level arguments of the call whose `(` is at `openIndex`, as written. */
function argumentsFrom(text: string, openIndex: number): string[] {
  const args: string[] = []
  let depth = 0
  let quote: string | null = null
  let start = openIndex + 1
  const end = Math.min(text.length, openIndex + MAX_CALL_SCAN_CHARS)
  for (let index = openIndex + 1; index < end; index += 1) {
    const char = text[index]
    if (quote) {
      if (char === '\\') {
        index += 1
      } else if (char === quote) {
        quote = null
      }
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '(' || char === '[' || char === '{') {
      depth += 1
    } else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) {
        const last = text.slice(start, index).trim()
        // Why: `View()` has no arguments, not one empty one.
        return last.length > 0 || args.length > 0 ? [...args, last] : []
      }
      depth -= 1
    } else if (char === ',' && depth === 0) {
      args.push(text.slice(start, index).trim())
      start = index + 1
    }
  }
  return args
}

/** The call a literal is an argument of, with the literal's argument position. */
function callAround(text: string, quoteIndex: number): Call | null {
  let depth = 0
  let commas = 0
  const stop = Math.max(0, quoteIndex - MAX_CALL_SCAN_CHARS)
  for (let index = quoteIndex - 1; index >= stop; index -= 1) {
    const char = text[index]
    if (char === '"') {
      // Why: an earlier string argument ("Hello, world") must not count as extra arguments.
      let opening = text.lastIndexOf('"', index - 1)
      while (opening > 0 && text[opening - 1] === '\\') {
        opening = text.lastIndexOf('"', opening - 1)
      }
      if (opening < stop) {
        return null
      }
      index = opening
    } else if (char === ')' || char === ']') {
      depth += 1
    } else if (char === '(' || char === '[') {
      if (depth === 0) {
        const callee = /([A-Za-z_][\w.]*)\s*$/.exec(text.slice(Math.max(0, index - 200), index))
        return callee
          ? { callee: callee[1], args: argumentsFrom(text, index), argIndex: commas }
          : null
      }
      depth -= 1
    } else if (char === ',' && depth === 0) {
      commas += 1
    } else if ((char === ';' || char === '{' || char === '}') && depth === 0) {
      return null
    }
  }
  return null
}

/** A plain string literal argument (optionally named, e.g. `controllerName: "Home"`). */
function literalValue(arg: string | undefined): string | null {
  const match = arg ? /^(?:\w+\s*:\s*)?@?"((?:[^"\\]|\\.)*)"$/.exec(arg) : null
  return match ? match[1] : null
}

type Tag = { name: string; text: string; attributeAtQuote: string | null }

function tagAround(text: string, quoteIndex: number): Tag | null {
  const open = text.lastIndexOf('<', quoteIndex)
  if (open === -1 || text.lastIndexOf('>', quoteIndex) > open) {
    return null
  }
  const close = text.indexOf('>', quoteIndex)
  const tagText = text.slice(open, close === -1 ? text.length : close + 1)
  const name = /^<\s*([\w:-]+)/.exec(tagText)
  const attribute = /([\w:-]+)\s*=\s*$/.exec(text.slice(open, quoteIndex))
  return name ? { name: name[1], text: tagText, attributeAtQuote: attribute?.[1] ?? null } : null
}

function tagAttribute(tag: Tag, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`).exec(tag.text)
  return match ? match[2] : null
}

/** `Views/{Controller}/…` or `Areas/{Area}/Views/{Controller}/…`; Shared views have no controller. */
function viewContext(path: string): MvcContext {
  const normalized = path.replace(/\\/g, '/')
  const inArea = /(?:^|\/)Areas\/([^/]+)\/Views\/([^/]+)\/[^/]+$/.exec(normalized)
  const inViews = /(?:^|\/)Views\/([^/]+)\/[^/]+$/.exec(normalized)
  const folder = inArea?.[2] ?? inViews?.[1] ?? null
  return {
    area: inArea?.[1] ?? null,
    controller: folder && folder !== 'Shared' ? folder : null,
    action: null
  }
}

/** The controller class, its `[Area]`, and the action method enclosing `offset`. */
function controllerContext(text: string, offset: number): MvcContext {
  const before = text.slice(0, offset)
  const classes = [...before.matchAll(/\bclass\s+([A-Za-z_]\w*?)Controller\b/g)]
  const lastClass = classes.at(-1)
  const areaText = lastClass
    ? before.slice(Math.max(0, (lastClass.index ?? 0) - 500), lastClass.index)
    : ''
  const areas = [...areaText.matchAll(/\[Area\(\s*"([^"]+)"\s*\)\]/g)]
  const lines = before.split('\n')
  let action: string | null = null
  for (let index = lines.length - 1; index >= 0 && !action; index -= 1) {
    if (/\bclass\s/.test(lines[index])) {
      break
    }
    const method = METHOD_SIGNATURE.exec(lines[index])
    if (method) {
      const attributes = lines.slice(Math.max(0, index - 5), index + 1).join('\n')
      action = /\[ActionName\(\s*"([^"]+)"\s*\)\]/.exec(attributes)?.[1] ?? method[1]
    }
  }
  return { controller: lastClass?.[1] ?? null, area: areas.at(-1)?.[1] ?? null, action }
}

function fromTagHelper(tag: Tag, literal: Literal, context: MvcContext): MvcConstruct | null {
  const area = tagAttribute(tag, 'asp-area') ?? context.area
  const attribute = tag.attributeAtQuote
  if (attribute === 'asp-action') {
    return {
      kind: 'action',
      action: literal.value,
      controller: tagAttribute(tag, 'asp-controller') ?? context.controller,
      area
    }
  }
  if (attribute === 'asp-controller') {
    return { kind: 'controller', controller: literal.value, area }
  }
  return attribute === 'name' && tag.name === 'partial'
    ? { kind: 'view', name: literal.value, partial: true, context }
    : null
}

/** Action/controller string arguments of the routing helpers, by helper name. */
const ROUTE_ARGUMENTS: Record<string, { action: number; controller: number }> = {
  RedirectToAction: { action: 0, controller: 1 },
  RedirectToActionPermanent: { action: 0, controller: 1 },
  Action: { action: 0, controller: 1 },
  ActionLink: { action: 1, controller: 2 },
  BeginForm: { action: 0, controller: 1 }
}

function fromCall(
  call: Call,
  literal: Literal,
  context: MvcContext,
  isView: boolean
): MvcConstruct | null {
  const name = call.callee.split('.').at(-1) ?? ''
  if (call.argIndex === 0 && !isView && VIEW_METHODS.has(name)) {
    return { kind: 'view', name: literal.value, partial: name === 'PartialView', context }
  }
  if (call.argIndex === 0 && PARTIAL_HELPERS.has(name)) {
    return { kind: 'view', name: literal.value, partial: true, context }
  }
  const route = ROUTE_ARGUMENTS[name]
  if (!route) {
    return null
  }
  const controller = literalValue(call.args[route.controller]) ?? context.controller
  if (call.argIndex === route.action) {
    return { kind: 'action', action: literal.value, controller, area: context.area }
  }
  return call.argIndex === route.controller
    ? { kind: 'controller', controller: literal.value, area: context.area }
    : null
}

/** `View(` / `PartialView(` under the cursor in a controller, with its view name if written. */
function fromViewCall(text: string, offset: number, context: MvcContext): MvcConstruct | null {
  let start = offset
  while (start > 0 && /\w/.test(text[start - 1])) {
    start -= 1
  }
  const word = /^\w+/.exec(text.slice(start))?.[0] ?? ''
  const open = /^\s*\(/.exec(text.slice(start + word.length))
  if (!VIEW_METHODS.has(word) || !open || text[start - 1] === '.') {
    return null
  }
  const openIndex = start + word.length + open[0].length - 1
  const name = literalValue(argumentsFrom(text, openIndex)[0])
  return { kind: 'view', name, partial: word === 'PartialView', context }
}

/**
 * The ASP.NET MVC reference under the cursor, if any: tag helpers (`asp-controller`,
 * `asp-action`, `<partial name>`) and `Layout` in views, `View()` and routing helpers
 * (`RedirectToAction`, `Url.Action`, `Html.ActionLink`, `Html.BeginForm`) in either.
 */
export function detectMvcConstruct(
  document: Pick<CodeNavigationDocument, 'path' | 'text'>,
  position: CodeNavigationPosition
): MvcConstruct | null {
  const { text } = document
  const offset = offsetAt(text, position)
  const isView = document.path.toLowerCase().endsWith('.cshtml')
  const context = isView ? viewContext(document.path) : controllerContext(text, offset)
  const literal = literalAt(text, offset, isView ? `"'` : '"')
  if (!literal) {
    return isView ? null : fromViewCall(text, offset, context)
  }
  if (isView) {
    const tag = tagAround(text, literal.quoteIndex)
    const fromTag = tag ? fromTagHelper(tag, literal, context) : null
    if (fromTag) {
      return fromTag
    }
    const lineStart = text.lastIndexOf('\n', literal.quoteIndex - 1) + 1
    if (/\bLayout\s*=\s*$/.test(text.slice(lineStart, literal.quoteIndex))) {
      return { kind: 'view', name: literal.value, partial: true, context }
    }
  }
  const call = callAround(text, literal.quoteIndex)
  return call ? fromCall(call, literal, context, isView) : null
}
