const HEAD_REFERENCE = 'HEAD';
const NUL_BYTE = 0;
const LINE_FEED_BYTE = 10;

/** @typedef {{path: string, added: number, deleted: number, untracked?: boolean}} FileStat */
/** @typedef {{added: number, deleted: number, files: FileStat[], baseline: string, includeUntracked: boolean, excluded: Record<string, number>}} Stats */

/**
 * Create independent counters and collections for a scan against HEAD.
 * @returns {Stats}
 */
function emptyStats() {
  return { added: 0, deleted: 0, files: [], baseline: HEAD_REFERENCE, includeUntracked: true, excluded: {} };
}

/**
 * Accumulate exclusions in the supplied stats, ignoring zero counts.
 * @param {Stats} stats
 * @param {string} reason Exclusion category shown in the breakdown.
 * @param {number} [count]
 */
function exclude(stats, reason, count = 1) {
  if (count) stats.excluded[reason] = (stats.excluded[reason] ?? 0) + count;
}

/**
 * Count newline-delimited lines, including a final line without a newline.
 * @param {Buffer} buffer
 * @returns {number | null} Line count, or null when a NUL byte marks binary content.
 */
function countLines(buffer) {
  if (buffer.includes(NUL_BYTE)) return null;
  if (!buffer.length) return 0;

  let lineCount = buffer[buffer.length - 1] === LINE_FEED_BYTE ? 0 : 1;

  for (const byte of buffer) {
    if (byte === LINE_FEED_BYTE) lineCount++;
  }

  return lineCount;
}

module.exports = { emptyStats, exclude, countLines };
