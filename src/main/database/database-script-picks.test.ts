import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DatabaseScriptPicks } from './database-script-picks'

const dir = mkdtempSync(join(tmpdir(), 'orca-script-picks-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function file(name: string, text: string): string {
  writeFileSync(join(dir, name), text)
  return join(dir, name)
}

describe('DatabaseScriptPicks', () => {
  it('hands out a token for the chosen files, in numbered order, with their sizes', async () => {
    const paths = [file('10_b.sql', 'select 2;'), file('2_a.sql', 'select 1;')]
    const picks = new DatabaseScriptPicks()
    const picked = await picks.register(paths)
    expect(picked?.files).toEqual([
      { name: '2_a.sql', size: 9 },
      { name: '10_b.sql', size: 9 }
    ])
    expect(picks.files(picked!.token)?.map((source) => source.path)).toEqual([paths[1], paths[0]])
  })

  it('returns nothing for a cancelled dialog, an unknown token or an expired one', async () => {
    let now = 0
    const picks = new DatabaseScriptPicks(() => now)
    expect(await picks.register(null)).toBeNull()
    expect(picks.files('not-a-token')).toBeNull()
    const picked = await picks.register([file('c.sql', 'x')])
    now += 60 * 60 * 1000
    expect(picks.files(picked!.token)).toBeNull()
  })
})
