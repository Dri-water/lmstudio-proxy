import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { processRequestBody } from './image-processor.js';

export function createProxyApp(getConfig) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get('/health', (_req, res) => {
    const cfg = getConfig();
    res.json({
      status: 'ok',
      proxyPort: cfg.proxyPort,
      targetUrl: cfg.targetUrl,
    });
  });

  app.use(async (req, res, next) => {
    if (req.method === 'POST' && req.body) {
      const cfg = getConfig();
      try {
        req.body = await processRequestBody(req.body, {
          debug: cfg.debug,
          log: cfg.debug ? console.log : () => {},
        });
      } catch (error) {
        console.error('[PROXY] Error processing request:', error);
      }
    }
    next();
  });

  const proxy = createProxyMiddleware({
    router: () => getConfig().targetUrl,
    changeOrigin: true,
    on: {
      proxyReq: (proxyReq, req) => {
        const cfg = getConfig();
        if (cfg.debug && req.body) {
          console.log(`[PROXY] ${req.method} ${req.url} -> ${cfg.targetUrl}`);
        }
        if (req.body) {
          const bodyData = JSON.stringify(req.body);
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
          proxyReq.write(bodyData);
        }
      },
      error: (err, _req, res) => {
        console.error('[PROXY] Proxy error:', err.message);
        if (!res.headersSent) {
          res.status(502).json({
            error: 'Proxy error',
            message: err.message,
            hint: 'Check that LMStudio is running and targetUrl is reachable from the container.',
          });
        }
      },
    },
  });

  app.use('/', proxy);

  return app;
}
