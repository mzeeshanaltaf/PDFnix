import { toast } from 'sonner'

/** Puts `text` on the clipboard and says so; reports failure. */
export async function copyText(text: string, what = 'Text'): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`, { duration: 2000 })
    return true
  } catch {
    toast.error(`${what} could not be copied`)
    return false
  }
}
