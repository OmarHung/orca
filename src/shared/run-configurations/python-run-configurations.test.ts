import { describe, expect, it } from 'vitest'
import { detectPythonRunConfigurations, isPythonProjectFile } from './python-run-configurations'

const PYPROJECT = [
  '[project]',
  'name = "shop"',
  '[project.scripts]',
  'serve = "shop.cli:serve"',
  'build-docs = "shop.docs:build"',
  '"bad name" = "shop.x:y"',
  '[tool.pytest.ini_options]',
  'addopts = "-q"'
].join('\n')

function summary(
  configurations: ReturnType<typeof detectPythonRunConfigurations>
): [string, string, string][] {
  return configurations.map((configuration) => [
    configuration.name,
    configuration.kind,
    configuration.command
  ])
}

describe('isPythonProjectFile', () => {
  it('recognises the files a Python project folder is read for', () => {
    expect(isPythonProjectFile('pyproject.toml')).toBe(true)
    expect(isPythonProjectFile('manage.py')).toBe(true)
    expect(isPythonProjectFile('util.py')).toBe(false)
  })
})

describe('detectPythonRunConfigurations', () => {
  it('runs through the lockfile runner, including entry points and pytest', () => {
    const configurations = detectPythonRunConfigurations({
      projectDir: '/w/shop',
      fileNames: ['pyproject.toml', 'uv.lock', 'main.py'],
      pyprojectText: PYPROJECT,
      venv: null
    })

    expect(configurations.every((configuration) => configuration.projectName === 'shop')).toBe(true)
    expect(summary(configurations)).toEqual([
      ['main.py', 'run', 'uv run python main.py'],
      ['serve', 'run', 'uv run serve'],
      ['build-docs', 'build', 'uv run build-docs'],
      ['pytest', 'test', 'uv run python -m pytest']
    ])
    expect(configurations[0]).toMatchObject({
      id: 'python:/w/shop:file:main.py',
      debug: { kind: 'python-file', filePath: '/w/shop/main.py' }
    })
    expect(configurations[3].debug).toEqual({ kind: 'python-module', module: 'pytest' })
  })

  it('uses a POSIX virtualenv and offers only the entry points installed in it', () => {
    const configurations = detectPythonRunConfigurations({
      projectDir: '/w/shop',
      fileNames: ['pyproject.toml', '.venv', 'app.py'],
      pyprojectText: PYPROJECT,
      venv: { dirName: '.venv', layout: 'posix', executables: ['python', 'serve'] }
    })

    expect(summary(configurations)).toEqual([
      ['app.py', 'run', '.venv/bin/python app.py'],
      ['serve', 'run', '.venv/bin/serve'],
      ['pytest', 'test', '.venv/bin/python -m pytest']
    ])
  })

  it('uses a Windows virtualenv layout', () => {
    const configurations = detectPythonRunConfigurations({
      projectDir: 'C:\\w\\shop',
      fileNames: ['main.py', 'venv'],
      pyprojectText: null,
      venv: { dirName: 'venv', layout: 'windows', executables: ['python.exe'] }
    })

    expect(summary(configurations)).toEqual([
      ['main.py', 'run', './venv/Scripts/python.exe main.py']
    ])
    expect(configurations[0].debug).toEqual({
      kind: 'python-file',
      filePath: 'C:\\w\\shop\\main.py'
    })
  })

  it('falls back to the platform interpreter name and skips unreachable entry points', () => {
    const posix = detectPythonRunConfigurations({
      projectDir: '/w/tool',
      fileNames: ['pyproject.toml', 'main.py'],
      pyprojectText: PYPROJECT,
      venv: null
    })
    const windows = detectPythonRunConfigurations({
      projectDir: 'D:/w/tool',
      fileNames: ['main.py'],
      pyprojectText: null,
      venv: null
    })

    expect(summary(posix).map(([name]) => name)).toEqual(['main.py', 'pytest'])
    expect(posix[0].command).toBe('python3 main.py')
    expect(windows[0].command).toBe('python main.py')
    expect(windows[0].projectName).toBe('tool')
  })

  it('offers Django commands, debugging runserver and test with their arguments', () => {
    const configurations = detectPythonRunConfigurations({
      projectDir: '/w/site',
      fileNames: ['manage.py', 'poetry.lock'],
      pyprojectText: null,
      venv: null
    })

    expect(summary(configurations)).toEqual([
      ['manage.py runserver', 'run', 'poetry run python manage.py runserver'],
      ['manage.py migrate', 'other', 'poetry run python manage.py migrate'],
      ['manage.py makemigrations', 'other', 'poetry run python manage.py makemigrations'],
      ['manage.py test', 'test', 'poetry run python manage.py test'],
      ['manage.py shell', 'other', 'poetry run python manage.py shell']
    ])
    expect(configurations[0]).toMatchObject({
      debug: { kind: 'python-file', filePath: '/w/site/manage.py' },
      debugOptions: { args: ['runserver'] }
    })
    expect(configurations[1].debug).toBeUndefined()
  })
})
