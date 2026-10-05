import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { UNTRANSLATED_GIT_OUTPUT_ENV } from '../git-output-locale'
import type { GitBranchActionExecutor } from './git-branch-action-types'

const execFileAsync = promisify(execFile)

// Why: the user's global config (pull.rebase, merge.ff, hooks…) must not change test outcomes.
const ISOLATED_GIT_ENV = {
  ...process.env,
  ...UNTRANSLATED_GIT_OUTPUT_ENV,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0'
}

export type GitBranchActionTestRepo = {
  path: string
  git: (...args: string[]) => string
  commitFile: (file: string, content: string, message: string) => string
  write: (file: string, content: string) => void
  read: (file: string) => string
  exec: GitBranchActionExecutor
}

/** Real repositories for the branch-action contract tests; `cleanup` removes every one made. */
export function createGitBranchActionTestRepos(): {
  createRepo: (options?: { bare?: boolean }) => GitBranchActionTestRepo
  cleanup: () => void
} {
  const paths: string[] = []
  const createRepo = (options: { bare?: boolean } = {}): GitBranchActionTestRepo => {
    const path = mkdtempSync(join(tmpdir(), 'orca-branch-action-'))
    paths.push(path)
    const git = (...args: string[]): string =>
      execFileSync('git', args, {
        cwd: path,
        encoding: 'utf8',
        stdio: 'pipe',
        env: ISOLATED_GIT_ENV
      })
    git('init', '--quiet', '-b', 'main', ...(options.bare ? ['--bare'] : []))
    if (!options.bare) {
      git('config', 'user.name', 'Orca Test')
      git('config', 'user.email', 'orca@example.test')
      git('config', 'commit.gpgSign', 'false')
      git('config', 'tag.gpgSign', 'false')
    }
    const write = (file: string, content: string): void => writeFileSync(join(path, file), content)
    const commitFile = (file: string, content: string, message: string): string => {
      write(file, content)
      git('add', file)
      git('commit', '--quiet', '-m', message)
      return git('rev-parse', 'HEAD').trim()
    }
    const exec: GitBranchActionExecutor = async (args) => {
      const { stdout } = await execFileAsync('git', args, { cwd: path, env: ISOLATED_GIT_ENV })
      return { stdout }
    }
    return {
      path,
      git,
      commitFile,
      write,
      read: (file) => readFileSync(join(path, file), 'utf8'),
      exec
    }
  }
  const cleanup = (): void => {
    for (const path of paths.splice(0)) {
      rmSync(path, { recursive: true, force: true })
    }
  }
  return { createRepo, cleanup }
}
