import React from 'react'
import { Eye, EyeOff, LoaderCircle } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type {
  DetectedRunConfiguration,
  RunConfigurationKind
} from '../../../../shared/run-configurations/run-configuration-types'
import { detectedConfigurationLabel } from './detected-run-configuration'
import {
  isDetectedRunMenuEmpty,
  type DetectedRunMenu,
  type DetectedRunMenuProject
} from './detected-run-menu'
import { RunEcosystemBadge } from './RunEcosystemBadge'
import { RunWidgetMenuRow, type RunWidgetRowContext } from './RunWidgetMenuRow'
import type { RunWidgetItem } from './run-widget-items'

export type DetectedSectionActions = {
  toItem: (run: DetectedRunConfiguration) => RunWidgetItem
  hideKeyOf: (run: DetectedRunConfiguration) => string
  onHide: (key: string) => void
  onShow: (keys: readonly string[]) => void
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

function ProjectLabel({ project }: { project: DetectedRunMenuProject }): React.JSX.Element {
  return (
    <>
      <RunEcosystemBadge ecosystem={project.ecosystem} />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      {project.location && project.location !== project.name ? (
        <span className="max-w-32 min-w-0 truncate text-muted-foreground">{project.location}</span>
      ) : null}
    </>
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
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="run-widget-detected-project">
        <ProjectLabel project={project} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-56">
        <div className="scrollbar-sleek max-h-[60vh] overflow-y-auto">
          {project.groups.map((group) => (
            <React.Fragment key={group.kind}>
              <DropdownMenuLabel>{kindHeading(group.kind)}</DropdownMenuLabel>
              {group.runs.map((run) => {
                const item = actions.toItem(run)
                return (
                  <RunWidgetMenuRow
                    key={run.id}
                    item={item}
                    current={item.key === row.selectedKey}
                    state={row.rowState(item)}
                    actions={row.rowActions}
                    onSelect={row.onSelect}
                    onHide={() => actions.onHide(actions.hideKeyOf(run))}
                  />
                )
              })}
            </React.Fragment>
          ))}
        </div>
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
      <DropdownMenuSubTrigger data-testid="run-widget-hidden">
        <EyeOff />
        <span className="flex-1">
          {translate('run.widget.hidden', 'Hidden ({{value0}})', { value0: keys.length })}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-56">
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
              <ProjectLabel project={project} />
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
 * Runs detected from project files, one submenu per project with its runs grouped by kind, and
 * the entries the user hid, which can be shown again. `menu` is null until the first scan ends.
 */
export function RunWidgetDetectedSection({
  menu,
  row,
  actions
}: {
  menu: DetectedRunMenu | null
  row: RunWidgetRowContext
  actions: DetectedSectionActions
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
    <>
      {heading}
      {menu.projects.map((project) => (
        <ProjectSubmenu key={project.key} project={project} row={row} actions={actions} />
      ))}
      {hasHidden ? <HiddenSubmenu menu={menu} onShow={actions.onShow} /> : null}
    </>
  )
}
