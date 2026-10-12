import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Worktree } from '../../../../shared/worktree/types'

const mocks = vi.hoisted(() => ({
  launchAgentInNewTab: vi.fn(),
  launchWorkItemDirect: vi.fn(),
  activateAndRevealWorktree: vi.fn(),
  focusTerminalTabSurface: vi.fn(),
  openModal: vi.fn(),
  writeClipboardText: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({ launchAgentInNewTab: mocks.launchAgentInNewTab }))
vi.mock('@/lib/launch-work-item-direct', () => ({
  launchWorkItemDirect: mocks.launchWorkItemDirect
}))
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: mocks.activateAndRevealWorktree
}))
vi.mock('@/lib/focus-terminal-tab-surface', () => ({
  focusTerminalTabSurface: mocks.focusTerminalTabSurface
}))
vi.mock('@/lib/agent-launch-request-id', () => ({ newAgentLaunchRequestId: () => 'request-1' }))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ activeGroupIdByWorktree: { 'wt-1': 'group-1' }, openModal: mocks.openModal })
  }
}))

import {
  MONDAY_AGENT_WORKSPACE_LIMIT,
  recentMondayAgentWorkspaces,
  startMondayTaskAgentInNewWorkspace,
  startMondayTaskAgentInWorkspace
} from './monday-task-agent-launch'

const task = { id: '42', name: '範例任務', url: 'https://acme.monday.com/boards/1/pulses/42' }

function worktree(id: string, overrides: Partial<Worktree> = {}): Worktree {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: ordering reads only these fields.
  return { id, displayName: id, isArchived: false, lastActivityAt: 0, ...overrides } as Worktree
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.writeClipboardText.mockResolvedValue(undefined)
  vi.stubGlobal('window', { api: { ui: { writeClipboardText: mocks.writeClipboardText } } })
})

describe('recentMondayAgentWorkspaces', () => {
  it('orders by visit, then activity, without archived ones, up to the limit', () => {
    const many = Array.from({ length: MONDAY_AGENT_WORKSPACE_LIMIT + 5 }, (_, index) =>
      worktree(`busy-${index}`, { lastActivityAt: index })
    )
    const rows = recentMondayAgentWorkspaces(
      [...many, worktree('visited'), worktree('archived', { isArchived: true })],
      { visited: 5, archived: 9 }
    )

    expect(rows).toHaveLength(MONDAY_AGENT_WORKSPACE_LIMIT)
    expect(rows[0]?.id).toBe('visited')
    expect(rows[1]?.id).toBe(`busy-${MONDAY_AGENT_WORKSPACE_LIMIT + 4}`)
    expect(rows.some((row) => row.id === 'archived')).toBe(false)
  })
})

describe('startMondayTaskAgentInWorkspace', () => {
  it('opens the agent in a new tab with the task as a draft and focuses it', () => {
    mocks.launchAgentInNewTab.mockReturnValue({ surface: { kind: 'local-terminal', tabId: 't1' } })

    startMondayTaskAgentInWorkspace({ worktreeId: 'wt-1', agent: 'claude', prompt: 'do it' })

    expect(mocks.launchAgentInNewTab).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'claude',
        worktreeId: 'wt-1',
        groupId: 'group-1',
        prompt: 'do it',
        promptDelivery: 'draft'
      })
    )
    expect(mocks.focusTerminalTabSurface).toHaveBeenCalledWith('t1')
  })

  it('reveals the workspace before the agent surface opens', () => {
    mocks.activateAndRevealWorktree.mockReturnValue(false)
    mocks.launchAgentInNewTab.mockImplementation((args: { beforeSurfaceOpen: () => boolean }) =>
      args.beforeSurfaceOpen() ? {} : null
    )

    startMondayTaskAgentInWorkspace({ worktreeId: 'wt-1', agent: 'claude', prompt: 'do it' })

    expect(mocks.activateAndRevealWorktree).toHaveBeenCalledWith('wt-1', {
      providesInitialSurface: true
    })
    expect(mocks.toast.error).toHaveBeenCalledWith('Could not open that workspace')
  })
})

describe('startMondayTaskAgentInNewWorkspace', () => {
  it('creates a workspace named after the monday item with the task as its draft', async () => {
    await startMondayTaskAgentInNewWorkspace({ repoId: 'repo-1', task, prompt: 'do it' })

    expect(mocks.launchWorkItemDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 'repo-1',
        promptDelivery: 'draft',
        item: expect.objectContaining({
          title: '範例任務',
          url: task.url,
          number: null,
          pasteContent: 'do it',
          workspaceName: 'monday-42'
        })
      })
    )
  })

  it('falls back to the new-workspace dialog with the task on the clipboard', async () => {
    mocks.launchWorkItemDirect.mockImplementation(
      async (args: { openModalFallback: () => void }) => {
        args.openModalFallback()
        return false
      }
    )

    await startMondayTaskAgentInNewWorkspace({ repoId: 'repo-1', task, prompt: 'do it' })
    await Promise.resolve()

    expect(mocks.openModal).toHaveBeenCalledWith('new-workspace-composer', {
      prefilledName: '範例任務',
      initialRepoId: 'repo-1',
      telemetrySource: 'unknown'
    })
    expect(mocks.writeClipboardText).toHaveBeenCalledWith('do it')
    expect(mocks.toast.info).toHaveBeenCalled()
  })
})
