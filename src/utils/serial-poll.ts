// Schedule the next refresh after the current request settles, never over it.
export function startSerialPoll(
  task: (signal: AbortSignal) => Promise<boolean | void>,
  intervalMs: number,
  options: { paused?: () => boolean; maxBackoffMs?: number } = {},
) {
  let stopped = false;
  let pending = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const schedule = (delay: number) => { timer = setTimeout(() => { void run(); }, delay); };
  const run = async () => {
    if (stopped || pending) return;
    clearTimeout(timer);
    if (options.paused?.()) { schedule(intervalMs); return; }
    pending = true;
    controller = new AbortController();
    try {
      const ok = await task(controller.signal);
      failures = ok === false ? Math.min(failures + 1, 4) : 0;
    } catch { failures = Math.min(failures + 1, 4); }
    finally {
      pending = false;
      controller = undefined;
      if (!stopped) schedule(Math.min(options.maxBackoffMs ?? 60000, intervalMs * 2 ** failures));
    }
  };
  void run();
  return {
    refresh: () => { void run(); },
    stop: () => { stopped = true; clearTimeout(timer); controller?.abort(); },
  };
}
