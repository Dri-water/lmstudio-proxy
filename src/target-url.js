/**
 * When the proxy runs in Docker, localhost inside the container is not the host.
 * Rewrite localhost/127.0.0.1 to host.docker.internal for outbound requests only.
 */
export function resolveTargetUrl(url) {
  if (!url) return url;

  const inDocker = process.env.DOCKER === 'true';

  try {
    const parsed = new URL(url);
    const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

    if (inDocker && isLocalHost) {
      parsed.hostname = 'host.docker.internal';
      return parsed.toString();
    }
  } catch {
    return url;
  }

  return url;
}
