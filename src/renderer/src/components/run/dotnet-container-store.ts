import { create } from 'zustand'

const ENABLED_STORAGE_KEY = 'orca.dotnet.containerToolchain.v1'

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(ENABLED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function writeEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(ENABLED_STORAGE_KEY, String(enabled))
  } catch {
    // Storage can be unavailable; the choice then lasts only for this window.
  }
}

type DotnetContainerState = {
  /** Whether runs send .NET 5-and-older projects to Orca's Docker container. */
  enabled: boolean
  /** Null until loaded, or where the container cannot run (Windows, other CPUs). */
  launcherPath: string | null
  setEnabled: (enabled: boolean) => void
  loadLauncherPath: () => Promise<string | null>
}

// Why localStorage, not synced settings: the container and its launcher exist on this machine only.
export const useDotnetContainerStore = create<DotnetContainerState>((set) => ({
  enabled: readEnabled(),
  launcherPath: null,
  setEnabled: (enabled) => {
    set({ enabled })
    writeEnabled(enabled)
  },
  loadLauncherPath: async () => {
    const launcherPath = await window.api.dotnetContainer.launcherPath().catch(() => null)
    set({ launcherPath })
    return launcherPath
  }
}))
