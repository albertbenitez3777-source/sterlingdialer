import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSerialPoll } from '../src/utils/serial-poll';

afterEach(() => vi.useRealTimers());
describe('background refresh reliability', () => {
  it('does not overlap a slow request, even after repeated refresh events', async () => {
    vi.useFakeTimers();
    let finish!: (ok: boolean) => void;
    const task = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const poll = startSerialPoll(task, 5000);
    await vi.advanceTimersByTimeAsync(30000);
    poll.refresh(); poll.refresh();
    expect(task).toHaveBeenCalledTimes(1);
    finish(true);
    await vi.advanceTimersByTimeAsync(4999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    poll.stop(); finish(true);
  });
  it('backs off failed refreshes and returns to the normal cadence after recovery', async () => {
    vi.useFakeTimers();
    const task = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    const poll = startSerialPoll(task, 5000);
    await vi.advanceTimersByTimeAsync(9999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20000);
    expect(task).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(4);
    poll.stop();
  });
  it('cancels the active request on logout/unmount and never schedules a late refresh', async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    let finish!: (ok: boolean) => void;
    const task = vi.fn(s => { signal = s; return new Promise<boolean>(resolve => { finish = resolve; }); });
    const poll = startSerialPoll(task, 5000);
    poll.stop();
    expect(signal.aborted).toBe(true);
    finish(true);
    await vi.advanceTimersByTimeAsync(60000);
    poll.refresh();
    expect(task).toHaveBeenCalledTimes(1);
  });
  it('skips hidden-page data requests and refreshes on return', async () => {
    vi.useFakeTimers();
    let paused = true;
    const task = vi.fn().mockResolvedValue(true);
    const poll = startSerialPoll(task, 5000, { paused: () => paused });
    await vi.advanceTimersByTimeAsync(10000);
    expect(task).not.toHaveBeenCalled();
    paused = false; poll.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);
    poll.stop();
  });
  it('recovers after an exception without creating a fast retry loop', async () => {
    vi.useFakeTimers();
    const task = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(true);
    const poll = startSerialPoll(task, 5000);
    await vi.advanceTimersByTimeAsync(9999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    poll.stop();
  });
});
