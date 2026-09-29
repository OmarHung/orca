import { useEffect, useState, type RefObject } from 'react'

function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') === true
}

/**
 * Finder drops onto the remote pane become uploads. Preload claims every native file drop at
 * document capture to route it to terminals and editors, so this listens one step earlier, on
 * window capture, and takes only drops that land inside the pane.
 */
export function useSftpFileDrop(
  zoneRef: RefObject<HTMLElement | null>,
  onDropPaths: (paths: string[]) => void,
  enabled: boolean
): boolean {
  const [isOver, setIsOver] = useState(false)

  useEffect(() => {
    if (!enabled) {
      return
    }
    const isInsideZone = (event: DragEvent): boolean => {
      const zone = zoneRef.current
      return zone !== null && event.target instanceof Node && zone.contains(event.target)
    }
    const onDragOver = (event: DragEvent): void => {
      setIsOver(carriesFiles(event) && isInsideZone(event))
    }
    const onDragLeave = (event: DragEvent): void => {
      if (event.relatedTarget === null) {
        setIsOver(false)
      }
    }
    const onDrop = (event: DragEvent): void => {
      setIsOver(false)
      if (!carriesFiles(event) || !isInsideZone(event)) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      const paths = Array.from(event.dataTransfer?.files ?? [])
        .map((file) => window.api.sftp.getPathForFile(file))
        .filter((filePath) => filePath !== '')
      if (paths.length > 0) {
        onDropPaths(paths)
      }
    }
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('drop', onDrop, true)
    }
  }, [enabled, onDropPaths, zoneRef])

  return isOver
}
