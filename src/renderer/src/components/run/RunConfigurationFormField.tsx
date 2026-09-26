import React from 'react'
import { Label } from '@/components/ui/label'

/** Label + control + helper text, following the settings form anatomy. */
export function FormField({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {description ? <p className="text-[11px] text-muted-foreground">{description}</p> : null}
    </div>
  )
}
