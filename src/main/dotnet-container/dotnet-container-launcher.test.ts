import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runProcess, spawnProcess } from '../../shared/child-process/run-process'
import { buildDotnetContainerLauncher } from './dotnet-container-launcher'

const IMAGE = 'orca-dotnet:abc123'
const CONTAINER = 'orca-dotnet-test'
const CONFIG = 'cfg123'

// A docker that keeps one container's state ("running config") in $FAKE_STATE.
const FAKE_DOCKER = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
state=$FAKE_STATE
case "$1" in
  info) [ -n "$FAKE_DOCKER_DOWN" ] && exit 1; exit 0 ;;
  container) [ -f "$state" ] && { cat "$state"; exit 0; }; exit 1 ;;
  image) [ -n "$FAKE_IMAGE_PRESENT" ] && exit 0; exit 1 ;;
  build) cat > /dev/null; exit 0 ;;
  run)
    [ -n "$FAKE_RUN_ERROR" ] && { echo "$FAKE_RUN_ERROR" >&2; exit 125; }
    mkdir "$state.name" 2>/dev/null || { echo 'Conflict: the container name is already in use' >&2; exit 125; }
    echo "false ${CONFIG}" > "$state"
    sleep "\${FAKE_CREATE_DELAY:-0}"
    echo "true ${CONFIG}" > "$state"
    exit 0 ;;
  start) sed 's/^false/true/' "$state" > "$state.tmp" && mv "$state.tmp" "$state"; exit 0 ;;
  rm) rm -rf "$state" "$state.name"; exit 0 ;;
  exec)
    case "$*" in
      *--list*)
        for id in $FAKE_RUN_IDS; do grep -qx "$id" "$state.killed" 2>/dev/null || echo "$id"; done
        exit 0 ;;
      *--kill*) echo "$5" >> "$state.killed"; exit 0 ;;
    esac
    [ -t 0 ] && echo 'stdin is a tty' >> "$FAKE_DOCKER_LOG"
    [ -n "$FAKE_EXEC_SLEEP" ] && sleep "$FAKE_EXEC_SLEEP"
    echo exec-ran
    exit "\${FAKE_EXEC_STATUS:-0}" ;;
esac
exit 0
`

// The Mac's dotnet: exports a dev certificate when asked, otherwise reports how it was called.
const FAKE_NATIVE_DOTNET = `#!/bin/sh
case "$*" in
  "dev-certs https --export-path "*)
    echo "$* (from $(pwd -P))" >> "$FAKE_DOTNET_LOG"
    [ -n "$FAKE_DEVCERTS_FAIL" ] && exit 1
    printf pfx > "$4"
    exit 0 ;;
