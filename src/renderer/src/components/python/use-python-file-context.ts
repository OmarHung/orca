import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { basename } from '@/lib/path'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { getActiveRuntimeTarget } from '@/runtime/runtime-client-target'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import type { PythonInterpreter } from '../../../../shared/python-interpreter-types'
import { isLocalDebugTarget } from '../debug/debug-launch'
import { useDebugLaunchTarget } from '../debug/use-debug-launch-target'
import type { RunTarget } from '../run/run-configuration-control'
import {
  resolveEffectiveInterpreter,
  usePythonInterpreterStore,
  type PythonInterpreterChoice
} from './python-interpreter-store'
import { buildPythonRunCommand } from './python-run-command'

const NO_INTERPRETERS: PythonInterpreter[] = []

export type PythonFileContext = {
  worktreeId: string
  projectId: string
  projectRoot: string
  filePath: string
  /** Interpreter detection and debugging need the project on this machine. */
  local: boolean
  interpreters: PythonInterpreter[]
  detecting: boolean
  choice: PythonInterpreterChoice
  /** null when nothing was detected (or the project is remote): Run falls back to PATH. */
  interpreter: PythonInterpreter | null
  runTarget: RunTarget
}

function shellPlatform(local: boolean): 'windows' | 'posix' {
  return local && navigator.userAgent.includes('Windows') ? 'windows' : 'posix'
}

/** The active Python file with the interpreter this project runs it with. */
export function usePythonFileContext(): PythonFileContext | null {
  const launch = useDebugLaunchTarget()
  const worktree = useAppStore((s) =>
    launch ? findWorktreeById(s.worktreesByRepo, launch.worktreeId) : undefined
  )
  const repo = useAppStore((s) =>
    worktree ? s.repos.find((candidate) => candidate.id === worktree.repoId) : undefined
  )
  const runtimeIsLocal = useAppStore((s) => getActiveRuntimeTarget(s.settings).kind === 'local')
  const local =
    worktree !== undefined &&
    repo !== undefined &&
    isLocalDebugTarget({
      repoHostId: getRepoExecutionHostId(repo),
      activeRuntimeIsLocal: runtimeIsLocal,
      worktreePath: worktree.path
    })
  const projectRoot = worktree?.path ?? ''
  const detected = usePythonInterpreterStore((s) => s.detectedByRoot[projectRoot])
  const choice = usePythonInterpreterStore((s) => s.choiceFor(repo?.id ?? ''))
  const detect = usePythonInterpreterStore((s) => s.detect)
  const groupId = useAppStore((s) =>
    launch ? (s.activeGroupIdByWorktree[launch.worktreeId] ?? null) : null
  )

  useEffect(() => {
    if (local && projectRoot) {
      void detect(projectRoot)
    }
  }, [detect, local, projectRoot])

  if (!launch || !worktree || !repo) {
    return null
  }
  const interpreters = local ? (detected?.interpreters ?? NO_INTERPRETERS) : NO_INTERPRETERS
  const interpreter = local ? resolveEffectiveInterpreter(choice, interpreters) : null
  const platform = shellPlatform(local)
  const command = buildPythonRunCommand({
    interpreterPath: interpreter?.path ?? (platform === 'windows' ? 'python' : 'python3'),
    filePath: launch.filePath,
    projectRoot,
    platform
  })
  const label = basename(launch.filePath)
  return {
    worktreeId: launch.worktreeId,
    projectId: repo.id,
    projectRoot,
    filePath: launch.filePath,
    local,
    interpreters,
    detecting: local && detected?.status !== 'ready',
    choice,
    interpreter,
    runTarget: {
      worktreeId: launch.worktreeId,
      groupId,
      commandKey: `python-file:${launch.filePath}`,
      command: { id: `python-file:${launch.filePath}`, label, command, appendEnter: true }
    }
  }
}
