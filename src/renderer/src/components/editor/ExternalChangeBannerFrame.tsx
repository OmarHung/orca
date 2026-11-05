import React from 'react'

/** Stacks a file's external-change banner above a diff surface. */
export function ExternalChangeBannerFrame({
  banner,
  children
}: {
  banner: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  if (!banner) {
    return <>{children}</>
  }
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {banner}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
