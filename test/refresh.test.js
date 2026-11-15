const test = require('node:test');
const assert = require('node:assert/strict');
const { RefreshQueue } = require('../src/core/refreshQueue');

const DEBOUNCE_MS = 5;

test('immediate refreshes serialize and suppress stale completion', async () => {
  const firstRefresh = createDeferred();
  const secondRefresh = createDeferred();
  const renderedResults = [];
  let refreshCount = 0;
  const queue = new RefreshQueue(
    () => ++refreshCount === 1 ? firstRefresh.promise : secondRefresh.promise,
    result => renderedResults.push(result),
    assert.fail
  );

  const pendingRefresh = queue.request(true);
  queue.request(true);
  queue.request(true);
  assert.equal(refreshCount, 1);

  firstRefresh.resolve('old');
  await waitForNextTurn();
  assert.equal(refreshCount, 2);
  assert.deepEqual(renderedResults, []);

  secondRefresh.resolve('new');
  await pendingRefresh;
  assert.deepEqual(renderedResults, ['new']);

  queue.dispose();
});

test('repository switching aborts work and disposal prevents all rendering', async () => {
  const requests = [];
  const renderedResults = [];
  const queue = new RefreshQueue(
    signal => {
      const request = createDeferred();
      requests.push({ signal, ...request });
      return request.promise;
    },
    result => renderedResults.push(result),
    assert.fail
  );

  const pendingRefresh = queue.request(true);
  queue.request(true, true);
  assert.equal(requests[0].signal.aborted, true);

  requests[0].resolve('old');
  await waitForNextTurn();
  assert.equal(requests.length, 2);

  queue.dispose();
  assert.equal(requests[1].signal.aborted, true);

  requests[1].resolve('new');
  await pendingRefresh;
  assert.deepEqual(renderedResults, []);

  await queue.request(true);
  assert.equal(requests.length, 2);
});

test('debounce resets its deadline and disposal cancels pending work', async (testContext) => {
  testContext.mock.timers.enable({ apis: ['setTimeout'] });
  let refreshCount = 0;
  const queue = new RefreshQueue(async () => ++refreshCount, () => {}, assert.fail, DEBOUNCE_MS);

  testContext.after(() => queue.dispose());
  queue.request();
  testContext.mock.timers.tick(DEBOUNCE_MS - 1);
  assert.equal(refreshCount, 0);
  queue.request();
  testContext.mock.timers.tick(DEBOUNCE_MS - 1);
  assert.equal(refreshCount, 0);
  testContext.mock.timers.tick(1);
  await waitForNextTurn();
  assert.equal(refreshCount, 1);

  queue.request();
  queue.dispose();
  testContext.mock.timers.tick(DEBOUNCE_MS);
  assert.equal(refreshCount, 1);
});

test('failure is reported and next request can recover', async () => {
  const failures = [];
  const renderedResults = [];
  let refreshCount = 0;
  const queue = new RefreshQueue(
    async () => {
      if (++refreshCount === 1) {
        throw new Error('failure');
      }

      return 'recovered';
    },
    result => renderedResults.push(result),
    error => failures.push(error)
  );

  await queue.request(true);
  await queue.request(true);
  assert.equal(failures.length, 1);
  assert.deepEqual(renderedResults, ['recovered']);

  queue.dispose();
});

test('an obsolete rejection cannot replace newer counts with an error', async () => {
  let rejectFirstRefresh;
  const firstRefresh = new Promise((_resolve, reject) => { rejectFirstRefresh = reject; });
  const failures = [];
  const renderedResults = [];
  let refreshCount = 0;
  const queue = new RefreshQueue(
    () => ++refreshCount === 1 ? firstRefresh : Promise.resolve('current'),
    result => renderedResults.push(result),
    error => failures.push(error)
  );

  const pendingRefresh = queue.request(true);
  queue.request(true);
  rejectFirstRefresh(new Error('obsolete'));
  await pendingRefresh;
  assert.deepEqual(failures, []);
  assert.deepEqual(renderedResults, ['current']);

  queue.dispose();
});

/** Exposes a promise resolver so tests control when refresh work completes. */
function createDeferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });

  return { promise, resolve };
}

/** Lets queued promise callbacks finish before checking refresh state. */
function waitForNextTurn() {
  return new Promise(resolve => setImmediate(resolve));
}
