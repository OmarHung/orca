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
const openUrl = vi.fn()

const base = { baseTag: 'v1.4.211', targetTag: 'v1.4.212' }
const conflict = {
  phase: 'conflict' as const,
  ...base,
  repoRoot: '/src/orca-omar-custom',
  branch: 'omar/custom',
  files: ['src/renderer/src/app-shell/AppWorkspaceShell.tsx'],
  commitSubject: 'feat(renderer): add a Git Log bottom panel'
}
const conflictCommits = [
  {
    sha: '7ef454a4870000000000',
    subject: 'feat(renderer): add a Git Log bottom panel',
    files: ['src/renderer/src/i18n/locales/en.json']
  },
  {
    sha: '71d5dff5b60000000000',
    subject: 'feat(run): show runs in a Run tool window',
    files: ['src/a.tsx', 'src/b.ts']
  }
]

function setStatus(status: UpdateStatus): void {
  act(() => useAppStore.getState().setUpdateStatus(status))
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  download.mockReset().mockResolvedValue(undefined)
  quitAndInstall.mockReset().mockResolvedValue(undefined)
  openUrl.mockReset().mockResolvedValue(undefined)
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
      shell: { openUrl },
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

  it('lists the upstream release notes since the base, newest first', () => {
    setStatus({
      state: 'available',
      version: 'v1.4.213',
      changelog: null,
      forkSync: {
        phase: 'available',
        baseTag: 'v1.4.211',
        targetTag: 'v1.4.213',
        releaseNotes: [
          {
            tag: 'v1.4.213',
            title: 'Orca v1.4.213',
            url: 'https://github.com/stablyai/orca/releases/tag/v1.4.213',
            publishedAt: null,
            body: '**Terminal:** a new Reset Terminal item'
          },
          {
            tag: 'v1.4.212',
            title: 'Orca v1.4.212',
            url: 'https://github.com/stablyai/orca/releases/tag/v1.4.212',
            publishedAt: null,
            body: 'Faster diffs'
          }
        ]
      }
    })
    const notes = screen.getByTestId('fork-sync-release-notes')
    const titles = Array.from(notes.querySelectorAll('article button')).map((b) => b.textContent)
    expect(titles).toEqual(['Orca v1.4.213', 'Orca v1.4.212'])
    expect(screen.getByText('Terminal:')).toBeTruthy()
    expect(screen.getByText('Faster diffs')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Orca v1.4.212' }))
    expect(openUrl).toHaveBeenCalledWith('https://github.com/stablyai/orca/releases/tag/v1.4.212')
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

  it('lists every conflicting commit with its files', () => {
    setStatus({
      state: 'error',
      message: 'conflict',
      retryable: true,
      userInitiated: true,
      forkSync: { ...conflict, conflictCommits }
    })
    expect(
      screen.getByText('2 of your commits conflict with v1.4.212. The branch was left unchanged.')
    ).toBeTruthy()
    const list = screen.getByTestId('fork-sync-conflict-commits')
    expect(list.textContent).toContain('7ef454a487 feat(renderer): add a Git Log bottom panel')
    expect(list.textContent).toContain('71d5dff5b6 feat(run): show runs in a Run tool window')
    for (const file of ['src/renderer/src/i18n/locales/en.json', 'src/a.tsx', 'src/b.ts']) {
      expect(screen.getByText(file)).toBeTruthy()
    }
    expect(screen.getByRole('button', { name: 'Resolve with AI' })).toBeTruthy()
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
    expect(prompt).not.toContain('dry run')
  })

  it('lists every conflicting commit from the dry run', () => {
    const prompt = buildForkSyncConflictPrompt({ ...conflict, conflictCommits })
    expect(prompt).toContain('A dry run found these fork commits conflicting')
    expect(prompt).toContain(
      '- 71d5dff5b6 "feat(run): show runs in a Run tool window": "src/a.tsx", "src/b.ts"'
    )
  })
})
