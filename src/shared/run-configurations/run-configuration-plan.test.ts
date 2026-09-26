import { describe, expect, it } from 'vitest'
import { normalizeRunConfigurationDefinitions } from './run-configuration-definition'
import { planRunConfiguration } from './run-configuration-plan'

function configs(entries: unknown[]) {
  return normalizeRunConfigurationDefinitions(entries).configurations
}

const names = (list: { name: string }[]) => list.map((entry) => entry.name)

describe('planRunConfiguration', () => {
  it('runs before-launch steps depth first, each once', () => {
    const all = configs([
      { name: 'Restore', command: 'dotnet restore' },
      { name: 'Build', command: 'dotnet build', beforeLaunch: ['Restore'] },
      { name: 'Migrate', command: 'dotnet ef database update', beforeLaunch: ['Build'] },
      {
        name: 'API',
        target: { kind: 'dotnet-project', projectFile: 'Api.csproj' },
        beforeLaunch: ['Build', 'Migrate']
      }
    ])
    const result = planRunConfiguration(all, 'API')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(names(result.plan.beforeLaunch)).toEqual(['Restore', 'Build', 'Migrate'])
      expect(names(result.plan.launches)).toEqual(['API'])
    }
  })

  it('expands nested compounds and merges their before-launch steps', () => {
    const all = configs([
      { name: 'Build', command: 'make' },
      { name: 'Web', command: 'pnpm dev', beforeLaunch: ['Build'] },
      { name: 'Worker', command: 'pnpm worker', beforeLaunch: ['Build'] },
      { name: 'Backend', configurations: ['Worker'] },
      { name: 'All', configurations: ['Web', 'Backend', 'Web'] }
    ])
    const result = planRunConfiguration(all, 'All')
    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(names(result.plan.beforeLaunch)).toEqual(['Build'])
      expect(names(result.plan.launches)).toEqual(['Web', 'Worker'])
    }
  })

  it('rejects missing references, cycles and non-command steps', () => {
    const all = configs([
      { name: 'A', command: 'a', beforeLaunch: ['B'] },
      { name: 'B', command: 'b', beforeLaunch: ['A'] },
      { name: 'C', command: 'c', beforeLaunch: ['Nope'] },
      { name: 'D', target: { kind: 'node-file', filePath: 'a.js' } },
      { name: 'E', command: 'e', beforeLaunch: ['D'] },
      { name: 'Loop', configurations: ['Loop'] }
    ])
    expect(planRunConfiguration(all, 'A')).toEqual({
      ok: false,
      error: { code: 'cycle', reference: 'A' }
    })
    expect(planRunConfiguration(all, 'C')).toEqual({
      ok: false,
      error: { code: 'missing', reference: 'Nope' }
    })
    expect(planRunConfiguration(all, 'E')).toEqual({
      ok: false,
      error: { code: 'step-not-command', reference: 'D' }
    })
    expect(planRunConfiguration(all, 'Loop')).toEqual({
      ok: false,
      error: { code: 'cycle', reference: 'Loop' }
    })
    expect(planRunConfiguration(all, 'Z')).toEqual({
      ok: false,
      error: { code: 'missing', reference: 'Z' }
    })
  })

  it('allows only one debug session per compound', () => {
    const all = configs([
      { name: 'A', target: { kind: 'node-file', filePath: 'a.js' } },
      { name: 'B', target: { kind: 'node-file', filePath: 'b.js' } },
      { name: 'Both', configurations: ['A', 'B'] }
    ])
    expect(planRunConfiguration(all, 'Both')).toEqual({
      ok: false,
      error: { code: 'multiple-debug', reference: 'B' }
    })
  })

  it('reports compounds in between as involved', () => {
    const all = configs([
      { name: 'A', command: 'a' },
      { name: 'Inner', configurations: ['A'] },
      { name: 'Outer', configurations: ['Inner'] }
    ])
    const result = planRunConfiguration(all, 'Outer')
    expect(result.ok && result.plan.involvedIds.sort()).toEqual(['A', 'Inner', 'Outer'])
  })

  it('expands each compound once however often it is listed', () => {
    const entries: unknown[] = [{ name: 'Leaf', command: 'x' }]
    for (let level = 0; level < 30; level += 1) {
      const child = level === 0 ? 'Leaf' : `C${level - 1}`
      entries.push({ name: `C${level}`, configurations: [child, `${child} `, child] })
    }
    const result = planRunConfiguration(configs(entries), 'C29')
    expect(result.ok && names(result.plan.launches)).toEqual(['Leaf'])
  })
})
