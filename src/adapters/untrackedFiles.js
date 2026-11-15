const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { countLines } = require('../core/stats');

const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024;
const NON_REGULAR_FILE_REASON = 'non-regular files';

/**
 * Count lines in an untracked file, returning an exclusion reason for unsafe or unreadable files.
 * The file handle is always closed; cancellation propagates to the caller.
 * @param {string} root Canonical repository root (resolved with realpath).
 * @param {string} relativePath File path relative to the repository root.
 * @param {AbortSignal} [signal]
 * @returns {Promise<{added: number} | {reason: string}>}
 */
async function readUntracked(root, relativePath, signal) {
  signal?.throwIfAborted();
  let fileHandle;

  try {
    const filename = path.resolve(root, relativePath);
    const pathStats = await fs.lstat(filename);
    if (pathStats.isSymbolicLink()) return { reason: 'symlinks' };
    if (!pathStats.isFile()) return { reason: NON_REGULAR_FILE_REASON };

    const realFilePath = await fs.realpath(filename);
    const relativeRealPath = path.relative(root, realFilePath);
    if (relativeRealPath === '..' || relativeRealPath.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRealPath)) {
      return { reason: 'outside-repository files' };
    }

    fileHandle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const initialFileStats = await fileHandle.stat();
    if (!initialFileStats.isFile()) return { reason: NON_REGULAR_FILE_REASON };
    if (initialFileStats.size > MAX_UNTRACKED_BYTES) return { reason: 'oversized files' };

    // Read one extra byte to detect growth without exceeding the scan limit.
    const buffer = Buffer.alloc(Math.min(initialFileStats.size + 1, MAX_UNTRACKED_BYTES + 1));
    let totalBytesRead = 0;

    while (totalBytesRead < buffer.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await fileHandle.read(buffer, totalBytesRead, buffer.length - totalBytesRead, null);
      if (!bytesRead) break;

      totalBytesRead += bytesRead;
    }

    const finalFileStats = await fileHandle.stat();
    if (totalBytesRead !== initialFileStats.size
      || finalFileStats.size !== initialFileStats.size
      || finalFileStats.mtimeMs !== initialFileStats.mtimeMs) {
      return { reason: 'files changed during scan' };
    }

    const added = countLines(buffer.subarray(0, totalBytesRead));
    return added === null ? { reason: 'binary files' } : { added };
  } catch {
    signal?.throwIfAborted();
    return { reason: 'unreadable files' };
  } finally {
    await fileHandle?.close();
  }
}

/**
 * Resolve the canonical root used to check whether untracked files stay inside the repository.
 * @param {string} root
 * @returns {Promise<string>}
 */
function realpath(root) {
  return fs.realpath(root);
}

module.exports = { readUntracked, realpath, MAX_UNTRACKED_BYTES };
