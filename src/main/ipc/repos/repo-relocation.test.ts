import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Store } from '../../persistence/loading-store/store'
import { ProfileStateSqliteAuthority } from '../../persistence/profile-state/profile-state-sqlite-authority'
import { hostWorktreeTarget } from '../../../shared/worktree/host-qualified-identity'
import { relocateLocalRepo } from './repo-relocation'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn(), handle: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
}))

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

describe('relocateLocalRepo', () => {
  let root: string
  let store: Store
  let oldPath: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'orca-relocate-')))
    oldPath = join(root, 'before', 'app')
    mkdirSync(oldPath, { recursive: true })
    git(oldPath, 'init', '-q', '-b', 'main')
    writeFileSync(join(oldPath, 'README.md'), 'hi\n')
    git(oldPath, 'add', '.')
    git(oldPath, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'init')
    store = new Store({
      dataFile: join(root, 'state.json'),
      profileStateAuthority: new ProfileStateSqliteAuthority(join(root, 'profile.db'), 'relocate')
    })
    store.addRepo({
      id: 'repo',
      path: oldPath,
      displayName: 'App',
      badgeColor: 'blue',
      addedAt: 0,
      kind: 'git'
    })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('moves the project, its main workspace state and its linked worktrees to the new folder', async () => {
    const linked = join(root, 'feature')
    git(oldPath, 'worktree', 'add', '-q', '-b', 'feature', linked)
    store.setWorktreeMeta(hostWorktreeTarget({ id: `repo::${oldPath}`, hostId: 'local' }), {
      displayName: 'Main checkout'
    })
    const newPath = join(root, 'after', 'app')
    mkdirSync(join(root, 'after'))
    renameSync(oldPath, newPath)

    const result = await relocateLocalRepo(store, 'repo', newPath)

    expect('error' in result).toBe(false)
    expect(store.getRepo('repo')?.path).toBe(newPath)
    expect(store.getWorktreeMeta(`repo::${newPath}`)?.displayName).toBe('Main checkout')
    expect(store.getWorktreeMeta(`repo::${oldPath}`)).toBeUndefined()
    // The linked worktree finds the moved `.git` again.
    expect(git(linked, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature')
  })

  it('refuses a folder that is not a Git repository and keeps the old path', async () => {
    const plain = join(root, 'plain')
    mkdirSync(plain)

    const result = await relocateLocalRepo(store, 'repo', plain)

    expect(result).toEqual({ error: 'not-git-repo' })
    expect(store.getRepo('repo')?.path).toBe(oldPath)
  })
})
