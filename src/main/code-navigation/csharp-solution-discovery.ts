import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const MAX_DEPTH = 4
const MAX_DIRECTORIES = 2_000
const SOLUTION_PATTERN = /\.(sln|slnx)$/i
// Why: dependency and build-output trees never hold the solution but can hold many directories.
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'bin',
  'obj',
  '.git',
  '.vs',
  '.idea',
  'dist',
  'build',
  'out',
  'packages',
  'vendor',
  'coverage',
  '.next'
])

export type ReadDirectory = (path: string) => Promise<{ name: string; isDirectory: boolean }[]>

async function readDirectoryEntries(path: string) {
  const entries = await readdir(path, { withFileTypes: true })
  return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
}

/**
 * The solution csharp-ls should load, relative to `root`: the shallowest `.sln`/`.slnx`, when it
 * is the only one at that depth. Passing it skips csharp-ls's own crawl of the whole folder (about
 * two seconds on a repo with a frontend); null leaves the choice to csharp-ls.
 */
export async function findCsharpSolution(
  root: string,
  read: ReadDirectory = readDirectoryEntries
): Promise<string | null> {
  let level = [root]
  let visited = 0
  for (let depth = 0; depth <= MAX_DEPTH && level.length > 0; depth += 1) {
    const solutions: string[] = []
    const next: string[] = []
    for (const directory of level) {
      visited += 1
      if (visited > MAX_DIRECTORIES) {
        return null
      }
      const entries = await read(directory).catch(() => [])
      for (const entry of entries) {
        const path = join(directory, entry.name)
        if (entry.isDirectory) {
          if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
            next.push(path)
          }
        } else if (SOLUTION_PATTERN.test(entry.name)) {
          solutions.push(path)
        }
      }
    }
    if (solutions.length > 0) {
      return solutions.length === 1 ? relative(root, solutions[0]) : null
    }
    level = next
  }
  return null
}
