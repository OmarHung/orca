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

function renderIcon(name: string, kind: SftpEntry['kind']): SVGElement | null {
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
  return container.querySelector('svg')
}

function iconClassFor(name: string, kind: SftpEntry['kind']): string {
  return renderIcon(name, kind)?.getAttribute('class') ?? ''
}

function extensionLabelFor(name: string): string | null {
  return renderIcon(name, 'file')?.querySelector('text')?.textContent ?? null
}

describe('SftpFileRow icon', () => {
  it('prints the extension on the icon of files that have one', () => {
    expect(extensionLabelFor('app.tsx')).toBe('TSX')
    expect(extensionLabelFor('photo.PNG')).toBe('PNG')
    expect(extensionLabelFor('backup.tar.gz')).toBe('GZ')
    expect(extensionLabelFor('Package.swift')).toBe('SWIFT')
  })

  it('keeps the file-type icon when there is no extension or it is too long to read', () => {
    expect(iconClassFor('Dockerfile', 'file')).toContain('lucide-file-cog')
    expect(extensionLabelFor('.bashrc')).toBeNull()
    expect(iconClassFor('trailing.', 'file')).toContain('lucide-file ')
    expect(iconClassFor('app.properties', 'file')).toContain('lucide-file-sliders')
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
