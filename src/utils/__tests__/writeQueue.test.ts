import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebouncedWriter } from '../writeQueue';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createDebouncedWriter', () => {
  it('collapses rapid repeated calls for the same key into a single write of the latest value', async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const schedule = createDebouncedWriter(writeFn, 400);

    schedule('index', 'v1');
    await vi.advanceTimersByTimeAsync(100);
    schedule('index', 'v2');
    await vi.advanceTimersByTimeAsync(100);
    schedule('index', 'v3');

    // Not enough quiet time has elapsed yet for any write to fire.
    expect(writeFn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);

    expect(writeFn).toHaveBeenCalledTimes(1);
    expect(writeFn).toHaveBeenCalledWith('index', 'v3');
  });

  it('calls onSettled with "saved" after a successful debounced write', async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const onSettled = vi.fn();
    const schedule = createDebouncedWriter(writeFn, 400, onSettled);

    schedule('index', 'content');
    await vi.advanceTimersByTimeAsync(400);

    expect(onSettled).toHaveBeenCalledWith('index', 'saved');
  });

  it('calls onSettled with "error" when the write rejects', async () => {
    const err = new Error('disk full');
    const writeFn = vi.fn().mockRejectedValue(err);
    const onSettled = vi.fn();
    const schedule = createDebouncedWriter(writeFn, 400, onSettled);

    schedule('index', 'content');
    await vi.advanceTimersByTimeAsync(400);

    expect(onSettled).toHaveBeenCalledWith('index', 'error', err);
  });

  it('runs writes for different keys independently', async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const schedule = createDebouncedWriter(writeFn, 400);

    schedule('index', 'index content');
    await vi.advanceTimersByTimeAsync(100);
    schedule('log', 'log content');

    await vi.advanceTimersByTimeAsync(400);
    // 'index' should have fired (400ms after its own schedule call at t=0)
    expect(writeFn).toHaveBeenCalledWith('index', 'index content');

    await vi.advanceTimersByTimeAsync(400);
    expect(writeFn).toHaveBeenCalledWith('log', 'log content');

    expect(writeFn).toHaveBeenCalledTimes(2);
  });

  it('never runs two writes for the same key concurrently: a write arriving mid-flight is queued to run after the current one settles', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const writeFn = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const onSettled = vi.fn();
    const schedule = createDebouncedWriter(writeFn, 400, onSettled);

    schedule('index', 'v1');
    await vi.advanceTimersByTimeAsync(400);
    // First write is now in flight (unresolved).
    expect(writeFn).toHaveBeenCalledTimes(1);
    expect(writeFn).toHaveBeenNthCalledWith(1, 'index', 'v1');

    // A second edit arrives while the first write is still pending.
    schedule('index', 'v2');
    await vi.advanceTimersByTimeAsync(400);

    // The debounce timer for v2 has fired, but since a write for 'index'
    // is still in flight, the second write must NOT have started yet.
    expect(writeFn).toHaveBeenCalledTimes(1);

    // Resolve the first write; only now should the queued v2 write start.
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(writeFn).toHaveBeenCalledTimes(2);
    expect(writeFn).toHaveBeenNthCalledWith(2, 'index', 'v2');
    expect(onSettled).toHaveBeenNthCalledWith(1, 'index', 'saved');

    second.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(onSettled).toHaveBeenNthCalledWith(2, 'index', 'saved');
  });
});
