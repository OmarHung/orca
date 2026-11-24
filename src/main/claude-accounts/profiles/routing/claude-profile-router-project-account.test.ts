import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeManagedAccount } from '../../../../shared/agent-accounts/managed-account-types'
import { ClaudeProfileRouter, type ClaudeProfileRouterSettings } from './claude-profile-router'
import { installClaudeProfileRouter } from './claude-profile-installed-router'

vi.mock('@orca/process-host', () => ({ runProcess: vi.fn() }))
vi.mock('../../../codex-cli/command', () => ({ resolveClaudeCommand: () => '/unused-claude' }))

const roots: string[] = []
afterEach(() => {
  installClaudeProfileRouter(undefined)
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'claude-router-project-'))
  roots.push(root)
  const userHome = join(root, 'personal')
  const dataRoot = join(root, 'data')
  mkdirSync(join(userHome, '.claude'), { recursive: true })
  const account = (id: string): ClaudeManagedAccount => ({
    id,
    email: `${id}@example.test`,
    authMethod: 'subscription-oauth',
    managedAuthPath: '/unused-legacy',
    createdAt: 0,
    updatedAt: 0,
    lastAuthenticatedAt: 0
  })
  const settings: ClaudeProfileRouterSettings = {
    claudeManagedAccounts: [account('a'), account('b')],
    activeClaudeManagedAccountId: 'a',
    activeClaudeManagedAccountIdsByRuntime: undefined,
    // Avoid probing an installed Claude binary.
    agentStatusHooksEnabled: false,
    disabledTuiAgents: []
  }
  const pins = new Map<string, { accountId: string | null }>()
  const router = new ClaudeProfileRouter({
    getSettings: () => settings,
    dataRoot,
    userHome,
    env: {},
    runSetup: () => new Promise(() => {}),
    refreshWaitMs: 500,
    getProjectAccount: (repoId) => pins.get(repoId) ?? null
  })
  const home = (id: string) => join(dataRoot, 'claude-profiles', id, 'home')
  return { settings, router, home, pins }
}

function signIn(stateDir: string, email: string): void {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(
    join(stateDir, '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: email } })
  )
}

describe('ClaudeProfileRouter project accounts', () => {
  it("launches a project that pins an account there and re-points the project's terminals when its pin changes", () => {
    const f = fixture()
    signIn(f.home('a'), 'a@example.test')
    signIn(f.home('b'), 'b@example.test')
    const project = { repoId: 'repo-1' }
    f.pins.set(project.repoId, { accountId: 'b' })

    expect(f.router.preparation(project)).toMatchObject({
      configDir: f.home('b'),
      provenance: 'profile:b'
    })
    expect(f.router.preparation()).toMatchObject({
      configDir: f.home('a'),
      provenance: 'profile:a'
    })
    const env = f.router.terminalEnv(undefined, project)
    expect(env.CLAUDE_CONFIG_DIR).toBe(f.home('b'))
    const pointer = env.ORCA_CLAUDE_PROFILE_POINTER ?? ''
    expect(pointer).not.toBe(f.router.pointerPath)
    expect(readFileSync(pointer, 'utf8')).toBe(f.home('b'))
    expect(readFileSync(f.router.pointerPath, 'utf8')).toBe(f.home('a'))

    f.pins.set(project.repoId, { accountId: null })
    f.router.publish(project)
    expect(readFileSync(pointer, 'utf8')).toBe('')

    // Unpinned, the project's open terminals follow a later Accounts switch.
    f.pins.delete(project.repoId)
    f.settings.activeClaudeManagedAccountId = 'b'
    f.router.publish()
    expect(readFileSync(pointer, 'utf8')).toBe(f.home('b'))
  })
})
