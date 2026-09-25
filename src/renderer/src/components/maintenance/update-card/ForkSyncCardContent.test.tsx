// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../../../../../shared/update-status-types'
import { useAppStore } from '../../../store'
import { UpdateCard } from '../../UpdateCard'
import { TooltipProvider } from '../../ui/tooltip'
import { buildForkSyncConflictPrompt } from '@/lib/fork-sync-conflict-agent'

const download = vi.fn()
const quitAndInstall = vi.fn()

const base = { baseTag: 'v1.4.211', targetTag: 'v1.4.212' }
const conflict = {
  phase: 'conflict' as const,
  ...base,
  repoRoot: '/src/orca-omar-custom',
  branch: 'omar/custom',
  files: ['src/renderer/src/app-shell/AppWorkspaceShell.tsx'],
  commitSubject: 'feat(renderer): add a Git Log bottom panel'
}

function setStatus(status: UpdateStatus): void {
  act(() => useAppStore.getState().setUpdateStatus(status))
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  download.mockReset().mockResolvedValue(undefined)
  quitAndInstall.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal(
    'matchMedia',
    vi
      .fn()
      .mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  )
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      updater: { download, quitAndInstall, check: vi.fn() },
      // Why: the first update click records that the reassurance note was seen.
      ui: { set: vi.fn().mockResolvedValue(undefined) }
    }
  })
  render(
    <TooltipProvider>
      <UpdateCard />
    </TooltipProvider>
  )
})

afterEach(() => {
  cleanup()
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.unstubAllGlobals()
})

describe('fork sync update card', () => {
  it('offers syncing to the new upstream tag', () => {
    setStatus({
      state: 'available',
      version: 'v1.4.212',
      changelog: null,
      forkSync: { phase: 'available', ...base }
    })
    expect(screen.getByText('Upstream released v1.4.212')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sync & update' }))
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('shows the current step while syncing', () => {
    setStatus({
      state: 'downloading',
      percent: 55,
      version: 'v1.4.212',
      forkSync: { phase: 'syncing', ...base, stage: 'build' }
    })
    expect(screen.getByText('Step 6 of 6: Building the app…')).toBeTruthy()
  })

  it('lists conflicted files and offers AI resolution and retry', () => {
    setStatus({
      state: 'error',
      message: 'conflict',
      retryable: true,
      userInitiated: true,
      forkSync: conflict
    })
    expect(screen.getByText('Your changes conflict with v1.4.212')).toBeTruthy()
    expect(screen.getByText(conflict.files[0])).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resolve with AI' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('shows where a failed sync stopped with its output', () => {
    setStatus({
      state: 'error',
      message: 'failed',
      retryable: true,
      userInitiated: true,
      forkSync: {
        phase: 'failed',
        ...base,
        repoRoot: '/src/orca',
        stage: 'verify',
        logTail: 'error TS2322: nope'
      }
    })
    expect(screen.getByText('Stopped at: Typechecking and testing')).toBeTruthy()
    expect(screen.getByText('error TS2322: nope')).toBeTruthy()
  })

  it('installs a finished build', () => {
    setStatus({
      state: 'downloaded',
      version: 'v1.4.212',
      forkSync: { phase: 'built', ...base, manifestPath: '/w/dist/latest-mac.yml' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }))
    expect(quitAndInstall).toHaveBeenCalledTimes(1)
  })
})

describe('buildForkSyncConflictPrompt', () => {
  it('names the exact rebase to redo, the files, and marks repo text as untrusted', () => {
    const prompt = buildForkSyncConflictPrompt(conflict)
    expect(prompt).toContain('git rebase --onto v1.4.212 v1.4.211 omar/custom')
    expect(prompt).toContain('"src/renderer/src/app-shell/AppWorkspaceShell.tsx"')
    expect(prompt).toContain('/src/orca-omar-custom')
    expect(prompt).toContain('untrusted')
    expect(prompt).toContain('Do not push')
  })
})
