import { useCallback, useEffect, useState } from 'react'
import type { SshTarget } from '../../../../shared/ssh-types'
import { useAppStore } from '@/store'

type SshTargetListStatus = 'loading' | 'ready' | 'error'

type SshTargetList = {
  status: SshTargetListStatus
  targets: SshTarget[]
  reload: () => void
}

/** Orca's SSH targets, refreshed from ~/.ssh/config on mount like the SSH settings pane. */
export function useSshTargetList(): SshTargetList {
  const [status, setStatus] = useState<SshTargetListStatus>('loading')
  const [targets, setTargets] = useState<SshTarget[]>([])

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const result = await window.api.ssh.importConfig()
      useAppStore.getState().recordSshRepoReadoptions(result.repoReadoptions)
    } catch {
      // Why: a broken config must not hide the targets Orca already knows.
    }
    try {
      const listed = await window.api.ssh.listTargets()
      if (signal?.aborted) {
        return
      }
      setTargets(listed)
      setStatus('ready')
      useAppStore.getState().setSshTargetsMetadata(listed)
    } catch {
      if (!signal?.aborted) {
        setStatus('error')
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const reload = useCallback(() => {
    setStatus('loading')
    void load()
  }, [load])

  return { status, targets, reload }
}
