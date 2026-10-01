import { describe, expect, it, vi } from 'vitest'

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))

import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import { savedCommandFor, savedRunFor } from './saved-command-match'

const WORKTREE = '/repo'
const serve: RunConfigurationDefinition = {
  type: 'command',
  id: 'serve',
  name: 'shop: dev',
  command: 'pnpm run dev',
  cwd: 'frontend/shop'
}

describe('savedCommandFor', () => {
  it('finds the saved command that runs the same command in the same folder', () => {
    expect(savedCommandFor('pnpm run dev', '/repo/frontend/shop', [serve], WORKTREE)).toBe(serve)
  })

  it('treats another folder, another command or extra Before launch steps as another run', () => {
    expect(savedCommandFor('pnpm run dev', '/repo/frontend/admin', [serve], WORKTREE)).toBeNull()
    expect(savedCommandFor('pnpm run build', '/repo/frontend/shop', [serve], WORKTREE)).toBeNull()
    const withBuild = { ...serve, beforeLaunch: ['build'] }
    expect(savedCommandFor('pnpm run dev', '/repo/frontend/shop', [withBuild], WORKTREE)).toBeNull()
  })

  it('matches a run in the workspace root to a configuration without a folder', () => {
    const root = { ...serve, cwd: undefined }
    expect(savedCommandFor('pnpm run dev', WORKTREE, [root], WORKTREE)).toBe(root)
  })
})

describe('savedRunFor', () => {
  it('runs as the saved configuration, sharing its single-instance terminal', () => {
    const saved = savedRunFor(
      {
        worktreeId: 'wt',
        groupId: null,
        cwd: '/repo/frontend/shop',
        command: {
          id: 'detected:x',
          label: 'shop: dev',
          command: 'pnpm run dev',
          appendEnter: true
        }
      },
      [serve],
      WORKTREE
    )
    expect(saved).toMatchObject({
      id: 'serve',
      target: { commandKey: 'config:serve', cwd: '/repo/frontend/shop' }
    })
  })
})
