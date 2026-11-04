import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sshCommandDraftSchema, type SshCommandDraft } from '../../shared/ssh-command-types'
import { SshCommandStore } from './ssh-command-store'

const DRAFT: SshCommandDraft = {
  name: 'Tail a service',
  template: 'journalctl -u {{service}} -n {{lines}} --no-pager',
  params: [
    {
      key: 'service',
      label: 'Service',
      kind: 'text',
      defaultValue: 'nginx',
      required: true,
      quote: 'shell'
    },
    {
      key: 'lines',
      label: 'Lines',
      kind: 'number',
      defaultValue: '100',
      required: true,
      quote: 'shell'
    }
  ],
  runMode: 'insert',
  scope: { type: 'all' }
}

describe('SshCommandStore', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-ssh-commands-'))
    filePath = join(dir, 'ssh-commands.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps commands across instances', () => {
    const saved = new SshCommandStore(filePath).save(undefined, DRAFT)

    expect(new SshCommandStore(filePath).list()).toEqual([saved])
  })

  it('replaces a command saved under the same id', () => {
    const store = new SshCommandStore(filePath)
    const saved = store.save(undefined, DRAFT)

    store.save(saved.id, { ...DRAFT, name: 'Renamed' })

    expect(store.list().map((command) => command.name)).toEqual(['Renamed'])
  })

  it('deletes a command', () => {
    const store = new SshCommandStore(filePath)
    const saved = store.save(undefined, DRAFT)

    store.delete(saved.id)

    expect(new SshCommandStore(filePath).list()).toEqual([])
  })

  it('refuses to read a broken file, so the next save cannot erase it', () => {
    writeFileSync(filePath, '{ not json')
    const store = new SshCommandStore(filePath)

    expect(() => store.save(undefined, DRAFT)).toThrow('not valid JSON')
    expect(readFileSync(filePath, 'utf8')).toBe('{ not json')
  })

  it('skips one bad record and keeps the rest', () => {
    const good = { ...DRAFT, id: 'good' }
    writeFileSync(filePath, JSON.stringify({ version: 1, commands: [good, { id: 'bad' }] }))

    expect(new SshCommandStore(filePath).list()).toEqual([good])
  })

  it('keeps a record it cannot read through later saves and deletes', () => {
    const good = { ...DRAFT, id: 'good' }
    const future = { id: 'future', kind: 'something new' }
    writeFileSync(filePath, JSON.stringify({ version: 1, commands: [good, future] }))
    const store = new SshCommandStore(filePath)

    store.save(undefined, DRAFT)
    store.delete('good')

    expect(JSON.parse(readFileSync(filePath, 'utf8')).commands).toContainEqual(future)
  })

  it.each([
    ['a file from a newer version', { version: 2, commands: [] }],
    ['a list at the top', []],
    ['commands that are not a list', { version: 1, commands: {} }],
    ['no commands at all', { version: 1 }]
  ])('refuses to overwrite %s', (_label, content) => {
    const original = JSON.stringify(content)
    writeFileSync(filePath, original)
    const store = new SshCommandStore(filePath)

    expect(() => store.save(undefined, DRAFT)).toThrow()
    expect(readFileSync(filePath, 'utf8')).toBe(original)
  })

  it('takes a hand edit without a restart', () => {
    const store = new SshCommandStore(filePath)
    store.list()
    writeFileSync(filePath, JSON.stringify({ version: 1, commands: [{ ...DRAFT, id: 'edited' }] }))

    expect(store.list().map((command) => command.id)).toEqual(['edited'])
  })
})

describe('sshCommandDraftSchema', () => {
  it('rejects a template that could drive the terminal', () => {
    expect(sshCommandDraftSchema.safeParse({ ...DRAFT, template: 'a\u001b[0m' }).success).toBe(
      false
    )
  })

  it('rejects a tab, which the remote shell would take as asking for completion', () => {
    expect(sshCommandDraftSchema.safeParse({ ...DRAFT, template: 'a\tb' }).success).toBe(false)
  })

  it('accepts line breaks, which are flattened before anything is sent', () => {
    expect(sshCommandDraftSchema.safeParse({ ...DRAFT, template: 'a\nb' }).success).toBe(true)
  })

  it('rejects a parameter name that could never match the template', () => {
    const params = [{ ...DRAFT.params[0], key: 'bad key' }]

    expect(sshCommandDraftSchema.safeParse({ ...DRAFT, params }).success).toBe(false)
  })

  it('rejects two parameters with one name', () => {
    const params = [DRAFT.params[0], DRAFT.params[0]]

    expect(sshCommandDraftSchema.safeParse({ ...DRAFT, params }).success).toBe(false)
  })
})
