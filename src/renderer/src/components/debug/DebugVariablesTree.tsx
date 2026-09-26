import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { DebugProtocol } from '@vscode/debugprotocol'
import { translate } from '@/i18n/i18n'
import { loadDebugVariables } from './debug-session-controller'
import { useDebugStore } from './debug-store'

const INDENT_PX = 12
// Why: DAP variable graphs can be cyclic (a.parent.child.parent…); cap how deep a user can drill.
const MAX_DEPTH = 32

export function VariableRow({
  variable,
  depth,
  trailing
}: {
  variable: DebugProtocol.Variable
  depth: number
  /** Extra controls at the end of the row, e.g. a watch's remove button. */
  trailing?: React.ReactNode
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const children = useDebugStore((s) => s.variablesByReference[variable.variablesReference])
  const expandable = variable.variablesReference > 0 && depth < MAX_DEPTH

  const toggle = (): void => {
    if (!expandable) {
      return
    }
    if (!expanded && !children) {
      void loadDebugVariables(variable.variablesReference)
    }
    setExpanded(!expanded)
  }

  return (
    <>
      <div className="group flex min-w-0 items-center hover:bg-accent">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 py-0.5 pr-2 text-left font-mono text-xs"
          style={{ paddingLeft: depth * INDENT_PX + 4 }}
          onClick={toggle}
          aria-expanded={expandable ? expanded : undefined}
        >
          <span className="flex size-3 shrink-0 items-center justify-center text-muted-foreground">
            {expandable ? expanded ? <ChevronDown /> : <ChevronRight /> : null}
          </span>
          <span className="shrink-0 text-foreground">{variable.name}</span>
          <span className="shrink-0 text-muted-foreground">=</span>
          <span className="truncate text-muted-foreground" title={variable.value}>
            {variable.type ? `{${variable.type}} ` : ''}
            {variable.value}
          </span>
        </button>
        {trailing}
      </div>
      {expanded && children
        ? children.map((child) => (
            <VariableRow
              key={`${variable.variablesReference}:${child.name}`}
              variable={child}
              depth={depth + 1}
            />
          ))
        : null}
    </>
  )
}

export function DebugVariablesTree(): React.JSX.Element {
  const scopes = useDebugStore((s) => s.scopes)
  const variablesByReference = useDebugStore((s) => s.variablesByReference)
  const scopesWithVariables = scopes.filter(
    (scope) => variablesByReference[scope.variablesReference]
  )

  return (
    <div className="flex min-h-0 flex-col" data-testid="debug-variables">
      <div className="shrink-0 px-2 py-1 text-xs font-semibold text-muted-foreground">
        {translate('debug.variables', 'Variables')}
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-auto">
        {scopesWithVariables.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {translate('debug.variablesEmpty', 'Variables appear when the program pauses')}
          </div>
        ) : (
          scopesWithVariables.map((scope) => (
            <div key={scope.variablesReference}>
              {scopes.length > 1 ? (
                <div className="px-2 pt-1 text-xs text-muted-foreground">{scope.name}</div>
              ) : null}
              {variablesByReference[scope.variablesReference].map((variable) => (
                <VariableRow key={variable.name} variable={variable} depth={0} />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
