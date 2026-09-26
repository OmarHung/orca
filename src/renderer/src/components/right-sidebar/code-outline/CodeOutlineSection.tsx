import React, { useCallback, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useDragResize } from '@/components/bottom-panel/use-drag-resize'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { CodeOutlineBody } from './CodeOutlineBody'
import {
  loadCodeOutlineSectionLayout,
  saveCodeOutlineSectionLayout,
  type CodeOutlineSectionLayout
} from './code-outline-section-storage'
import { useActiveOutlineTarget } from './use-code-outline'

const MIN_SECTION_HEIGHT = 96
// Leaves the file tree above at least this much room when the section is dragged up.
const MIN_FILE_TREE_HEIGHT = 120

/** Collapsible, resizable Structure section docked under the Explorer's file tree. */
export function CodeOutlineSection(): React.JSX.Element {
  const target = useActiveOutlineTarget()
  const [layout, setLayout] = useState<CodeOutlineSectionLayout>(loadCodeOutlineSectionLayout)
  const sectionRef = useRef<HTMLDivElement>(null)

  const updateLayout = useCallback((patch: Partial<CodeOutlineSectionLayout>) => {
    setLayout((current) => {
      const next = { ...current, ...patch }
      saveCodeOutlineSectionLayout(next)
      return next
    })
  }, [])
  const setHeight = useCallback((height: number) => updateLayout({ height }), [updateLayout])
  const { size, handleProps } = useDragResize({
    axis: 'y',
    size: layout.height,
    setSize: setHeight,
    min: MIN_SECTION_HEIGHT,
    getMax: () =>
      (sectionRef.current?.parentElement?.clientHeight ?? layout.height) - MIN_FILE_TREE_HEIGHT,
    direction: -1
  })

  const title = translate('auto.components.rightSidebar.CodeOutlinePanel.title', 'Structure')

  return (
    <div
      ref={sectionRef}
      data-testid="code-outline-section"
      className={cn(
        'relative flex shrink-0 flex-col border-t border-border',
        !layout.collapsed && 'min-h-0'
      )}
      // Why: cap by the container too, so a height saved in a taller window can't hide the file tree.
      style={
        layout.collapsed
          ? undefined
          : { height: size, maxHeight: `calc(100% - ${MIN_FILE_TREE_HEIGHT}px)` }
      }
    >
      {!layout.collapsed ? (
        <div
          {...handleProps}
          aria-label={translate(
            'auto.components.rightSidebar.CodeOutlinePanel.resize',
            'Resize Structure'
          )}
          className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize outline-none focus-visible:bg-ring/30"
        />
      ) : null}
      <button
        type="button"
        aria-expanded={!layout.collapsed}
        aria-label={translate(
          'auto.components.rightSidebar.CodeOutlinePanel.toggle',
          'Toggle Structure section'
        )}
        className="flex h-7 shrink-0 items-center gap-1 px-1.5 text-left"
        onClick={() => updateLayout({ collapsed: !layout.collapsed })}
      >
        <ChevronDown
          className={cn(
            'size-3 shrink-0 text-foreground/70 transition-transform',
            layout.collapsed && '-rotate-90'
          )}
        />
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-foreground/70">
          {title}
        </span>
        {target ? (
          <span className="min-w-0 truncate text-[11px] text-muted-foreground">
            {target.fileName}
          </span>
        ) : null}
      </button>
      {!layout.collapsed ? <CodeOutlineBody /> : null}
    </div>
  )
}
