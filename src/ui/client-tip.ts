type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

export function getStartScreenTip(fullscreenAvailable: boolean) {
  const isiOS = isIOS();
  const standalone = isStandalone();
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

  if (isiOS && !standalone) {
    return 'Hold + sweep START. Fullscreen on iPhone/iPad: Share → Add to Home Screen. Audio starts after first tap.';
  }

  if (isiOS) {
    return 'Hold + sweep START. Home Screen mode is fullscreen. Audio starts after first tap.';
  }

  if (fullscreenAvailable) {
    return coarsePointer
      ? 'Hold + sweep START. Use Fullscreen from pause for a bigger view.'
      : 'Hold + sweep START. Press F for fullscreen.';
  }

  return 'Hold + sweep START. Release to fire.';
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  const navigatorWithStandalone = navigator as NavigatorWithStandalone;
  return window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
}
