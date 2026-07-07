#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const server = await createServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
});

try {
  server.moduleGraph.invalidateAll();
  const mod = await server.ssrLoadModule('/scripts/simulation-cli.ts');
  await mod.main(process.argv.slice(2), { root });
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  await server.close();
}
