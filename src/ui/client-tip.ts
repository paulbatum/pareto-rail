type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

export function getStartScreenTip(fullscreenAvailable: boolean) {
  const { isiOS, standalone, coarsePointer } = getClientTipPlatform();

  if (isiOS && !standalone) {
    return 'Fullscreen recommended on iPhone/iPad: Share → Add to Home Screen. Audio starts after first tap.';
  }

  if (isiOS) {
    return 'Fullscreen recommended. Home Screen mode is active. Audio starts after first tap.';
  }

  if (coarsePointer) {
    return fullscreenAvailable ? 'Fullscreen recommended: open pause and tap Fullscreen.' : '';
  }

  return fullscreenAvailable ? 'Fullscreen recommended: press F.' : '';
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
