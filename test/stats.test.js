const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const git = require('../src/adapters/git');
const files = require('../src/adapters/untrackedFiles');
const { parseNumstat, runGit } = git;
const { readUntracked, MAX_UNTRACKED_BYTES } = files;
const { countLines } = require('../src/core/stats');
const { createCollectStats, mapLimit } = require('../src/core/collectStats');
const { formatTooltipMarkdown, escapeMarkdown, formatPrefix, validateColor, shouldShowStats } = require('../src/presentation/formatting');

const collectStats = createCollectStats({ git, files });
const BINARY_EXCLUSION = 'binary files';
const MAIN_BRANCH = 'main';
const READ_CONCURRENCY = 8;
const LONG_RUNNING_SCRIPT = 'setTimeout(() => {}, 10000)';

test('numstat consumes rename records and preserves tabs/newlines', () => {
  const stats = parseNumstat('2\t1\t\0old\tname\0new\nname\0-\t-\tbinary\0' + '3\t0\tspace ü\tfile\0');
  assert.equal(stats.added, 5);
  assert.equal(stats.deleted, 1);
  assert.deepEqual(stats.files.map(file => file.path), ['new\nname', 'space ü\tfile']);
  assert.equal(stats.excluded[BINARY_EXCLUSION], 1);
  assert.throws(() => parseNumstat('1\t0\t\0old\0'), /Incomplete/);
  assert.throws(() => parseNumstat('garbage\0'), /Invalid/);
});

test('line counting handles empty, CRLF, no trailing newline and binaries', () => {
  const cases = [['', 0], ['a', 1], ['a\n', 1], ['a\r\nb', 2], ['\n\n', 2], ['\0x', null]];

  for (const [text, expectedLines] of cases) {
    assert.equal(countLines(Buffer.from(text)), expectedLines);
  }
});

test('presentation is deterministic, escaped, theme-aware and limited', () => {
  const records = Array.from({ length: 22 }, (_, index) =>
    `1\t0\tfile${String(21 - index).padStart(2, '0')}\0`
  );
  const stats = parseNumstat(records.join(''));
  const tooltip = formatTooltipMarkdown('[command](command:evil)', stats);
  assert.ok(tooltip.includes('\\[command\\]\\(command:evil\\)'));
  assert.ok(tooltip.includes('file00'));
  assert.ok(tooltip.includes('file01'));
  assert.ok(tooltip.indexOf('file00') < tooltip.indexOf('file01'));
  assert.equal((tooltip.match(/`\+1 −0`/g) || []).length, 20);
  assert.ok(!tooltip.includes('file20'));
  assert.match(tooltip, /2 more files/);

  const rankedTooltip = formatTooltipMarkdown('repo', {
    ...stats,
    files: [
      { path: 'small-change', added: 1, deleted: 0 },
      { path: 'large-deletion', added: 0, deleted: 10 }
    ]
  });
  assert.ok(rankedTooltip.indexOf('large-deletion') < rankedTooltip.indexOf('small-change'));

  assert.equal(escapeMarkdown('a\nb\tc'), 'a\\nb\\tc');

  assert.equal(formatPrefix(' x '), 'x ');
  assert.equal(formatPrefix(42), '');
  assert.ok(!formatPrefix('$(zap)').includes('$('));

  assert.equal(validateColor(''), undefined);
  assert.equal(validateColor('red'), undefined);
  assert.equal(validateColor('#abc'), '#abc');

  assert.equal(shouldShowStats(parseNumstat('')), false);
  assert.equal(shouldShowStats(parseNumstat('-\t-\tbinary\0')), true);
});

test('unborn repository counts staged contents once plus untracked', async (testContext) => {
  const repository = await createRepositoryFixture(testContext);
  await repository.writeFile('staged', 'one\ntwo\n');
  repository.runGit('add', 'staged');
  await repository.writeFile('untracked', 'three');

  const result = await repository.collectStats();
  assert.equal(result.added, 3);
  assert.match(result.baseline, /empty tree/);
  assert.equal((await repository.collectStats(false)).added, 2);
});

