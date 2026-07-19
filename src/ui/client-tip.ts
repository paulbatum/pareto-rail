type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

export function getStartScreenTip(fullscreenAvailable: boolean) {
  const { isiOS, standalone, coarsePointer } = getClientTipPlatform();

  if (isiOS && !standalone) {
    return 'Best with sound on and fullscreen. iPhone/iPad: Share → Add to Home Screen. Audio starts after first tap.';
  }

  if (isiOS) {
    return 'Best with sound on — audio starts after first tap. Home Screen mode is active.';
  }

  if (coarsePointer) {
    return fullscreenAvailable ? 'Best with sound on and fullscreen: open pause and tap Fullscreen.' : 'Best with sound on.';
  }

  return fullscreenAvailable ? 'Best with sound on and fullscreen: press F.' : 'Best with sound on.';
}

export function getLockUndoTip(): string {
  const { isiOS, coarsePointer } = getClientTipPlatform();
  return isiOS || coarsePointer ? '' : 'Right-click removes your last lock.';
}

function getClientTipPlatform() {
  return {
    isiOS: isIOS(),
    standalone: isStandalone(),
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
  };
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  const navigatorWithStandalone = navigator as NavigatorWithStandalone;
  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
}
