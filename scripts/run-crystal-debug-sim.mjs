import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'warn',
  server: { middlewareMode: true },
});

try {
  await server.ssrLoadModule('/scripts/sim-crystal-lancer-debug.ts');
} finally {
  await server.close();
}
