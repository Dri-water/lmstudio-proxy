import { readFile } from 'fs/promises';
import { extname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { isFilePath, resolveHostImagePath } from './host-paths.js';

export { isFilePath } from './host-paths.js';

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

export async function convertImageToBase64(imagePath) {
  const imageBuffer = await readFile(imagePath);
  const ext = extname(imagePath).toLowerCase();
  const mimeType = MIME_TYPES[ext];

  if (!mimeType) {
    throw new Error(`Unsupported image format: ${ext}`);
  }

  const base64Image = imageBuffer.toString('base64');
  return `data:${mimeType};base64,${base64Image}`;
}

export async function convertWebpDataUriToPng(imageUrl) {
  const base64Data = imageUrl.replace(/^data:image\/webp;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');
  const pngBuffer = await sharp(buffer).png().toBuffer();
  return `data:image/png;base64,${pngBuffer.toString('base64')}`;
}

export function normalizeImageUrlObject(contentItem) {
  const imageUrl = contentItem.image_url?.url ?? contentItem.image_url;
  if (typeof contentItem.image_url === 'string') {
    contentItem.image_url = { url: imageUrl };
  }
  return imageUrl;
}

export function setImageUrl(contentItem, value) {
  if (typeof contentItem.image_url === 'string') {
    contentItem.image_url = value;
  } else {
    contentItem.image_url.url = value;
  }
}

export async function processImageUrl(imageUrl, { debug = false, log = console.log } = {}) {
  if (isFilePath(imageUrl)) {
    let filePath = imageUrl;
    if (filePath.startsWith('file://')) {
      try {
        filePath = fileURLToPath(filePath);
      } catch {
        filePath = filePath.replace('file://', '');
      }
    }

    filePath = resolveHostImagePath(filePath);

    if (debug) log(`[PROXY] Converting image path: ${imageUrl} -> ${filePath}`);
    const base64Uri = await convertImageToBase64(filePath);
    if (debug) log(`[PROXY] Converted path to base64 (${base64Uri.length} chars)`);
    return { url: base64Uri, converted: true };
  }

  if (imageUrl.startsWith('data:image/webp')) {
    if (debug) log('[PROXY] Converting WebP data URI to PNG');
    const pngBase64 = await convertWebpDataUriToPng(imageUrl);
    if (debug) log(`[PROXY] Converted WebP to PNG (${pngBase64.length} chars)`);
    return { url: pngBase64, converted: true };
  }

  if (imageUrl.startsWith('data:')) {
    if (debug) log(`[PROXY] Passing through data URI (${imageUrl.substring(0, 30)}...)`);
    return { url: imageUrl, converted: false, normalizeStructure: typeof imageUrl === 'string' };
  }

  if (debug) log(`[PROXY] Skipping remote URL: ${imageUrl}`);
  return { url: imageUrl, converted: false };
}

export async function processRequestBody(body, options = {}) {
  if (!body || typeof body !== 'object') return body;

  const processedBody = JSON.parse(JSON.stringify(body));

  if (!processedBody.messages || !Array.isArray(processedBody.messages)) {
    return processedBody;
  }

  for (const message of processedBody.messages) {
    if (!message.content || !Array.isArray(message.content)) continue;

    for (const contentItem of message.content) {
      if (contentItem.type !== 'image_url' || !contentItem.image_url) continue;

      const imageUrl = normalizeImageUrlObject(contentItem);

      try {
        const result = await processImageUrl(imageUrl, options);
        setImageUrl(contentItem, result.url);

        if (result.normalizeStructure && typeof contentItem.image_url === 'string') {
          contentItem.image_url = { url: result.url };
        }
      } catch (error) {
        const logFn = options.log || console.error;
        logFn(`[PROXY] Failed to convert image: ${error.message}`);
      }
    }
  }

  return processedBody;
}
