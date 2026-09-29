import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ORCA_TERMINAL_COMMAND_FINISHED_EVENT } from '@/hooks/terminal-command-finished-event'
import { GIT_LOG_BACKSTOP_POLL_MS, subscribeGitLogRefreshSignals } from './git-log-refresh-signals'

type RepoCallback = (data: { repoId: string }) => void

function installFakeHost(): {
  emitWorktreesChanged: (repoId: string) => void
  emitGitStatusMetadataChanged: (repoId: string) => void
  emitWindow: (event: Event) => void
  emitVisibilityChange: () => void
  setVisible: (visible: boolean) => void
  listenerCount: () => number
} {
  const repoCallbacks = { changed: new Set<RepoCallback>(), metadata: new Set<RepoCallback>() }
  const windowListeners = new Map<string, Set<EventListener>>()
  const documentListeners = new Set<EventListener>()
  let visibilityState = 'visible'
  const addTo =
    (set: Set<RepoCallback>) =>
    (callback: RepoCallback): (() => void) => {
      set.add(callback)
      return () => set.delete(callback)
    }
  vi.stubGlobal('window', {
    api: {
      worktrees: {
        onChanged: addTo(repoCallbacks.changed),
        onGitStatusMetadataChanged: addTo(repoCallbacks.metadata)
      }
    },
    addEventListener: (type: string, listener: EventListener) => {
      windowListeners.set(type, (windowListeners.get(type) ?? new Set()).add(listener))
    },
    removeEventListener: (type: string, listener: EventListener) => {
      windowListeners.get(type)?.delete(listener)
    }
  })
  vi.stubGlobal('document', {
    get visibilityState() {
      return visibilityState
    },
    addEventListener: (_type: string, listener: EventListener) => documentListeners.add(listener),
    removeEventListener: (_type: string, listener: EventListener) =>
      documentListeners.delete(listener)
  })
  return {
    emitWorktreesChanged: (repoId) => repoCallbacks.changed.forEach((cb) => cb({ repoId })),
    emitGitStatusMetadataChanged: (repoId) =>
      repoCallbacks.metadata.forEach((cb) => cb({ repoId })),
    emitWindow: (event) => windowListeners.get(event.type)?.forEach((listener) => listener(event)),
    emitVisibilityChange: () =>
      documentListeners.forEach((listener) => listener(new Event('visibilitychange'))),
    setVisible: (visible) => {
      visibilityState = visible ? 'visible' : 'hidden'
    },
    listenerCount: () =>
      repoCallbacks.changed.size +
      repoCallbacks.metadata.size +
      documentListeners.size +
      [...windowListeners.values()].reduce((total, set) => total + set.size, 0)
  }
}

function commandFinished(worktreeId: string): Event {
  return new CustomEvent(ORCA_TERMINAL_COMMAND_FINISHED_EVENT, {
    detail: { worktreeId, exitCode: 0 }
  })
}

describe('subscribeGitLogRefreshSignals', () => {
  let host: ReturnType<typeof installFakeHost>
  const onSignal = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    host = installFakeHost()
    onSignal.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reports repo metadata and worktree changes for its own repo only', () => {
    subscribeGitLogRefreshSignals({ repoId: 'repo-1', worktreeId: 'wt-1', onSignal })
    host.emitGitStatusMetadataChanged('repo-2')
    host.emitWorktreesChanged('repo-2')
    expect(onSignal).not.toHaveBeenCalled()

    host.emitGitStatusMetadataChanged('repo-1')
    host.emitWorktreesChanged('repo-1')
    expect(onSignal).toHaveBeenCalledTimes(2)
    expect(onSignal).toHaveBeenCalledWith({ changeSignal: true })
  })

  it('reports commands finished in its own worktree only', () => {
    subscribeGitLogRefreshSignals({ repoId: 'repo-1', worktreeId: 'wt-1', onSignal })
    host.emitWindow(commandFinished('wt-2'))
    expect(onSignal).not.toHaveBeenCalled()

    host.emitWindow(commandFinished('wt-1'))
    expect(onSignal).toHaveBeenCalledWith({ changeSignal: true })
  })

  it('reports returning to the window as a change', () => {
    subscribeGitLogRefreshSignals({ repoId: 'repo-1', worktreeId: 'wt-1', onSignal })
    host.emitWindow(new Event('focus'))
    host.emitVisibilityChange()
    expect(onSignal).toHaveBeenCalledTimes(2)
    expect(onSignal).toHaveBeenLastCalledWith({ changeSignal: true })
  })

  it('polls as a backstop for ref-only changes no watcher reports', () => {
    subscribeGitLogRefreshSignals({ repoId: 'repo-1', worktreeId: 'wt-1', onSignal })
    vi.advanceTimersByTime(GIT_LOG_BACKSTOP_POLL_MS - 1)
    expect(onSignal).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onSignal).toHaveBeenCalledTimes(1)
    expect(onSignal).toHaveBeenCalledWith(undefined)
  })

  it('stays quiet while the window is hidden', () => {
    subscribeGitLogRefreshSignals({ repoId: 'repo-1', worktreeId: 'wt-1', onSignal })
    host.setVisible(false)
    host.emitGitStatusMetadataChanged('repo-1')
    host.emitWindow(commandFinished('wt-1'))
    host.emitVisibilityChange()
    vi.advanceTimersByTime(GIT_LOG_BACKSTOP_POLL_MS)
    expect(onSignal).not.toHaveBeenCalled()

    host.setVisible(true)
    host.emitVisibilityChange()
    expect(onSignal).toHaveBeenCalledTimes(1)
  })

  it('removes every listener and the poll on unsubscribe', () => {
    const unsubscribe = subscribeGitLogRefreshSignals({
      repoId: 'repo-1',
      worktreeId: 'wt-1',
      onSignal
    })
    expect(host.listenerCount()).toBe(5)
    unsubscribe()
    expect(host.listenerCount()).toBe(0)
    vi.advanceTimersByTime(GIT_LOG_BACKSTOP_POLL_MS * 2)
    expect(onSignal).not.toHaveBeenCalled()
  })

  it('still polls when there is no repo or preload bridge', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    subscribeGitLogRefreshSignals({ repoId: null, worktreeId: 'wt-1', onSignal })
    vi.advanceTimersByTime(GIT_LOG_BACKSTOP_POLL_MS)
    expect(onSignal).toHaveBeenCalledTimes(1)
  })
})
