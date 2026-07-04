import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'warn',
  server: { middlewareMode: true, hmr: false },
});

try {
  await server.ssrLoadModule('/scripts/sim-crystal-lancer-debug.ts');
} finally {
  await server.close();
}
