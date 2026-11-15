const { execFile } = require('node:child_process');
const { emptyStats, exclude } = require('../core/stats');

const MAX_GIT_OUTPUT_BYTES = 20 * 1024 * 1024;
const DEFAULT_GIT_TIMEOUT_MS = 10000;
const HEAD_REFERENCE = 'HEAD';
const NUL_SEPARATOR = '\0';
const BINARY_LINE_COUNT = '-';
const MISSING_REFERENCE_EXIT_CODE = 1;
const DIFF_FLAGS = ['--no-ext-diff', '--no-textconv', '--no-color'];

/** @typedef {import('../core/stats').Stats} Stats */

/**
 * Collect saved tracked changes against HEAD, or an empty tree before the first commit.
 * Submodule changes are recorded as exclusions rather than line counts.
 * @param {string} gitPath
 * @param {string} root Repository working directory.
 * @param {AbortSignal} [signal]
 * @returns {Promise<Stats>}
 */
async function readTrackedStats(gitPath, root, signal) {
  /** @param {string[]} argumentsList */
  const runRepositoryGit = (argumentsList) => runGit(gitPath, root, argumentsList, { signal });
  let baselineReference = HEAD_REFERENCE;
  let hasNoCommits = false;

  try {
    await runRepositoryGit(['rev-parse', '--verify', '--quiet', HEAD_REFERENCE]);
  } catch (error) {
    if (!(error instanceof GitError) || error.code !== MISSING_REFERENCE_EXIT_CODE) throw error;

    await runRepositoryGit(['symbolic-ref', '--quiet', HEAD_REFERENCE]);
    baselineReference = (await runRepositoryGit(['hash-object', '-t', 'tree', '--stdin'])).trim();
    hasNoCommits = true;
  }

  const numstatOutput = await runRepositoryGit([
    'diff', ...DIFF_FLAGS, '--find-renames', '--numstat', '-z',
    '--ignore-submodules=all', baselineReference, '--'
  ]);
  const stats = parseNumstat(numstatOutput);
  stats.baseline = hasNoCommits ? 'empty tree (no commits yet)' : HEAD_REFERENCE;

  // Disable renames so each raw record consists of metadata and exactly one path.
  const rawOutput = await runRepositoryGit([
    'diff', ...DIFF_FLAGS, '--no-renames', '--raw', '-z',
    '--ignore-submodules=none', baselineReference, '--'
  ]);
  const rawTokens = rawOutput.split(NUL_SEPARATOR);

  for (let tokenIndex = 0; tokenIndex < rawTokens.length; tokenIndex += 2) {
    // Git mode 160000 identifies a submodule on either side of the diff.
    if (/^:(?:160000 |\d{6} 160000 )/.test(rawTokens[tokenIndex])) {
      exclude(stats, 'submodule changes');
    }
  }

  return stats;
}

/**
 * List untracked paths relative to the repository root, respecting Git ignore rules.
 * @param {string} gitPath
 * @param {string} root
 * @param {AbortSignal} [signal]
 * @returns {Promise<string[]>}
 */
async function listUntracked(gitPath, root, signal) {
  const output = await runGit(gitPath, root, ['ls-files', '--others', '--exclude-standard', '-z'], { signal });

  return output.split(NUL_SEPARATOR).filter(Boolean);
}

/**
 * Run Git without interactive prompts or optional locks, rejecting with a sanitized error.
 * Errors omit stderr, arguments, filenames, and contents.
 * @param {string} gitPath
 * @param {string} workingDirectory
 * @param {string[]} argumentsList Git subcommand followed by its arguments.
 * @param {{signal?: AbortSignal, timeout?: number, input?: string}} [options] Timeout is in milliseconds.
 * @returns {Promise<string>} UTF-8 standard output.
 */
function runGit(gitPath, workingDirectory, argumentsList, options = {}) {
  return new Promise((resolve, reject) => {
    const childProcess = execFile(gitPath, argumentsList, {
      cwd: workingDirectory,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      timeout: options.timeout ?? DEFAULT_GIT_TIMEOUT_MS,
      signal: options.signal,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }
    }, (error, stdout) => {
      if (!error) {
        resolve(stdout);
        return;
      }

      const errorCode = options.signal?.aborted ? 'cancelled'
        : error.killed ? 'timeout' : error.code ?? 'unknown';
      reject(new GitError(argumentsList[0], errorCode));
    });

    // Process failures are reported by execFile, including early stdin closure.
    childProcess.stdin?.on('error', () => {});
    childProcess.stdin?.end(options.input ?? '');
  });
}

/**
 * Parse NUL-delimited numstat output, including three-token rename records.
 * Binary files become exclusions; malformed records throw.
 * @param {string} output
 * @returns {Stats}
 */
function parseNumstat(output) {
  const stats = emptyStats();
  const tokens = output.split(NUL_SEPARATOR);

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    if (!tokens[tokenIndex]) continue;

    const recordMatch = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(tokens[tokenIndex]);
    if (!recordMatch) throw new Error('Invalid Git numstat record.');

    let filename = recordMatch[3];
    if (!filename) {
      const previousFilename = tokens[++tokenIndex];
      filename = tokens[++tokenIndex];
      if (!previousFilename || !filename) throw new Error('Incomplete Git rename record.');
    }

    if (recordMatch[1] === BINARY_LINE_COUNT || recordMatch[2] === BINARY_LINE_COUNT) {
      exclude(stats, 'binary files');
      continue;
    }

    const added = Number(recordMatch[1]);
    const deleted = Number(recordMatch[2]);
    stats.added += added;
    stats.deleted += deleted;
    stats.files.push({ path: filename, added, deleted });
  }

  return stats;
}

/** A Git failure safe to display without exposing repository data. */
class GitError extends Error {
  /**
   * @param {string} operation Git subcommand, without its arguments.
   * @param {string | number} code Exit code or process failure category.
   */
  constructor(operation, code) {
    super(`Git ${operation} failed (${code}).`);
    this.name = 'GitError';
    this.code = code;
  }
}

module.exports = { readTrackedStats, listUntracked, parseNumstat, runGit, GitError };
