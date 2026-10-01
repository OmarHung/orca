import React from 'react'
import { FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import { getRelativePathInsideRoot } from '@/lib/path'

/** A folder path typed in, or picked with Browse when the workspace is on this machine. */
export function FolderPathInput({
  value,
  disabled,
  browseRoot,
  placeholder,
  testIdPrefix,
  onChange
}: {
  value: string
  disabled: boolean
  /** The workspace root when its folders are on this machine, so Browse can pick one. */
  browseRoot: string | null
  placeholder: string
  testIdPrefix: string
  onChange: (value: string) => void
}): React.JSX.Element {
  const browse = async (): Promise<void> => {
    if (!browseRoot) {
      return
    }
    const picked = await window.api.shell.pickDirectory({ defaultPath: browseRoot })
    if (picked) {
      // Why relative: the configuration is saved per repository and must work in every worktree.
      const relative = getRelativePathInsideRoot(picked, browseRoot)
      onChange(relative === null ? picked : relative || '.')
    }
  }
  return (
    <div className="flex gap-2">
      <Input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        data-testid={`${testIdPrefix}-output-dir`}
        onChange={(event) => onChange(event.target.value)}
      />
      {browseRoot ? (
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          data-testid={`${testIdPrefix}-browse`}
          onClick={() => void browse()}
        >
          <FolderOpen />
          {translate('run.configurations.publish.browse', 'Browse…')}
        </Button>
      ) : null}
    </div>
  )
}
