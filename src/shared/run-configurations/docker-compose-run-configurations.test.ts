import { describe, expect, it } from 'vitest'
import {
  detectDockerComposeRunConfigurations,
  isDockerComposeFile
} from './docker-compose-run-configurations'

const STACK = [
  'x-common: &common',
  '  restart: unless-stopped',
  'services:',
  '  db:',
  '    image: postgres:16',
  '  api:',
  '    <<: *common',
  '    build: .',
  '    depends_on:',
  '      db:',
  '        condition: service_healthy'
].join('\n')

function summary(
  configurations: ReturnType<typeof detectDockerComposeRunConfigurations>
): [string, string, string, string][] {
  return configurations.map((configuration) => [
    configuration.projectName,
    configuration.name,
    configuration.kind,
    configuration.command
  ])
}

describe('isDockerComposeFile', () => {
  it('recognises default and named compose files', () => {
    expect(isDockerComposeFile('compose.yaml')).toBe(true)
    expect(isDockerComposeFile('docker-compose.yml')).toBe(true)
    expect(isDockerComposeFile('docker-compose.prod.yml')).toBe(true)
    expect(isDockerComposeFile('compose-dev.yaml')).toBe(true)
    expect(isDockerComposeFile('compose.json')).toBe(false)
    expect(isDockerComposeFile('mkdocs.yml')).toBe(false)
  })
})

describe('detectDockerComposeRunConfigurations', () => {
  it('offers the stack, each service, build, down and logs for the default file', () => {
    const configurations = detectDockerComposeRunConfigurations({
      projectDir: '/w',
      files: [{ name: 'docker-compose.yml', text: STACK }]
    })

    expect(summary(configurations)).toEqual([
      ['docker-compose.yml', 'up', 'run', 'docker compose up'],
      ['docker-compose.yml', 'up -d', 'run', 'docker compose up -d'],
      ['docker-compose.yml', 'up db', 'run', 'docker compose up db'],
      ['docker-compose.yml', 'up api', 'run', 'docker compose up api'],
      ['docker-compose.yml', 'build', 'build', 'docker compose build'],
      ['docker-compose.yml', 'down', 'other', 'docker compose down'],
      ['docker-compose.yml', 'logs -f', 'other', 'docker compose logs -f']
    ])
    expect(configurations[0]).toMatchObject({
      id: 'docker:/w:compose:docker-compose.yml:up',
      ecosystem: 'docker',
      projectDir: '/w',
      projectFile: '/w/docker-compose.yml'
    })
  })

  it('includes services the override file adds, without listing it on its own', () => {
    const configurations = detectDockerComposeRunConfigurations({
      projectDir: '/w',
      files: [
        { name: 'compose.yaml', text: 'services:\n  web:\n    image: nginx' },
        { name: 'compose.override.yaml', text: 'services:\n  debug:\n    image: busybox' }
      ]
    })

    expect(configurations.map((configuration) => configuration.name)).toContain('up debug')
    expect(new Set(configurations.map((configuration) => configuration.projectName))).toEqual(
      new Set(['compose.yaml'])
    )
  })

  it('layers a named file that leans on default services onto the default file', () => {
    const configurations = detectDockerComposeRunConfigurations({
      projectDir: '/w',
      files: [
        { name: 'docker-compose.yml', text: STACK },
        {
          name: 'docker-compose.windows.yml',
          text: 'services:\n  nginx:\n    image: nginx\n    depends_on:\n      - api'
        }
      ]
    })
    const windows = configurations.filter(
      (configuration) => configuration.projectName === 'docker-compose.windows.yml'
    )

    expect(windows[0].command).toBe(
      'docker compose -f docker-compose.yml -f docker-compose.windows.yml up'
    )
    expect(windows.map((configuration) => configuration.name)).toEqual(
      expect.arrayContaining(['up db', 'up api', 'up nginx'])
    )
  })

  it('layers a named file whose services only tweak settings', () => {
    const first = detectDockerComposeRunConfigurations({
      projectDir: '/w',
      files: [
        { name: 'compose.yaml', text: STACK },
        { name: 'compose.prod.yaml', text: 'services:\n  api:\n    environment:\n      A: b' }
      ]
    }).find((configuration) => configuration.projectName === 'compose.prod.yaml')

    expect(first?.command).toBe('docker compose -f compose.yaml -f compose.prod.yaml up')
  })

  it('runs a self-contained named file on its own', () => {
    const configurations = detectDockerComposeRunConfigurations({
      projectDir: '/w',
      files: [
        { name: 'compose.yaml', text: STACK },
        { name: 'compose.test.yaml', text: 'services:\n  runner:\n    build: ./tests' }
      ]
    }).filter((configuration) => configuration.projectName === 'compose.test.yaml')

    expect(summary(configurations).map(([, name, , command]) => [name, command])).toEqual([
      ['up', 'docker compose -f compose.test.yaml up'],
      ['up -d', 'docker compose -f compose.test.yaml up -d'],
      ['up runner', 'docker compose -f compose.test.yaml up runner'],
      ['build', 'docker compose -f compose.test.yaml build'],
      ['down', 'docker compose -f compose.test.yaml down'],
      ['logs -f', 'docker compose -f compose.test.yaml logs -f']
    ])
  })

  it('still offers the whole-stack commands when the file cannot be parsed', () => {
    const configurations = detectDockerComposeRunConfigurations({
      projectDir: '/w',
      files: [{ name: 'compose.yaml', text: 'services: [unclosed' }]
    })

    expect(configurations.map((configuration) => configuration.name)).toEqual([
      'up',
      'up -d',
      'build',
      'down',
      'logs -f'
    ])
  })

  it('skips service names no shell can take literally', () => {
    const configurations = detectDockerComposeRunConfigurations({
      projectDir: '/w',
      files: [{ name: 'compose.yaml', text: 'services:\n  "a$b":\n    image: x' }]
    })

    expect(configurations.some((configuration) => configuration.name.includes('$'))).toBe(false)
  })
})
