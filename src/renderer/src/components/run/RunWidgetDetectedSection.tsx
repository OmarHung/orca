import React from 'react'
import { Boxes, ChevronLeft, Eye, EyeOff, LoaderCircle } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { DockerExportRunConfiguration } from '../../../../shared/run-configurations/docker-export-configuration'
import type { DotnetPublishRunConfiguration } from '../../../../shared/run-configurations/dotnet-publish-configuration'
import type {
  DetectedRunConfiguration,
  RunConfigurationKind
} from '../../../../shared/run-configurations/run-configuration-types'
import { DetectedPublishActions, unsavedExportStages } from './DetectedPublishActions'
import { detectedConfigurationLabel } from './detected-run-configuration'
import {
  isDetectedRunMenuEmpty,
  type DetectedRunMenu,
  type DetectedRunMenuEcosystem,
  type DetectedRunMenuGroup,
  type DetectedRunMenuProject,
  splitLocation
} from './detected-run-menu'
import { RUN_KIND_ICONS } from './run-configuration-icon'
import { RUN_WIDGET_CONTENT_STYLE } from './run-widget-cascade'
import { RunEcosystemBadge, runEcosystemLabel } from './RunEcosystemBadge'
import { RunWidgetMenuRow, type RunWidgetRowContext } from './RunWidgetMenuRow'
import type { RunWidgetItem } from './run-widget-items'

export type DetectedSectionActions = {
  toItem: (run: DetectedRunConfiguration) => RunWidgetItem
  /** The widget's own row for a saved configuration; null once it is gone. */
  savedItem: (configurationId: string) => RunWidgetItem | null
  /** Opens the Publish to folder dialog for a new configuration of this run's project. */
  onNewPublish: (run: DetectedRunConfiguration) => void
  /** Opens the Export to folder dialog for a new export of this Dockerfile (of `stage`). */
  onNewDockerExport: (run: DetectedRunConfiguration, stage?: string) => void
  onEditPublish: (
    configuration: DotnetPublishRunConfiguration | DockerExportRunConfiguration
  ) => void
  hideKeyOf: (run: DetectedRunConfiguration) => string
  onHide: (key: string) => void
  onShow: (keys: readonly string[]) => void
}

/** True when submenus open to the left, so their triggers point that way. */
const CascadeLeftContext = React.createContext(false)

function CascadeSubTrigger({
  testId,
  children
}: {
  testId: string
  children: React.ReactNode
}): React.JSX.Element {
  const cascadeLeft = React.useContext(CascadeLeftContext)
  return (
    <DropdownMenuSubTrigger data-testid={testId} hideChevron={cascadeLeft}>
      {children}
      {cascadeLeft ? <ChevronLeft className="ml-auto size-4" /> : null}
    </DropdownMenuSubTrigger>
  )
}

function kindHeading(kind: RunConfigurationKind): string {
  switch (kind) {
    case 'run':
      return translate('run.widget.kind.run', 'Run')
    case 'build':
      return translate('run.widget.kind.build', 'Build')
    case 'test':
      return translate('run.widget.kind.test', 'Test')
    case 'publish':
      return translate('run.widget.kind.publish', 'Publish')
    case 'other':
      return translate('run.widget.kind.other', 'Other')
  }
}

/** Keeps the menu open, so several entries can be hidden or shown in one go. */
function keepOpen(action: () => void): (event: Event) => void {
  return (event) => {
    event.preventDefault()
    action()
  }
}

function Count({ value }: { value: number }): React.JSX.Element {
  return <span className="shrink-0 text-muted-foreground tabular-nums">{value}</span>
}

/**
 * A project's name, then where it lives: under a folder heading only its own folder (when named
 * differently), elsewhere the toolchain and its full location.
 */
function ProjectLabel({
  project,
  underFolderHeading
}: {
  project: DetectedRunMenuProject
  underFolderHeading: boolean
}): React.JSX.Element {
  const place = underFolderHeading ? splitLocation(project.location).leaf : project.location
  return (
    <>
      {underFolderHeading ? null : <RunEcosystemBadge ecosystem={project.ecosystem} />}
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      {place && place !== project.name ? (
        <span className="max-w-32 min-w-0 truncate text-muted-foreground">{place}</span>
      ) : null}
    </>
  )
}

