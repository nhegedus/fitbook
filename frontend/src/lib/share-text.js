// Hands a piece of text to the system share sheet (fork feature, docs/NUTRITION.md: sharing a
// meal). The phone app uses the native sheet; a browser its own when it has one (phones do);
// anywhere else — or when the browser refuses — the text goes to the clipboard instead.
// Returns what happened, for the caller's toast: 'shared' | 'dismissed' | 'copied' | 'failed'.
import { MOBILE } from './mobile.js'
import { copyText } from './clipboard.js'

export async function shareText(text, title) {
  if (MOBILE) {
    try {
      const { Share } = await import('@capacitor/share')
      await Share.share({ title, text })
      return 'shared'
    } catch { return 'dismissed' }   // the native sheet throws when it is closed
  }
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try { await navigator.share({ title, text }); return 'shared' }
    catch (e) { if (e?.name === 'AbortError') return 'dismissed' }
  }
  return (await copyText(text)) ? 'copied' : 'failed'
}
