import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ClaudeLaunchProject } from '../../../../shared/agent-accounts/claude/claude-project-account'
import { writeFileAtomically } from '../../../filesystem/atomic-file-publication'

export type LaunchProject = ClaudeLaunchProject

const HEX_NAME = /^(?:[0-9a-f]{2})+$/

/** The `claude` shell function re-reads a pointer on every launch; an empty one is System default. */
function writePointerFile(path: string, home: string): void {
  // Avoid rewriting the pointer on every launch.
  if (existsSync(path) && readFileSync(path, 'utf8') === home) {
    return
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileAtomically(path, home, { mode: 0o600 })
}

/**
 * The host's pointer files: one for the Accounts selection, and one per project whose terminals
 * were handed one, so a project's own account switch reaches its open terminals.
 */
export class ClaudeProfilePointers {
  readonly globalPath: string
  private readonly projectDir: string

  constructor(
    dataRoot: string,
    /** The routed home for a launch; undefined is System default. */
    private readonly homeFor: (project?: ClaudeLaunchProject) => string | undefined
  ) {
    this.globalPath = join(dataRoot, 'claude-profiles', 'selected-host')
    this.projectDir = join(dataRoot, 'claude-profiles', 'projects')
  }

  /** Hex keeps any repo id a safe, case-insensitive-filesystem-proof name that maps back to it. */
  path(project?: ClaudeLaunchProject): string {
    return project
      ? join(this.projectDir, Buffer.from(project.repoId, 'utf8').toString('hex'))
      : this.globalPath
  }

  private write(project?: ClaudeLaunchProject): void {
    writePointerFile(this.path(project), this.homeFor(project) ?? '')
  }

  /** A project launch writes its own pointer; any other change re-points every project too. */
  sync(project?: ClaudeLaunchProject): void {
    this.write()
    if (project) {
      this.write(project)
    } else {
      this.refresh()
    }
  }

  /** A project pointer must exist before it is handed to a terminal; failures must not block one. */
  tryWrite(project?: ClaudeLaunchProject): void {
    if (!project) {
      return
    }
    try {
      this.write(project)
    } catch (error) {
      console.warn('[claude-profile] Could not write the project Claude pointer:', error)
    }
  }

  /** Re-point every project that was handed a pointer, after a selection or login change. */
  private refresh(): void {
    let names: string[]
    try {
      names = readdirSync(this.projectDir)
    } catch {
      return
    }
    for (const name of names.filter((entry) => HEX_NAME.test(entry))) {
      this.write({ repoId: Buffer.from(name, 'hex').toString('utf8') })
    }
  }

  clear(): void {
    rmSync(this.globalPath, { force: true })
    rmSync(this.projectDir, { recursive: true, force: true })
  }
}
