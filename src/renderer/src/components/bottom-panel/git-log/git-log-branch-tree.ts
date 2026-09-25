import type { GitHistoryBranch } from '../../../../../shared/git-history'

export type GitLogBranchTreeNode =
  | { kind: 'group'; key: 'local' | 'remote'; children: GitLogBranchTreeNode[] }
  | { kind: 'folder'; key: string; label: string; children: GitLogBranchTreeNode[] }
  | { kind: 'branch'; key: string; label: string; branch: GitHistoryBranch }

export type GitLogBranchTreeRow = { node: GitLogBranchTreeNode; depth: number }

type MutableFolder = { folders: Map<string, MutableFolder>; branches: GitHistoryBranch[] }

function emptyFolder(): MutableFolder {
  return { folders: new Map(), branches: [] }
}

function insert(root: MutableFolder, segments: string[], branch: GitHistoryBranch): void {
  let folder = root
  for (const segment of segments.slice(0, -1)) {
    let next = folder.folders.get(segment)
    if (!next) {
      next = emptyFolder()
      folder.folders.set(segment, next)
    }
    folder = next
  }
  folder.branches.push(branch)
}

function toNodes(folder: MutableFolder, keyPrefix: string): GitLogBranchTreeNode[] {
  const byLabel = (a: { label: string }, b: { label: string }): number =>
    a.label.localeCompare(b.label)
  const folders = [...folder.folders.entries()]
    .map(([label, child]) => ({
      kind: 'folder' as const,
      key: `${keyPrefix}/${label}`,
      label,
      children: toNodes(child, `${keyPrefix}/${label}`)
    }))
    .sort(byLabel)
  const leaves = folder.branches
    .map((branch) => ({
      kind: 'branch' as const,
      key: branch.fullName,
      label: branch.name.split('/').at(-1) ?? branch.name,
      branch
    }))
    .sort(byLabel)
  // Why folders first: matches JetBrains' branch tree, where grouped prefixes lead.
  return [...folders, ...leaves]
}

/** Local and Remote groups, each nesting `a/b/c` names into folders; remotes nest under their remote name. */
export function buildGitLogBranchTree(
  branches: readonly GitHistoryBranch[],
  query: string
): GitLogBranchTreeNode[] {
  const needle = query.trim().toLocaleLowerCase()
  const local = emptyFolder()
  const remote = emptyFolder()
  for (const branch of branches) {
    if (needle && !branch.name.toLocaleLowerCase().includes(needle)) {
      continue
    }
    insert(branch.kind === 'local' ? local : remote, branch.name.split('/'), branch)
  }
  const groups: GitLogBranchTreeNode[] = []
  const localChildren = toNodes(local, 'local')
  if (localChildren.length > 0) {
    groups.push({ kind: 'group', key: 'local', children: localChildren })
  }
  const remoteChildren = toNodes(remote, 'remote')
  if (remoteChildren.length > 0) {
    groups.push({ kind: 'group', key: 'remote', children: remoteChildren })
  }
  return groups
}

export function flattenGitLogBranchTree(
  nodes: readonly GitLogBranchTreeNode[],
  collapsedKeys: ReadonlySet<string>,
  options: { isFiltering?: boolean } = {},
  depth = 0
): GitLogBranchTreeRow[] {
  const rows: GitLogBranchTreeRow[] = []
  for (const node of nodes) {
    rows.push({ node, depth })
    if (node.kind === 'branch') {
      continue
    }
    // Why: while filtering, collapse state would hide the very matches the user searched for.
    if (options.isFiltering || !collapsedKeys.has(node.key)) {
      rows.push(...flattenGitLogBranchTree(node.children, collapsedKeys, options, depth + 1))
    }
  }
  return rows
}
