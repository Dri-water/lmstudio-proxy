import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTargetUrl } from '../src/target-url.js';

describe('resolveTargetUrl', () => {
  let originalDocker;

  beforeEach(() => {
    originalDocker = process.env.DOCKER;
  });

  afterEach(() => {
    if (originalDocker === undefined) delete process.env.DOCKER;
    else process.env.DOCKER = originalDocker;
  });

  it('rewrites localhost to host.docker.internal when running in Docker', () => {
    process.env.DOCKER = 'true';
    assert.equal(resolveTargetUrl('http://localhost:1234'), 'http://host.docker.internal:1234/');
    assert.equal(resolveTargetUrl('http://127.0.0.1:1234'), 'http://host.docker.internal:1234/');
  });

  it('leaves localhost unchanged outside Docker', () => {
    delete process.env.DOCKER;
    assert.equal(resolveTargetUrl('http://localhost:1234'), 'http://localhost:1234');
  });

  it('leaves non-localhost URLs unchanged in Docker', () => {
    process.env.DOCKER = 'true';
    assert.equal(
      resolveTargetUrl('http://host.docker.internal:1234'),
      'http://host.docker.internal:1234',
    );
  });
});
