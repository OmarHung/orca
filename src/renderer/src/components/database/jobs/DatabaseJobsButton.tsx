import React from 'react'
import { ListChecks, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import { DatabaseJobRow } from './DatabaseJobRow'
import { useDatabaseJobsStore } from './database-jobs-store'

/** The page header's list of background jobs; hidden until the first one starts. */
export function DatabaseJobsButton(): React.JSX.Element | null {
  const jobs = useDatabaseJobsStore((state) => state.jobs)
  const cancel = useDatabaseJobsStore((state) => state.cancel)
  const dismiss = useDatabaseJobsStore((state) => state.dismiss)
  if (jobs.length === 0) {
    return null
  }
  const running = jobs.filter((job) => job.status === 'running').length
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          {running > 0 ? <Loader2 className="size-3.5 animate-spin" /> : <ListChecks />}
          {running > 0
            ? translate('database.jobs.runningCount', 'Jobs ({{value0}} running)', {
                value0: String(running)
              })
            : translate('database.jobs.button', 'Jobs')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(440px,calc(100vw-2rem))]">
        <div
          role="list"
          aria-label={translate('database.jobs.list', 'Background jobs')}
          className="scrollbar-sleek max-h-[60vh] divide-y divide-border overflow-y-auto"
        >
          {jobs.map((job) => (
            <div role="listitem" key={job.id}>
              <DatabaseJobRow
                job={job}
                onCancel={() => void cancel(job.id)}
                onDismiss={() => dismiss(job.id)}
              />
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
