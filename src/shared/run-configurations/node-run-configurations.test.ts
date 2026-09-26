import { describe, expect, it } from 'vitest'
import {
  classifyScript,
  detectNodePackageManager,
  detectNodeRunConfigurations
} from './node-run-configurations'

describe('detectNodePackageManager', () => {
  it('prefers the packageManager field', () => {
    expect(detectNodePackageManager('pnpm@9.1.0', ['package-lock.json'])).toBe('pnpm')
  })

  it('falls back to the lockfile, then npm', () => {
    expect(detectNodePackageManager(undefined, ['yarn.lock'])).toBe('yarn')
    expect(detectNodePackageManager(undefined, ['bun.lockb'])).toBe('bun')
    expect(detectNodePackageManager(undefined, [])).toBe('npm')
  })
})

describe('classifyScript', () => {
  it('maps common script names to kinds', () => {
    expect(classifyScript('build')).toBe('build')
    expect(classifyScript('build:prod')).toBe('build')
    expect(classifyScript('dev')).toBe('run')
    expect(classifyScript('start')).toBe('run')
    expect(classifyScript('test')).toBe('test')
    expect(classifyScript('release')).toBe('publish')
    expect(classifyScript('lint')).toBe('other')
  })
})

describe('detectNodeRunConfigurations', () => {
  it('creates one configuration per script using the project package manager', () => {
    const configurations = detectNodeRunConfigurations({
      projectDir: '/w/web',
      fileNames: ['package.json', 'pnpm-lock.yaml'],
      packageJsonText: JSON.stringify({
        name: 'web',
        private: true,
        scripts: { dev: 'vite', build: 'vite build', 'build app': 'x' }
      })
    })

    expect(configurations).toEqual([
      expect.objectContaining({
        name: 'dev',
        kind: 'run',
        command: 'pnpm run dev',
        projectName: 'web'
      }),
      expect.objectContaining({ name: 'build', kind: 'build', command: 'pnpm run build' }),
      expect.objectContaining({ name: 'build app', command: 'pnpm run "build app"' })
    ])
    expect(configurations[0].id).toBe('node:/w/web:script:dev')
  })

  it('adds publish for a public package without a publish script', () => {
    const configurations = detectNodeRunConfigurations({
      projectDir: '/w/lib',
      fileNames: [],
      packageJsonText: JSON.stringify({ name: 'my-lib', scripts: {} })
    })

    expect(configurations).toEqual([
      expect.objectContaining({ kind: 'publish', command: 'npm publish', name: 'npm publish' })
    ])
  })

  it('uses the folder name when the package has no name, and ignores invalid JSON', () => {
    expect(
      detectNodeRunConfigurations({
        projectDir: '/w/tools',
        fileNames: [],
        packageJsonText: '{"scripts":{"go":"node x.js"}}'
      })[0].projectName
    ).toBe('tools')
    expect(
      detectNodeRunConfigurations({ projectDir: '/w', fileNames: [], packageJsonText: '{oops' })
    ).toEqual([])
  })
})
