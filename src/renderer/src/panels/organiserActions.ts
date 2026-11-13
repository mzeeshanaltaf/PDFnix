/** What the organiser's menus and toolbars do to the selected pages. */

import {
  deletePages,
  duplicatePages,
  extractPages,
  insertBlank,
  insertFromFile,
  rotateSome
} from '@/state/pageOps'
import type { DocumentTab } from '@/state/tabs'

export interface OrganiserActions {
  rotate: (degrees: 90 | -90) => void
  duplicate: () => void
  remove: () => void
  extract: () => void
  insertBlank: (where: 'before' | 'after') => void
  insertFile: (where: 'before' | 'after') => void
}

/** The organiser's commands for `pages` of a tab (shared by menus and toolbars). */
export function organiserActions(
  tab: DocumentTab,
  pages: number[],
  after: () => void
): OrganiserActions {
  const first = pages.length > 0 ? pages[0] : tab.page
  const last = pages.length > 0 ? pages[pages.length - 1] : tab.page
  return {
    rotate: (degrees) => void rotateSome(tab.id, pages.length > 0 ? pages : [tab.page], degrees),
    duplicate: () => void duplicatePages(tab.id, pages).then(after),
    remove: () => void deletePages(tab.id, pages).then(after),
    extract: () => void extractPages(tab.id, pages),
    insertBlank: (where) =>
      void insertBlank(tab.id, where === 'before' ? first : last + 1).then(after),
    insertFile: (where) =>
      void insertFromFile(tab.id, where === 'before' ? first : last + 1).then(after)
  }
}