test('net counts cancel staged changes, ignore ignored files, count deletions', async (testContext) => {
  const repository = await createRepositoryFixture(testContext);
  await repository.writeFile('file', 'original\n');
  await repository.writeFile('.gitignore', 'ignored\n');
  repository.commitAll();

  await repository.writeFile('file', 'staged\n');
  repository.runGit('add', 'file');
  await repository.writeFile('file', 'original\n');
  await repository.writeFile('ignored', 'not counted\n');
  assert.equal(shouldShowStats(await repository.collectStats()), false);

  await fs.unlink(path.join(repository.root, 'file'));
  assert.equal((await repository.collectStats()).deleted, 1);
});

test('renames preserve destination paths and zero-line changes remain visible', async (testContext) => {
  const repository = await createRepositoryFixture(testContext);
  await repository.writeFile('old', 'one\ntwo\nthree\n');
  repository.commitAll();

  repository.runGit('mv', 'old', 'new ü [name]');

  const result = await repository.collectStats();
  assert.equal(result.added, 0);
  assert.equal(result.deleted, 0);
  assert.equal(result.files[0].path, 'new ü [name]');
  assert.equal(shouldShowStats(result), true);
});

test('unusual tracked filenames round-trip through Git', { skip: process.platform === 'win32' }, async (testContext) => {
  const repository = await createRepositoryFixture(testContext);
  const filename = 'tab\tline\n`[x] ü';
  await repository.writeFile(filename, 'one\n');
  repository.commitAll();

  await repository.writeFile(filename, 'one\ntwo\n');

  const result = await repository.collectStats();
  assert.equal(result.files[0].path, filename);
  assert.equal(result.added, 1);
});

test('binary files, oversized files and symlinks disclose exclusions', async (testContext) => {
  const repository = await createRepositoryFixture(testContext);
  await repository.writeFile('tracked.bin', Buffer.from([0, 1]));
  repository.commitAll();

  await repository.writeFile('tracked.bin', Buffer.from([0, 2]));
  await repository.writeFile('untracked.bin', Buffer.from([0, 3]));
  await repository.writeFile('huge', Buffer.alloc(MAX_UNTRACKED_BYTES + 1, 65));
  if (process.platform !== 'win32') {
    await fs.symlink('tracked.bin', path.join(repository.root, 'link'));
  }

  const result = await repository.collectStats();
  assert.equal(result.added, 0);
  assert.equal(result.excluded[BINARY_EXCLUSION], 2);
  assert.equal(result.excluded['oversized files'], 1);
  if (process.platform !== 'win32') {
    assert.equal(result.excluded.symlinks, 1);
  }
  assert.match(formatTooltipMarkdown('repo', result), /Partial totals/);
  assert.deepEqual(await readUntracked(repository.root, 'absent'), { reason: 'unreadable files' });
});

test('large untracked scans deterministically cap at 500 files', async (testContext) => {
  const repository = await createRepositoryFixture(testContext);
  const filenames = Array.from({ length: 510 }, (_, index) => `f${String(index).padStart(3, '0')}`);
  await mapLimit(filenames, READ_CONCURRENCY, filename => repository.writeFile(filename, 'line\n'));

  const result = await repository.collectStats();
  assert.equal(result.added, 500);
  assert.equal(result.excluded['files beyond the 500-file limit'], 10);
  assert.equal(result.files[0].path, 'f000');
  assert.equal(result.files.at(-1).path, 'f499');
});

test('read pool bounds concurrency and preserves order despite out-of-order completion', async () => {
  const releases = new Map();
  const started = [];
  const completed = [];
  const pending = mapLimit([0, 1, 2], 2, async index => {
    started.push(index);
    await new Promise(resolve => releases.set(index, resolve));
    completed.push(index);
    return `result-${index}`;
  });

  assert.deepEqual(started, [0, 1]);
  releases.get(1)();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2]);
  releases.get(2)();
  await new Promise(resolve => setImmediate(resolve));
  releases.get(0)();

  assert.deepEqual(await pending, ['result-0', 'result-1', 'result-2']);
  assert.deepEqual(completed, [1, 2, 0]);
});

