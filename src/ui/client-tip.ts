/* The runner now teaches the controls with its own staged instruction prompt, and the
   sound/landscape/fullscreen encouragements are their own start-screen banners (see
   hud.setStartNudgesVisible / hud.setFullscreenOffered). Levels still receive a start tip
   they may compose onto, but the runner no longer displays it. */
export function getStartScreenTip() {
  return '';
}

export function getLockUndoTip(): string {
  return isCoarsePointer() ? '' : 'Right-click removes your last lock.';
}

function isCoarsePointer() {
  return window.matchMedia('(pointer: coarse)').matches;
}
