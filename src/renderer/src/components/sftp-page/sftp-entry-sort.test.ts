import { describe, expect, it } from 'vitest'
import type { SftpEntry } from '../../../../shared/sftp-types'
import { sftpCellText, sftpEntryTypeLabel } from './sftp-columns'
import { nextSftpSort, sortSftpEntriesBy } from './sftp-entry-sort'

function entry(overrides: Partial<SftpEntry> & Pick<SftpEntry, 'name'>): SftpEntry {
  return {
    path: `/srv/${overrides.name}`,
    kind: 'file',
    size: 0,
    modifiedMs: 0,
    createdMs: null,
    owner: null,
    ...overrides
  }
}

const entries = [
  entry({ name: 'b.log', size: 300, modifiedMs: 3, owner: 'root' }),
  entry({ name: 'logs', kind: 'directory', modifiedMs: 9 }),
  entry({ name: 'a10.txt', size: 100, modifiedMs: 1, owner: 'deploy' }),
  entry({ name: 'a2.txt', size: 200, modifiedMs: 2, owner: 'deploy' })
]

function names(list: SftpEntry[]): string[] {
  return list.map((item) => item.name)
}

describe('sortSftpEntriesBy', () => {
  it('keeps folders first and orders names naturally', () => {
    expect(names(sortSftpEntriesBy(entries, { column: 'name', direction: 'asc' }))).toEqual([
      'logs',
      'a2.txt',
      'a10.txt',
      'b.log'
    ])
  })

  it('sorts by size or date in either direction, folders still first', () => {
    expect(names(sortSftpEntriesBy(entries, { column: 'size', direction: 'desc' }))).toEqual([
      'logs',
      'b.log',
      'a2.txt',
      'a10.txt'
    ])
    expect(names(sortSftpEntriesBy(entries, { column: 'modified', direction: 'asc' }))).toEqual([
      'logs',
      'a10.txt',
      'a2.txt',
      'b.log'
    ])
  })

  it('breaks owner ties by name', () => {
    expect(names(sortSftpEntriesBy(entries, { column: 'owner', direction: 'asc' }))).toEqual([
      'logs',
      'a2.txt',
      'a10.txt',
      'b.log'
    ])
  })
})

describe('nextSftpSort', () => {
  it('flips the sorted column and starts other columns ascending', () => {
    expect(nextSftpSort({ column: 'size', direction: 'asc' }, 'size')).toEqual({
      column: 'size',
      direction: 'desc'
    })
    expect(nextSftpSort({ column: 'size', direction: 'desc' }, 'name')).toEqual({
      column: 'name',
      direction: 'asc'
    })
  })
})

describe('sftp cells', () => {
  it('labels types by kind and extension, treating dotfiles as extensionless', () => {
    expect(sftpEntryTypeLabel(entry({ name: 'app.tar.gz' }))).toBe('GZ file')
    expect(sftpEntryTypeLabel(entry({ name: '.bashrc' }))).toBe('File')
    expect(sftpEntryTypeLabel(entry({ name: 'logs', kind: 'directory' }))).toBe('Folder')
  })

  it('shows a dash where the side has no value, such as remote creation times', () => {
    expect(sftpCellText('created', entry({ name: 'a' }))).toBe('—')
    expect(sftpCellText('size', entry({ name: 'logs', kind: 'directory' }))).toBe('—')
    expect(sftpCellText('owner', entry({ name: 'a', owner: 'deploy' }))).toBe('deploy')
  })
})
