import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isFilePath, resolveHostImagePath } from '../src/host-paths.js';

describe('isFilePath', () => {
  it('detects Windows absolute paths (critical for Docker/Linux)', () => {
    assert.equal(isFilePath('C:\\Users\\test\\AppData\\Local\\Temp\\shot.png'), true);
    assert.equal(isFilePath('D:/Temp/screenshot.png'), true);
  });

  it('detects Unix absolute paths', () => {
    assert.equal(isFilePath('/tmp/screenshot.png'), true);
  });

  it('rejects URLs and data URIs', () => {
    assert.equal(isFilePath('https://example.com/img.png'), false);
    assert.equal(isFilePath('data:image/png;base64,abc'), false);
  });
});

describe('resolveHostImagePath', () => {
  let originalDocker;

  beforeEach(() => {
    originalDocker = process.env.DOCKER;
    process.env.DOCKER = 'true';
    process.env.HOST_TEMP_MOUNT = '/host-temp';
  });

  afterEach(() => {
    if (originalDocker === undefined) delete process.env.DOCKER;
    else process.env.DOCKER = originalDocker;
  });

  it('maps Windows temp paths to /host-temp', () => {
    assert.equal(
      resolveHostImagePath('C:\\Users\\Coconut\\AppData\\Local\\Temp\\cline-shot.png'),
      '/host-temp/cline-shot.png',
    );
  });

  it('maps Unix /tmp paths to /host-temp', () => {
    assert.equal(resolveHostImagePath('/tmp/screenshot.png'), '/host-temp/screenshot.png');
  });

  it('leaves paths unchanged outside Docker', () => {
    delete process.env.DOCKER;
    const path = 'C:\\Users\\test\\shot.png';
    assert.equal(resolveHostImagePath(path), path);
  });
});
