/* Browser lifecycle for playthrough capture.
 *
 * Recording needs a real GPU: the game is WebGPU-only, and headless Chrome inside WSL
 * has no render device at all (no /dev/dri, no WebGPU, software rasterization only).
 * So the recorder drives Chrome on the Windows side over its remote debugging port.
 * WSL reaches it on loopback, which requires WSL's mirrored networking mode.
 */
import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

const CHROME_CANDIDATES = [
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

export function findCaptureBrowser() {
  const override = process.env.PARETO_CAPTURE_BROWSER;
  if (override) {
    if (!existsSync(override)) throw new Error(`PARETO_CAPTURE_BROWSER is set but does not exist: ${override}`);
    return override;
  }
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      'Could not find a Windows Chrome or Edge to record with.\n'
      + 'Playthrough capture needs a GPU browser on the Windows side; headless Chrome inside WSL cannot render WebGPU.\n'
      + 'Set PARETO_CAPTURE_BROWSER to the executable if it lives somewhere unusual.',
    );
  }
  return found;
}

async function windowsTempDir() {
  const { stdout } = await run('cmd.exe', ['/c', 'echo %TEMP%'], { cwd: '/mnt/c' });
  const value = stdout.trim();
  if (!value || value.includes('%TEMP%')) throw new Error('Could not read the Windows temp directory');
  return value;
}

async function waitForDebugPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return await response.json();
      lastError = new Error(`debug port answered ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `The capture browser never opened its debugging port on 127.0.0.1:${port} (${lastError?.message ?? 'no response'}).\n`
    + 'If another Chrome already holds that port, pass --port with a free one. Reaching the Windows side on\n'
    + 'loopback also requires WSL mirrored networking (networkingMode=mirrored in .wslconfig).',
  );
}

export async function launchCaptureBrowser({ port, width, height, muted = true }) {
  const executable = findCaptureBrowser();
  const profileDir = `${await windowsTempDir()}\\pareto-rail-capture`;
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*',
    // The run starts itself, with no click to unlock audio the way a player would.
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-webgpu',
    '--hide-scrollbars',
    `--window-size=${width},${height}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ];
  // Belt and braces with the unconnected audio tap: nothing should reach the speakers.
  if (muted) args.splice(args.length - 1, 0, '--mute-audio');

  const child = spawn(executable, args, { detached: true, stdio: 'ignore' });
  child.unref();
  const version = await waitForDebugPort(port, 30_000);

  return {
    browserURL: `http://127.0.0.1:${port}`,
    version,
    async stop() {
      // The launcher process exits immediately on Windows, so kill by command line.
      const script = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*pareto-rail-capture*' "
        + `-and $_.CommandLine -like '*remote-debugging-port=${port}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
      await run('powershell.exe', ['-NoProfile', '-Command', script], { cwd: '/mnt/c' }).catch(() => {});
    },
  };
}
