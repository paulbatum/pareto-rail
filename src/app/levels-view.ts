import type { LevelsView } from './router';

const LEVELS_VIEW_KEY = 'pr-levels-view';

/** The data view is the default; only a visitor who has chosen the gallery gets
 * it back on a bare /levels visit. Deep links to either view always win. */
export function getLevelsView(): LevelsView {
  if (typeof window === 'undefined') return 'data';
  try {
    return window.localStorage.getItem(LEVELS_VIEW_KEY) === 'gallery' ? 'gallery' : 'data';
  } catch {
    return 'data';
  }
}

export function setLevelsView(view: LevelsView): void {
  try {
    window.localStorage.setItem(LEVELS_VIEW_KEY, view);
  } catch {
    // The page still works when storage is unavailable.
  }
}
