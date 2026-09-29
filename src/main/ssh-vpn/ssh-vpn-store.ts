import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
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

/** VPN profiles and host assignments in `userData/ssh-vpn.json`, cached after the first read. */
export class SshVpnStore {
  private cache: StoreState | null = null

  constructor(private readonly filePath: string) {}

  listProfiles(): SshVpnProfile[] {
    return this.state().profiles
  }

  getProfile(id: string): SshVpnProfile | null {
    return this.state().profiles.find((profile) => profile.id === id) ?? null
  }

  saveProfile(id: string | undefined, draft: SshVpnProfileDraft): SshVpnProfile {
    const state = this.state()
    const existing = id ? state.profiles.find((profile) => profile.id === id) : undefined
    const saved: SshVpnProfile = { ...draft, id: existing?.id ?? randomUUID() }
    const profiles = existing
      ? state.profiles.map((profile) => (profile.id === saved.id ? saved : profile))
      : [...state.profiles, saved]
    this.write({ ...state, profiles })
    return saved
  }

  /** Also unassigns every host that used the profile. */
  deleteProfile(id: string): void {
    const state = this.state()
    this.write({
      profiles: state.profiles.filter((profile) => profile.id !== id),
      assignments: Object.fromEntries(
        Object.entries(state.assignments).filter(([, profileId]) => profileId !== id)
      )
    })
  }

  /** The profile a host is routed through, or null (also when the profile was deleted). */
  profileForTarget(targetId: string): SshVpnProfile | null {
    const profileId = this.state().assignments[targetId]
    return profileId ? this.getProfile(profileId) : null
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
    this.cache ??= this.read()
    return this.cache
  }

  private read(): StoreState {
    if (!existsSync(this.filePath)) {
      return { profiles: [], assignments: {} }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
    } catch (error) {
      // Why throw: reading "empty" here would let the next save drop every saved profile.
      if (isUnreadableError(error)) {
        throw error
      }
      return { profiles: [], assignments: {} }
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
    writeDurableSecureJsonFile(this.filePath, file)
    this.cache = state
  }
}
