import { afterEach, expect, it, vi } from 'vitest';
import { startSerialPoll } from '../src/utils/serial-poll';
import { refreshWorkspace, workspaceReads, type WorkspaceRead } from '../src/utils/workspace-refresh';
afterEach(() => vi.useRealTimers());

it('loads only the visible owner reports and retains agent transfer alerts', () => {
  expect(workspaceReads(true, 'dashboard', 'overview')).toEqual(['admin']);
  expect(workspaceReads(true, 'leads', 'overview')).toEqual(['leads']);
  expect(workspaceReads(true, 'monitoring', 'overview')).toEqual([]);
  expect(workspaceReads(true, 'system', 'redial')).toEqual(['admin', 'redial', 'team']);
  expect(workspaceReads(false, 'dashboard', 'overview')).toEqual(['queues', 'alerts', 'transfers']);
  expect(workspaceReads(false, 'saved', 'overview')).toContain('saved');
  expect(workspaceReads(false, 'dashboard', 'overview')).not.toContain('secretary');
});

it('shows the primary report first and cancels the old page before its next report', async () => {
  const controller = new AbortController();
  const order: string[] = [];
  const loaders = Object.fromEntries(['admin', 'team', 'redial'].map(name => [name, async () => {
    order.push(name); if (name === 'admin') controller.abort(); return true;
  }])) as Record<WorkspaceRead, (signal: AbortSignal) => Promise<boolean>>;
  expect(await refreshWorkspace(['admin', 'redial', 'team'], loaders, controller.signal)).toBe(false);
  expect(order).toEqual(['admin']);
});

it('a failed agent statistics query does not suppress transfer alerts', async () => {
  const alerts = vi.fn(async () => true), transfers = vi.fn(async () => true);
  const loaders = { queues: async () => false, alerts, transfers } as unknown as Record<WorkspaceRead, (signal: AbortSignal) => Promise<boolean>>;
  expect(await refreshWorkspace(['queues', 'alerts', 'transfers'], loaders, new AbortController().signal, false)).toBe(false);
  expect(alerts).toHaveBeenCalledOnce(); expect(transfers).toHaveBeenCalledOnce();
});

it('never overlaps slow refreshes and backs off after failures', async () => {
  vi.useFakeTimers();
  let release!: (ok: boolean) => void;
  const task = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
  const poll = startSerialPoll(task, 30000, { maxBackoffMs: 120000 });
  await vi.advanceTimersByTimeAsync(90000);
  poll.refresh(); expect(task).toHaveBeenCalledTimes(1);
  release(false); await vi.advanceTimersByTimeAsync(59999);
  expect(task).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(task).toHaveBeenCalledTimes(2);
  poll.stop(); release(true);
  await vi.advanceTimersByTimeAsync(300000); expect(task).toHaveBeenCalledTimes(2);
});

it('pauses hidden reports and resumes with one request; cleanup aborts in-flight work', async () => {
  vi.useFakeTimers(); let hidden = true;
  const task = vi.fn(async () => true);
  const poll = startSerialPoll(task, 30000, { paused: () => hidden });
  await vi.advanceTimersByTimeAsync(60000); expect(task).not.toHaveBeenCalled();
  hidden = false; poll.refresh(); await vi.advanceTimersByTimeAsync(0);
  expect(task).toHaveBeenCalledTimes(1); poll.stop();
  let observed: AbortSignal | undefined;
  const active = startSerialPoll(signal => { observed = signal; return new Promise(() => {}); }, 30000);
  active.stop(); expect(observed?.aborted).toBe(true);
});
