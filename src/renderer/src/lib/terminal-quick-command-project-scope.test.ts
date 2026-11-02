import { describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { ProjectHostSetup } from '../../../shared/project-types'
import type { TerminalQuickCommand } from '../../../shared/terminal-quick-command-types'
import { terminalQuickCommandMatchesWorkspaceProject } from './terminal-quick-command-project-scope'

type ScopeSetup = Pick<ProjectHostSetup, 'hostId' | 'projectId' | 'repoId'>

const LOCAL_REPO_ID = '32a0226d-9f33-42e8-8b7b-24867dea06d4'
const WINDOWS_REPO_ID = 'a0a2b4a4-1bff-494c-b005-d77918abc6a7'
const SIBLING_CLONE_REPO_ID = '7c1f0e52-3a64-4d0b-9e21-5b8d6f4a2c10'

function command(repoId: string): TerminalQuickCommand {
  return {
    id: 'test-orca',
    label: 'Test Orca',
    action: 'terminal-command',
    command: 'pnpm test',
    appendEnter: true,
    scope: { type: 'repo', repoId }
  }
}

function setup(
  hostId: ExecutionHostId,
  repoId: string,
  projectId = 'github:stablyai/orca'
): ScopeSetup {
  return { hostId, projectId, repoId }
}

describe('terminalQuickCommandMatchesWorkspaceProject', () => {
  it.each<ExecutionHostId>(['local', 'ssh:builder', 'runtime:windows-2'])(
    'keeps a repo command on its own clone when %s has two clones of the same remote',
    (hostId) => {
      const context = {
        commandHostId: hostId,
        projectHostSetups: [setup(hostId, LOCAL_REPO_ID), setup(hostId, SIBLING_CLONE_REPO_ID)],
        targetHostId: hostId
      }
      const scoped = command(LOCAL_REPO_ID)

      expect(
        terminalQuickCommandMatchesWorkspaceProject(scoped, {
          ...context,
          targetRepoId: SIBLING_CLONE_REPO_ID
        })
      ).toBe(false)
      expect(
        terminalQuickCommandMatchesWorkspaceProject(scoped, {
          ...context,
          targetRepoId: LOCAL_REPO_ID
        })
      ).toBe(true)
    }
  )

  it('keeps a settings-owned command on its own clone of the SSH host running its repo', () => {
    const context = {
      commandHostId: 'local' as const,
      projectHostSetups: [
        setup('ssh:builder', LOCAL_REPO_ID),
        setup('ssh:builder', SIBLING_CLONE_REPO_ID)
      ],
      targetHostId: 'ssh:builder' as const
    }
    const scoped = command(LOCAL_REPO_ID)

    expect(
      terminalQuickCommandMatchesWorkspaceProject(scoped, {
        ...context,
        targetRepoId: SIBLING_CLONE_REPO_ID
      })
    ).toBe(false)
    expect(
      terminalQuickCommandMatchesWorkspaceProject(scoped, {
        ...context,
        targetRepoId: LOCAL_REPO_ID
      })
    ).toBe(true)
  })

  it('shows a settings-owned SSH repo command on a local clone of the same project', () => {
    expect(
      terminalQuickCommandMatchesWorkspaceProject(command(WINDOWS_REPO_ID), {
        commandHostId: 'local',
        projectHostSetups: [setup('ssh:builder', WINDOWS_REPO_ID), setup('local', LOCAL_REPO_ID)],
        targetHostId: 'local',
        targetRepoId: LOCAL_REPO_ID
      })
    ).toBe(true)
  })
})
