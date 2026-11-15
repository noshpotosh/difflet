const DEFAULT_REFRESH_DELAY_MS = 400;

/**
 * Serialize refreshes and publish only the latest request's result, independent of VS Code.
 * @template T
 */
class RefreshQueue {
  /**
   * @param {(signal: AbortSignal) => Promise<T>} collect Collect a snapshot, honoring cancellation.
   * @param {(result: T) => void} render Publish a current snapshot.
   * @param {(error: unknown) => void} fail Report a current request's failure.
   * @param {number} [delay] Debounce delay in milliseconds.
   */
  constructor(collect, render, fail, delay = DEFAULT_REFRESH_DELAY_MS) {
    this.collect = collect;
    this.render = render;
    this.fail = fail;
    this.delay = delay;

    this.generation = 0;
    this.disposed = false;
    this.pending = false;

    /** @type {NodeJS.Timeout | undefined} */
    this.timer = undefined;
    /** @type {AbortController | undefined} */
    this.controller = undefined;
    /** @type {Promise<void> | undefined} */
    this.running = undefined;
  }

  /**
   * Supersede older results and schedule a refresh, coalescing pending requests.
   * @param {boolean} [immediate] Skip the debounce delay.
   * @param {boolean} [cancel] Abort the active collection before scheduling its replacement.
   * @returns {Promise<void>} Waits for draining when immediate; otherwise resolves after scheduling.
   */
  request(immediate = false, cancel = false) {
    if (this.disposed) return Promise.resolve();

    this.generation++;
    if (cancel) this.controller?.abort();

    clearTimeout(this.timer);
    this.pending = false;

    if (immediate) {
      this.timer = undefined;
      this.pending = true;
      return this.drain();
    }

    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pending = true;
      void this.drain();
    }, this.delay);

    return Promise.resolve();
  }

  /** Stop scheduling, abort active work, and prevent any further results or errors from publishing. */
  dispose() {
    this.disposed = true;
    this.generation++;
    this.pending = false;

    clearTimeout(this.timer);
    this.controller?.abort();
  }

  /** Reuse the active drain promise and restart if a request arrives during completion. */
  drain() {
    if (this.running) return this.running;

    this.running = this.collectPendingRequests().finally(() => {
      this.running = undefined;
      if (this.pending && !this.disposed) return this.drain();
    });

    return this.running;
  }

  /** Collect pending snapshots serially, suppressing results and errors from superseded requests. */
  async collectPendingRequests() {
    while (this.pending && !this.disposed) {
      this.pending = false;
      const requestGeneration = this.generation;
      this.controller = new AbortController();

      try {
        const result = await this.collect(this.controller.signal);
        if (!this.disposed && requestGeneration === this.generation) this.render(result);
      } catch (error) {
        if (!this.disposed && requestGeneration === this.generation) this.fail(error);
      } finally {
        this.controller = undefined;
      }
    }
  }
}

module.exports = { RefreshQueue };
