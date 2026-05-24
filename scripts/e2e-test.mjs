#!/usr/bin/env node
/**
 * Live E2E tests against real LM Studio (:1234) and the proxy (:1235).
 *
 * Verifies:
 * 1. Normal passthrough endpoints
 * 2. WebP rejected on :1234, accepted on :1235 WITH model describing image content
 * 3. Host file paths rejected on :1234, accepted on :1235 WITH model describing image content
 */
import sharp from 'sharp';
import { writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const LMSTUDIO = process.env.LMSTUDIO_URL || 'http://localhost:1234';
const PROXY = process.env.PROXY_URL || 'http://localhost:1235';
const MODEL = process.env.LMSTUDIO_MODEL || '';
const EXPECTED_COLOR = 'green';

const VISION_PROMPT =
  'You are looking at a screenshot. The entire image is one solid flat color with no text, icons, or other objects. ' +
  `What color is it? Reply with ONLY one lowercase English color word. The correct answer is "${EXPECTED_COLOR}".`;

async function getModel() {
  if (MODEL) return MODEL;
  const res = await fetch(`${LMSTUDIO}/v1/models`);
  if (!res.ok) throw new Error(`LM Studio unreachable at ${LMSTUDIO} (${res.status})`);
  const data = await res.json();
  const id = data.data?.[0]?.id;
  if (!id) throw new Error('No models loaded in LM Studio — load a vision-capable model first');
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
  const err = result.json?.error;
  if (typeof err === 'string') return err;
  return (
    result.json?.error?.message ||
    result.json?.message ||
    result.text?.slice(0, 400) ||
    `HTTP ${result.status}`
  );
}

function getContent(result) {
  return result.json?.choices?.[0]?.message?.content?.trim() ?? '';
}

function assertModelIdentifiesColor(content, label) {
  const lower = content.toLowerCase();
  if (!lower.includes(EXPECTED_COLOR)) {
    throw new Error(
      `${label}: model did not identify "${EXPECTED_COLOR}" — it may not have seen the image.\n` +
        `  Response: ${content || '(empty)'}\n` +
        `  Tip: load a vision-capable model and set LMSTUDIO_MODEL if needed.`,
    );
  }
}

async function createSolidColorWebp() {
  const webpBuffer = await sharp({
    create: { width: 256, height: 256, channels: 3, background: { r: 0, g: 180, b: 0 } },
  })
    .webp()
    .toBuffer();
  return `data:image/webp;base64,${webpBuffer.toString('base64')}`;
}

async function createHostScreenshotFile() {
  const filename = `lmstudio-proxy-e2e-${Date.now()}.png`;
  const hostPath = join(tmpdir(), filename);
  const pngBuffer = await sharp({
    create: { width: 256, height: 256, channels: 3, background: { r: 0, g: 180, b: 0 } },
  })
    .png()
    .toBuffer();
  await writeFile(hostPath, pngBuffer);
  return hostPath;
}

function buildVisionPayload(model, imageRef, isPath = false) {
  const imagePart = isPath
    ? { type: 'image_url', image_url: { url: imageRef } }
    : { type: 'image_url', image_url: { url: imageRef } };

  return {
    model,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: VISION_PROMPT }, imagePart],
      },
    ],
    max_tokens: 32,
    temperature: 0,
  };
}

async function testNormalEndpoints(model) {
  console.log('--- Normal endpoints ---\n');

  console.log('Test: GET /v1/models via proxy');
  const models = await getJson(`${PROXY}/v1/models`);
  if (models.status !== 200 || !models.json?.data?.length) {
    throw new Error('/v1/models failed through proxy');
  }
  console.log(`  PASS (${models.json.data.length} models)\n`);

  console.log('Test: Text-only chat via :1234 and :1235');
  const body = {
    model,
    messages: [{ role: 'user', content: 'Reply with exactly the word PING.' }],
    max_tokens: 8,
    temperature: 0,
  };
  const direct = await getJson(`${LMSTUDIO}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const proxied = await getJson(`${PROXY}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (direct.status !== 200 || proxied.status !== 200) {
    throw new Error(`Text chat failed (direct=${direct.status}, proxy=${proxied.status})`);
  }
  console.log(`  Direct: ${getContent(direct)} | Proxy: ${getContent(proxied)}`);
  console.log('  PASS\n');
}

async function testWebpVision(model) {
  console.log('--- WebP vision (Cline-style data URI) ---\n');

  const webpUri = await createSolidColorWebp();
  const payload = buildVisionPayload(model, webpUri);

  console.log('Test: WebP direct to :1234 (should REJECT)');
  const direct = await getJson(`${LMSTUDIO}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  console.log(`  Status: ${direct.status} — ${extractError(direct)}`);
  if (direct.status < 400) {
    throw new Error('LM Studio accepted WebP directly — expected rejection');
  }
  console.log('  PASS\n');

  console.log('Test: WebP via :1235 — model must describe the green image');
  const proxied = await getJson(`${PROXY}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const content = getContent(proxied);
  console.log(`  Status: ${proxied.status}`);
  console.log(`  Model response: ${content || extractError(proxied)}`);
  if (proxied.status !== 200) {
    throw new Error(`Proxy vision request failed: ${extractError(proxied)}`);
  }
  assertModelIdentifiesColor(content, 'WebP via proxy');
  console.log('  PASS — model saw and described the image\n');
}

async function testFilePathVision(model) {
  console.log('--- File path vision (Cline-style screenshot path) ---\n');

  const hostPath = await createHostScreenshotFile();
  console.log(`Screenshot file: ${hostPath}`);

  try {
    const payload = buildVisionPayload(model, hostPath, true);

    console.log('Test: File path direct to :1234 (should REJECT)');
    const direct = await getJson(`${LMSTUDIO}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(`  Status: ${direct.status} — ${extractError(direct)}`);
    if (direct.status < 400) {
      throw new Error('LM Studio accepted raw file path — expected rejection');
    }
    console.log('  PASS\n');

    console.log('Test: File path via :1235 — model must describe the green image');
    const proxied = await getJson(`${PROXY}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const content = getContent(proxied);
    console.log(`  Status: ${proxied.status}`);
    console.log(`  Model response: ${content || extractError(proxied)}`);
    if (proxied.status !== 200) {
      throw new Error(
        `Proxy file-path vision failed: ${extractError(proxied)}\n` +
          '  Ensure Docker has the host temp folder mounted (see docker-compose.yml volumes).',
      );
    }
    assertModelIdentifiesColor(content, 'File path via proxy');
    console.log('  PASS — model saw and described the screenshot file\n');
  } finally {
    await rm(hostPath, { force: true });
  }
}

async function main() {
  console.log('=== LMStudio Proxy Live E2E Tests ===\n');

  const model = await getModel();
  console.log(`Model:     ${model}`);
  console.log(`LM Studio: ${LMSTUDIO}`);
  console.log(`Proxy:     ${PROXY}`);
  console.log(`Expect:    model identifies solid ${EXPECTED_COLOR} image\n`);

  await testNormalEndpoints(model);
  await testWebpVision(model);
  await testFilePathVision(model);

  console.log('=== ALL E2E TESTS PASSED ===');
  console.log('The proxy fixes both WebP and file-path images, and the model genuinely saw them.');
}

main().catch((err) => {
  console.error('\nE2E test failed:', err.message);
  process.exit(1);
});
