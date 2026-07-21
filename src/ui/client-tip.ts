/* The sound encouragement lives in its own start-screen banner (see hud.setSoundTipVisible),
   so the client tip only carries guidance that varies by platform. */
export function getStartScreenTip(fullscreenAvailable: boolean) {
  if (isCoarsePointer()) return '';
  return fullscreenAvailable ? 'Fullscreen: press F' : '';
}

export function getLockUndoTip(): string {
  return isCoarsePointer() ? '' : 'Right-click removes your last lock.';
}

function isCoarsePointer() {
  return window.matchMedia('(pointer: coarse)').matches;
}
