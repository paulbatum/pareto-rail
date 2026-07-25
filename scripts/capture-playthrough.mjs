#!/usr/bin/env node
/* Record a promotional playthrough video of a level: the real game, played by an
 * autoplay policy, with its procedural soundtrack. See docs/playthrough-videos.md.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { launchCaptureBrowser } from './capture/browser.mjs';
import { installCaptureRuntime } from './capture/in-page.mjs';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Finished videos belong on the Windows side, out of the WSL filesystem. Intermediates
   always stay local: writing them across the Windows mount runs at a fifteenth of the
   speed and would put a slow path in the middle of a real-time capture. */
const WINDOWS_RECORDINGS_DIR = '/mnt/f/Recordings/Pareto Rail';

const RESOLUTIONS = {
  '720p': { width: 1280, height: 720, bitrate: 12_000_000 },
  '1080p': { width: 1920, height: 1080, bitrate: 20_000_000 },
};

const POLICIES = ['volley', 'perfect', 'imperfect'];
const FRAME_SOURCES = ['render-loop', 'compositor'];

const DEFAULT_TUNING = {
  speed: 5.0,     // reticle sweep speed, NDC per second
  maxHold: 4.5,   // seconds before firing a partial volley anyway
  grace: 1.4,     // seconds to wait for another target before firing
  dwell: 0.06,    // pause on each target after locking it
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const { width, height, bitrate: defaultBitrate } = RESOLUTIONS[options.resolution];
  const bitrate = options.bitrate ?? defaultBitrate;
  const outDir = options.out ?? (fs.existsSync(WINDOWS_RECORDINGS_DIR) ? WINDOWS_RECORDINGS_DIR : path.join(root, 'tmp'));
  const stem = fileStem(options.level, options.policy, options.resolution);
  const outPath = path.join(outDir, `${stem}.mp4`);
  const videoPath = path.join(root, 'tmp', `${stem}.h264`);
  const audioPath = path.join(root, 'tmp', `${stem}.audio.webm`);

  await ensureBuild(options.build);
  await fsp.mkdir(path.join(root, 'tmp'), { recursive: true });
  if (!options.dryRun) await fsp.mkdir(outDir, { recursive: true });

  const server = await preview({ root, logLevel: 'error', preview: { host: '127.0.0.1', port: options.serverPort } });
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine the preview server port');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  console.log(`Recording ${options.level} · ${options.policy} · ${options.resolution} · seed ${options.seed}`);
  const browser = await launchCaptureBrowser({ port: options.port, width, height });
  let connection = null;
  let videoStream = null;

  try {
    connection = await puppeteer.connect({ browserURL: browser.browserURL });
    const page = await connection.newPage();
    page.on('pageerror', (error) => console.error(`[page] ${error.message}`));
    page.on('console', (message) => {
      // Resource failures are reported from the response side, with the URL attached.
      if (message.text().startsWith('Failed to load resource')) return;
      if (message.type() === 'error') console.error(`[page] ${message.text()}`);
    });
    page.on('response', (response) => {
      /* Two absences are normal here and not worth reporting: Chrome always asks for
         /favicon.ico even though the site ships an SVG icon, and the Vercel analytics
         script only exists once deployed. */
      const url = response.url();
      if (response.status() < 400 || url.endsWith('/favicon.ico') || url.includes('/_vercel/')) return;
      console.error(`[page] ${response.status()} ${url}`);
    });
    await page.setViewport({ width, height, deviceScaleFactor: 1 });

    if (!options.dryRun) {
      videoStream = fs.createWriteStream(videoPath);
      let writeChain = Promise.resolve();
      await page.exposeFunction('__paretoVideoSink', (base64) => {
        const buffer = Buffer.from(base64, 'base64');
        writeChain = writeChain.then(() => new Promise((resolve) => {
          if (videoStream.write(buffer)) resolve();
          else videoStream.once('drain', resolve);
        }));
        return true;
      });
      videoStream.writeChain = () => writeChain;
    }

    await page.evaluateOnNewDocument(installCaptureRuntime, { immortal: !options.mortal });
    const url = new URL('/', baseUrl);
    url.searchParams.set('level', options.level);
    url.searchParams.set('capture', '1');
    await page.goto(url.href, { waitUntil: 'networkidle0' });
    await settle(page, options.warmupSeconds);

    await startFullscreen(page);
    const canvasSize = await page.evaluate(() => {
      if (!window.__raildCapture) return null;
      return { width: window.__raildCapture.canvas.width, height: window.__raildCapture.canvas.height };
    });
    if (!canvasSize) {
      throw new Error('The page exposed no capture handle. The built site must include the ?capture=1 hook in src/game.');
    }
    if (canvasSize.width !== width || canvasSize.height !== height) {
      console.warn(`Canvas is ${canvasSize.width}x${canvasSize.height}, expected ${width}x${height}`);
    }

    await page.evaluate((args) => window.__paretoInstallAutoplay(args), {
      policy: options.policy,
      seed: options.seed,
      tuning: { ...DEFAULT_TUNING, ...options.tuning },
    });

    const recording = page.evaluate((args) => window.__paretoRecord(args), {
      dryRun: options.dryRun,
      frameSource: options.frameSource,
      fps: options.fps,
      bitrate,
      codec: options.codec,
      maxSeconds: options.maxSeconds,
      tailSeconds: options.tailSeconds,
      queueLimit: 90,
    });
    // A beat of recording before the run begins, so the first frame is not the start word.
    await new Promise((resolve) => setTimeout(resolve, 600));
    await page.keyboard.press('r');

    const result = await recording;
    if (videoStream) {
      await videoStream.writeChain();
      await new Promise((resolve) => videoStream.end(resolve));
      videoStream = null;
      await fsp.writeFile(audioPath, Buffer.from(result.audio, 'base64'));
    }
    await page.close();
    report(result, options);

    if (options.dryRun) {
      console.log('Dry run: nothing written.');
      return;
    }
    if (!result.reachedEnd) {
      console.warn(`The run did not reach the end of the level within ${options.maxSeconds}s; the video is truncated.`);
    }

    const fps = (result.frameCount / result.seconds).toFixed(3);
    await run('ffmpeg', [
      '-y', '-v', 'error',
      '-r', fps, '-i', videoPath,
      '-i', audioPath,
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest',
      outPath,
    ]);
    if (!options.keepIntermediates) {
      await fsp.rm(videoPath, { force: true });
      await fsp.rm(audioPath, { force: true });
    }
    console.log(`Wrote ${outPath}`);
  } finally {
    if (videoStream) videoStream.end();
    connection?.disconnect();
    await browser.stop();
    await server.close();
  }
}

