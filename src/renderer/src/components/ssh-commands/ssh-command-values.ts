import { z } from 'zod'
import type { SshCommandParam } from '../../../../shared/ssh-command-types'

// Why localStorage: last-used values are a convenience on this device, not part of the command.
const STORAGE_KEY = 'orca.sshCommandValues'

const StoredValuesSchema = z.record(z.string(), z.record(z.string(), z.string()))

function readAll(): Record<string, Record<string, string>> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = StoredValuesSchema.safeParse(raw ? JSON.parse(raw) : {})
    return parsed.success ? parsed.data : {}
  } catch {
    // Corrupt or unavailable storage just starts from the defaults.
    return {}
  }
}

function writeAll(values: Record<string, Record<string, string>>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values))
  } catch {
    // Storage can be unavailable; the values just won't be remembered.
  }
}

/** What the form starts with: the value used last, or the default if that no longer applies. */
export function initialSshCommandValues(
  commandId: string,
  params: readonly SshCommandParam[]
): Record<string, string> {
  const remembered = readAll()[commandId] ?? {}
  return Object.fromEntries(
    params.map((param) => {
      // Why hasOwn: a parameter may be called `constructor`, which every object would answer for.
      const value = Object.hasOwn(remembered, param.key) ? remembered[param.key] : undefined
      const isUsable =
        value !== undefined && (param.kind !== 'select' || (param.options ?? []).includes(value))
      return [param.key, isUsable ? value : param.defaultValue]
    })
  )
}

export function rememberSshCommandValues(
  commandId: string,
  values: Readonly<Record<string, string>>
): void {
  writeAll({ ...readAll(), [commandId]: { ...values } })
}

export function forgetSshCommandValues(commandId: string): void {
  writeAll(Object.fromEntries(Object.entries(readAll()).filter(([id]) => id !== commandId)))
}
