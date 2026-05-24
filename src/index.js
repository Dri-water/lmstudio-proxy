import { loadConfig, getConfig } from './config.js';
import { createProxyApp } from './proxy-server.js';
import { createAdminApp } from './admin-server.js';

let proxyServer = null;
let adminServer = null;

async function startProxyServer() {
  const cfg = getConfig();
  const app = createProxyApp(getConfig);

  return new Promise((resolve, reject) => {
    const server = app.listen(cfg.proxyPort, '0.0.0.0', () => {
      console.log(`[PROXY] Listening on http://0.0.0.0:${cfg.proxyPort}`);
      console.log(`[PROXY] Forwarding to ${cfg.targetUrl}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

async function startAdminServer() {
  const cfg = getConfig();
  const app = createAdminApp({
    onConfigChange: async (_nextConfig, { portChanged }) => {
      if (!portChanged) {
        console.log('[ADMIN] Runtime settings updated (targetUrl/debug)');
      }
    },
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(cfg.adminPort, '0.0.0.0', () => {
      console.log(`[ADMIN] UI available at http://0.0.0.0:${cfg.adminPort}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

async function shutdown() {
  const closers = [];
  if (proxyServer) closers.push(new Promise((r) => proxyServer.close(() => r())));
  if (adminServer) closers.push(new Promise((r) => adminServer.close(() => r())));
  await Promise.all(closers);
}

async function main() {
  await loadConfig();
  const cfg = getConfig();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        LMStudio Proxy — Docker Edition                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Fixes Cline/KiloCode vision errors by converting:');
  console.log('  • File paths  → base64 data URIs');
  console.log('  • WebP images → PNG (LMStudio compatible)');
  console.log('  • String image_url → proper object structure');
  console.log('');

  proxyServer = await startProxyServer();
  adminServer = await startAdminServer();

  if (cfg.debug) {
    console.log('[PROXY] Debug logging enabled');
  }
}

process.on('SIGINT', async () => {
  console.log('\n[PROXY] Shutting down...');
  await shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[PROXY] Shutting down...');
  await shutdown();
  process.exit(0);
});

main().catch((err) => {
  console.error('[PROXY] Failed to start:', err);
  process.exit(1);
});
