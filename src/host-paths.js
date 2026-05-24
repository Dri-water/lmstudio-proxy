import { isAbsolute } from 'path';

/**
 * Map host filesystem paths (from Cline/KiloCode on the host) to paths
 * visible inside the Docker container via mounted volumes.
 */
export function resolveHostImagePath(imagePath) {
  if (process.env.DOCKER !== 'true') return imagePath;

  let path = imagePath;
  const hostTemp = process.env.HOST_TEMP_MOUNT || '/host-temp';

  if (path.startsWith('file://')) {
    path = path.replace(/^file:\/\//, '');
  }

  // C:\Users\...\AppData\Local\Temp\screenshot.png
  const winTemp = path.match(/^[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\Temp\\(.+)$/i);
  if (winTemp) {
    return `${hostTemp}/${winTemp[1].replace(/\\/g, '/')}`;
  }

  // C:\Temp\foo.png or other Temp variants
  const winTempShort = path.match(/^[A-Za-z]:\\Temp\\(.+)$/i);
  if (winTempShort) {
    return `${hostTemp}/${winTempShort[1].replace(/\\/g, '/')}`;
  }

  // C:/Users/.../Temp/foo.png
  const winTempFwd = path.match(/^[A-Za-z]:\/Users\/[^/]+\/AppData\/Local\/Temp\/(.+)$/i);
  if (winTempFwd) {
    return `${hostTemp}/${winTempFwd[1]}`;
  }

  // Unix /tmp/foo.png when host temp is mounted
  if (path.startsWith('/tmp/')) {
    return `${hostTemp}/${path.slice(5)}`;
  }

  return imagePath;
}

/**
 * Detect paths sent by AI tools — includes Windows paths when running in Linux/Docker.
 */
export function isFilePath(str) {
  if (!str || typeof str !== 'string') return false;
  if (str.startsWith('data:')) return false;
  if (str.startsWith('http://') || str.startsWith('https://')) return false;
  if (/^[A-Za-z]:[\\/]/.test(str)) return true;
  if (str.startsWith('file://')) return true;
  return isAbsolute(str) || str.startsWith('./') || str.startsWith('../');
}
