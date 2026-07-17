import fs from 'node:fs/promises';
import path from 'node:path';

export async function checkoutLayout(directory) {
  try {
    const metadata = await fs.lstat(path.join(directory, '.git'));
    if (metadata.isFile()) return 'linked';
    if (metadata.isDirectory()) return 'standalone';
    return null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
