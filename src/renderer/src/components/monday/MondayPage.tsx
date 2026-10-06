import React, { useEffect, useMemo } from 'react'
import { CalendarRange, Loader2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { isWebClientLocation } from '@/lib/web-client-location'
import type { MondayError, MondaySchedule } from '../../../../shared/monday/monday-types'
import { buildMondayEntries } from './monday-calendar-model'
import { mondayErrorMessage } from './monday-error-message'
import {
  checkMondayForChanges,
  disconnectMonday,
  loadMondayConnection,
  loadMondaySchedule,
  refreshMonday
} from './monday-page-actions'
import { useMondayPageStore } from './monday-page-store'
import { MondayBrowserPanel } from './MondayBrowserPanel'
import { MondayConnectPanel } from './MondayConnectPanel'
import { MondayGanttView } from './MondayGanttView'
import { MondayItemDetailPanel } from './MondayItemDetailPanel'
import { MondayMonthView } from './MondayMonthView'
import { MondayStatusBar } from './MondayStatusBar'
import { MondayToolbar } from './MondayToolbar'
import { useMondayToday } from './use-monday-today'

function CenteredMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function ErrorBanner({
  error,
  onRetry
}: {
  error: MondayError
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-destructive/10 px-4 py-2 text-xs">
      <span className="min-w-0 flex-1 text-destructive">{mondayErrorMessage(error)}</span>
      {error.kind === 'unauthorized' ? (
        <Button variant="outline" size="xs" onClick={() => void disconnectMonday()}>
          {translate('monday.action.reconnect', 'Connect again')}
        </Button>
      ) : (
        <Button variant="outline" size="xs" onClick={onRetry}>
          <RotateCw className="size-3" />
          {translate('monday.action.retry', 'Retry')}
        </Button>
      )}
    </div>
  )
}

function ScheduleWorkspace({ schedule }: { schedule: MondaySchedule }): React.JSX.Element {
  const prefs = useMondayPageStore((state) => state.prefs)
  const anchorMonth = useMondayPageStore((state) => state.anchorMonth)
  const selectedItemId = useMondayPageStore((state) => state.selectedItemId)
  const today = useMondayToday()
  const { scheduled, unscheduled } = useMemo(
    () =>
      buildMondayEntries(
        schedule,
        { hideDone: prefs.hideDone, statusLabels: prefs.statusLabels },
        today
      ),
    [schedule, prefs.hideDone, prefs.statusLabels, today]
  )
  const selectedEntry = useMemo(
    () => [...scheduled, ...unscheduled].find((entry) => entry.item.id === selectedItemId) ?? null,
    [scheduled, unscheduled, selectedItemId]
  )
  const selectedBoard =
    schedule.boards.find((board) => board.boardId === selectedEntry?.item.boardId) ?? null
  return (
    <>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {prefs.view === 'month' ? (
            <MondayMonthView
              entries={scheduled}
              anchorMonth={anchorMonth}
              today={today}
              selectedItemId={selectedItemId}
            />
          ) : (
            <MondayGanttView
              entries={scheduled}
              boardOrder={prefs.boardIds}
              anchorMonth={anchorMonth}
              today={today}
              selectedItemId={selectedItemId}
            />
          )}
        </div>
        {selectedItemId ? (
          <MondayItemDetailPanel
            key={selectedItemId}
            itemId={selectedItemId}
            entry={selectedEntry}
            board={selectedBoard}
            today={today}
          />
        ) : null}
      </div>
      <MondayStatusBar
        schedule={schedule}
        scheduledCount={scheduled.length}
        unscheduled={unscheduled}
      />
    </>
  )
}

function ScheduleArea(): React.JSX.Element {
  const boardIds = useMondayPageStore((state) => state.prefs.boardIds)
  const schedule = useMondayPageStore((state) => state.schedule)
  const loading = useMondayPageStore((state) => state.scheduleLoading)
  const error = useMondayPageStore((state) => state.scheduleError)

  useEffect(() => {
    if (boardIds.length === 0) {
      return
    }
    // Coming back to the page: reload only if monday changed since the last read.
    if (useMondayPageStore.getState().schedule) {
      void checkMondayForChanges()
    } else {
      void loadMondaySchedule({ refresh: false })
    }
  }, [boardIds.length])

  useEffect(() => {
    const onFocus = (): void => void checkMondayForChanges()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  if (boardIds.length === 0) {
    return (
      <CenteredMessage>
        <CalendarRange className="size-7" />
        <p className="max-w-sm">
          {translate(
            'monday.empty.noBoards',
            'Choose the monday boards whose schedule you want to see.'
          )}
        </p>
        <Button onClick={() => useMondayPageStore.setState({ boardPickerOpen: true })}>
          {translate('monday.boards.choose', 'Choose boards')}
        </Button>
      </CenteredMessage>
    )
  }
  return (
    <>
      {error ? <ErrorBanner error={error} onRetry={() => void refreshMonday()} /> : null}
      {schedule ? (
        <ScheduleWorkspace schedule={schedule} />
      ) : loading ? (
        <CenteredMessage>
          <Loader2 className="size-5 animate-spin" />
          {translate('monday.loading.schedule', 'Reading schedule from monday…')}
        </CenteredMessage>
      ) : null}
    </>
  )
}

function ConnectedPage(): React.JSX.Element {
  const connection = useMondayPageStore((state) => state.connection)
  const connectionError = useMondayPageStore((state) => state.connectionError)
  if (!connection) {
    return connectionError ? (
      <CenteredMessage>
        <p className="text-destructive">{mondayErrorMessage(connectionError)}</p>
        <Button variant="outline" onClick={() => void loadMondayConnection()}>
          {translate('monday.action.retry', 'Retry')}
        </Button>
      </CenteredMessage>
    ) : (
      <div className="flex-1" />
    )
  }
  if (!connection.account) {
    return <MondayConnectPanel />
  }
  return (
    <>
      <MondayToolbar
        account={connection.account}
        sessionOnly={connection.tokenKeptForSessionOnly}
      />
      <ScheduleArea />
    </>
  )
}

export default function MondayPage(): React.JSX.Element {
  useEffect(() => {
    void loadMondayConnection()
  }, [])
  if (isWebClientLocation()) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background" data-testid="monday-page">
        <CenteredMessage>
          {translate('monday.page.desktopOnly', 'monday is available in the desktop app only.')}
        </CenteredMessage>
      </div>
    )
  }
  return (
    <div className="flex h-full min-h-0 bg-background" data-testid="monday-page">
      <div className="flex min-w-0 flex-1 flex-col">
        <ConnectedPage />
      </div>
      <MondayBrowserPanel />
    </div>
  )
}
