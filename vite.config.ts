import { execSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { rankApiDevPlugin } from './server/vite-rank-api';
import { adminApiDevPlugin } from './server/vite-admin-api';

const templatePath = path.resolve(process.cwd(), 'src/levels/crystal/visuals/crystal-template.json');

/* Full commit SHA of the deployed build, surfaced on the About page. Vercel sets
   VERCEL_GIT_COMMIT_SHA; locally we fall back to git. Empty string when neither is available. */
function resolveCommitHash(): string {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromEnv) return fromEnv;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

const commitHash = resolveCommitHash();

export default defineConfig({
  plugins: [
    react(),
    benchmarkDescriptorsPlugin(),
    crystalTemplateDevPlugin(),
    versionMarkerPlugin(commitHash),
    rankApiDevPlugin(),
    adminApiDevPlugin(),
  ],
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  server: {
    /* Reaching the dev server from a phone needs HTTPS, since WebGPU is secure-context only.
       `tailscale serve 5173` fronts it with a cert under the tailnet's own domain. The bare
       MagicDNS name covers hitting the dev server directly from another tailnet device. */
    allowedHosts: ['.ts.net', 'paulryzen-1'],
  },
  build: {
    chunkSizeWarningLimit: 1200,
    manifest: true,
  },
});

/* Serves every benchmark level.json as one module instead of 100+ separate ones.

   The catalog needs all descriptors up front, and a bundled build inlines them either
   way. A dev server has no bundling step, so an eager glob costs one request per level
   — fine on localhost, slow over a proxied connection where each round trip is ~100ms.

   Discovery still means "a level.json one level down", so a new level appears without
   touching a registry, and nested test-fixtures stay out. */
const BENCHMARK_DESCRIPTORS_ID = 'virtual:benchmark-descriptors';
const RESOLVED_BENCHMARK_DESCRIPTORS_ID = `\0${BENCHMARK_DESCRIPTORS_ID}`;
const benchmarkLevelsRoot = path.resolve(process.cwd(), 'src/benchmark-levels');

function benchmarkDescriptorsPlugin(): Plugin {
  return {
    name: 'pareto-rail-benchmark-descriptors',
    resolveId(id) {
      return id === BENCHMARK_DESCRIPTORS_ID ? RESOLVED_BENCHMARK_DESCRIPTORS_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_BENCHMARK_DESCRIPTORS_ID) return null;

      const descriptors: Record<string, unknown> = {};
      for (const entry of fsSync.readdirSync(benchmarkLevelsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const descriptorPath = path.join(benchmarkLevelsRoot, entry.name, 'level.json');
        if (!fsSync.existsSync(descriptorPath)) continue;
        // Parsing here turns a malformed descriptor into a build error naming the file,
        // rather than a syntax error in a generated module nobody can open.
        try {
          descriptors[`./${entry.name}/level.json`] = JSON.parse(fsSync.readFileSync(descriptorPath, 'utf8'));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.error(`Invalid JSON in src/benchmark-levels/${entry.name}/level.json: ${message}`);
        }
      }

      // U+2028/U+2029 are valid in JSON strings and legal in modern JS, but escaping
      // them keeps the emitted module safe for any downstream tool that predates ES2019.
      const literal = JSON.stringify(descriptors).replace(/[\u2028\u2029]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16)}`);
      return `export default ${literal};\n`;
    },
    configureServer(server) {
      const isDescriptor = (file: string) =>
        path.dirname(path.dirname(path.resolve(file))) === benchmarkLevelsRoot && path.basename(file) === 'level.json';

      // Nothing imports the individual files any more, so the module graph cannot link a
      // descriptor edit back to this module. Adding, removing, or editing one reloads.
      const reload = (file: string) => {
        if (!isDescriptor(file)) return;
        const module = server.moduleGraph.getModuleById(RESOLVED_BENCHMARK_DESCRIPTORS_ID);
        if (module) server.moduleGraph.invalidateModule(module);
        server.ws.send({ type: 'full-reload' });
      };

      server.watcher.on('add', reload);
      server.watcher.on('unlink', reload);
      server.watcher.on('change', reload);
    },
  };
}

/* Emits a tiny /version.json holding the deployed commit SHA so a long-open tab can
   detect a newer build (see src/app/update-check.ts). Build-only: it's written into the
   output, never tracked in public/. The staleness check is disabled in dev (HMR covers it),
   so there's no dev-server route for it. */
function versionMarkerPlugin(commit: string): Plugin {
  return {
    name: 'pareto-rail-version-marker',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ commit })}\n`,
      });
    },
  };
}

