import { describe, expect, it } from 'vitest'
import { importLaunchJson } from './launch-json-import'

const LAUNCH_JSON = `{
  // VS Code keeps comments and trailing commas in here
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Python: Current File",
      "type": "debugpy",
      "request": "launch",
      "program": "\${file}",
      "args": ["--verbose"],
      "env": { "DEBUG": "1" },
    },
    { "name": "Module", "type": "python", "request": "launch", "module": "app.main", "python": "\${workspaceFolder}/.venv/bin/python" },
    { "name": "Attach", "type": "debugpy", "request": "attach", "connect": { "port": 5678 } },
    { "name": "Server", "type": "node", "request": "launch", "program": "\${workspaceFolder}/server.js", "cwd": "\${workspaceFolder}/api" },
    { "name": "Dev", "type": "pwa-node", "request": "launch", "runtimeExecutable": "pnpm", "runtimeArgs": ["run", "dev"] },
    {
      "name": ".NET Core Launch (web)",
      "type": "coreclr",
      "request": "launch",
      "preLaunchTask": "build",
      "program": "\${workspaceFolder}/bin/Debug/net8.0/Api.dll",
      "args": "--urls http://localhost:5000",
      "cwd": "\${workspaceFolder}"
    },
    { "name": "Chrome", "type": "chrome", "request": "launch", "url": "http://localhost:3000" },
    { "name": "Weird node", "type": "node", "request": "launch", "runtimeExecutable": "deno" }
  ],
  "compounds": [
    { "name": "Full stack", "configurations": ["Server", { "name": "Dev", "folder": "web" }] }
  ]
}`

describe('importLaunchJson', () => {
  it('maps supported launch configurations and compounds', () => {
    const result = importLaunchJson(LAUNCH_JSON)
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.configurations).toEqual([
      {
        type: 'debug',
        id: 'launch:Python: Current File',
        name: 'Python: Current File',
        target: { kind: 'python-file', filePath: '${file}' },
        args: ['--verbose'],
        env: { DEBUG: '1' }
      },
      {
        type: 'debug',
        id: 'launch:Module',
        name: 'Module',
        target: {
          kind: 'python-module',
          module: 'app.main',
          pythonPath: '${workspaceFolder}/.venv/bin/python'
        }
      },
      {
        type: 'debug',
        id: 'launch:Server',
        name: 'Server',
        target: { kind: 'node-file', filePath: '${workspaceFolder}/server.js' },
        cwd: '${workspaceFolder}/api'
      },
      {
        type: 'debug',
        id: 'launch:Dev',
        name: 'Dev',
        target: { kind: 'node-script', packageManager: 'pnpm', script: 'dev' }
      },
      {
        type: 'debug',
        id: 'launch:.NET Core Launch (web)',
        name: '.NET Core Launch (web)',
        target: { kind: 'dotnet-program', program: '${workspaceFolder}/bin/Debug/net8.0/Api.dll' },
        cwd: '${workspaceFolder}',
        args: ['--urls', 'http://localhost:5000']
      },
      {
        type: 'compound',
        id: 'launch:Full stack',
        name: 'Full stack',
        configurations: ['launch:Server', 'launch:Dev']
      }
    ])
    expect(result.skipped).toEqual([
      { name: 'Attach', reason: 'attach' },
      { name: 'Chrome', reason: 'unsupported-type' },
      { name: 'Weird node', reason: 'no-entry-point' }
    ])
    expect(result.preLaunchTasks).toEqual([{ name: '.NET Core Launch (web)', task: 'build' }])
  })

  it('rejects text that is not a launch.json', () => {
    expect(importLaunchJson('{ nope')).toEqual({ ok: false })
    expect(importLaunchJson('[]')).toEqual({ ok: false })
  })
})
