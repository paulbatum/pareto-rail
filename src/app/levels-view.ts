import type { LevelsView } from './router';

const LEVELS_VIEW_KEY = 'pr-levels-view';

/** The gallery is the default; a stored preference only ever moves a bare
 * /levels visit to the data view. Deep links to /levels/data always win. */
export function getLevelsView(): LevelsView {
  if (typeof window === 'undefined') return 'gallery';
  try {
    return window.localStorage.getItem(LEVELS_VIEW_KEY) === 'data' ? 'data' : 'gallery';
  } catch {
    return 'gallery';
  }
}

export function setLevelsView(view: LevelsView): void {
  try {
    window.localStorage.setItem(LEVELS_VIEW_KEY, view);
  } catch {
    // The page still works when storage is unavailable.
  }
}
