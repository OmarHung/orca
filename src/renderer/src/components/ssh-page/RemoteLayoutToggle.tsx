import { Folder, Rows2, SquareTerminal, type LucideIcon } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { ShortcutKeyCombo } from '../ShortcutKeyCombo'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import type { RemoteLayout } from './remote-session-store'

const IS_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
const CHORD_KEYS = IS_MAC ? ['⌘', '⌥'] : ['Ctrl', 'Alt']

type LayoutOption = { value: RemoteLayout; Icon: LucideIcon; digit: string; label: () => string }

const LAYOUT_OPTIONS: readonly LayoutOption[] = [
  {
    value: 'terminal',
    Icon: SquareTerminal,
    digit: '1',
    label: () => translate('sshPage.layout.terminal', 'Terminal')
  },
  {
    value: 'split',
    Icon: Rows2,
    digit: '2',
    label: () => translate('sshPage.layout.split', 'Split')
  },
  {
    value: 'files',
    Icon: Folder,
    digit: '3',
    label: () => translate('sshPage.layout.files', 'Files')
  }
]

/** Switches what the active tab shows. Labels give way first on a narrow strip. */
export function RemoteLayoutToggle({
  layout,
  onChange
}: {
  /** Null while no tab is open. */
  layout: RemoteLayout | null
  onChange: (layout: RemoteLayout) => void
}): React.JSX.Element {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="xs"
      value={layout ?? ''}
      disabled={layout === null}
      aria-label={translate('sshPage.layout.label', 'Tab layout')}
      onValueChange={(value) => {
        // Why find: a click on the pressed item reports an empty value, which changes nothing.
        const option = LAYOUT_OPTIONS.find((candidate) => candidate.value === value)
        if (option) {
          onChange(option.value)
        }
      }}
    >
      {LAYOUT_OPTIONS.map(({ value, Icon, digit, label }) => (
        <Tooltip key={value}>
          <TooltipTrigger asChild>
            <ToggleGroupItem value={value} aria-label={label()} data-remote-layout={value}>
              <Icon className="size-3.5" />
              <span className="hidden @3xl/remote-strip:inline">{label()}</span>
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            <ShortcutKeyCombo keys={[...CHORD_KEYS, digit]} />
          </TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  )
}
