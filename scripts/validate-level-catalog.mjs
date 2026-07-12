#!/usr/bin/env node
import path from 'node:path';
import { createServer } from 'vite';

const root = path.resolve(process.cwd());
const server = await createServer({ root, appType: 'custom', logLevel: 'error', server: { middlewareMode: true, hmr: false } });
try {
  const { benchmarkLevelCatalog } = await server.ssrLoadModule('/src/levels/index.ts');
  for (const entry of benchmarkLevelCatalog) await entry.load();
  console.log(`Validated ${benchmarkLevelCatalog.length} discovered benchmark level module(s).`);
} finally {
  await server.close();
}
