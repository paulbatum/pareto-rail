type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

export function getStartScreenTip(fullscreenAvailable: boolean) {
  const isiOS = isIOS();
  const standalone = isStandalone();
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

  if (isiOS && !standalone) {
    return 'Fullscreen recommended on iPhone/iPad: Share → Add to Home Screen. Audio starts after first tap.';
  }

  if (isiOS) {
    return 'Fullscreen recommended. Home Screen mode is active. Audio starts after first tap.';
  }

  if (fullscreenAvailable) {
    return coarsePointer ? 'Fullscreen recommended: open pause and tap Fullscreen.' : 'Fullscreen recommended: press F.';
  }

  return '';
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  const navigatorWithStandalone = navigator as NavigatorWithStandalone;
  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
}