function crystalTemplateDevPlugin(): Plugin {
  return {
    name: 'pareto-rail-crystal-template-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';

        if (req.method === 'GET' && (url === '/dev' || url === '/dev/')) {
          req.url = '/dev/index.html';
          next();
          return;
        }

        if (req.method !== 'POST' || url !== '/dev/api/template') {
          next();
          return;
        }

        try {
          const body = await readBody(req);
          const parsed = JSON.parse(body) as unknown;
          if (!isCrystalTemplate(parsed)) {
            sendJson(res, 400, { ok: false, error: 'Invalid CrystalTemplate body' });
            return;
          }

          await fs.writeFile(templatePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
          sendJson(res, 200, { ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Template save failed';
          sendJson(res, 400, { ok: false, error: message });
        }
      });
    },
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 200_000) reject(new Error('Request body too large'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void }, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function isCrystalTemplate(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['shared', 'kinds'])) return false;
  return isShared(value.shared) && isKinds(value.kinds);
}

function isShared(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['hexRings', 'spokes', 'shards', 'fins', 'core'])) return false;
  return (
    Array.isArray(value.hexRings) &&
    value.hexRings.length > 0 &&
    value.hexRings.every(isHexRing) &&
    isSpokes(value.spokes) &&
    isShards(value.shards) &&
    isFins(value.fins) &&
    isCore(value.core)
  );
}

function isHexRing(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['radius', 'zOffset', 'intensity', 'colorRole', 'spinOffset']) &&
    isFiniteNumber(value.radius) &&
    isFiniteNumber(value.zOffset) &&
    isFiniteNumber(value.intensity) &&
    (value.colorRole === 'accent' || value.colorRole === 'contrast') &&
    isFiniteNumber(value.spinOffset)
  );
}

function isSpokes(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['count', 'radius', 'length', 'centerDistance', 'fillIntensity', 'edgeIntensity']) &&
    isNonNegativeNumber(value.count) &&
    isNonNegativeNumber(value.radius) &&
    isNonNegativeNumber(value.length) &&
    isFiniteNumber(value.centerDistance) &&
    isNonNegativeNumber(value.fillIntensity) &&
    isNonNegativeNumber(value.edgeIntensity)
  );
}

function isShards(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'baseRadius',
      'scale',
      'xBiasScale',
      'xBiasOffset',
      'distanceMult',
      'flatten',
      'tiltJitter',
      'fillIntensity',
      'edgeIntensity',
    ]) &&
    isNonNegativeNumber(value.baseRadius) &&
    isRecord(value.scale) &&
    hasOnlyKeys(value.scale, ['x', 'y', 'z']) &&
    isRange(value.scale.x) &&
    isRange(value.scale.y) &&
    isRange(value.scale.z) &&
    isFiniteNumber(value.xBiasScale) &&
    isFiniteNumber(value.xBiasOffset) &&
    isRange(value.distanceMult) &&
    isFiniteNumber(value.flatten) &&
    isNonNegativeNumber(value.tiltJitter) &&
    isNonNegativeNumber(value.fillIntensity) &&
    isNonNegativeNumber(value.edgeIntensity)
  );
}

function isFins(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'angleSpread',
      'zTilt',
      'lengthMult',
      'baseWidth',
      'tipWidth',
      'baseDistanceMult',
      'fillIntensity',
      'edgeIntensity',
    ]) &&
    isNonNegativeNumber(value.angleSpread) &&
    isNonNegativeNumber(value.zTilt) &&
    isRange(value.lengthMult) &&
    isRange(value.baseWidth) &&
    isNonNegativeNumber(value.tipWidth) &&
    isRange(value.baseDistanceMult) &&
    isNonNegativeNumber(value.fillIntensity) &&
    isNonNegativeNumber(value.edgeIntensity)
  );
}

function isCore(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['coreRadius', 'glowRadius', 'coreIntensity', 'glowIntensity', 'glowOpacity']) &&
    isNonNegativeNumber(value.coreRadius) &&
    isNonNegativeNumber(value.glowRadius) &&
    isNonNegativeNumber(value.coreIntensity) &&
    isNonNegativeNumber(value.glowIntensity) &&
    isNonNegativeNumber(value.glowOpacity)
  );
}

function isKinds(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['node', 'drifter', 'orbiter'])) return false;
  return isKind(value.node) && isKind(value.drifter) && isKind(value.orbiter);
}

function isKind(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['weights', 'shardPairs', 'finPairs', 'shellRadius', 'elongation']) &&
    isWeightTriple(value.weights) &&
    isNonNegativeNumber(value.shardPairs) &&
    isNonNegativeNumber(value.finPairs) &&
    isNonNegativeNumber(value.shellRadius) &&
    isNonNegativeNumber(value.elongation)
  );
}

function isWeightTriple(value: unknown): boolean {
  return Array.isArray(value) && value.length === 3 && value.every(isNonNegativeNumber);
}

function isRange(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber) && value[0] <= value[1];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}
