import { describe, expect, it } from 'vitest'
import { detectDockerfileRunConfigurations, isDockerfile } from './dockerfile-run-configurations'

const VISUAL_STUDIO = [
  'FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base',
  'WORKDIR /app',
  'EXPOSE 8080',
  'EXPOSE 8081',
  '',
  'FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build',
  'WORKDIR /src',
  'COPY ["src/Api/Api.csproj", "src/Api/"]',
  'RUN dotnet restore "./src/Api/Api.csproj"',
  'COPY . .',
  '',
  'FROM base AS final',
  'COPY --from=build /app/publish .',
  'ENTRYPOINT ["dotnet", "Api.dll"]'
].join('\n')

function commands(configurations: ReturnType<typeof detectDockerfileRunConfigurations>): {
  run?: string
  build?: string
} {
  return Object.fromEntries(
    configurations.map((configuration) => [configuration.name, configuration.command])
  )
}

describe('isDockerfile', () => {
  it('recognises Dockerfiles and their variants, not their ignore files', () => {
    expect(isDockerfile('Dockerfile')).toBe(true)
    expect(isDockerfile('dockerfile')).toBe(true)
    expect(isDockerfile('Dockerfile.dev')).toBe(true)
    expect(isDockerfile('api.Dockerfile')).toBe(true)
    expect(isDockerfile('Dockerfile.dockerignore')).toBe(false)
    expect(isDockerfile('.dockerignore')).toBe(false)
  })
})

describe('detectDockerfileRunConfigurations', () => {
  it('builds in its folder and runs with the exposed ports published', () => {
    const configurations = detectDockerfileRunConfigurations({
      projectDir: '/w/My App',
      workspaceRoot: '/w',
      fileName: 'Dockerfile',
      text: 'FROM python:3.12-slim\nCOPY . .\nEXPOSE 8000 53/udp 9000/tcp $PORT\nCMD ["python"]'
    })

    expect(commands(configurations)).toEqual({
      run: 'docker build -t my-app . && docker run --rm -it -p 8000:8000 -p 53:53/udp -p 9000:9000 my-app',
      build: 'docker build -t my-app .'
    })
    expect(configurations[0]).toMatchObject({
      ecosystem: 'docker',
      kind: 'run',
      projectName: 'Dockerfile',
      projectFile: '/w/My App/Dockerfile'
    })
  })

  it('builds a Visual Studio Dockerfile from the folder its copies are relative to', () => {
    const configurations = detectDockerfileRunConfigurations({
      projectDir: '/w/src/Api',
      workspaceRoot: '/w',
      fileName: 'Dockerfile',
      text: VISUAL_STUDIO
    })

    expect(commands(configurations).build).toBe('docker build -f Dockerfile -t api ../..')
    expect(commands(configurations).run).toContain('-p 8080:8080 -p 8081:8081 api')
  })

  it('publishes only the ports of stages the final image builds on', () => {
    const configurations = detectDockerfileRunConfigurations({
      projectDir: '/w/web',
      workspaceRoot: '/w',
      fileName: 'Dockerfile',
      text: 'FROM node:20 AS build\nEXPOSE 9229\nFROM node:20-slim\nEXPOSE 3000'
    })

    expect(commands(configurations).run).toMatch(/docker run --rm -it -p 3000:3000 web$/)
  })

  it('names variants after their suffix and passes the file explicitly', () => {
    const configurations = detectDockerfileRunConfigurations({
      projectDir: '/w/api',
      workspaceRoot: '/w',
      fileName: 'Dockerfile.dev',
      text: 'FROM alpine\nRUN <<EOF\nEXPOSE 1\nEOF\nCOPY a.txt /a.txt'
    })

    expect(commands(configurations)).toEqual({
      run: 'docker build -f Dockerfile.dev -t api-dev . && docker run --rm -it api-dev',
      build: 'docker build -f Dockerfile.dev -t api-dev .'
    })
  })

  it('does not chain commands for a Windows folder', () => {
    const configurations = detectDockerfileRunConfigurations({
      projectDir: 'C:\\w\\api',
      workspaceRoot: 'C:\\w',
      fileName: 'Dockerfile',
      text: 'FROM alpine\nEXPOSE 80'
    })

    expect(commands(configurations).run).toBe('docker run --rm -it -p 80:80 api')
    expect(configurations[0].projectFile).toBe('C:\\w\\api\\Dockerfile')
  })
})
