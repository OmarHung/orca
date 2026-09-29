// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SftpEntry } from '../../../../shared/sftp-types'
import { DEFAULT_SFTP_COLUMN_WIDTHS } from './sftp-columns'
import { SftpFileRow } from './SftpFileRow'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function iconClassFor(name: string, kind: SftpEntry['kind']): string {
  const entry: SftpEntry = {
    name,
    path: `/srv/${name}`,
    kind,
    size: 0,
    modifiedMs: 0,
    createdMs: null,
    owner: null
  }
  act(() =>
    root.render(
      <SftpFileRow
        entry={entry}
        columns={['name']}
        widths={DEFAULT_SFTP_COLUMN_WIDTHS}
        isSelected={false}
        onClick={() => undefined}
        onDoubleClick={() => undefined}
      />
    )
  )
  return container.querySelector('svg')?.getAttribute('class') ?? ''
}

describe('SftpFileRow icon', () => {
  it('shows a file-type icon for files', () => {
    expect(iconClassFor('app.tsx', 'file')).toContain('lucide-file-code')
    expect(iconClassFor('photo.png', 'file')).toContain('lucide-file-image')
    expect(iconClassFor('notes.unknown', 'file')).toContain('lucide-file ')
  })

  it('shows a folder-type icon for well-known folders and a plain folder otherwise', () => {
    expect(iconClassFor('.git', 'directory')).toContain('lucide-folder-git')
    expect(iconClassFor('node_modules', 'directory')).toContain('lucide-folder-archive')
    expect(iconClassFor('releases-2024', 'directory')).toContain('lucide-folder ')
  })

  it('keeps the symlink icon for symlinks whatever their name', () => {
    expect(iconClassFor('src', 'symlink')).toContain('lucide-file-symlink')
  })
})
