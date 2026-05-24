import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import sharp from 'sharp';
import { createProxyApp } from '../src/proxy-server.js';

describe('proxy integration', () => {
  let mockLmStudio;
  let mockPort;
  let proxyApp;
  let proxyServer;
  let proxyPort;
  let capturedBody;

  before(async () => {
    mockLmStudio = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] }));
        return;
      }

      if (req.method === 'GET' && req.url === '/v1/models/other') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }

      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        capturedBody = data ? JSON.parse(data) : null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'test', choices: [{ message: { content: 'ok' } }] }));
      });
    });

    await new Promise((resolve) => {
      mockLmStudio.listen(0, '127.0.0.1', () => {
        mockPort = mockLmStudio.address().port;
        resolve();
      });
    });

    const config = () => ({
      proxyPort: 0,
      targetUrl: `http://127.0.0.1:${mockPort}`,
      debug: false,
    });

    proxyApp = createProxyApp(config);
    await new Promise((resolve) => {
      proxyServer = proxyApp.listen(0, '127.0.0.1', () => {
        proxyPort = proxyServer.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((r) => proxyServer.close(() => r()));
    await new Promise((r) => mockLmStudio.close(() => r()));
  });

  it('exposes /health without hitting LMStudio', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.ok(body.targetUrl);
  });

  it('forwards GET /v1/models unchanged', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/v1/models`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.object, 'list');
    assert.equal(body.data[0].id, 'test-model');
  });

  it('forwards text-only chat/completions without modifying the body', async () => {
    const requestBody = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Say hello in one word.' }],
      max_tokens: 8,
    };

    const res = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    assert.equal(res.status, 200);
    assert.deepEqual(capturedBody, requestBody);
    const body = await res.json();
    assert.equal(body.choices[0].message.content, 'ok');
  });

  it('forwards chat/completions with file paths converted to base64 before reaching LMStudio', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'lmstudio-proxy-int-'));
    const pngBuffer = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
    const imagePath = join(tempDir, 'screenshot.png');
    await writeFile(imagePath, pngBuffer);

    try {
      const requestBody = {
        model: 'test-model',
        messages: [
          {
            role: 'user',
            content: [{ type: 'image_url', image_url: { url: imagePath } }],
          },
        ],
      };

      const res = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      assert.equal(res.status, 200);
      assert.ok(capturedBody);
      const forwardedUrl = capturedBody.messages[0].content[0].image_url.url;
      assert.match(forwardedUrl, /^data:image\/png;base64,/);
      assert.notEqual(forwardedUrl, imagePath);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('forwards chat/completions with WebP converted to PNG before reaching LMStudio', async () => {
    const webpBuffer = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .webp()
      .toBuffer();
    const webpDataUri = `data:image/webp;base64,${webpBuffer.toString('base64')}`;

    const requestBody = {
      model: 'test-model',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: webpDataUri } }],
        },
      ],
    };

    const res = await fetch(`http://127.0.0.1:${proxyPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    assert.equal(res.status, 200);
    assert.ok(capturedBody);
    const forwardedUrl = capturedBody.messages[0].content[0].image_url.url;
    assert.match(forwardedUrl, /^data:image\/png;base64,/);
    assert.doesNotMatch(forwardedUrl, /webp/i);
  });
});
