import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from './worktree-activation'
import * as activationGate from './worktree-agent-activation-gate'
import { seedProjectInitialAgentTab } from './project-initial-agent-tab-seeding'
import {
  makeCreatedAgentWorktree as makeWorktree,
  seedEmptyActivatableWorktree
} from '@/lib/worktree-activation-created-agent-test-state'
import type { Repo } from '../../../shared/repo-types'
import type { Worktree } from '../../../shared/worktree/types'

const openDefaultChat = vi.hoisted(() => vi.fn())

vi.mock('@/lib/empty-workspace-default-agent-chat', () => ({
  openDefaultAgentChatInEmptyWorkspace: openDefaultChat,
  emptyWorkspaceDefaultChatAwaitsDetection: () => false,
  loadEmptyWorkspaceDefaultChatDetection: async () => {}
}))

const USER_OPEN = { navigationIntent: 'user-open' } as const
const initialAppStoreState = useAppStore.getState()

afterEach(() => {
  openDefaultChat.mockReset()
  vi.restoreAllMocks()
  useAppStore.setState(initialAppStoreState, true)
})

function seedEmptyProject(repoOverrides: Partial<Repo>): Worktree {
  const worktree = makeWorktree()
  seedEmptyActivatableWorktree(worktree)
  const state = useAppStore.getState()
  useAppStore.setState({
    repos: state.repos.map((repo) => {
      const { initialTab: _pinnedByFixture, ...rest } = repo
      return { ...rest, ...repoOverrides }
    })
  })
  return worktree
}

function openedTab(worktreeId: string) {
  const state = useAppStore.getState()
  const tab = state.tabsByWorktree[worktreeId]?.[0]
  expect(state.tabsByWorktree[worktreeId]).toHaveLength(1)
  return { tab, startup: tab ? state.pendingStartupByTabId[tab.id] : undefined }
}

describe('project initial tab', () => {
  it('opens Claude in an empty workspace when the project has no choice saved', () => {
    const worktree = seedEmptyProject({})

    activateAndRevealWorktree(worktree.id, { notifyHostRuntime: false })

    const { tab, startup } = openedTab(worktree.id)
    expect(tab?.launchAgent).toBe('claude')
    expect(startup?.command).toMatch(/^claude\b/)
    expect(startup?.telemetry).toMatchObject({ launch_source: 'sidebar', request_kind: 'new' })
  })

  it('opens the agent the project chose', () => {
    const worktree = seedEmptyProject({ initialTab: 'codex' })

    activateAndRevealWorktree(worktree.id, { notifyHostRuntime: false })

    const { tab, startup } = openedTab(worktree.id)
    expect(tab?.launchAgent).toBe('codex')
    expect(startup?.command).toMatch(/^codex\b/)
  })

  it('opens a plain shell when the project chose Terminal', () => {
    const worktree = seedEmptyProject({ initialTab: 'terminal' })

    activateAndRevealWorktree(worktree.id, { notifyHostRuntime: false })

    const { tab, startup } = openedTab(worktree.id)
    expect(tab?.launchAgent).toBeUndefined()
    expect(startup).toBeUndefined()
  })

  it('falls back to a plain shell when the chosen agent is disabled', () => {
    const worktree = seedEmptyProject({})
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings!, disabledTuiAgents: ['claude'] }
    })

    activateAndRevealWorktree(worktree.id, { notifyHostRuntime: false })

    expect(openedTab(worktree.id).startup).toBeUndefined()
  })

  it('keeps a Blank Terminal pick from the create picker', () => {
    const worktree = seedEmptyProject({})

    activateAndRevealWorktree(worktree.id, { agent: null, notifyHostRuntime: false })

    expect(openedTab(worktree.id).startup).toBeUndefined()
  })

  it('keeps a Blank Terminal pick through the async activation gate', async () => {
    const worktree = seedEmptyProject({})
    vi.spyOn(activationGate, 'workspaceHasSleepingAgentSessions').mockReturnValue(true)
    const gate = vi.spyOn(activationGate, 'gateWorktreeAgentActivation')
    gate.mockResolvedValue('empty')

    activateAndRevealWorktree(worktree.id, { agent: null, notifyHostRuntime: false })
    await gate.mock.results[0]?.value

    expect(openedTab(worktree.id).startup).toBeUndefined()
  })

  it('opens the project agent after the async activation gate reports an empty workspace', async () => {
    const worktree = seedEmptyProject({})
    vi.spyOn(activationGate, 'workspaceHasSleepingAgentSessions').mockReturnValue(true)
    const gate = vi.spyOn(activationGate, 'gateWorktreeAgentActivation')
    gate.mockResolvedValue('empty')

    activateAndRevealWorktree(worktree.id, { notifyHostRuntime: false })
    await gate.mock.results[0]?.value

    expect(openedTab(worktree.id).tab?.launchAgent).toBe('claude')
  })

  it("opens the project agent instead of the user's default agent chat", () => {
    const worktree = seedEmptyProject({ initialTab: 'codex' })

    activateAndRevealWorktree(worktree.id, { ...USER_OPEN, notifyHostRuntime: false })

    expect(openDefaultChat).not.toHaveBeenCalled()
    expect(openedTab(worktree.id).tab?.launchAgent).toBe('codex')
  })

  it("keeps the shell over the user's default agent chat when the project chose Terminal", () => {
    const worktree = seedEmptyProject({ initialTab: 'terminal' })

    activateAndRevealWorktree(worktree.id, { ...USER_OPEN, notifyHostRuntime: false })

    expect(openDefaultChat).not.toHaveBeenCalled()
    expect(openedTab(worktree.id).startup).toBeUndefined()
  })

  it("lets the user's default agent chat open when the project's agent is disabled", () => {
    const worktree = seedEmptyProject({})
    useAppStore.setState({
      settings: { ...useAppStore.getState().settings!, disabledTuiAgents: ['claude'] }
    })
    openDefaultChat.mockReturnValue({ primaryTabId: null })

    activateAndRevealWorktree(worktree.id, { ...USER_OPEN, notifyHostRuntime: false })

    expect(openDefaultChat).toHaveBeenCalledWith(worktree.id)
  })

  it('seeds the startup-hydration tab only when the project opens an agent', () => {
    const agentProject = seedEmptyProject({})
    expect(seedProjectInitialAgentTab(agentProject.id)).toBe(true)
    expect(openedTab(agentProject.id).tab?.launchAgent).toBe('claude')

    const shellProject = seedEmptyProject({ initialTab: 'terminal' })
    expect(seedProjectInitialAgentTab(shellProject.id)).toBe(false)
  })
})
