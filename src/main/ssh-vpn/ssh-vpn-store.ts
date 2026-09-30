import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import {
  sshVpnProfileSchema,
  type SshVpnProfile,
  type SshVpnProfileDraft
} from '../../shared/ssh-vpn-types'
import { isUnreadableError, writeDurableSecureJsonFile } from '../../shared/secure-file'

type StoreFile = {
  version: 1
  profiles: SshVpnProfile[]
  /** SSH target id → VPN profile id. Kept here, not on SshTarget, so ~/.ssh/config imports keep it. */
  assignments: Record<string, string>
}

type StoreState = Omit<StoreFile, 'version'>

function parseAssignments(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

/** VPN profiles and host assignments in `userData/ssh-vpn.json`, cached until the file changes. */
export class SshVpnStore {
  private cache: { state: StoreState; mtimeMs: number | null } | null = null

  constructor(private readonly filePath: string) {}

  listProfiles(): SshVpnProfile[] {
    return this.state().profiles
  }

  getProfile(id: string): SshVpnProfile | null {
    return this.state().profiles.find((profile) => profile.id === id) ?? null
  }

  /** Replaces the profile with `id`, or adds one under `id` (a new id when none is given). */
  saveProfile(id: string | undefined, draft: SshVpnProfileDraft): SshVpnProfile {
    const state = this.state()
    const saved: SshVpnProfile = { ...draft, id: id ?? randomUUID() }
    const exists = state.profiles.some((profile) => profile.id === saved.id)
    const profiles = exists
      ? state.profiles.map((profile) => (profile.id === saved.id ? saved : profile))
      : [...state.profiles, saved]
    this.write({ ...state, profiles })
    return saved
  }

  /** Also unassigns every host that used the profile. */
  deleteProfile(id: string): void {
    const state = this.state()
    const profiles = state.profiles.filter((profile) => profile.id !== id)
    const assignments = Object.entries(state.assignments).filter(
      ([, profileId]) => profileId !== id
    )
    if (
      profiles.length !== state.profiles.length ||
      assignments.length !== Object.keys(state.assignments).length
    ) {
      this.write({ profiles, assignments: Object.fromEntries(assignments) })
    }
  }

  /**
   * The profile a host is routed through, or null when it connects directly. Throws when the host
   * is assigned to a profile that is missing or invalid, so it never silently connects directly.
   */
  profileForTarget(targetId: string): SshVpnProfile | null {
    const profileId = this.state().assignments[targetId]
    if (!profileId) {
      return null
    }
    const profile = this.getProfile(profileId)
    if (!profile) {
      throw new Error(
        'This host is set to use a VPN profile that is missing or invalid in ssh-vpn.json. Choose its VPN again, or Direct connection.'
      )
    }
    return profile
  }

  listAssignments(): Record<string, string> {
    return { ...this.state().assignments }
  }

  setAssignment(targetId: string, profileId: string | null): void {
    const state = this.state()
    const rest = Object.fromEntries(
      Object.entries(state.assignments).filter(
        ([assignedTargetId]) => assignedTargetId !== targetId
      )
    )
    this.write({ ...state, assignments: profileId ? { ...rest, [targetId]: profileId } : rest })
  }

  /** Drops assignments whose host no longer exists. */
  pruneAssignments(existingTargetIds: ReadonlySet<string>): void {
    const state = this.state()
    const kept = Object.entries(state.assignments).filter(([targetId]) =>
      existingTargetIds.has(targetId)
    )
    if (kept.length !== Object.keys(state.assignments).length) {
      this.write({ ...state, assignments: Object.fromEntries(kept) })
    }
  }

  private state(): StoreState {
    // Why mtime: a hand edit (or another Orca window) must take effect without a restart.
    const mtimeMs = this.mtimeMs()
    if (!this.cache || this.cache.mtimeMs !== mtimeMs) {
      this.cache = { state: this.read(), mtimeMs }
    }
    return this.cache.state
  }

  private mtimeMs(): number | null {
    try {
      return statSync(this.filePath).mtimeMs
    } catch {
      return null
    }
  }

  private read(): StoreState {
    if (!existsSync(this.filePath)) {
      return { profiles: [], assignments: {} }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
    } catch (error) {
      // Why throw either way: reading "empty" would send every assigned host out directly and
      // let the next save drop every saved profile.
      if (isUnreadableError(error)) {
        throw error
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(
        `The VPN settings file ${this.filePath} is not valid JSON (${reason}). Fix or delete it; until then Orca will not open SSH connections.`
      )
    }
    const raw = typeof parsed === 'object' && parsed !== null ? parsed : {}
    const profiles: unknown = Reflect.get(raw, 'profiles')
    return {
      // Why per entry: one hand-edited or future-format record must not hide the rest.
      profiles: (Array.isArray(profiles) ? profiles : []).flatMap((entry) => {
        const result = sshVpnProfileSchema.safeParse(entry)
        return result.success ? [result.data] : []
      }),
      assignments: parseAssignments(Reflect.get(raw, 'assignments'))
    }
  }

  private write(state: StoreState): void {
    const file: StoreFile = { version: 1, ...state }
    // Why first: a write can fail after it replaced the file, so the next read must go to disk.
    this.cache = null
    writeDurableSecureJsonFile(this.filePath, file)
    this.cache = { state, mtimeMs: this.mtimeMs() }
  }
}
