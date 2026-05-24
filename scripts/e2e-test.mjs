#!/usr/bin/env node
/**
 * Live E2E tests against real LM Studio (:1234) and the proxy (:1235).
 *
 * 1. Normal endpoints — text chat and /v1/models work through the proxy
 * 2. Vision fix — WebP rejected on :1234, accepted via :1235
 */
import sharp from 'sharp';

const LMSTUDIO = process.env.LMSTUDIO_URL || 'http://localhost:1234';
const PROXY = process.env.PROXY_URL || 'http://localhost:1235';
const MODEL = process.env.LMSTUDIO_MODEL || '';

async function getModel() {
  if (MODEL) return MODEL;
  const res = await fetch(`${LMSTUDIO}/v1/models`);
  if (!res.ok) throw new Error(`LM Studio unreachable at ${LMSTUDIO} (${res.status})`);
  const data = await res.json();
  const id = data.data?.[0]?.id;
  if (!id) throw new Error('No models loaded in LM Studio');
  return id;
}

async function getJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, text };
}

function extractError(result) {
  return (
    result.json?.error?.message ||
    result.json?.error ||
    result.json?.message ||
    result.text?.slice(0, 300) ||
    `HTTP ${result.status}`
  );
}

async function testNormalEndpoints(model) {
  console.log('--- Normal endpoints ---\n');

  console.log('Test: GET /v1/models via proxy');
  const models = await getJson(`${PROXY}/v1/models`);
  console.log(`  Status: ${models.status}`);
  if (models.status !== 200 || !models.json?.data?.length) {
    console.error('  FAIL: /v1/models did not return a model list through the proxy');
    process.exit(1);
  }
  console.log(`  Models: ${models.json.data.map((m) => m.id).join(', ')}`);
  console.log('  PASS\n');

  console.log('Test: Text-only chat via LM Studio :1234');
  const directBody = {
    model,
    messages: [{ role: 'user', content: 'Reply with exactly the word PING.' }],
    max_tokens: 8,
    temperature: 0,
  };
  const direct = await getJson(`${LMSTUDIO}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(directBody),
  });
  console.log(`  Status: ${direct.status}`);
  const directContent = direct.json?.choices?.[0]?.message?.content;
  console.log(`  Response: ${directContent ?? extractError(direct)}`);
  if (direct.status !== 200 || !directContent) {
    console.error('  FAIL: text-only chat failed directly against LM Studio');
    process.exit(1);
  }
  console.log('  PASS\n');

  console.log('Test: Text-only chat via proxy :1235');
  const proxied = await getJson(`${PROXY}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(directBody),
  });
  console.log(`  Status: ${proxied.status}`);
  const proxiedContent = proxied.json?.choices?.[0]?.message?.content;
  console.log(`  Response: ${proxiedContent ?? extractError(proxied)}`);
  if (proxied.status !== 200 || !proxiedContent) {
    console.error('  FAIL: text-only chat failed through the proxy');
    process.exit(1);
  }
  console.log('  PASS\n');

  console.log('Test: GET /health on proxy');
  const health = await getJson(`${PROXY}/health`);
  console.log(`  Status: ${health.status}`);
  console.log(`  Body: ${JSON.stringify(health.json)}`);
  if (health.status !== 200 || health.json?.status !== 'ok') {
    console.error('  FAIL: proxy /health check failed');
    process.exit(1);
  }
  console.log('  PASS\n');
}

async function buildWebpPayload(model) {
  const webpBuffer = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .webp()
    .toBuffer();

  const webpDataUri = `data:image/webp;base64,${webpBuffer.toString('base64')}`;

  return {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Reply with exactly the word OK and nothing else.' },
          { type: 'image_url', image_url: { url: webpDataUri } },
        ],
      },
    ],
    max_tokens: 16,
    temperature: 0,
  };
}

async function testVisionFix(model) {
  console.log('--- Vision image fix ---\n');

  const payload = await buildWebpPayload(model);
  const webpUrl = payload.messages[0].content[1].image_url.url;
  console.log(`Payload image: WebP data URI (${webpUrl.length} chars)\n`);

  console.log('Test: WebP direct to LM Studio :1234 (should REJECT)');
  const direct = await getJson(`${LMSTUDIO}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  console.log(`  Status: ${direct.status}`);
  console.log(`  Response: ${extractError(direct)}`);
  const directRejected =
    direct.status >= 400 || /base64|webp|url.*field|image/i.test(String(extractError(direct)));
  if (!directRejected) {
    console.error('  FAIL: LM Studio accepted WebP directly — expected rejection');
    process.exit(1);
  }
  console.log('  PASS\n');

  console.log('Test: WebP via proxy :1235 (should ACCEPT)');
  const proxied = await getJson(`${PROXY}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  console.log(`  Status: ${proxied.status}`);
  const content = proxied.json?.choices?.[0]?.message?.content;
  console.log(`  Response: ${content ?? extractError(proxied)}`);
  if (proxied.status !== 200 || !proxied.json?.choices?.length) {
    console.error('  FAIL: proxy did not return a successful vision completion');
    process.exit(1);
  }
  console.log('  PASS\n');
}

async function main() {
  console.log('=== LMStudio Proxy Live E2E Tests ===\n');

  const model = await getModel();
  console.log(`Model:     ${model}`);
  console.log(`LM Studio: ${LMSTUDIO}`);
  console.log(`Proxy:     ${PROXY}\n`);

  await testNormalEndpoints(model);
  await testVisionFix(model);

  console.log('=== ALL E2E TESTS PASSED ===');
}

main().catch((err) => {
  console.error('E2E test failed:', err.message);
  process.exit(1);
});
