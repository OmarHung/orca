import { describe, expect, it } from 'vitest'
import type { GitHistoryBranch } from '../../../../../shared/git-history'
import { buildGitLogBranchTree, flattenGitLogBranchTree } from './git-log-branch-tree'

function branch(fullName: string, overrides: Partial<GitHistoryBranch> = {}): GitHistoryBranch {
  const isLocal = fullName.startsWith('refs/heads/')
  return {
    fullName,
    name: fullName.replace(/^refs\/(heads|remotes)\//, ''),
    kind: isLocal ? 'local' : 'remote',
    revision: 'a'.repeat(40),
    isHead: false,
    ...overrides
  }
}

const branches = [
  branch('refs/heads/main', { isHead: true }),
  branch('refs/heads/fix/syscom/csp-header'),
  branch('refs/heads/fix/login'),
  branch('refs/remotes/origin/main'),
  branch('refs/remotes/origin/fix/login'),
  branch('refs/remotes/upstream/dev')
]

function labels(rows: ReturnType<typeof flattenGitLogBranchTree>): string[] {
  return rows.map(
    (row) => `${'  '.repeat(row.depth)}${row.node.kind === 'group' ? row.node.key : row.node.label}`
  )
}

describe('buildGitLogBranchTree', () => {
  it('nests slash-separated names into folders, folders first, and groups remotes by remote', () => {
    const tree = buildGitLogBranchTree(branches, '')
    expect(labels(flattenGitLogBranchTree(tree, new Set()))).toEqual([
      'local',
      '  fix',
      '    syscom',
      '      csp-header',
      '    login',
      '  main',
      'remote',
      '  origin',
      '    fix',
      '      login',
      '    main',
      '  upstream',
      '    dev'
    ])
  })

  it('hides children of collapsed folders', () => {
    const tree = buildGitLogBranchTree(branches, '')
    const rows = flattenGitLogBranchTree(tree, new Set(['local/fix', 'remote']))
    expect(labels(rows)).toEqual(['local', '  fix', '  main', 'remote'])
  })

  it('filters by a case-insensitive substring of the full short name and drops empty groups', () => {
    const tree = buildGitLogBranchTree(branches, 'LOGIN')
    expect(labels(flattenGitLogBranchTree(tree, new Set()))).toEqual([
      'local',
      '  fix',
      '    login',
      'remote',
      '  origin',
      '    fix',
      '      login'
    ])
  })

  it('ignores collapse state while filtering so matches stay visible', () => {
    const tree = buildGitLogBranchTree(branches, 'dev')
    expect(
      labels(flattenGitLogBranchTree(tree, new Set(['remote']), { isFiltering: true }))
    ).toEqual(['remote', '  upstream', '    dev'])
  })
})
