import React from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { FormField } from '../../run/RunConfigurationFormField'

/** Label + input, with the label also naming the input for assistive tech. */
export function TextField({
  label,
  ...inputProps
}: { label: string } & React.ComponentProps<typeof Input>): React.JSX.Element {
  return (
    <FormField label={label}>
      <Input aria-label={label} {...inputProps} />
    </FormField>
  )
}

export type SelectOption<T extends string> = { value: T; label: string; disabled?: boolean }

export function SelectField<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange
}: {
  label: string
  value: T
  options: readonly SelectOption<T>[]
  disabled?: boolean
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <FormField label={label}>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          const option = options.find((candidate) => candidate.value === next)
          if (option) {
            onChange(option.value)
          }
        }}
      >
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  )
}

export function SwitchField({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex h-9 items-center gap-2 text-sm">
      <Switch checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  )
}
