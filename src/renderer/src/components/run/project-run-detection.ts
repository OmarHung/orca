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

type ProjectFiles = {
  listNames: (dir: string) => Promise<string[]>
  readText: (path: string) => Promise<string | null>
}

function projectFilesFor(context: RuntimeFileOperationArgs, worktreeRoot: string): ProjectFiles {
  return {
    listNames: async (dir) => {
      try {
        return (await readRuntimeDirectory(context, dir)).map((entry) => entry.name)
      } catch {
        return []
      }
    },
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
  const state = useAppStore.getState()
  const worktree = findWorktreeById(state.worktreesByRepo, worktreeId)
  if (!worktree) {
    return []
  }
  const projectFiles =
    files ??
    projectFilesFor(
      getTabEntryFileOperationContext(state, worktreeId, worktree.path),
      worktree.path
    )
  const dir = isDirectory ? path : dirname(path)
  const names = await projectFiles.listNames(dir)
  const selected = isDirectory ? names : names.filter((name) => name === basename(path))
  const configurations: DetectedRunConfiguration[] = []
  if (selected.includes('package.json')) {
    const packageJsonText = await projectFiles.readText(joinPath(dir, 'package.json'))
    if (packageJsonText !== null) {
      configurations.push(
        ...detectNodeRunConfigurations({ projectDir: dir, fileNames: names, packageJsonText })
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
