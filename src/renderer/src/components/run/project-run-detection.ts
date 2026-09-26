import { useAppStore } from '@/store'
import { basename, dirname, getRelativePathInsideRoot, joinPath } from '@/lib/path'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { readRuntimeDirectory } from '@/runtime/runtime-file-mutation-client'
import { readRuntimeFileContent } from '@/runtime/runtime-file-read-client'
import type { RuntimeFileOperationArgs } from '@/runtime/runtime-file-client-types'
import { getTabEntryFileOperationContext } from '../tab-bar/tab-create-entry-local-path'
import {
  detectDotnetRunConfigurations,
  isDotnetProjectFile
} from '../../../../shared/run-configurations/dotnet-run-configurations'
import { detectNodeRunConfigurations } from '../../../../shared/run-configurations/node-run-configurations'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import type { DirEntry } from '../../../../shared/filesystem-entry-types'

export type ProjectFiles = {
  listNames: (dir: string) => Promise<string[]>
  /** Names of the real (non-symlink) subdirectories. */
  listDirectories: (dir: string) => Promise<string[]>
  readText: (path: string) => Promise<string | null>
}

function projectFilesFor(context: RuntimeFileOperationArgs, worktreeRoot: string): ProjectFiles {
  const listEntries = async (dir: string): Promise<DirEntry[]> => {
    try {
      return await readRuntimeDirectory(context, dir)
    } catch {
      return []
    }
  }
  return {
    listNames: async (dir) => (await listEntries(dir)).map((entry) => entry.name),
    listDirectories: async (dir) =>
      (await listEntries(dir))
        .filter((entry) => entry.isDirectory && !entry.isSymlink)
        .map((entry) => entry.name),
    readText: async (filePath) => {
      try {
        const file = await readRuntimeFileContent({
          settings: context.settings,
          filePath,
          relativePath: getRelativePathInsideRoot(filePath, worktreeRoot) ?? undefined,
          worktreeId: context.worktreeId ?? undefined,
          connectionId: context.connectionId
        })
        return file.isBinary ? null : file.content
      } catch {
        return null
      }
    }
  }
}

/** File access for a workspace on whatever host owns it (local, WSL, SSH, remote runtime). */
export function worktreeProjectFiles(
  worktreeId: string
): { root: string; files: ProjectFiles } | null {
  const state = useAppStore.getState()
  const worktree = findWorktreeById(state.worktreesByRepo, worktreeId)
  if (!worktree) {
    return null
  }
  const context = getTabEntryFileOperationContext(state, worktreeId, worktree.path)
  return {
    root: worktree.path,
    files: projectFilesFor(context, worktree.path)
  }
}

async function detectDotnet(
  dir: string,
  projectFileName: string,
  files: ProjectFiles
): Promise<DetectedRunConfiguration[]> {
  const projectXml = await files.readText(joinPath(dir, projectFileName))
  if (projectXml === null) {
    return []
  }
  const properties = joinPath(dir, 'Properties')
  const publishProfileNames = (await files.listNames(joinPath(properties, 'PublishProfiles')))
    .filter((name) => name.toLowerCase().endsWith('.pubxml'))
    .map((name) => name.replace(/\.pubxml$/i, ''))
  return detectDotnetRunConfigurations({
    projectDir: dir,
    projectFileName,
    projectXml,
    launchSettingsText: await files.readText(joinPath(properties, 'launchSettings.json')),
    publishProfileNames
  })
}

/**
 * Run configurations for a file-tree node: a folder contributes every project it directly
 * contains; a project file (package.json, *.csproj) contributes just that project.
 */
export async function detectProjectRunConfigurations(
  worktreeId: string,
  path: string,
  isDirectory: boolean,
  files?: ProjectFiles
): Promise<DetectedRunConfiguration[]> {
  const workspace = worktreeProjectFiles(worktreeId)
  const projectFiles = workspace ? (files ?? workspace.files) : null
  if (!projectFiles) {
    return []
  }
  const dir = isDirectory ? path : dirname(path)
  const names = await projectFiles.listNames(dir)
  const selected = isDirectory ? names : names.filter((name) => name === basename(path))
  const configurations: DetectedRunConfiguration[] = []
  if (selected.includes('package.json')) {
    const packageJsonText = await projectFiles.readText(joinPath(dir, 'package.json'))
    if (packageJsonText !== null) {
      configurations.push(
        ...detectNodeRunConfigurations({
          projectDir: dir,
          fileNames: names,
          packageJsonText
        })
      )
    }
  }
  for (const projectFileName of selected.filter(isDotnetProjectFile).sort()) {
    configurations.push(...(await detectDotnet(dir, projectFileName, projectFiles)))
  }
  return configurations
}

/** Cheap filename check so the context menu only probes folders and files that can be projects. */
export function mayContainRunConfigurations(name: string, isDirectory: boolean): boolean {
  return isDirectory || name === 'package.json' || isDotnetProjectFile(name)
}

// Why skipped: dependency, build-output and tool folders never hold the projects people run.
const SKIPPED_WORKSPACE_DIRS = new Set([
  'node_modules',
  'bin',
  'obj',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  'coverage'
])
const WORKSPACE_SCAN_DEPTH = 4
const MAX_WORKSPACE_SCAN_DIRS = 200

/**
 * Run configurations for the whole workspace: the root and folders up to four levels down,
 * which covers `frontend/admin/` and `backend/src/Api/` layouts without walking the tree.
 */
export async function detectWorkspaceRunConfigurations(
  worktreeId: string,
  files?: ProjectFiles
): Promise<DetectedRunConfiguration[]> {
  const workspace = worktreeProjectFiles(worktreeId)
  const projectFiles = workspace ? (files ?? workspace.files) : null
  if (!workspace || !projectFiles) {
    return []
  }
  const dirs: string[] = []
  let level = [workspace.root]
  for (let depth = 0; depth <= WORKSPACE_SCAN_DEPTH && level.length > 0; depth += 1) {
    dirs.push(...level)
    const children = await Promise.all(
      level.map(async (dir) =>
        depth === WORKSPACE_SCAN_DEPTH
          ? []
          : (await projectFiles.listDirectories(dir))
              .filter((name) => !name.startsWith('.') && !SKIPPED_WORKSPACE_DIRS.has(name))
              .map((name) => joinPath(dir, name))
      )
    )
    level = children.flat().slice(0, MAX_WORKSPACE_SCAN_DIRS - dirs.length)
  }
  const found = await Promise.all(
    dirs.map((dir) => detectProjectRunConfigurations(worktreeId, dir, true, projectFiles))
  )
  return found.flat()
}
