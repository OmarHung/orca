import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SshVpnStore } from './ssh-vpn-store'

const DRAFT = { name: 'Office', ovpnPath: '/vpn/office.ovpn', idleMinutes: 10 }

describe('SshVpnStore', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-ssh-vpn-store-'))
    filePath = join(dir, 'ssh-vpn.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('persists profiles and host assignments across instances', () => {
    const store = new SshVpnStore(filePath)
    const profile = store.saveProfile(undefined, DRAFT)
    store.setAssignment('target-a', profile.id)

    const reopened = new SshVpnStore(filePath)
    expect(reopened.listProfiles()).toEqual([profile])
    expect(reopened.profileForTarget('target-a')).toEqual(profile)
    expect(reopened.profileForTarget('target-b')).toBeNull()
  })

  it('updates in place and unassigns hosts when a profile is deleted', () => {
    const store = new SshVpnStore(filePath)
    const office = store.saveProfile(undefined, DRAFT)
    const lab = store.saveProfile(undefined, { ...DRAFT, name: 'Lab' })
    store.saveProfile(office.id, { ...DRAFT, idleMinutes: 0 })
    store.setAssignment('target-a', office.id)
    store.setAssignment('target-b', lab.id)

    store.deleteProfile(office.id)

    expect(store.listProfiles()).toEqual([lab])
    expect(store.listAssignments()).toEqual({ 'target-b': lab.id })
    store.setAssignment('target-b', null)
    expect(new SshVpnStore(filePath).listAssignments()).toEqual({})
  })

  it('prunes assignments of removed hosts', () => {
    const store = new SshVpnStore(filePath)
    const profile = store.saveProfile(undefined, DRAFT)
    store.setAssignment('kept', profile.id)
    store.setAssignment('gone', profile.id)

    store.pruneAssignments(new Set(['kept']))

    expect(store.listAssignments()).toEqual({ kept: profile.id })
  })

  it('picks up edits made to the file by someone else', () => {
    const store = new SshVpnStore(filePath)
    const profile = store.saveProfile(undefined, DRAFT)
    expect(store.profileForTarget('target-a')).toBeNull()

    const edited = JSON.parse(readFileSync(filePath, 'utf8'))
    edited.assignments = { 'target-a': profile.id }
    writeFileSync(filePath, JSON.stringify(edited))
    // Why: same-millisecond writes would share an mtime; move it so the change is observable.
    utimesSync(filePath, new Date(), new Date(Date.now() + 5_000))

    expect(store.profileForTarget('target-a')).toEqual(profile)
  })

  it('fails closed: an assignment to a missing or invalid profile throws instead of going direct', () => {
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        profiles: [{ id: 'bad-profile', name: 'x', ovpnPath: 'relative.ovpn', idleMinutes: 1 }],
        assignments: { a: 'bad-profile' }
      })
    )

    expect(() => new SshVpnStore(filePath).profileForTarget('a')).toThrow(/missing or invalid/)
    expect(new SshVpnStore(filePath).profileForTarget('unassigned')).toBeNull()
  })

  it('fails closed on a file that is not JSON, and never overwrites it', () => {
    writeFileSync(filePath, '{ not json')
    const store = new SshVpnStore(filePath)

    expect(() => store.profileForTarget('a')).toThrow(/not valid JSON/)
    expect(() => store.saveProfile(undefined, DRAFT)).toThrow(/not valid JSON/)
    expect(readFileSync(filePath, 'utf8')).toBe('{ not json')
  })

  it('skips malformed records instead of dropping the whole file', () => {
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        profiles: [
          { id: 'profile-0001', ...DRAFT },
          { id: 'bad', name: '', ovpnPath: 'relative.ovpn', idleMinutes: -1 }
        ],
        assignments: { a: 'profile-0001', b: 42 }
      })
    )

    const store = new SshVpnStore(filePath)

    expect(store.listProfiles()).toEqual([{ id: 'profile-0001', ...DRAFT }])
    expect(store.listAssignments()).toEqual({ a: 'profile-0001' })
    expect(JSON.parse(readFileSync(filePath, 'utf8')).version).toBe(1)
  })
})
