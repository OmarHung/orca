import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CSHARP_RAZOR_DESIGN_TIME_TARGETS,
  ensureCsharpRazorDesignTimeTargets
} from './csharp-razor-design-time'

let baseDir: string

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'orca-razor-targets-'))
})

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true })
})

describe('ensureCsharpRazorDesignTimeTargets', () => {
  it('writes the targets file, and rewrites a stale one', async () => {
    const path = await ensureCsharpRazorDesignTimeTargets(join(baseDir, 'language-servers'))
    expect(await readFile(path, 'utf8')).toBe(CSHARP_RAZOR_DESIGN_TIME_TARGETS)

    await writeFile(path, '<Project />')
    expect(await ensureCsharpRazorDesignTimeTargets(join(baseDir, 'language-servers'))).toBe(path)
    expect(await readFile(path, 'utf8')).toBe(CSHARP_RAZOR_DESIGN_TIME_TARGETS)
  })

  it('only opts netcoreapp3.x and net5.0 into the SDK generator targets', () => {
    expect(CSHARP_RAZOR_DESIGN_TIME_TARGETS).toContain(
      "VersionGreaterThanOrEquals('$(TargetFrameworkVersion)', '3.0')"
    )
    expect(CSHARP_RAZOR_DESIGN_TIME_TARGETS).toContain(
      "VersionLessThan('$(TargetFrameworkVersion)', '6.0')"
    )
    expect(CSHARP_RAZOR_DESIGN_TIME_TARGETS).toContain(
      '<Import Project="$(_OrcaRazorGeneratorTargets)"'
    )
  })
})
