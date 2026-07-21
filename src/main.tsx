import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import './app/style.css';
import './app/theme.css';
import { Analytics } from '@vercel/analytics/react';
import { App } from './app/App';
import { installDevErrorOverlay } from './ui/dev-error-overlay';

if (import.meta.env.DEV) installDevErrorOverlay();

// After a redeploy, a still-open tab can request a content-hashed chunk that no
// longer exists, so its dynamic import rejects. Reloading fetches the fresh
// index.html and its current chunk names, which fixes the common stale-tab case.
// We debounce on a stored timestamp rather than a one-shot flag: a genuine redeploy
// recovers because its reloads are far apart in time, but if a reload does NOT fix
// it — a broken deploy whose chunk 404s even when fresh, including a deep link
// straight to a lazy route — the next preload error lands inside the debounce window
// and we stop, letting the error boundary show a fallback instead of looping.
const RELOAD_GUARD_KEY = 'preload-error-reloaded-at';
const RELOAD_DEBOUNCE_MS = 10_000;
window.addEventListener('vite:preloadError', (event) => {
  let lastReloadAt: number;
  try {
    lastReloadAt = Number(sessionStorage.getItem(RELOAD_GUARD_KEY)) || 0;
  } catch {
    // sessionStorage can throw (e.g. private browsing). Without a working guard we
    // can't prevent a reload loop, so skip auto-reload and let the boundary handle it.
    return;
  }
  if (Date.now() - lastReloadAt < RELOAD_DEBOUNCE_MS) return;
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    return;
  }
  event.preventDefault();
  location.reload();
});

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root');

createRoot(root).render(
  <StrictMode>
    <App />
    <Analytics />
  </StrictMode>,
);
document.body.classList.remove('booting');
