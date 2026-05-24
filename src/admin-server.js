import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig, saveConfig } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createAdminApp({ onConfigChange }) {
  const app = express();
  app.use(express.json());

  app.get('/api/config', (_req, res) => {
    res.json(getConfig());
  });

  app.post('/api/config', async (req, res) => {
    const current = getConfig();
    const { proxyPort, adminPort, targetUrl, debug } = req.body;

    const updates = {};
    if (targetUrl !== undefined) updates.targetUrl = String(targetUrl).trim();
    if (debug !== undefined) updates.debug = Boolean(debug);
    if (proxyPort !== undefined) updates.proxyPort = Number(proxyPort);
    if (adminPort !== undefined) updates.adminPort = Number(adminPort);

    if (updates.proxyPort && (updates.proxyPort < 1 || updates.proxyPort > 65535)) {
      return res.status(400).json({ error: 'proxyPort must be between 1 and 65535' });
    }
    if (updates.adminPort && (updates.adminPort < 1 || updates.adminPort > 65535)) {
      return res.status(400).json({ error: 'adminPort must be between 1 and 65535' });
    }
    if (updates.targetUrl && !/^https?:\/\/.+/.test(updates.targetUrl)) {
      return res.status(400).json({ error: 'targetUrl must be a valid http(s) URL' });
    }

    const nextConfig = await saveConfig(updates);
    const portChanged =
      (updates.proxyPort !== undefined && updates.proxyPort !== current.proxyPort) ||
      (updates.adminPort !== undefined && updates.adminPort !== current.adminPort);

    if (onConfigChange) {
      await onConfigChange(nextConfig, { portChanged });
    }

    res.json({
      ...nextConfig,
      restartRequired: portChanged,
      message: portChanged
        ? 'Port settings saved. Restart the container to apply port changes.'
        : 'Settings saved and applied.',
    });
  });

  app.use(express.static(path.join(__dirname, '../public')));

  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  return app;
}
