import { z } from 'zod'

/** Letters, digits, `_` and `-`. Any other `{{...}}` is ordinary text, such as `{{.Names}}`. */
export const SSH_COMMAND_KEY_PATTERN = /^[A-Za-z0-9_-]+$/

const LABEL_MAX_LENGTH = 200
const VALUE_MAX_LENGTH = 4_000
const TEMPLATE_MAX_LENGTH = 20_000
const OPTION_MAX_COUNT = 200
const PARAM_MAX_COUNT = 50
const HOST_MAX_COUNT = 2_000

/**
 * C0 (line breaks press Enter, Ctrl-U clears the line, Tab asks for completion), DEL, C1, and the
 * invisible direction and line controls that could make the preview read unlike what is sent.
 */
export function hasSshCommandControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0)
    return (
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    )
  })
}

/** Line breaks between commands are flattened before sending. */
function isSafeTemplate(template: string): boolean {
  return !hasSshCommandControlCharacter(template.replace(/[\r\n]/g, ''))
}

export const sshCommandParamSchema = z.object({
  key: z.string().regex(SSH_COMMAND_KEY_PATTERN).max(LABEL_MAX_LENGTH),
  label: z.string().max(LABEL_MAX_LENGTH),
  kind: z.enum(['text', 'number', 'select']),
  options: z.array(z.string().max(VALUE_MAX_LENGTH)).max(OPTION_MAX_COUNT).optional(),
  defaultValue: z.string().max(VALUE_MAX_LENGTH),
  required: z.boolean(),
  quote: z.enum(['shell', 'raw'])
})

const sshCommandScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }),
  z.object({ type: z.literal('group'), groupId: z.string().min(1) }),
  z.object({ type: z.literal('hosts'), targetIds: z.array(z.string()).max(HOST_MAX_COUNT) })
])

export const sshCommandDraftSchema = z.object({
  name: z.string().trim().min(1).max(LABEL_MAX_LENGTH),
  template: z.string().trim().min(1).max(TEMPLATE_MAX_LENGTH).refine(isSafeTemplate),
  params: z
    .array(sshCommandParamSchema)
    .max(PARAM_MAX_COUNT)
    .refine((params) => new Set(params.map((param) => param.key)).size === params.length),
  runMode: z.enum(['run', 'insert']),
  scope: sshCommandScopeSchema
})

export const sshCommandSchema = sshCommandDraftSchema.extend({ id: z.string().min(1) })

export const sshCommandSaveRequestSchema = z.object({
  id: z.string().min(1).optional(),
  draft: sshCommandDraftSchema
})

export const sshCommandIdSchema = z.string().min(1)

export type SshCommandParam = z.infer<typeof sshCommandParamSchema>
export type SshCommandScope = z.infer<typeof sshCommandScopeSchema>
export type SshCommandDraft = z.infer<typeof sshCommandDraftSchema>
export type SshCommand = z.infer<typeof sshCommandSchema>
export type SshCommandSaveRequest = z.infer<typeof sshCommandSaveRequestSchema>

export type SshCommandResult<T> = { ok: true; value: T } | { ok: false; error: string }
