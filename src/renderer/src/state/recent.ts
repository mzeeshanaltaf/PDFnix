import { create } from 'zustand'
import type { RecentFile } from '../../../shared/api'

interface RecentState {
  files: RecentFile[]
}

/** The recent-files list. Main owns and persists it; this mirrors it for the UI. */
export const useRecent = create<RecentState>(() => ({ files: [] }))

/** Loads the list and follows changes. Returns a function that stops following. */
export function startRecentSync(): () => void {
  void window.api.files.getRecent().then((files) => useRecent.setState({ files }))
  return window.api.files.onRecentChanged((files) => useRecent.setState({ files }))
}
