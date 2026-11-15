const { exclude } = require('./stats');

const MAX_UNTRACKED_FILES = 500;
const READ_CONCURRENCY = 8;
const UNTRACKED_LIMIT_EXCLUSION = `files beyond the ${MAX_UNTRACKED_FILES}-file limit`;

/**
 * @typedef {{
 * readTrackedStats: (gitPath: string, root: string, signal?: AbortSignal) => Promise<import('./stats').Stats>,
 * listUntracked: (gitPath: string, root: string, signal?: AbortSignal) => Promise<string[]>
 * }} GitOperations
 * @typedef {{
 * realpath: (root: string) => Promise<string>,
 * readUntracked: (root: string, relativePath: string, signal?: AbortSignal) => Promise<{added: number} | {reason: string}>
 * }} FileOperations
 */

/**
 * Build a stats collector using the supplied Git and filesystem operations.
 * @param {{git: GitOperations, files: FileOperations}} dependencies
 */
function createCollectStats({ git, files }) {
  /**
   * Combine tracked totals with a sorted, capped scan of untracked files.
   * @param {string} gitPath Git executable path.
   * @param {string} root Repository working directory.
   * @param {boolean} includeUntracked Whether to read and count untracked files.
   * @param {AbortSignal} [signal] Forwarded to Git operations and file reads.
   * @returns {Promise<import('./stats').Stats>}
   */
  return async function collectStats(gitPath, root, includeUntracked, signal) {
    const stats = await git.readTrackedStats(gitPath, root, signal);
    stats.includeUntracked = includeUntracked;
    if (!includeUntracked) return stats;

    const untrackedPaths = (await git.listUntracked(gitPath, root, signal)).sort();
    exclude(stats, UNTRACKED_LIMIT_EXCLUSION, Math.max(0, untrackedPaths.length - MAX_UNTRACKED_FILES));

    const selectedPaths = untrackedPaths.slice(0, MAX_UNTRACKED_FILES);
    const resolvedRoot = await files.realpath(root);
    const results = await mapLimit(selectedPaths, READ_CONCURRENCY,
      (relativePath) => files.readUntracked(resolvedRoot, relativePath, signal));

    results.forEach((result, index) => {
      if ('reason' in result) {
        exclude(stats, result.reason);
      } else {
        stats.added += result.added;
        stats.files.push({ path: selectedPaths[index], added: result.added, deleted: 0, untracked: true });
      }
    });

    return stats;
  };
}

/**
 * Map items with bounded concurrency, preserving input order in the results.
 * Wait for all workers before propagating a failure, including cancellation.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit Maximum number of concurrent workers; must be positive.
 * @param {(item: T) => Promise<R>} work
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, limit, work) {
  /** @type {R[]} */
  const results = new Array(items.length);
  let nextIndex = 0;

  const workerOutcomes = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await work(items[index]);
    }
  }));

  const failedWorker = workerOutcomes.find((outcome) => outcome.status === 'rejected');
  if (failedWorker?.status === 'rejected') throw failedWorker.reason;

  return results;
}

module.exports = { createCollectStats, mapLimit, MAX_UNTRACKED_FILES, READ_CONCURRENCY };