function folderHeading(folder: string): string {
  return folder ? `${folder}/` : translate('run.widget.rootFolder', 'Workspace root')
}

/** This machine's folder publishes and exports open in their dialog; orca.yaml ones in the file. */
function editablePublish(
  item: RunWidgetItem
): DotnetPublishRunConfiguration | DockerExportRunConfiguration | null {
  return item.kind === 'configuration' &&
    item.source === 'local' &&
    (item.configuration.type === 'dotnet-publish' || item.configuration.type === 'docker-export')
    ? item.configuration
    : null
}

function KindSubmenu({
  group,
  row,
  actions,
  publishFrom
}: {
  group: DetectedRunMenuGroup
  row: RunWidgetRowContext
  actions: DetectedSectionActions
  /** On Publish: the run a new folder publish or Docker export starts from. */
  publishFrom: DetectedRunConfiguration | null
}): React.JSX.Element {
  const Icon = RUN_KIND_ICONS[group.kind]
  const savedItems = group.saved.flatMap((configuration) => {
    const item = actions.savedItem(configuration.id)
    return item ? [item] : []
  })
  const rowFor = (item: RunWidgetItem, onHide?: () => void): React.JSX.Element => {
    const publish = editablePublish(item)
    return (
      <RunWidgetMenuRow
        key={item.key}
        item={item}
        current={item.key === row.selectedKey}
        state={row.rowState(item)}
        actions={row.rowActions}
        onSelect={row.onSelect}
        onHide={onHide}
        onEdit={publish ? () => actions.onEditPublish(publish) : undefined}
      />
    )
  }
  return (
    <DropdownMenuSub>
      <CascadeSubTrigger testId="run-widget-detected-kind">
        <Icon />
        <span className="min-w-0 flex-1 truncate">{kindHeading(group.kind)}</span>
        <Count
          value={
            savedItems.length +
            group.runs.length +
            unsavedExportStages(publishFrom, group.saved).length
          }
        />
      </CascadeSubTrigger>
      <DropdownMenuSubContent style={RUN_WIDGET_CONTENT_STYLE} className="min-w-56">
        <div className="scrollbar-sleek max-h-[60vh] overflow-y-auto">
          {/* Why first: a saved configuration is one the user set up on purpose. */}
          {savedItems.map((item) => rowFor(item))}
          {group.runs.map((run) =>
            rowFor(actions.toItem(run), () => actions.onHide(actions.hideKeyOf(run)))
          )}
        </div>
        {publishFrom ? (
          <DetectedPublishActions
            from={publishFrom}
            saved={group.saved}
            onNewPublish={actions.onNewPublish}
            onNewDockerExport={actions.onNewDockerExport}
          />
        ) : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function ProjectSubmenu({
  project,
  row,
  actions
}: {
  project: DetectedRunMenuProject
  row: RunWidgetRowContext
  actions: DetectedSectionActions
}): React.JSX.Element {
  const runs = project.groups.flatMap((group) => group.runs)
  const publishFrom =
    project.ecosystem === 'dotnet'
      ? (runs.find((run) => run.projectFile) ?? null)
      : (runs.find((run) => run.dockerExport) ?? null)
  return (
    <DropdownMenuSub>
      <CascadeSubTrigger testId="run-widget-detected-project">
        <ProjectLabel project={project} underFolderHeading />
      </CascadeSubTrigger>
      <DropdownMenuSubContent style={RUN_WIDGET_CONTENT_STYLE} className="min-w-44">
        {project.groups.map((group) => (
          <KindSubmenu
            key={group.kind}
            group={group}
            row={row}
            actions={actions}
            publishFrom={group.kind === 'publish' ? publishFrom : null}
          />
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="run-widget-hide-project"
          onSelect={keepOpen(() => actions.onHide(project.key))}
        >
          <EyeOff />
          {translate('run.widget.hideProject', 'Hide This Project')}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function EcosystemSubmenu({
  group,
  row,
  actions
}: {
  group: DetectedRunMenuEcosystem
  row: RunWidgetRowContext
  actions: DetectedSectionActions
}): React.JSX.Element {
  return (
    <DropdownMenuSub>
      <CascadeSubTrigger testId="run-widget-detected-ecosystem">
        <Boxes />
        <span className="min-w-0 flex-1 truncate">{runEcosystemLabel(group.ecosystem)}</span>
        <Count value={group.projectCount} />
      </CascadeSubTrigger>
      <DropdownMenuSubContent style={RUN_WIDGET_CONTENT_STYLE} className="min-w-64">
        <div className="scrollbar-sleek max-h-[60vh] overflow-y-auto">
          {group.folders.map(({ folder, projects }) => (
            <React.Fragment key={folder}>
              {/* Why: a lone root group needs no heading. */}
              {folder || group.folders.length > 1 ? (
                <DropdownMenuLabel data-testid="run-widget-detected-folder">
                  {folderHeading(folder)}
                </DropdownMenuLabel>
              ) : null}
              {projects.map((project) => (
                <ProjectSubmenu key={project.key} project={project} row={row} actions={actions} />
              ))}
            </React.Fragment>
          ))}
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function HiddenSubmenu({
  menu,
  onShow
}: {
  menu: DetectedRunMenu
  onShow: (keys: readonly string[]) => void
}): React.JSX.Element {
  const keys = [
    ...menu.hiddenProjects.map((project) => project.key),
    ...menu.hiddenRuns.map((entry) => entry.key)
  ]
  return (
    <DropdownMenuSub>
      <CascadeSubTrigger testId="run-widget-hidden">
        <EyeOff />
        <span className="flex-1">
          {translate('run.widget.hidden', 'Hidden ({{value0}})', { value0: keys.length })}
        </span>
      </CascadeSubTrigger>
      <DropdownMenuSubContent style={RUN_WIDGET_CONTENT_STYLE} className="min-w-56">
        <DropdownMenuLabel>
          {translate('run.widget.hiddenHint', 'Click to show again')}
        </DropdownMenuLabel>
        <div className="scrollbar-sleek max-h-[60vh] overflow-y-auto">
          {menu.hiddenProjects.map((project) => (
            <DropdownMenuItem
              key={project.key}
              data-testid="run-widget-hidden-item"
              onSelect={keepOpen(() => onShow([project.key]))}
            >
              <Eye />
              <ProjectLabel project={project} underFolderHeading={false} />
            </DropdownMenuItem>
          ))}
          {menu.hiddenRuns.map(({ key, run }) => (
            <DropdownMenuItem
              key={key}
              data-testid="run-widget-hidden-item"
              onSelect={keepOpen(() => onShow([key]))}
            >
              <Eye />
              <span className="min-w-0 flex-1 truncate">{detectedConfigurationLabel(run)}</span>
            </DropdownMenuItem>
          ))}
        </div>
        {keys.length > 1 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={keepOpen(() => onShow(keys))}>
              <Eye />
              {translate('run.widget.showAll', 'Show All')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/**
 * Runs detected from project files, nested toolchain → project → kind → run, and the entries the
 * user hid, which can be shown again. `menu` is null until the first scan ends.
 */
export function RunWidgetDetectedSection({
  menu,
  row,
  actions,
  cascadeLeft
}: {
  menu: DetectedRunMenu | null
  row: RunWidgetRowContext
  actions: DetectedSectionActions
  cascadeLeft: boolean
}): React.JSX.Element | null {
  const heading = (
    <DropdownMenuLabel>{translate('run.widget.detected', 'Detected')}</DropdownMenuLabel>
  )
  if (menu === null) {
    return (
      <>
        {heading}
        <DropdownMenuItem disabled>
          <LoaderCircle className="animate-spin" />
          {translate('run.widget.detecting', 'Detecting…')}
        </DropdownMenuItem>
      </>
    )
  }
  if (isDetectedRunMenuEmpty(menu)) {
    return null
  }
  const hasHidden = menu.hiddenProjects.length + menu.hiddenRuns.length > 0
  return (
    <CascadeLeftContext.Provider value={cascadeLeft}>
      {heading}
      {menu.ecosystems.map((group) => (
        <EcosystemSubmenu key={group.ecosystem} group={group} row={row} actions={actions} />
      ))}
      {hasHidden ? <HiddenSubmenu menu={menu} onShow={actions.onShow} /> : null}
    </CascadeLeftContext.Provider>
  )
}
