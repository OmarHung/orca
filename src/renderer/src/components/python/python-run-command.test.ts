import { describe, expect, it } from 'vitest'
import { buildPythonRunCommand } from './python-run-command'

describe('buildPythonRunCommand', () => {
  it('uses project-relative paths for a project venv', () => {
    expect(
      buildPythonRunCommand({
        interpreterPath: '/Users/me/app/.venv/bin/python',
        filePath: '/Users/me/app/scripts/server.py',
        projectRoot: '/Users/me/app',
        platform: 'posix'
      })
    ).toBe('.venv/bin/python scripts/server.py')
  })

  it('keeps an interpreter outside the project absolute', () => {
    expect(
      buildPythonRunCommand({
        interpreterPath: '/opt/homebrew/bin/python3',
        filePath: '/Users/me/app/main.py',
        projectRoot: '/Users/me/app',
        platform: 'posix'
      })
    ).toBe('/opt/homebrew/bin/python3 main.py')
  })

  it('quotes paths with spaces or quotes for POSIX shells', () => {
    expect(
      buildPythonRunCommand({
        interpreterPath: '/Users/me/My Envs/py/bin/python',
        filePath: "/Users/me/app/it's here.py",
        projectRoot: '/Users/me/app',
        platform: 'posix'
      })
    ).toBe(`'/Users/me/My Envs/py/bin/python' 'it'\\''s here.py'`)
  })

  it('uses backslashes and double quotes on Windows', () => {
    expect(
      buildPythonRunCommand({
        interpreterPath: 'C:\\app\\.venv\\Scripts\\python.exe',
        filePath: 'C:\\app\\my scripts\\server.py',
        projectRoot: 'C:\\app',
        platform: 'windows'
      })
    ).toBe('.venv\\Scripts\\python.exe "my scripts\\server.py"')
  })
})
