import {
  FolderArchive,
  FolderCheck,
  FolderClock,
  FolderCode,
  FolderCog,
  FolderGit2,
  FolderKey,
  FolderOutput,
  FolderPen
} from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { getFolderTypeIcon } from './folder-type-icons'

describe('getFolderTypeIcon', () => {
  it('matches well-known folder names case-insensitively', () => {
    expect(getFolderTypeIcon('.git')).toBe(FolderGit2)
    expect(getFolderTypeIcon('.github')).toBe(FolderGit2)
    expect(getFolderTypeIcon('src')).toBe(FolderCode)
    expect(getFolderTypeIcon('Source')).toBe(FolderCode)
    expect(getFolderTypeIcon('node_modules')).toBe(FolderArchive)
    expect(getFolderTypeIcon('dist')).toBe(FolderOutput)
    expect(getFolderTypeIcon('.vscode')).toBe(FolderCog)
    expect(getFolderTypeIcon('__tests__')).toBe(FolderCheck)
    expect(getFolderTypeIcon('docs')).toBe(FolderPen)
    expect(getFolderTypeIcon('.ssh')).toBe(FolderKey)
    expect(getFolderTypeIcon('logs')).toBe(FolderClock)
  })

  it('uses the last path segment of POSIX and Windows paths', () => {
    expect(getFolderTypeIcon('/repo/packages/app/src')).toBe(FolderCode)
    expect(getFolderTypeIcon('C:\\repo\\node_modules')).toBe(FolderArchive)
    expect(getFolderTypeIcon('/repo/dist/')).toBe(FolderOutput)
  })

  it('returns null for folders without a dedicated icon', () => {
    expect(getFolderTypeIcon('my-feature')).toBeNull()
    expect(getFolderTypeIcon('')).toBeNull()
    expect(getFolderTypeIcon(null)).toBeNull()
  })
})
