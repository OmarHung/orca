/** Readers for run configurations from orca.yaml or storage: bounded, trimmed, never trusted. */

export const MAX_TEXT_LENGTH = 16_000
const MAX_LIST_ENTRIES = 200
const ENV_NAME_PATTERN = /^[A-Za-z_][\w.]{0,199}$/

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : null
}

export function asText(value: unknown, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed && trimmed.length <= maxLength ? trimmed : undefined
}

export function asTextList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_LIST_ENTRIES) {
    return undefined
  }
  const items = value
    .map((item) => (typeof item === 'number' ? String(item) : asText(item)))
    .filter((item): item is string => item !== undefined)
  const unique = [...new Set(items)]
  return unique.length > 0 ? unique : undefined
}

/** Program args keep empty strings and surrounding spaces; they are passed verbatim. */
export function asArgs(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_LIST_ENTRIES) {
    return undefined
  }
  const args = value
    .map((item) => (typeof item === 'number' ? String(item) : item))
    .filter((item): item is string => typeof item === 'string' && item.length <= MAX_TEXT_LENGTH)
  return args.length > 0 ? args : undefined
}

export function asEnv(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value)
  if (!record) {
    return undefined
  }
  const env: Record<string, string> = {}
  for (const [name, raw] of Object.entries(record).slice(0, MAX_LIST_ENTRIES)) {
    const text = typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : raw
    if (ENV_NAME_PATTERN.test(name) && typeof text === 'string' && text.length <= MAX_TEXT_LENGTH) {
      env[name] = text
    }
  }
  return Object.keys(env).length > 0 ? env : undefined
}
