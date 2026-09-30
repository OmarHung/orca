import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      worktreesByRepo: { repo: [{ id: 'wt', path: '/w', repoId: 'repo' }] }
    })
  }
}))
vi.mock('./project-run-detection', () => ({
  worktreeProjectFiles: () => ({
    files: {
      readText: async () =>
        '<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>'
    }
  })
}))

import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import {
  editDotnetPublishConfiguration,
  openDotnetPublishDialog,
  useDotnetPublishDialogStore
} from './dotnet-publish-dialog-store'
import { useRunConfigurationStore } from './run-configuration-store'

const DETECTED: DetectedRunConfiguration = {
  id: 'dotnet:/w/src/Api:Api.csproj:publish',
  ecosystem: 'dotnet',
  projectName: 'Api',
  projectDir: '/w/src/Api',
  projectFile: '/w/src/Api/Api.csproj',
  kind: 'publish',
  name: 'Publish (Release)',
  command: 'dotnet publish Api.csproj -c Release'
}
const SAVED = {
  type: 'dotnet-publish' as const,
  id: 'saved',
  name: 'Publish Api to folder',
  projectFile: 'src/Api/Api.csproj',
  outputDir: 'out/api'
}

beforeEach(() => {
  useDotnetPublishDialogStore.setState({ request: null })
  useRunConfigurationStore.setState({ localByRepo: { repo: [SAVED] } })
})

describe('openDotnetPublishDialog', () => {
  it("reopens the project's saved folder publish by default", async () => {
    await openDotnetPublishDialog(DETECTED, 'wt', null)

    expect(useDotnetPublishDialogStore.getState().request?.configuration).toEqual(SAVED)
  })

  it('starts another one, under a free name, when asked for a new one', async () => {
    await openDotnetPublishDialog(DETECTED, 'wt', 'group', { asNew: true })

    const request = useDotnetPublishDialogStore.getState().request
    expect(request).toMatchObject({ worktreeId: 'wt', groupId: 'group', repoId: 'repo' })
    expect(request?.configuration).toMatchObject({
      type: 'dotnet-publish',
      name: 'Publish Api to folder (2)',
      projectFile: 'src/Api/Api.csproj',
      outputDir: 'src/Api/bin/Release/net8.0/publish'
    })
    expect(request?.configuration.id).not.toBe('saved')
  })
})

describe('editDotnetPublishConfiguration', () => {
  it('opens the given saved configuration', () => {
    editDotnetPublishConfiguration(SAVED, 'wt', null)

    expect(useDotnetPublishDialogStore.getState().request).toMatchObject({
      repoId: 'repo',
      worktreePath: '/w',
      configuration: SAVED
    })
  })
})
