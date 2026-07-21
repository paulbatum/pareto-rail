export function getStartScreenTip(fullscreenAvailable: boolean) {
  if (isCoarsePointer()) return 'Best with sound on.';
  return fullscreenAvailable ? 'Best with sound on and fullscreen: press F.' : 'Best with sound on.';
}

export function getLockUndoTip(): string {
  return isCoarsePointer() ? '' : 'Right-click removes your last lock.';
}

function isCoarsePointer() {
  return window.matchMedia('(pointer: coarse)').matches;
}
