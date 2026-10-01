import { classifyScript } from './node-run-configurations'
import { joinProjectPath } from './project-path'
import { readPyprojectTables, type PyprojectTables } from './pyproject-tables'
import {
  quoteShellArgument,
  type DetectedRunConfiguration,
  type RunConfigurationKind
} from './run-configuration-types'

export type PythonRunner = 'uv' | 'poetry' | 'pdm' | 'pipenv'

/** A virtualenv inside the project; `executables` are the names in its bin/Scripts folder. */
export type PythonVirtualEnv = {
  dirName: string
  layout: 'posix' | 'windows'
  executables: readonly string[]
}

const RUNNER_FILES: [string, PythonRunner][] = [
  ['uv.lock', 'uv'],
  ['poetry.lock', 'poetry'],
  ['pdm.lock', 'pdm'],
  ['Pipfile.lock', 'pipenv'],
  ['Pipfile', 'pipenv']
]

export const PYTHON_VIRTUAL_ENV_DIRS = ['.venv', 'venv', 'env']
const ENTRY_FILES = ['main.py', 'app.py']
const PYTEST_CONFIG_FILES = ['pytest.ini', 'conftest.py']
const PYTHON_PROJECT_FILES = new Set([
  'pyproject.toml',
  'manage.py',
  'setup.py',
  ...ENTRY_FILES,
  ...PYTEST_CONFIG_FILES
])
const DJANGO_COMMANDS: [string, RunConfigurationKind][] = [
  ['runserver', 'run'],
  ['migrate', 'other'],
  ['makemigrations', 'other'],
  ['test', 'test'],
  ['shell', 'other']
]

/** Whether a folder holding this file is worth reading as a Python project. */
export function isPythonProjectFile(name: string): boolean {
  return PYTHON_PROJECT_FILES.has(name)
}

function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path)
}

type Launcher = {
  /** How to start the project's interpreter in a terminal. */
  python: string
  /** How to start a `[project.scripts]` entry point; null when it cannot be reached. */
  entryPoint: (name: string) => string | null
}

function launcherFor(
  projectDir: string,
  fileNames: readonly string[],
  venv: PythonVirtualEnv | null
): Launcher {
  const names = new Set(fileNames)
  const runner = RUNNER_FILES.find(([file]) => names.has(file))?.[1]
  if (runner) {
    return { python: `${runner} run python`, entryPoint: (name) => `${runner} run ${name}` }
  }
  if (venv?.layout === 'posix') {
    const bin = `${venv.dirName}/bin`
    return {
      python: `${bin}/python`,
      entryPoint: (name) => (venv.executables.includes(name) ? `${bin}/${name}` : null)
    }
  }
  if (venv?.layout === 'windows') {
    // Why forward slashes and ./: PowerShell and Git Bash both take them; cmd.exe takes neither.
    const scripts = `./${venv.dirName}/Scripts`
    return {
      python: `${scripts}/python.exe`,
      entryPoint: (name) =>
        venv.executables.includes(`${name}.exe`) ? `${scripts}/${name}.exe` : null
    }
  }
  // Why: macOS and most Linux distros ship only `python3`; Windows installers only `python`.
  return { python: isWindowsPath(projectDir) ? 'python' : 'python3', entryPoint: () => null }
}

function projectNameOf(tables: PyprojectTables | null, projectDir: string): string {
  return (
    tables?.get('project')?.get('name') ??
    tables?.get('tool.poetry')?.get('name') ??
    projectDir
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) ??
    projectDir
  )
}

function entryPointNames(tables: PyprojectTables | null): string[] {
  const names = [
    ...(tables?.get('project.scripts')?.keys() ?? []),
    ...(tables?.get('tool.poetry.scripts')?.keys() ?? [])
  ]
  return [...new Set(names)]
}

function usesPytest(fileNames: readonly string[], tables: PyprojectTables | null): boolean {
  return (
    PYTEST_CONFIG_FILES.some((file) => fileNames.includes(file)) ||
    Boolean(tables?.has('tool.pytest.ini_options'))
  )
}

/**
 * Entry files (main.py, app.py), Django's manage.py commands, `[project.scripts]` entry points
 * and pytest, each run through the project's runner (uv, Poetry, PDM, Pipenv) or virtualenv.
 */
export function detectPythonRunConfigurations(options: {
  projectDir: string
  fileNames: readonly string[]
  pyprojectText: string | null
  venv: PythonVirtualEnv | null
}): DetectedRunConfiguration[] {
  const { projectDir, fileNames } = options
  const tables = options.pyprojectText === null ? null : readPyprojectTables(options.pyprojectText)
  const launcher = launcherFor(projectDir, fileNames, options.venv)
  const base = {
    ecosystem: 'python' as const,
    projectName: projectNameOf(tables, projectDir),
    projectDir
  }
  const idBase = `python:${projectDir}`
  const configurations: DetectedRunConfiguration[] = []
  for (const file of ENTRY_FILES.filter((name) => fileNames.includes(name))) {
    configurations.push({
      ...base,
      id: `${idBase}:file:${file}`,
      kind: 'run',
      name: file,
      command: `${launcher.python} ${file}`,
      debug: { kind: 'python-file', filePath: joinProjectPath(projectDir, file) }
    })
  }
  if (fileNames.includes('manage.py')) {
    const managePath = joinProjectPath(projectDir, 'manage.py')
    for (const [command, kind] of DJANGO_COMMANDS) {
      configurations.push({
        ...base,
        id: `${idBase}:django:${command}`,
        kind,
        name: `manage.py ${command}`,
        command: `${launcher.python} manage.py ${command}`,
        ...(kind === 'run' || kind === 'test'
          ? {
              debug: { kind: 'python-file' as const, filePath: managePath },
              debugOptions: { args: [command] }
            }
          : {})
      })
    }
  }
  for (const name of entryPointNames(tables)) {
    // Why: an entry point name is also an executable name, so it never needs quoting.
    const command = quoteShellArgument(name) === name ? launcher.entryPoint(name) : null
    // Why: without a runner or an installed virtualenv the entry point is not on any PATH.
    if (command === null) {
      continue
    }
    configurations.push({
      ...base,
      id: `${idBase}:script:${name}`,
      kind: classifyScript(name),
      name,
      command
    })
  }
  if (usesPytest(fileNames, tables)) {
    configurations.push({
      ...base,
      id: `${idBase}:pytest`,
      kind: 'test',
      name: 'pytest',
      command: `${launcher.python} -m pytest`,
      debug: { kind: 'python-module', module: 'pytest' }
    })
  }
  return configurations
}
