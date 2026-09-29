import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(import.meta.dirname, '../../..', '..')

const require = createRequire(import.meta.url)
const electronBuilderConfig = require('../../../electron-builder.config.cjs')

describe('electron-builder config', () => {
  // Why: SFTP downloads fork this entry from disk; packed inside asar it cannot start and every
  // download fails. The client and packaging must agree on the filename, so it is read from source.
  it('unpacks the SFTP local writer entry that downloads fork', async () => {
    const clientSource = await readFile(
      join(REPO_ROOT, 'src', 'main', 'sftp', 'local-writer', 'sftp-local-writer.ts'),
      'utf8'
    )
    const entryFilename = clientSource.match(/ENTRY_FILENAME = '([^']+)'/)?.[1]

    expect(entryFilename).toBe('sftp-local-writer-entry.js')
    expect(electronBuilderConfig.asarUnpack).toContain(`out/main/${entryFilename}`)
    const entryPoints = await readFile(
      join(REPO_ROOT, 'config', 'build-plugins', 'main-build-entry-points.ts'),
      'utf8'
    )
    expect(entryPoints).toMatch(/'sftp-local-writer-entry':\s*resolve\(/)
  })
})
