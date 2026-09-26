import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Folder, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import type { RunConfigurationDefinition } from '../../../../shared/run-configurations/run-configuration-definition'
import type { DetectedRunConfiguration } from '../../../../shared/run-configurations/run-configuration-types'
import {
  detectedRunTree,
  filterDetectedRunTree,
  type DetectedRunFolder,
  type DetectedRunProject
} from './detected-run-tree'
import { RUN_KIND_ICONS, runConfigurationIcon } from './run-configuration-icon'

const SAVED_NODE_KEY = 'saved'
const INDENT_REM = 1
/** Small workspaces show every run at once; larger ones start with projects collapsed. */
const EXPAND_ALL_MAX_RUNS = 12

const ECOSYSTEM_LABELS: Record<DetectedRunProject['ecosystem'], string> = {
  node: 'Node',
  dotnet: '.NET'
}

type TreeState = {
  isOpen: (key: string, byDefault: boolean) => boolean
  toggle: (key: string, byDefault: boolean) => void
  indent: (depth: number) => React.CSSProperties
}

function TreeRow({
  depth,
  tree,
  children,
  testId,
  onClick
}: {
  depth: number
  tree: TreeState
  children: React.ReactNode
  testId?: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      style={tree.indent(depth)}
      className="flex w-full min-w-0 items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-xs hover:bg-accent hover:text-accent-foreground"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return open ? (
    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
  ) : (
    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
  )
}

function ProjectNode({
  project,
  depth,
  tree,
  expandByDefault,
  onPick
}: {
  project: DetectedRunProject
  depth: number
  tree: TreeState
  expandByDefault: boolean
  onPick: (run: DetectedRunConfiguration) => void
}): React.JSX.Element {
  const open = tree.isOpen(project.key, expandByDefault)
  return (
    <>
      <TreeRow
        depth={depth}
        tree={tree}
        testId="compound-picker-project"
        onClick={() => tree.toggle(project.key, expandByDefault)}
      >
        <Chevron open={open} />
        <span className="shrink-0 rounded-sm border border-border px-1 text-[10px] text-muted-foreground">
          {ECOSYSTEM_LABELS[project.ecosystem]}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
          {project.runs.length}
        </span>
      </TreeRow>
      {open
        ? project.runs.map((run) => {
            const Icon = RUN_KIND_ICONS[run.kind]
            return (
              <TreeRow
                key={run.id}
                depth={depth + 1}
                tree={tree}
                testId="compound-picker-run"
                onClick={() => onPick(run)}
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{run.name}</span>
              </TreeRow>
            )
          })
        : null}
    </>
  )
}

function FolderNode({
  folder,
  depth,
  tree,
  expandProjects,
  onPick
}: {
  folder: DetectedRunFolder
  depth: number
  tree: TreeState
  expandProjects: boolean
  onPick: (run: DetectedRunConfiguration) => void
}): React.JSX.Element {
  // The root folder has no row of its own.
  const open = !folder.label || tree.isOpen(folder.key, true)
  const childDepth = folder.label ? depth + 1 : depth
  return (
    <>
      {folder.label ? (
        <TreeRow depth={depth} tree={tree} onClick={() => tree.toggle(folder.key, true)}>
          <Chevron open={open} />
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{folder.label}</span>
        </TreeRow>
      ) : null}
      {open ? (
        <>
          {folder.projects.map((project) => (
            <ProjectNode
              key={project.key}
              project={project}
              depth={childDepth}
              tree={tree}
              expandByDefault={expandProjects}
              onPick={onPick}
            />
          ))}
          {folder.folders.map((child) => (
            <FolderNode
              key={child.key}
              folder={child}
              depth={childDepth}
              tree={tree}
              expandProjects={expandProjects}
              onPick={onPick}
            />
          ))}
        </>
      ) : null}
    </>
  )
}

/** Tree of runs detected in the workspace (folder → project → run) plus saved configurations. */
export function CompoundRunPicker({
  detected,
  saved,
  worktreePath,
  disabled,
  hasMembers,
  onPickDetected,
  onPickSaved
}: {
  /** Null while the workspace is being scanned. */
  detected: readonly DetectedRunConfiguration[] | null
  saved: readonly RunConfigurationDefinition[]
  worktreePath: string
  disabled: boolean
  /** When nothing is left to add, says so instead of claiming nothing was found. */
  hasMembers: boolean
  onPickDetected: (run: DetectedRunConfiguration) => void
  onPickSaved: (id: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set())
  const needle = query.trim().toLowerCase()
  const tree = filterDetectedRunTree(detectedRunTree(detected ?? [], worktreePath), needle)
  const matchingSaved = saved.filter((entry) => entry.name.toLowerCase().includes(needle))
  const expandProjects = needle.length > 0 || (detected?.length ?? 0) <= EXPAND_ALL_MAX_RUNS
  const state: TreeState = {
    // A toggled key flips its default; searching shows every match.
    isOpen: (key, byDefault) => (needle ? true : toggled.has(key) !== byDefault),
    toggle: (key) => {
      const next = new Set(toggled)
      if (!next.delete(key)) {
        next.add(key)
      }
      setToggled(next)
    },
    indent: (depth) => ({ paddingLeft: `${0.5 + depth * INDENT_REM}rem` })
  }
  const close = (): void => {
    setOpen(false)
    setQuery('')
  }
  const nothingToAdd = saved.length === 0 && detected !== null && detected.length === 0
  const savedOpen = state.isOpen(SAVED_NODE_KEY, true)

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || nothingToAdd}
          data-testid="compound-add-member"
          className="w-full justify-start"
        >
          <Plus />
          <span className="truncate">
            {nothingToAdd && hasMembers
              ? translate('run.compound.addedEverything', 'Every run found is already added')
              : nothingToAdd
                ? translate(
                    'run.compound.nothingToAdd',
                    'No runs found in this workspace and no saved configurations'
                  )
                : translate('run.compound.add', 'Add a run…')}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)]">
        <div className="p-1">
          <Input
            autoFocus
            value={query}
            placeholder={translate('run.compound.search', 'Filter runs')}
            aria-label={translate('run.compound.search', 'Filter runs')}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div
            data-testid="compound-run-picker"
            className="scrollbar-sleek mt-1 max-h-80 overflow-y-auto"
            // Why: the dialog's scroll lock swallows wheel scrolling in this portaled popover.
            onWheel={(event) => {
              event.currentTarget.scrollTop += event.deltaY
            }}
          >
            {matchingSaved.length > 0 ? (
              <>
                <TreeRow depth={0} tree={state} onClick={() => state.toggle(SAVED_NODE_KEY, true)}>
                  <Chevron open={savedOpen} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {translate('run.compound.saved', 'Saved configurations')}
                  </span>
                </TreeRow>
                {savedOpen
                  ? matchingSaved.map((entry) => {
                      const Icon = runConfigurationIcon(entry)
                      return (
                        <TreeRow
                          key={entry.id}
                          depth={1}
                          tree={state}
                          testId="compound-picker-saved"
                          onClick={() => {
                            onPickSaved(entry.id)
                            close()
                          }}
                        >
                          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                        </TreeRow>
                      )
                    })
                  : null}
              </>
            ) : null}
            {detected === null ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                {translate('run.compound.scanning', 'Looking for runs in this workspace…')}
              </p>
            ) : tree ? (
              <FolderNode
                folder={tree}
                depth={0}
                tree={state}
                expandProjects={expandProjects}
                onPick={(run) => {
                  onPickDetected(run)
                  close()
                }}
              />
            ) : matchingSaved.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                {translate('run.compound.noMatch', 'No matching runs')}
              </p>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
