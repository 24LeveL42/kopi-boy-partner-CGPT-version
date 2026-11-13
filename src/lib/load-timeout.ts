/**
 * Every load a partner waits on (server reads for "/", "/welcome",
 * "/kitchen", and the orders / deliveries panels) gets a time limit and
 * one automatic retry, so a request that never comes back ends in a clear
 * "Try again" message instead of a skeleton or spinner that never stops.
 */

/** How long one attempt may take before it counts as failed. */
export const READ_TIMEOUT_MS = 10_000;

export class LoadTimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms} ms`);
    this.name = "LoadTimeoutError";
  }
}

/**
 * Runs `work` with an AbortSignal that fires after `ms`. Rejects with
 * LoadTimeoutError at that point even if `work` ignores the signal, so the
 * caller never waits longer than `ms`.
 */
export async function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, ms: number = READ_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new LoadTimeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One automatic retry: runs `attempt`, and if it throws or its result
 * counts as `failed`, runs it once more and returns (or throws) whatever
 * the second try gives.
 */
export async function retryOnce<T>(attempt: () => Promise<T>, failed: (result: T) => boolean = () => false): Promise<T> {
  try {
    const result = await attempt();
    if (!failed(result)) return result;
  } catch {
    // fall through to the second try
  }
  return attempt();
}
