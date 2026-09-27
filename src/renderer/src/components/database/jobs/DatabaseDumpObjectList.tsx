import React, { useMemo, useState } from 'react'
import { Eye, Layers, SquareFunction, Table2, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { DumpCandidate, DumpCandidateGroup } from './database-dump-candidates'

const ICON_CLASS = 'size-3.5 shrink-0 text-muted-foreground'

function CandidateIcon({ icon }: { icon: DumpCandidate['icon'] }): React.JSX.Element {
  switch (icon) {
    case 'table':
      return <Table2 className={ICON_CLASS} />
    case 'view':
      return <Eye className={ICON_CLASS} />
    case 'function':
      return <SquareFunction className={ICON_CLASS} />
    case 'procedure':
      return <Workflow className={ICON_CLASS} />
  }
}

function groupState(
  candidates: readonly DumpCandidate[],
  selected: ReadonlySet<string>
): boolean | 'indeterminate' {
  const count = candidates.filter((candidate) => selected.has(candidate.key)).length
  return count === 0 ? false : count === candidates.length ? true : 'indeterminate'
}

function withKeys(selected: ReadonlySet<string>, keys: readonly string[], on: boolean) {
  const next = new Set(selected)
  for (const key of keys) {
    if (on) {
      next.add(key)
    } else {
      next.delete(key)
    }
  }
  return next
}

/** The objects a dump can hold, grouped by schema, with a filter over their names. */
export function DatabaseDumpObjectList({
  groups,
  selected,
  onChange
}: {
  groups: readonly DumpCandidateGroup[]
  selected: ReadonlySet<string>
  onChange: (selected: ReadonlySet<string>) => void
}): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return groups
      .map((group) => ({
        ...group,
        candidates: group.candidates.filter((candidate) =>
          candidate.object.name.toLowerCase().includes(needle)
        )
      }))
      .filter((group) => group.candidates.length > 0)
  }, [groups, filter])
  const visibleKeys = visible.flatMap((group) => group.candidates.map((candidate) => candidate.key))
  const total = groups.reduce((sum, group) => sum + group.candidates.length, 0)
  const showSchemas = groups.length > 1
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={translate('database.dump.filter', 'Filter by name')}
          aria-label={translate('database.dump.filter', 'Filter by name')}
          className="h-8 flex-1"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(withKeys(selected, visibleKeys, true))}
        >
          {translate('database.dump.selectAll', 'Select All')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(withKeys(selected, visibleKeys, false))}
        >
          {translate('database.dump.selectNone', 'Select None')}
        </Button>
      </div>
      <ul
        aria-label={translate('database.dump.objects', 'Objects')}
        className="scrollbar-sleek h-56 overflow-y-auto rounded-md border border-border py-1"
      >
        {visible.map((group) => (
          <li key={group.schema}>
            {showSchemas ? (
              <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1 hover:bg-accent">
                <Checkbox
                  checked={groupState(group.candidates, selected)}
                  onCheckedChange={(next) =>
                    onChange(
                      withKeys(
                        selected,
                        group.candidates.map((candidate) => candidate.key),
                        next === true
                      )
                    )
                  }
                  aria-label={group.schema}
                />
                <Layers className={ICON_CLASS} />
                <span className="truncate text-sm font-medium">{group.schema}</span>
              </label>
            ) : null}
            <ul>
              {group.candidates.map((candidate) => (
                <li key={candidate.key}>
                  <label
                    className={
                      showSchemas
                        ? 'flex cursor-pointer items-center gap-2 py-1 pr-2.5 pl-8 hover:bg-accent'
                        : 'flex cursor-pointer items-center gap-2 px-2.5 py-1 hover:bg-accent'
                    }
                  >
                    <Checkbox
                      checked={selected.has(candidate.key)}
                      onCheckedChange={(next) =>
                        onChange(withKeys(selected, [candidate.key], next === true))
                      }
                      aria-label={candidate.object.name}
                    />
                    <CandidateIcon icon={candidate.icon} />
                    <span className="truncate text-sm">{candidate.object.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </li>
        ))}
        {visible.length === 0 ? (
          <li className="px-2.5 py-2 text-sm text-muted-foreground">
            {translate('database.dump.noMatch', 'No objects match.')}
          </li>
        ) : null}
      </ul>
      <p className="text-[11px] text-muted-foreground tabular-nums">
        {translate('database.dump.selectedCount', 'Selected: {{value0}} of {{value1}}', {
          value0: String(selected.size),
          value1: String(total)
        })}
      </p>
    </div>
  )
}