function fileStem(level, policy, resolution) {
  const name = policy === 'volley' ? `${level}_playthrough` : `${level}_playthrough_${policy}`;
  return `${name}_${localTimestamp()}_${resolution}`.replace(/-/g, '_');
}

// Local time, so a recording's name matches when it was made; takes never overwrite.
function localTimestamp(now = new Date()) {
  const pad = (value) => `${value}`.padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `${date}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function ensureBuild(force) {
  const indexPath = path.join(root, 'dist', 'index.html');
  if (!force && fs.existsSync(indexPath)) return;
  console.log(force ? 'Building the site…' : 'Building the site (dist/ is missing)…');
  await run('npm', ['run', 'build'], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
}

async function settle(page, seconds) {
  // Let the level mount, then let shaders compile: the first recorded run after a cold
  // browser drops frames otherwise.
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function startFullscreen(page) {
  /* The site's navigation insets the canvas, so a windowed capture is not a clean 16:9.
     The game's own fullscreen mode fixes that, and browsers only honour a fullscreen
     request that follows real input — which a debugging-protocol keystroke counts as. */
  const point = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  if (!point) throw new Error('The game canvas never appeared; is the level id correct?');
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.press('f');
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

function report(result, options) {
  const lines = [
    `frames ${result.frameCount} (${(result.frameCount / result.seconds).toFixed(1)} fps, ${result.dropped} dropped)`,
    `length ${result.seconds.toFixed(1)}s`,
  ];
  if (result.summary) {
    lines.push(`score ${result.summary.score} rank ${result.summary.rank} · ${result.summary.kills}/${result.summary.totalEnemies} kills`);
  }
  if (options.policy === 'volley' && result.volleySizes.length > 0) {
    const sizes = result.volleySizes;
    const mean = sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
    const full = sizes.filter((size) => size === 6).length;
    lines.push(`volleys ${sizes.length}, mean ${mean.toFixed(2)} locks, ${full} at full six`);
  }
  console.log(lines.join('\n'));
}

function parseArgs(argv) {
  const options = {
    level: 'crystal-corridor',
    policy: 'volley',
    seed: 7,
    resolution: '720p',
    frameSource: 'render-loop',
    fps: 60,
    codec: 'avc1.64002A',
    maxSeconds: 300,
    tailSeconds: 2.5,
    warmupSeconds: 6,
    port: 9333,
    serverPort: 5199,
    tuning: {},
    dryRun: false,
    mortal: false,
    keepIntermediates: false,
    build: false,
    help: false,
    out: undefined,
    bitrate: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return next;
    };
    switch (arg) {
      case '--level': options.level = value(); break;
      case '--policy': options.policy = value(); break;
      case '--seed': options.seed = Number(value()); break;
      case '--resolution': options.resolution = value(); break;
      case '--frames': options.frameSource = value(); break;
      case '--fps': options.fps = Number(value()); break;
      case '--bitrate': options.bitrate = Number(value()); break;
      case '--max-seconds': options.maxSeconds = Number(value()); break;
      case '--out': options.out = path.resolve(process.cwd(), value()); break;
      case '--port': options.port = Number(value()); break;
      case '--server-port': options.serverPort = Number(value()); break;
      case '--speed': options.tuning.speed = Number(value()); break;
      case '--max-hold': options.tuning.maxHold = Number(value()); break;
      case '--grace': options.tuning.grace = Number(value()); break;
      case '--dry-run': options.dryRun = true; break;
      case '--mortal': options.mortal = true; break;
      case '--keep-intermediates': options.keepIntermediates = true; break;
      case '--build': options.build = true; break;
      case '--help': case '-h': options.help = true; break;
      default: throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!RESOLUTIONS[options.resolution]) throw new Error(`Unknown resolution: ${options.resolution} (720p or 1080p)`);
  if (!POLICIES.includes(options.policy)) throw new Error(`Unknown policy: ${options.policy} (${POLICIES.join(', ')})`);
  if (!FRAME_SOURCES.includes(options.frameSource)) throw new Error(`Unknown frame source: ${options.frameSource} (${FRAME_SOURCES.join(', ')})`);
  return options;
}

function usage() {
  console.log(`Usage: npm run capture:playthrough -- [options]

  --level <id>          Level to record, default crystal-corridor
  --policy <name>       volley (default), perfect, or imperfect
  --seed <n>            Seed for policy randomness, default 7
  --resolution <size>   720p (default) or 1080p
  --frames <source>     render-loop (default) or compositor
  --out <dir>           Output directory; defaults to the Windows recordings drive
  --dry-run             Play the level and report, without recording
  --mortal              Let the player die instead of surviving the run
  --speed / --max-hold / --grace   Volley sweep tuning
  --build               Rebuild the site before recording
  --keep-intermediates  Keep the raw video and audio next to the finished file
  --port / --server-port           Debugging and preview ports
`);
}
