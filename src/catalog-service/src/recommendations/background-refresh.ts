export type RecommendationRefreshTab = 'movies' | 'series';
export type RecommendationRefreshWork = {
  profile_id: string;
  tab: RecommendationRefreshTab;
};

export type RecommendationRefreshQueueOptions = {
  refresh: (work: RecommendationRefreshWork) => Promise<unknown>;
  onPublished: (work: RecommendationRefreshWork) => void;
  onRetainedLastGood?: (work: RecommendationRefreshWork, error: unknown, willRetry: boolean) => void;
  /** Reports a throwing notifier. The queue keeps draining either way. */
  onBookkeepingFault?: (work: RecommendationRefreshWork | null, error: unknown) => void;
  wait?: (delayMs: number) => Promise<void>;
  maxRetries?: number;
  retryBaseMs?: number;
  shouldRetry?: (error: unknown, failedAttempts: number, maxRetries: number) => boolean;
};

const defaultWait = (delayMs: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, delayMs);
});

/**
 * Serializes expensive recommendation refreshes, coalesces duplicate triggers,
 * and retries transient failures without ever blocking the mutation response.
 * The refresh callback retains ownership of last-good publication semantics.
 */
export class CoalescingRecommendationRefreshQueue {
  private readonly pending = new Map<string, RecommendationRefreshWork>();
  private readonly attempts = new Map<string, number>();
  private flight: Promise<void> | null = null;

  constructor(private readonly options: RecommendationRefreshQueueOptions) {}

  enqueue(profileId: string, tabs: readonly RecommendationRefreshTab[]): void {
    const normalizedProfileId = profileId.trim();
    if (!normalizedProfileId) throw new Error('recommendation refresh requires profile id');
    tabs.forEach((tab) => {
      const work = { profile_id: normalizedProfileId, tab };
      this.pending.set(this.workKey(work), work);
    });
    if (!this.flight) this.start();
  }

  async idle(): Promise<void> {
    while (this.flight) await this.flight;
  }

  private start(): void {
    // `flight` must never reject: it is only awaited by idle(), so an unhandled
    // rejection here would take the whole catalog process down.
    this.flight = this.drain()
      .catch((error: unknown) => this.reportBookkeepingFault(null, error))
      .finally(() => {
        this.flight = null;
        // Close the enqueue-at-drain-boundary race: an enqueue that observed the
        // old flight is waiting in pending and must start a new drain here.
        if (this.pending.size > 0) this.start();
      });
  }

  private reportBookkeepingFault(work: RecommendationRefreshWork | null, error: unknown): void {
    try {
      this.options.onBookkeepingFault?.(work, error);
    } catch {
      // A failing fault reporter cannot be allowed to stop the queue.
    }
  }

  /**
   * Notifiers do cache invalidation and durable job bookkeeping. Under SQLite
   * write contention those can throw, and the refresh callback — not the
   * notifier — owns last-good publication, so a throw must not retry the whole
   * refresh, abandon the drain, or reject `flight`.
   */
  private notify(work: RecommendationRefreshWork, notifier: () => void): void {
    try {
      notifier();
    } catch (error) {
      this.reportBookkeepingFault(work, error);
    }
  }

  private workKey(work: RecommendationRefreshWork): string {
    return `${work.profile_id}\u0000${work.tab}`;
  }

  private async drain(): Promise<void> {
    const maxRetries = Math.max(0, Math.floor(this.options.maxRetries ?? 2));
    const retryBaseMs = Math.max(0, Math.floor(this.options.retryBaseMs ?? 250));
    const wait = this.options.wait ?? defaultWait;
    while (this.pending.size > 0) {
      const batch = [...this.pending.values()];
      this.pending.clear();
      for (const work of batch) {
        const key = this.workKey(work);
        // Retry the captured active item in place. Re-inserting it into
        // `pending` used to overwrite a newer same-key trigger and let the
        // integration layer consume that trigger while still holding the old
        // durable job IDs. Keeping retries local leaves new work pending for a
        // distinct callback/lifecycle transition after this item settles.
        while (true) {
          try {
            await this.options.refresh(work);
            this.attempts.delete(key);
            this.notify(work, () => this.options.onPublished(work));
            break;
          } catch (error) {
            const failedAttempts = (this.attempts.get(key) ?? 0) + 1;
            const willRetry = this.options.shouldRetry
              ? this.options.shouldRetry(error, failedAttempts, maxRetries)
              : failedAttempts <= maxRetries;
            this.notify(work, () => this.options.onRetainedLastGood?.(work, error, willRetry));
            if (!willRetry) {
              this.attempts.delete(key);
              break;
            }
            this.attempts.set(key, failedAttempts);
            await wait(retryBaseMs * 2 ** (failedAttempts - 1));
          }
        }
      }
    }
  }
}

/**
 * Promise-tail serialization scoped by key. Operations for one VOD media type
 * cannot overlap, while Movies and Series remain independent workers.
 */
export class KeyedSerialExecutor<Key> {
  private readonly tails = new Map<Key, Promise<void>>();

  run<Result>(key: Key, operation: () => Promise<Result>): Promise<Result> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(operation);
    const tail = run.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return run;
  }
}
