const test = require('node:test');
const assert = require('node:assert/strict');
const { createCollectStats } = require('../src/core/collectStats');
const { emptyStats } = require('../src/core/stats');

const REPOSITORY_ROOT = '/repo';
const REAL_REPOSITORY_ROOT = '/real';
const GIT_EXECUTABLE = 'git-bin';
const BINARY_EXCLUSION = 'binary files';

test('collection forwards context and cancellation, sorts paths and aggregates exclusions', async () => {
  const signal = new AbortController().signal;
  const gitCalls = [];
  const collectStats = createCollectStats({
    git: {
      async readTrackedStats(...argumentsReceived) {
        gitCalls.push(argumentsReceived);
        return { ...emptyStats(), added: 3 };
      },
      async listUntracked(...argumentsReceived) {
        gitCalls.push(argumentsReceived);
        return ['z', 'b', 'a'];
      }
    },
    files: {
      async realpath(repositoryRoot) {
        assert.equal(repositoryRoot, REPOSITORY_ROOT);
        return REAL_REPOSITORY_ROOT;
      },
      async readUntracked(repositoryRoot, filePath, receivedSignal) {
        assert.equal(repositoryRoot, REAL_REPOSITORY_ROOT);
        assert.equal(receivedSignal, signal);
        return filePath === 'z' ? { reason: BINARY_EXCLUSION } : { added: filePath === 'a' ? 2 : 4 };
      }
    }
  });

  const stats = await collectStats(GIT_EXECUTABLE, REPOSITORY_ROOT, true, signal);
  assert.deepEqual(gitCalls, [[GIT_EXECUTABLE, REPOSITORY_ROOT, signal], [GIT_EXECUTABLE, REPOSITORY_ROOT, signal]]);
  assert.equal(stats.added, 9);
  assert.deepEqual(stats.files, [
    { path: 'a', added: 2, deleted: 0, untracked: true },
    { path: 'b', added: 4, deleted: 0, untracked: true }
  ]);
  assert.deepEqual(stats.excluded, { [BINARY_EXCLUSION]: 1 });
});

test('disabling untracked collection skips listing and all filesystem operations', async () => {
  const failUnexpectedOperation = () => assert.fail('untracked operation must not run');
  const collectStats = createCollectStats({
    git: { readTrackedStats: async () => emptyStats(), listUntracked: failUnexpectedOperation },
    files: { realpath: failUnexpectedOperation, readUntracked: failUnexpectedOperation }
  });

  assert.equal((await collectStats('git', REPOSITORY_ROOT, false)).includeUntracked, false);
});

test('collection waits for active file reads before propagating cancellation', async () => {
  const abortController = new AbortController();
  let releaseRead;
  const pendingRead = new Promise(resolve => { releaseRead = resolve; });
  let markReadStarted;
  const readStarted = new Promise(resolve => { markReadStarted = resolve; });
  let readCompleted = false;
  const collectStats = createCollectStats({
    git: { readTrackedStats: async () => emptyStats(), listUntracked: async () => ['a', 'b'] },
    files: {
      realpath: async (repositoryRoot) => repositoryRoot,
      async readUntracked(_root, filePath, signal) {
        if (filePath === 'a') {
          markReadStarted();
          await pendingRead;
          readCompleted = true;
        } else {
          abortController.abort();
        }

        signal.throwIfAborted();
        return { added: 1 };
      }
    }
  });

  const collectionResult = collectStats('git', REPOSITORY_ROOT, true, abortController.signal);
  await readStarted;

  let collectionSettled = false;
  const cancellationAssertion = assert.rejects(collectionResult, { name: 'AbortError' }).then(() => { collectionSettled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(collectionSettled, false);

  releaseRead();
  await cancellationAssertion;
  assert.equal(readCompleted, true);
});
