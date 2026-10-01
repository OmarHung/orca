import { describe, expect, it } from 'vitest'
import {
  dockerExportAsCommand,
  dockerExportCommand,
  newDockerExportConfiguration,
  type DockerExportRunConfiguration
} from './docker-export-configuration'
import { normalizeRunConfigurationDefinitions } from './run-configuration-definition'

const BASE: DockerExportRunConfiguration = {
  type: 'docker-export',
  id: 'web',
  name: 'Export web',
  dockerfile: 'Dockerfile',
  target: 'export-bioab',
  outputDir: '/deploy/bioab_web'
}

describe('dockerExportCommand', () => {
  it('writes the usual command when the Dockerfile is the context default', () => {
    expect(dockerExportCommand(BASE)).toBe(
      'docker build --target export-bioab -o /deploy/bioab_web .'
    )
  })

  it('names the Dockerfile when the context is elsewhere, and quotes paths with spaces', () => {
    expect(
      dockerExportCommand({
        ...BASE,
        dockerfile: 'src/Api/Dockerfile',
        context: '.',
        outputDir: 'out dir/web',
        extraArgs: '--build-arg A=1'
      })
    ).toBe(
      'docker build -f src/Api/Dockerfile --target export-bioab -o "out dir/web" --build-arg A=1 .'
    )
  })

  it("defaults the context to the Dockerfile's folder", () => {
    expect(dockerExportCommand({ ...BASE, dockerfile: 'web/Dockerfile.prod' })).toBe(
      'docker build -f web/Dockerfile.prod --target export-bioab -o /deploy/bioab_web web'
    )
  })

  it('refuses a folder with a comma, which Docker reads as another option', () => {
    expect(dockerExportCommand({ ...BASE, outputDir: 'a,b' })).toBeNull()
    expect(dockerExportAsCommand({ ...BASE, target: '' })).toBeNull()
  })
})

describe('normalizeDockerExport', () => {
  it('keeps a valid export, including the empty-first choice', () => {
    const { configurations, problems } = normalizeRunConfigurationDefinitions([
      { ...BASE, cleanOutputDir: true, beforeLaunch: ['build'] }
    ])

    expect(problems).toEqual([])
    expect(configurations).toEqual([{ ...BASE, cleanOutputDir: true, beforeLaunch: ['build'] }])
  })

  it('explains what is missing or unsafe', () => {
    const { problems } = normalizeRunConfigurationDefinitions([
      { ...BASE, name: 'a', target: '' },
      { ...BASE, name: 'b', outputDir: '' },
      { ...BASE, name: 'c', outputDir: 'x,y' },
      { ...BASE, name: 'd', dockerfile: 'Docker$file' }
    ])

    expect(problems.map((problem) => problem.message)).toEqual([
      '"a": choose the stage to export.',
      '"b": choose the folder to export to.',
      '"c": the output folder cannot contain a comma.',
      expect.stringContaining('"d": the path "Docker$file"')
    ])
  })
})

describe('newDockerExportConfiguration', () => {
  it('exports into publish/<stage> and empties it first until a folder is chosen', () => {
    expect(
      newDockerExportConfiguration({
        id: 'n',
        dockerfile: 'Dockerfile',
        context: '.',
        target: 'export'
      })
    ).toEqual({
      type: 'docker-export',
      id: 'n',
      name: 'Export export to folder',
      dockerfile: 'Dockerfile',
      context: '.',
      target: 'export',
      outputDir: 'publish/export',
      cleanOutputDir: true
    })
  })
})
