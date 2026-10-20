/**
 * Keeps the screen on until the returned function is called. The browser drops
 * the lock whenever the page is hidden, so it's taken again on return.
 * Unsupported or refused (e.g. battery saver) is a quiet no-op.
 */
export function keepScreenOn(): () => void {
  let released = false;
  let lock: WakeLockSentinel | null = null;

  const acquire = async () => {
    try {
      if (released || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
      const next = await navigator.wakeLock.request("screen");
      if (released) void next.release().catch(() => {});
      else lock = next;
    } catch {
      // Sharing still works without it.
    }
  };
  const onVisible = () => void acquire();

  void acquire();
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    released = true;
    document.removeEventListener("visibilitychange", onVisible);
    void lock?.release().catch(() => {});
  };
}
