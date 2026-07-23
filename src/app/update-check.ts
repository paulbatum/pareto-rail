/* Silent staleness detection for long-open tabs. A tab that stays open across a redeploy
   keeps its old bundle until something forces a document load. We poll a tiny /version.json
   (emitted at build time, see versionMarkerPlugin in vite.config.ts) and, when its commit
   differs from the one baked into this bundle, flip a flag. router.navigate() reads the flag
   and turns the next real user navigation into a full document load, which fetches the fresh
   build. No UI, no prompt — the upgrade is invisible.

   Every failure mode is a silent no-op: fetch errors, non-OK responses, malformed JSON, and
   an empty baked-in hash (local builds have no SHA) never set the flag or log. We only ever
   flag when both the baked-in and fetched commits are non-empty and differ. */

const BAKED_COMMIT = __COMMIT_HASH__;
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // slow background poll
const MIN_FETCH_GAP_MS = 60 * 1000; // throttle so visibility flaps don't spam requests

let updateAvailable = false;
let lastFetchAt = 0;

export function isUpdateAvailable(): boolean {
  return updateAvailable;
}

async function checkForUpdate(): Promise<void> {
  if (updateAvailable) return; // sticky once set; nothing more to learn
  if (!BAKED_COMMIT) return; // local build with no SHA — never flag
  const now = Date.now();
  if (now - lastFetchAt < MIN_FETCH_GAP_MS) return;
  lastFetchAt = now;

  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const data: unknown = await res.json();
    const deployed = (data as { commit?: unknown })?.commit;
    if (typeof deployed !== 'string' || !deployed) return;
    if (deployed !== BAKED_COMMIT) updateAvailable = true;
  } catch {
    // Offline, blocked, or malformed response — stay silent and try again later.
  }
}

/* Wire up the background checks. No-op in dev (HMR already keeps the bundle fresh, and
   there's no dev-server route for /version.json). App mounts once, so this doesn't guard
   against double installation. */
export function installUpdateCheck(): void {
  if (import.meta.env.DEV) return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
  window.setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);
  void checkForUpdate();
}
