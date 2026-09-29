import * as z from 'zod'

export const TopLevelViewSchema = z
  .enum([
    'terminal',
    'settings',
    'tasks',
    'activity',
    'automations',
    'space',
    'skills',
    // Bot templates was a view before it became a dialog; an older peer can still send it.
    'botTemplates',
    'artifacts',
    'mobile',
    'database',
    'ssh',
    'sftp'
  ])
  .transform((view) => (view === 'botTemplates' ? 'terminal' : view))
