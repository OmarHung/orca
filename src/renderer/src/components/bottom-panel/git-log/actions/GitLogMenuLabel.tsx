import React from 'react'

/** One-line menu label: long branch names truncate instead of wrapping the menu tall. */
export function GitLogMenuLabel({ text }: { text: string }): React.JSX.Element {
  return (
    <span className="min-w-0 truncate" title={text}>
      {text}
    </span>
  )
}
