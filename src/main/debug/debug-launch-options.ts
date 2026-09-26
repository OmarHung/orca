import type { DebugLaunchOptions } from '../../shared/debug/debug-session-types'

function envRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : {}
}

/** Layers a run configuration's args/env over the launch arguments an adapter built. */
export function applyDebugLaunchOptions(
  launchArguments: Record<string, unknown>,
  options: DebugLaunchOptions | undefined
): Record<string, unknown> {
  if (!options) {
    return launchArguments
  }
  return {
    ...launchArguments,
    ...(options.args ? { args: [...options.args] } : {}),
    ...(options.env ? { env: { ...envRecord(launchArguments.env), ...options.env } } : {})
  }
}
