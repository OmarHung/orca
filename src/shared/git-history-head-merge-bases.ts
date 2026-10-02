import type { GitHistoryExecutor } from './git-history-types'

/**
 * Best common ancestors of HEAD and a logged branch (`revisions` holds its one resolved oid).
 * Undefined when git fails — including unrelated histories, where merge-base exits 1 — so no
 * commit is claimed for the current branch.
 */
export async function loadHeadMergeBases(
  git: GitHistoryExecutor,
  cwd: string,
  headOid: string,
  revisions: readonly string[]
): Promise<string[] | undefined> {
  const [revision] = revisions
  if (!revision || revisions.length !== 1) {
    return undefined
  }
  if (revision === headOid) {
    return [headOid]
  }
  try {
    const { stdout } = await git(['merge-base', '--all', headOid, revision], cwd)
    const oids = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    return oids.length > 0 ? oids : undefined
  } catch {
    return undefined
  }
}