esac
echo "native: $*"
`

function csproj(tfm: string): string {
  return `<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>${tfm}</TargetFramework></PropertyGroup></Project>`
}

describe.skipIf(process.platform === 'win32')('dotnet container launcher', () => {
  let root: string
  let work: string
  let log: string
  let state: string
  let launcher: string
  let bin: string
  let dockerSettings: string

  function writeExecutable(path: string, content: string): void {
    writeFileSync(path, content)
    chmodSync(path, 0o755)
  }

  function project(dir: string, files: Record<string, string>): string {
    const path = join(work, dir)
    mkdirSync(path, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(path, name), content)
    }
    return path
  }

  function legacyProject(): string {
    return project('legacy', { 'App.csproj': csproj('netcoreapp3.1') })
  }

  function setState(value: string): void {
    writeFileSync(state, `${value}\n`)
  }

  function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
      PATH: `${bin}:/usr/bin:/bin`,
      TMPDIR: root,
      FAKE_DOCKER_LOG: log,
      FAKE_DOTNET_LOG: join(root, 'dotnet.log'),
      FAKE_STATE: state,
      ...extra
    }
  }

  function dockerCalls(): string[] {
    try {
      return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
    } catch {
      return []
    }
  }

  function verbs(): string[] {
    return dockerCalls().map((call) => call.split(' ')[0])
  }

  function runLauncher(cwd: string, args: string[], extra: Record<string, string> = {}) {
    return runProcess({ program: '/bin/sh', args: [launcher, ...args], cwd, env: env(extra) })
  }

  beforeEach(() => {
    // Why realpath: the launcher compares `pwd -P` against the mounts (macOS /var is a symlink).
    root = realpathSync(mkdtempSync(join(os.tmpdir(), 'orca-dotnet-launcher-')))
    work = join(root, 'work')
    bin = join(root, 'bin')
    log = join(root, 'docker.log')
    state = join(root, 'container.state')
    dockerSettings = join(root, 'settings-store.json')
    mkdirSync(work)
    mkdirSync(bin)
    writeExecutable(join(bin, 'docker'), FAKE_DOCKER)
    writeExecutable(join(bin, 'dotnet'), FAKE_NATIVE_DOTNET)
    writeFileSync(join(root, 'Dockerfile'), 'FROM scratch\n')
    writeFileSync(dockerSettings, '{"HostNetworkingEnabled":true}')
    launcher = join(root, 'launcher', 'dotnet')
    mkdirSync(join(root, 'launcher'))
    writeExecutable(
      launcher,
      buildDotnetContainerLauncher({
        dockerPath: join(bin, 'docker'),
        containerName: CONTAINER,
        image: IMAGE,
        dockerfilePath: join(root, 'Dockerfile'),
        platform: 'linux/arm64',
        mounts: [work],
        run: {
          args: ['run', '--detach', '--name', CONTAINER, '--label', `x.config=${CONFIG}`, IMAGE],
          config: CONFIG
        },
        dockerDesktopSettingsPath: dockerSettings,
        httpsCertificateDir: join(work, 'orca-https')
      })
    )
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('execs a netcoreapp3.1 project in the running container from its own directory', async () => {
    const dir = legacyProject()
    setState(`true ${CONFIG}`)
    const result = await runLauncher(dir, ['run', '--launch-profile', 'Dev'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('exec-ran')
    const exec = dockerCalls().find((call) => call.startsWith('exec -i'))
    expect(exec).toContain(`-w ${dir}`)
    expect(exec).toMatch(/orca-exec \d+\.\d+ dotnet run --launch-profile Dev$/)
    expect(verbs()).not.toContain('run')
  })

  it('runs net6.0+ projects with the native dotnet', async () => {
    const dir = project('modern', { 'App.csproj': csproj('net8.0') })
    const result = await runLauncher(dir, ['build'])
    expect(result.stdout.trim()).toBe('native: build')
    expect(dockerCalls()).toEqual([])
  })

  it('uses the container when global.json pins SDK 3, but not for pins the image cannot honor', async () => {
    setState(`true ${CONFIG}`)
    project('pinned3', { 'global.json': '{ "sdk": { "version": "3.1.426" } }' })
    const pinned3 = project('pinned3/App', { 'App.csproj': csproj('net8.0') })
    expect((await runLauncher(pinned3, ['build'])).stdout).toContain('exec-ran')
    project('pinned5', { 'global.json': '{ "sdk": { "version": "5.0.408" } }' })
    const pinned5 = project('pinned5/App', { 'App.csproj': csproj('net8.0') })
    expect((await runLauncher(pinned5, ['build'])).stdout.trim()).toBe('native: build')
  })

  it('follows --project to a legacy project from elsewhere', async () => {
    setState(`true ${CONFIG}`)
    project('repo/src/Web', { 'Web.csproj': csproj('netcoreapp2.2') })
    const result = await runLauncher(join(work, 'repo'), ['run', '--project', 'src/Web/Web.csproj'])
    expect(result.stdout).toContain('exec-ran')
  })

  it('keeps host-only commands and the native override on the Mac', async () => {
    const dir = legacyProject()
    expect((await runLauncher(dir, ['--info'])).stdout.trim()).toBe('native: --info')
    expect((await runLauncher(dir, ['dev-certs', 'https'])).stdout.trim()).toBe(
      'native: dev-certs https'
    )
    const overridden = await runLauncher(dir, ['build'], { ORCA_DOTNET_TOOLCHAIN: 'native' })
    expect(overridden.stdout.trim()).toBe('native: build')
    expect(dockerCalls()).toEqual([])
  })

  it('builds the image and creates the container on first use', async () => {
    const dir = project('legacy', { 'App.csproj': csproj('net5.0') })
    const result = await runLauncher(dir, ['build'])
    expect(result.code).toBe(0)
    expect(verbs()).toEqual(['info', 'container', 'image', 'build', 'run', 'exec', 'exec'])
    expect(result.stderr).toContain('building the .NET container image')
  })

  it('creates the container once when several runs start together', async () => {
    const dir = legacyProject()
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        runLauncher(dir, ['build'], { FAKE_IMAGE_PRESENT: '1', FAKE_CREATE_DELAY: '1' })
      )
    )
    expect(results.map((result) => result.code)).toEqual([0, 0, 0])
    expect(verbs().filter((verb) => verb === 'run')).toHaveLength(1)
    expect(verbs()).not.toContain('rm')
  }, 20_000)

  it('starts a stopped container instead of recreating it', async () => {
    const dir = legacyProject()
    setState(`false ${CONFIG}`)
    await runLauncher(dir, ['build'])
    expect(verbs()).toEqual(['info', 'container', 'start', 'exec', 'exec'])
  })

  it('replaces an idle container created with other settings', async () => {
    const dir = legacyProject()
    setState('true old')
    await runLauncher(dir, ['build'], { FAKE_IMAGE_PRESENT: '1' })
    expect(dockerCalls()).toContain(`rm --force ${CONTAINER}`)
    expect(verbs()).toContain('run')
  })

  it('replaces an out-of-date container once only orphans were left in it', async () => {
    const dir = legacyProject()
    setState('true old')
    await runLauncher(dir, ['build'], { FAKE_IMAGE_PRESENT: '1', FAKE_RUN_IDS: '999999.1' })
    expect(dockerCalls()).toContain(`rm --force ${CONTAINER}`)
    expect(verbs()).toContain('run')
  })

  it('keeps an out-of-date container while programs still run in it', async () => {
    const dir = legacyProject()
    setState('true old')
    const result = await runLauncher(dir, ['build'], { FAKE_RUN_IDS: `${process.pid}.1` })
    expect(verbs()).not.toContain('rm')
    expect(result.stderr).toContain('out of date')
    expect(result.stdout).toContain('exec-ran')
  })

  it('stops programs whose launcher is gone, and only those', async () => {
    const dir = legacyProject()
    setState(`true ${CONFIG}`)
    // Why 999999: above every platform's PID limit, so it is never a live process.
    await runLauncher(dir, ['build'], { FAKE_RUN_IDS: `999999.1 ${process.pid}.2` })
    const kills = dockerCalls().filter((call) => call.includes('--kill'))
    expect(kills[0]).toBe(`exec ${CONTAINER} /usr/local/bin/orca-exec --kill 999999.1`)
    expect(kills.some((call) => call.includes(`--kill ${process.pid}.2`))).toBe(false)
  })

  it("stops what the run left behind once docker exec returns, even if the program's client died", async () => {
    const dir = legacyProject()
    setState(`true ${CONFIG}`)
    await runLauncher(dir, ['run'])
    const calls = dockerCalls()
    const runId = /orca-exec (\d+\.\d+) dotnet run$/.exec(calls.at(-2) ?? '')?.[1]
    expect(runId).toBeDefined()
    expect(calls.at(-1)).toBe(`exec ${CONTAINER} /usr/local/bin/orca-exec --kill ${runId}`)
  })

  it("shows docker's reason when the container cannot be created", async () => {
    const dir = legacyProject()
    const result = await runLauncher(dir, ['build'], {
      FAKE_IMAGE_PRESENT: '1',
      FAKE_RUN_ERROR: 'docker: Error response from daemon: Mounts denied'
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('could not start the .NET container: docker: Error')
  })

  it('warns when Docker Desktop host networking is off', async () => {
    const dir = legacyProject()
    setState(`true ${CONFIG}`)
    writeFileSync(dockerSettings, '{"HostNetworkingEnabled": false}')
    const result = await runLauncher(dir, ['run'])
    expect(result.stderr).toContain('host networking is off')
  })

  it('exports the Mac development certificate once and hands it to Kestrel by name', async () => {
    const dir = legacyProject()
    setState(`true ${CONFIG}`)
    await runLauncher(dir, ['run'])
    await runLauncher(dir, ['run'])
    const exports = readFileSync(join(root, 'dotnet.log'), 'utf8').trim().split('\n')
    expect(exports).toHaveLength(1)
    expect(exports[0]).toContain(
      `--export-path ${join(work, 'orca-https', 'aspnetcore-dev.pfx.new')}`
    )
    // Why: run from the project, a global.json pinning SDK 3.1 picks a dev-certs that needs sudo.
    expect(exports[0]).toContain(`(from ${join(work, 'orca-https')})`)
    const password = readFileSync(join(work, 'orca-https', 'password'), 'utf8')
    expect(password).toMatch(/^[0-9a-f]{32}$/)
    const exec = dockerCalls().find((call) => call.startsWith('exec -i')) ?? ''
    expect(exec).toContain('-e ASPNETCORE_Kestrel__Certificates__Default__Path')
    expect(exec).toContain('-e ASPNETCORE_Kestrel__Certificates__Default__Password')
    expect(readFileSync(log, 'utf8')).not.toContain(password)
  })

  it("keeps the user's own certificate and warns when the export fails", async () => {
    const dir = legacyProject()
    setState(`true ${CONFIG}`)
    await runLauncher(dir, ['run'], { ASPNETCORE_Kestrel__Certificates__Default__Path: '/c.pfx' })
    expect(() => readFileSync(join(root, 'dotnet.log'), 'utf8')).toThrow()
    const failed = await runLauncher(dir, ['run'], { FAKE_DEVCERTS_FAIL: '1' })
    expect(failed.stderr).toContain('could not export the HTTPS development certificate')
    expect(failed.stdout).toContain('exec-ran')
  })

  it('explains when the certificate folder is outside the shared folders', async () => {
    const outsideLauncher = join(root, 'launcher', 'dotnet-outside-cert')
    writeExecutable(
      outsideLauncher,
      readFileSync(launcher, 'utf8').replace(
        /^orca_cert_dir=.*$/m,
        `orca_cert_dir=${join(root, 'https')}`
      )
    )
    setState(`true ${CONFIG}`)
    const result = await runProcess({
      program: '/bin/sh',
      args: [outsideLauncher, 'run'],
      cwd: legacyProject(),
      env: env()
    })
    expect(result.stderr).toContain('is not shared with the .NET container')
    expect(result.stdout).toContain('exec-ran')
  })

  it('reports where a project would run without touching Docker', async () => {
    const legacy = legacyProject()
    const modern = project('modern', { 'App.csproj': csproj('net8.0') })
    const where = (cwd: string, args: string[]) =>
      runLauncher(cwd, ['--orca-where', ...args]).then((result) => result.stdout.trim())
    expect(await where(work, [join(legacy, 'App.csproj')])).toBe('container')
    expect(await where(work, [join(modern, 'App.csproj')])).toBe('native')
    expect(await where(legacy, ['build'])).toBe('container')
    expect(await where(legacy, ['--info'])).toBe('native')
    expect(dockerCalls()).toEqual([])
  })

  it('routes dotnet ef by the startup project, which runs the migrations', async () => {
    const web = project('solution/Web', { 'Web.csproj': csproj('netcoreapp3.1') })
    project('solution/Data', { 'Data.csproj': csproj('netstandard2.0') })
    project('solution/Modern', { 'Modern.csproj': csproj('net8.0') })
    const solution = join(work, 'solution')
    const where = (cwd: string, args: string[]) =>
      runLauncher(cwd, ['--orca-where', ...args]).then((result) => result.stdout.trim())
    expect(await where(web, ['ef', 'migrations', 'add', 'Init', '-p', '../Data/Data.csproj'])).toBe(
      'container'
    )
    expect(
      await where(join(solution, 'Modern'), ['ef', 'database', 'update', '-s', '../Web/Web.csproj'])
    ).toBe('container')
    expect(
      await where(web, ['ef', 'database', 'update', '--startup-project=../Modern/Modern.csproj'])
    ).toBe('native')
    // Why: outside ef, -s is --source and must not pick the project.
    expect(await where(join(solution, 'Modern'), ['build', '-s', '../Web'])).toBe('native')
  })

  it('prepares the container without running anything for --orca-ensure', async () => {
    const result = await runLauncher(legacyProject(), ['--orca-ensure'], {
      FAKE_IMAGE_PRESENT: '1'
    })
    expect(result.code).toBe(0)
    expect(verbs()).toEqual(['info', 'container', 'image', 'run'])
  })

  it('refuses --orca-ensure on an out-of-date container that is still busy', async () => {
    setState('true old')
    const result = await runLauncher(legacyProject(), ['--orca-ensure'], {
      FAKE_RUN_IDS: `${process.pid}.1`
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('out of date and still running programs')
    expect(verbs()).not.toContain('rm')
  })

  it('runs another program in the container for --orca-exec, whatever the project', async () => {
    setState(`true ${CONFIG}`)
    const modern = project('modern', { 'App.csproj': csproj('net8.0') })
    const result = await runLauncher(modern, [
      '--orca-exec',
      '/usr/local/lib/netcoredbg/netcoredbg',
      '--interpreter=vscode'
    ])
    expect(result.stdout).toContain('exec-ran')
    const exec = dockerCalls().find((call) => call.startsWith('exec -i')) ?? ''
    expect(exec).toMatch(
      /orca-exec \d+\.\d+ \/usr\/local\/lib\/netcoredbg\/netcoredbg --interpreter=vscode$/
    )
    expect((await runLauncher(modern, ['--orca-exec'])).stderr).toContain('needs a program')
  })

  it('opens a plain bash in the container for --orca-shell', async () => {
    setState(`true ${CONFIG}`)
    await runLauncher(legacyProject(), ['--orca-shell'])
    const exec = dockerCalls().find((call) => call.startsWith('exec -i')) ?? ''
    expect(exec).toContain('env PS1=(.NET container) \\w \\$  bash --noprofile --norc')
  })

  it('refuses a folder the container cannot see', async () => {
    const outside = join(root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'App.csproj'), csproj('netcoreapp3.1'))
    const result = await runLauncher(outside, ['build'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('outside the folders shared with the .NET container')
    expect(dockerCalls()).toEqual([])
  })

  it('explains when Docker is not running', async () => {
    const result = await runLauncher(legacyProject(), ['build'], { FAKE_DOCKER_DOWN: '1' })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Docker is not running')
  })

  it("returns the program's exit code", async () => {
    setState(`true ${CONFIG}`)
    const result = await runLauncher(legacyProject(), ['test'], { FAKE_EXEC_STATUS: '3' })
    expect(result.code).toBe(3)
  })

  it('passes ASP.NET settings by name and nothing host-specific', async () => {
    setState(`true ${CONFIG}`)
    await runLauncher(legacyProject(), ['run'], {
      ASPNETCORE_ENVIRONMENT: 'Development',
      ConnectionStrings__Default: 'Server=localhost',
      HOME: '/Users/someone'
    })
    const exec = dockerCalls().find((call) => call.startsWith('exec -i')) ?? ''
    expect(exec).toContain('-e ASPNETCORE_ENVIRONMENT')
    expect(exec).toContain('-e ConnectionStrings__Default')
    expect(exec).not.toContain('Server=localhost')
    expect(exec).not.toMatch(/-e (HOME|PATH)\b/)
  })

  it('hands the terminal to docker exec -t when run in one', async () => {
    const dir = legacyProject()
    setState(`true ${CONFIG}`)
    // Why `script`: it gives the launcher a real pseudo-terminal, as Orca's run panes do. Its own
    // stdin must be a file: macOS `script` refuses the socket Node pipes in.
    const script =
      process.platform === 'darwin'
        ? 'exec script -q /dev/null /bin/sh "$0" run < /dev/null'
        : 'exec script -qc "/bin/sh \'$0\' run" /dev/null < /dev/null'
    const result = await runProcess({
      program: '/bin/sh',
      args: ['-c', script, launcher],
      cwd: dir,
      env: env()
    })
    expect(result.code).toBe(0)
    expect(dockerCalls().find((call) => call.startsWith('exec -i'))).toContain('exec -i -t')
    expect(dockerCalls()).toContain('stdin is a tty')
  })

  it('stops the program inside the container when the launcher is terminated', async () => {
    const dir = legacyProject()
    setState(`true ${CONFIG}`)
    const child = spawnProcess({
      program: '/bin/sh',
      args: [launcher, 'run'],
      cwd: dir,
      env: env({ FAKE_EXEC_SLEEP: '5' })
    })
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    const deadline = Date.now() + 5_000
    while (!dockerCalls().some((call) => call.startsWith('exec -i')) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    child.kill('SIGTERM')
    await exited
    const runId = /orca-exec (\S+) dotnet/.exec(
      dockerCalls().find((call) => call.startsWith('exec -i')) ?? ''
    )?.[1]
    expect(runId).toBeTruthy()
    expect(dockerCalls()).toContain(`exec ${CONTAINER} /usr/local/bin/orca-exec --kill ${runId}`)
  })
})
