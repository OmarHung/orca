import { create } from 'zustand'
import { useAppStore } from '@/store'

/** Whether runs, debugging and terminals send .NET 5-and-older projects to Orca's container. */
export function isDotnetContainerEnabled(): boolean {
  return useAppStore.getState().settings?.dotnetContainerToolchain === true
}

type DotnetContainerState = {
  /** Null until loaded, or where the container cannot run (Windows, other CPUs). */
  launcherPath: string | null
  loadLauncherPath: () => Promise<string | null>
}

export const useDotnetContainerStore = create<DotnetContainerState>((set) => ({
  launcherPath: null,
  loadLauncherPath: async () => {
    const launcherPath = await window.api.dotnetContainer.launcherPath().catch(() => null)
    set({ launcherPath })
    return launcherPath
  }
}))
