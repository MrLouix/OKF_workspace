// OKF Workspace Generic - Debounced per-key write queue
// Collapses rapid successive writes for the same key into a single write
// of the latest value, and guarantees at most one in-flight write per key
// at a time so writes to the same file never interleave.
// Co-Authored-By: Mistral Vibe <vibe@mistral.ai>

export type WriteStatus = 'saved' | 'error';
export type OnSettled = (key: string, status: WriteStatus, error?: unknown) => void;
export type WriteFn = (key: string, ...args: any[]) => Promise<void>;
export type ScheduleFn = (key: string, ...args: any[]) => void;

interface KeyState {
  timer: ReturnType<typeof setTimeout> | null;
  pendingArgs: any[] | null;
  writing: boolean;
}

/**
 * Creates a debounced, per-key write scheduler.
 * @param writeFn - Called as writeFn(key, ...args) to perform the actual write
 * @param delayMs - Debounce window; a call for a key resets its timer
 * @param onSettled - Called once per completed write with 'saved' or 'error'
 * @returns schedule(key, ...args) - queues a debounced write for that key
 */
export function createDebouncedWriter(
  writeFn: WriteFn,
  delayMs = 400,
  onSettled?: OnSettled
): ScheduleFn {
  const states = new Map<string, KeyState>();

  function getState(key: string): KeyState {
    let state = states.get(key);
    if (!state) {
      state = { timer: null, pendingArgs: null, writing: false };
      states.set(key, state);
    }
    return state;
  }

  async function runNext(key: string): Promise<void> {
    const state = getState(key);
    // Another write for this key is already in flight: it will pick up
    // pendingArgs itself once it settles, so never start a concurrent write.
    if (state.writing || state.pendingArgs === null) return;

    const args = state.pendingArgs;
    state.pendingArgs = null;
    state.writing = true;
    try {
      await writeFn(key, ...args);
      onSettled?.(key, 'saved');
    } catch (err) {
      onSettled?.(key, 'error', err);
    } finally {
      state.writing = false;
      if (state.pendingArgs !== null) {
        runNext(key);
      }
    }
  }

  return function schedule(key: string, ...args: any[]): void {
    const state = getState(key);
    state.pendingArgs = args;
    if (state.timer !== null) {
      clearTimeout(state.timer);
    }
    state.timer = setTimeout(() => {
      state.timer = null;
      runNext(key);
    }, delayMs);
  };
}
