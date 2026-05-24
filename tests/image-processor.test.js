import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import sharp from 'sharp';
import {
  isFilePath,
  convertImageToBase64,
  convertWebpDataUriToPng,
  processRequestBody,
} from '../src/image-processor.js';

describe('isFilePath', () => {
  it('detects absolute file paths', () => {
    assert.equal(isFilePath('/tmp/screenshot.png'), true);
    assert.equal(isFilePath('C:\\Users\\test\\screenshot.png'), true);
  });

  it('rejects URLs and data URIs', () => {
    assert.equal(isFilePath('https://example.com/img.png'), false);
    assert.equal(isFilePath('data:image/png;base64,abc'), false);
    assert.equal(isFilePath('http://localhost:1234/x'), false);
  });

  it('detects file:// URLs', () => {
    assert.equal(isFilePath('file:///tmp/screenshot.png'), true);
  });
});

describe('image conversion — the original LMStudio bugs', () => {
  let tempDir;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lmstudio-proxy-test-'));
    const pngBuffer = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    await writeFile(join(tempDir, 'screenshot.png'), pngBuffer);
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('bug 1: converts local file paths to base64 data URIs', async () => {
    const imagePath = join(tempDir, 'screenshot.png');
    const dataUri = await convertImageToBase64(imagePath);

    assert.match(dataUri, /^data:image\/png;base64,/);

    const body = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image_url', image_url: { url: imagePath } },
          ],
        },
      ],
    };

    const processed = await processRequestBody(body);
    const url = processed.messages[0].content[1].image_url.url;
    assert.match(url, /^data:image\/png;base64,/);
    assert.notEqual(url, imagePath);
  });

  it('bug 2: converts WebP data URIs to PNG for LMStudio compatibility', async () => {
    const webpBuffer = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 128, b: 255 } },
    })
      .webp()
      .toBuffer();
    const webpDataUri = `data:image/webp;base64,${webpBuffer.toString('base64')}`;

    const pngDataUri = await convertWebpDataUriToPng(webpDataUri);
    assert.match(pngDataUri, /^data:image\/png;base64,/);

    const body = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: webpDataUri } }],
        },
      ],
    };

    const processed = await processRequestBody(body);
    const url = processed.messages[0].content[0].image_url.url;
    assert.match(url, /^data:image\/png;base64,/);
    assert.doesNotMatch(url, /webp/);
  });

  it('bug 3: normalizes string image_url to object structure', async () => {
    const pngBuffer = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 255, b: 0 } },
    })
      .png()
      .toBuffer();
    const pngDataUri = `data:image/png;base64,${pngBuffer.toString('base64')}`;

    const body = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: pngDataUri }],
        },
      ],
    };

    const processed = await processRequestBody(body);
    const item = processed.messages[0].content[0].image_url;
    assert.equal(typeof item, 'object');
    assert.ok(item.url);
    assert.match(item.url, /^data:image\/png;base64,/);
  });

  it('passes through remote HTTP URLs unchanged', async () => {
    const remoteUrl = 'https://example.com/image.png';
    const body = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: remoteUrl } }],
        },
      ],
    };

    const processed = await processRequestBody(body);
    assert.equal(processed.messages[0].content[0].image_url.url, remoteUrl);
  });
});
