import { describe, expect, it } from 'vitest'
import {
  expandRunConfigurationVariables,
  resolveRunConfigurationPath
} from './run-configuration-variables'

const context = { workspaceFolder: '/repo/wt', file: '/repo/wt/src/app/main.py' }

describe('expandRunConfigurationVariables', () => {
  it('expands workspace and file variables', () => {
    expect(
      expandRunConfigurationVariables(
        '${workspaceFolder}|${workspaceRoot}|${workspaceFolderBasename}|${file}|${fileBasename}|${fileBasenameNoExtension}|${fileDirname}|${fileExtname}|${relativeFile}|${relativeFileDirname}|${pathSeparator}|${/}',
        context
      )
    ).toEqual({
      ok: true,
      value:
        '/repo/wt|/repo/wt|wt|/repo/wt/src/app/main.py|main.py|main|/repo/wt/src/app|.py|src/app/main.py|src/app|/|/'
    })
  })

  it('leaves shell-style variables alone', () => {
    expect(expandRunConfigurationVariables('echo ${HOME} $PATH', context)).toEqual({
      ok: true,
      value: 'echo ${HOME} $PATH'
    })
  })

  it('fails on file variables without an open file', () => {
    expect(expandRunConfigurationVariables('${file}', { workspaceFolder: '/w' })).toEqual({
      ok: false,
      variable: '${file}'
    })
  })

  it('fails on VS Code-only variable namespaces', () => {
    expect(expandRunConfigurationVariables('${env:HOME}/x', context)).toEqual({
      ok: false,
      variable: '${env:HOME}'
    })
    expect(expandRunConfigurationVariables('${input:port}', context)).toMatchObject({ ok: false })
  })

  it('uses Windows separators for a Windows workspace', () => {
    const win = { workspaceFolder: 'C:\\repo\\wt', file: 'C:\\repo\\wt\\src\\a.ts' }
    expect(expandRunConfigurationVariables('${relativeFile}|${/}|${fileDirname}', win)).toEqual({
      ok: true,
      value: 'src\\a.ts|\\|C:\\repo\\wt\\src'
    })
  })
})

describe('resolveRunConfigurationPath', () => {
  it('joins relative paths onto the workspace', () => {
    expect(resolveRunConfigurationPath('./src/a.py', context)).toEqual({
      ok: true,
      value: '/repo/wt/src/a.py'
    })
    expect(resolveRunConfigurationPath('${workspaceFolder}/a.py', context)).toEqual({
      ok: true,
      value: '/repo/wt/a.py'
    })
    expect(resolveRunConfigurationPath('/abs/a.py', context)).toEqual({
      ok: true,
      value: '/abs/a.py'
    })
  })

  it('handles Windows paths', () => {
    const win = { workspaceFolder: 'C:\\repo' }
    expect(resolveRunConfigurationPath('src/a.js', win)).toEqual({
      ok: true,
      value: 'C:\\repo\\src\\a.js'
    })
    expect(resolveRunConfigurationPath('D:\\x\\a.js', win)).toEqual({
      ok: true,
      value: 'D:\\x\\a.js'
    })
  })
})
