/* Browser target for the headless render tools.
 *
 * `gpu` is the default and the only mode that renders what the game actually ships: a
 * real WebGPU device, real node materials, real postprocessing. It reuses the Windows
 * browser the playthrough recorder drives (see ./browser.mjs).
 *
 * `software` is the fallback for a machine without that setup. It runs Chrome inside
 * WSL on SwiftShader, where three.js can only use its WebGL2 backend, so the images are
 * an approximation and the frame timings mean nothing.
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { launchCaptureBrowser } from './browser.mjs';

export const RENDER_MODES = ['gpu', 'software'];

/* 9333 belongs to the playthrough recorder. Fixed rather than picked per run: Windows
   reserves scattered blocks of TCP ports, and a browser handed one of those starts
   normally but never binds, which reads as a browser that failed to come up. Pass a
   different port to run two capture tools at once. */
export const DEFAULT_DEBUG_PORT = 9334;

const SOFTWARE_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--disable-gpu-sandbox',
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
];

const SOFTWARE_HINT = 'Pass --software to fall back to the SwiftShader path instead; it renders the WebGL backend at reduced fidelity.';

/**
 * The mode a render tool uses when the caller asks for neither. Environments that have
 * no Windows browser to reach — the benchmark entrant sandboxes above all — set
 * `PARETO_RENDER_MODE=software` so their tools degrade deliberately rather than fail.
 */
export function defaultRenderMode() {
  const configured = process.env.PARETO_RENDER_MODE;
  if (configured === undefined || configured === '') return 'gpu';
  return readRenderMode(configured);
}

/**
 * Opens the browser the render tools drive. The caller closes it through `close()`.
 * `backend` is the three.js backend the pages should ask for.
 */
export async function openRenderBrowser({ mode = defaultRenderMode(), width = 1280, height = 720, port = DEFAULT_DEBUG_PORT } = {}) {
  if (!RENDER_MODES.includes(mode)) throw new Error(`Unknown render mode: ${mode} (${RENDER_MODES.join(', ')})`);

  if (mode === 'software') {
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: findLinuxChrome(),
      args: SOFTWARE_ARGS,
      // Chrome probes the display even headless, and hangs there when WSLg's X socket is
      // present but dead — which reads as an unexplained navigation timeout.
      env: withoutDisplay(process.env),
    });
    return { browser, mode, backend: 'webgl', close: () => browser.close() };
  }

  let launched;
  try {
    launched = await launchCaptureBrowser({ port, width, height, profile: `pareto-rail-snapshot-${port}` });
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : error}\n\n${SOFTWARE_HINT}`);
  }

  const browser = await puppeteer.connect({ browserURL: launched.browserURL });
  return {
    browser,
    mode,
    backend: 'webgpu',
    async close() {
      browser.disconnect();
      await launched.stop();
    },
  };
}

/**
 * Navigates, and explains the failure a Windows browser hits most often: it cannot
 * reach the dev server this process is running inside WSL.
 */
export async function gotoOrExplain(page, href, { mode, baseUrl, waitUntil = 'networkidle0' }) {
  try {
    await page.goto(href, { waitUntil });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (mode !== 'gpu') throw error;
    throw new Error(
      `The GPU browser could not load ${baseUrl}: ${message}\n`
      + 'It runs on the Windows side and has to reach this dev server inside WSL, which needs WSL mirrored\n'
      + `networking (networkingMode=mirrored in .wslconfig) or localhost forwarding.\n\n${SOFTWARE_HINT}`,
    );
  }
}

/**
 * three.js falls back to its WebGL2 backend without saying so when no WebGPU device is
 * available, which would quietly turn a full-fidelity capture back into an approximation.
 */
export function assertBackend(requested, actual) {
  if (requested === actual) return;
  if (requested !== 'webgpu') throw new Error(`The page rendered with the ${actual} backend, not the requested ${requested} backend.`);
  throw new Error(
    'The GPU browser has no WebGPU device: three.js fell back to its WebGL2 backend, so this capture would\n'
    + 'not be the pipeline the game ships. Check chrome://gpu in that browser — a blocklisted or missing\n'
    + `driver is the usual cause, and an old Chrome or Edge is the next.\n\n${SOFTWARE_HINT}`,
  );
}

/** `--software` on any render tool, parsed the same way everywhere. */
export function readRenderMode(value) {
  if (!RENDER_MODES.includes(value)) throw new Error(`Unknown render mode: ${value} (${RENDER_MODES.join(', ')})`);
  return value;
}

export function backendForMode(mode) {
  return mode === 'software' ? 'webgl' : 'webgpu';
}

function withoutDisplay(env) {
  const copy = { ...env };
  delete copy.DISPLAY;
  return copy;
}

function findLinuxChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const candidate of [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
