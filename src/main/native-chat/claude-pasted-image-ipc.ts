import { ipcMain } from 'electron'
import {
  findClaudePastedImage,
  parseClaudePastedImageLookupArgs
} from './claude-pasted-image-lookup'

/** Fork: lets the terminal preview the image behind Claude's `[Image #N]` chip. */
export function registerClaudePastedImageHandler(): void {
  ipcMain.handle('nativeChat:findClaudePastedImage', (_event, args: unknown) => {
    const parsed = parseClaudePastedImageLookupArgs(args)
    return parsed
      ? findClaudePastedImage(parsed)
      : { status: 'unavailable', message: 'Invalid image lookup request.' }
  })
}
