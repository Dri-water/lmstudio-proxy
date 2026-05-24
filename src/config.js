import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const CONFIG_DIR = process.env.CONFIG_DIR || '/data';
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  proxyPort: Number(process.env.PROXY_PORT) || 1235,
  adminPort: Number(process.env.ADMIN_PORT) || 8090,
  targetUrl: process.env.LMSTUDIO_URL || 'http://localhost:1234',
  debug: process.env.DEBUG === 'true',
};

let config = { ...DEFAULTS };

export function getConfig() {
  return { ...config };
}

export async function loadConfig() {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true });
  }

  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = await readFile(CONFIG_PATH, 'utf-8');
      const saved = JSON.parse(raw);
      config = { ...DEFAULTS, ...saved };
    } catch (err) {
      console.warn('[CONFIG] Failed to read config, using defaults:', err.message);
      config = { ...DEFAULTS };
    }
  } else {
    config = { ...DEFAULTS };
    await saveConfig();
  }

  // Environment always wins for listen ports (matches Docker port mappings)
  if (process.env.PROXY_PORT) config.proxyPort = Number(process.env.PROXY_PORT);
  if (process.env.ADMIN_PORT) config.adminPort = Number(process.env.ADMIN_PORT);
  if (process.env.LMSTUDIO_URL) config.targetUrl = process.env.LMSTUDIO_URL;
  if (process.env.DEBUG !== undefined) config.debug = process.env.DEBUG === 'true';

  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));

  return getConfig();
}

export async function saveConfig(updates = {}) {
  config = { ...config, ...updates };
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true });
  }
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
  return getConfig();
}

export function getConfigPath() {
  return CONFIG_PATH;
}