test('worktrees and conflicts produce saved-file totals', async (testContext) => {
  const repository = await createRepositoryFixture(testContext);
  await repository.writeFile('file', 'base\n');
  repository.commitAll();

  const worktree = path.join(repository.root, '..', `${path.basename(repository.root)}-worktree`);
  testContext.after(() => fs.rm(worktree, { recursive: true, force: true }));
  repository.runGit('worktree', 'add', '-b', 'other', worktree);
  await fs.writeFile(path.join(worktree, 'file'), 'base\nnew\n');
  assert.equal((await collectStats('git', worktree, true)).added, 1);

  repository.runGit('checkout', '-b', 'conflict');
  await repository.writeFile('file', 'branch\n');
  repository.commitAll();

  repository.runGit('checkout', MAIN_BRANCH);
  await repository.writeFile('file', 'main\n');
  repository.commitAll();

  assert.throws(() => repository.runGit('merge', 'conflict'));

  const result = await repository.collectStats();
  assert.equal(result.added, 4);
  assert.equal(result.deleted, 0);
  assert.equal(result.files[0].path, 'file');
});

test('submodule pointer changes never count as lines', async (testContext) => {
  const repository = await createRepositoryFixture(testContext);
  await repository.writeFile('file', 'base\n');
  repository.commitAll();

  const headCommit = repository.runGit('rev-parse', 'HEAD').trim();
  repository.runGit('update-index', '--add', '--cacheinfo', `160000,${headCommit},submodule`);
  await fs.mkdir(path.join(repository.root, 'submodule'));

  const result = await repository.collectStats(false);
  assert.equal(result.added, 0);
  assert.equal(result.deleted, 0);
  assert.equal(result.excluded['submodule changes'], 1);
});

test('external diff and text conversion commands are disabled', async (testContext) => {
  const repository = await createRepositoryFixture(testContext);
  await repository.writeFile('file', 'base\n');
  await repository.writeFile('.gitattributes', 'file diff=unsafe\n');
  repository.commitAll();

  repository.runGit('config', 'diff.unsafe.command', 'nonexistent-command');
  repository.runGit('config', 'diff.unsafe.textconv', 'nonexistent-command');
  await repository.writeFile('file', 'base\nnew\n');
  assert.equal((await repository.collectStats()).added, 1);
});

test('Git errors, timeout and abort are bounded and do not expose contents', async (testContext) => {
  const repository = await createRepositoryFixture(testContext);
  await assert.rejects(runGit('definitely-no-such-git-executable', repository.root, ['status']), /ENOENT/);
  await assert.rejects(runGit(process.execPath, repository.root, ['-e', LONG_RUNNING_SCRIPT], { timeout: 30 }), /timeout/);

  const controller = new AbortController();
  const pendingOperation = runGit(process.execPath, repository.root, ['-e', LONG_RUNNING_SCRIPT], { signal: controller.signal });
  controller.abort();
  await assert.rejects(pendingOperation, /cancelled/);

  await assert.rejects(
    runGit('git', repository.root, ['bad-command', 'private-file-contents']),
    error => !error.message.includes('private-file-contents')
  );
});

/** Creates an isolated Git repository and removes it after the owning test finishes. */
async function createRepositoryFixture(testContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'git-stats-'));
  testContext.after(() => fs.rm(root, { recursive: true, force: true }));

  const runRepositoryGit = (...argumentsReceived) => execFileSync('git', argumentsReceived, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: path.join(root, 'absent-config')
    }
  });
  runRepositoryGit('init', '-b', MAIN_BRANCH);
  runRepositoryGit('config', 'user.email', 'test@example.invalid');
  runRepositoryGit('config', 'user.name', 'Test');
  runRepositoryGit('config', 'core.autocrlf', 'false');
  runRepositoryGit('config', 'merge.conflictStyle', 'merge');

  const writeFile = (filePath, content) => fs.writeFile(path.join(root, filePath), content);
  const commitAll = () => {
    runRepositoryGit('add', '.');
    runRepositoryGit('-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  };
  const collectRepositoryStats = (includeUntracked = true) => collectStats('git', root, includeUntracked);

  return { root, runGit: runRepositoryGit, writeFile, commitAll, collectStats: collectRepositoryStats };
}
