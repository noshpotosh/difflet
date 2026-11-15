const COUNT_LOCALE = 'en-US';
const MAX_TOOLTIP_FILES = 20;
const HEX_COLOR_PATTERN = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;

/**
 * Build an escaped Markdown breakdown, ranking files by changed lines and then path.
 * @param {string} repositoryName Display name, treated as plain text.
 * @param {import('../core/stats').Stats} stats
 */
function formatTooltipMarkdown(repositoryName, stats) {
  const rankedFiles = [...stats.files].sort(compareFileChanges);
  const sections = [
    `**${escapeMarkdown(repositoryName)}** — net saved changes vs ${stats.baseline}`,
    `${rankedFiles.length} text file${rankedFiles.length === 1 ? '' : 's'} changed · +${formatCount(stats.added)} −${formatCount(stats.deleted)}`,
    `Untracked files: ${stats.includeUntracked ? 'included' : 'excluded by setting'}. Unsaved edits are excluded.`
  ];

  const fileBreakdown = rankedFiles.slice(0, MAX_TOOLTIP_FILES).map(file =>
    `\`+${formatCount(file.added)} −${formatCount(file.deleted)}\`  ${escapeMarkdown(file.path)}${file.untracked ? ' *(untracked)*' : ''}`
  ).join('  \n');
  sections.push(fileBreakdown);

  if (rankedFiles.length > MAX_TOOLTIP_FILES) {
    sections.push(`${rankedFiles.length - MAX_TOOLTIP_FILES} more files.`);
  }

  if (Object.keys(stats.excluded).length) {
    const exclusionSummary = Object.entries(stats.excluded).sort()
      .map(([reason, count]) => `${count} ${reason}`).join('; ');

    sections.push(`**Partial totals.** Excluded: ${exclusionSummary}.`);
  }

  sections.push(
    'Binary files and submodule changes do not contribute lines. Untracked scans cover up to 500 files, at most 2 MiB each.',
    'Click to open Source Control.'
  );

  return sections.filter(Boolean).join('\n\n');
}

/**
 * Keep partial or file-only changes visible even when both line totals are zero.
 * @param {import('../core/stats').Stats} stats
 */
function shouldShowStats(stats) {
  return stats.added !== 0 || stats.deleted !== 0 || stats.files.length > 0 || Object.keys(stats.excluded).length > 0;
}

/**
 * Remove icon syntax and control whitespace, adding a separator to nonempty labels.
 * @param {unknown} value User-configured status bar prefix.
 */
function formatPrefix(value) {
  if (typeof value !== 'string') return '';

  const sanitizedText = value.replace(/\$\(/g, '(').replace(/[\r\n\t]/g, ' ').trim();

  return sanitizedText ? `${sanitizedText} ` : '';
}

/**
 * Accept hexadecimal colors only, falling back to the theme foreground otherwise.
 * @param {unknown} value User-configured status bar color.
 * @returns {string | undefined}
 */
function validateColor(value) {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value) ? value : undefined;
}

/**
 * Format line counts consistently regardless of the editor's locale.
 * @param {number} count
 */
function formatCount(count) {
  return count.toLocaleString(COUNT_LOCALE);
}

/**
 * Escape Markdown syntax and expose control whitespace in repository names and paths.
 * @param {string} text
 */
function escapeMarkdown(text) {
  return text.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
    .replace(/([`*_{}[\]()<>#+!|~])/g, '\\$1');
}

/**
 * Sort by descending changed lines, breaking ties by path without locale dependence.
 * @param {import('../core/stats').FileStat} firstFile
 * @param {import('../core/stats').FileStat} secondFile
 */
function compareFileChanges(firstFile, secondFile) {
  const changeCountDifference = secondFile.added + secondFile.deleted - firstFile.added - firstFile.deleted;

  return changeCountDifference || (firstFile.path < secondFile.path ? -1 : firstFile.path > secondFile.path ? 1 : 0);
}

module.exports = { formatPrefix, validateColor, formatCount, escapeMarkdown, formatTooltipMarkdown, shouldShowStats };
