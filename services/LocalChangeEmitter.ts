type Listener = () => void | Promise<void>;

const listeners = new Set<Listener>();
const immediateListeners = new Set<Listener>();

// A sync or SMS batch writes many rows, each emitting a change. Listeners reload
// whole data sets, so collapse a burst of emits into one notification.
const COALESCE_MS = 80;
let pending: ReturnType<typeof setTimeout> | null = null;

function call(set: Set<Listener>) {
  for (const fn of Array.from(set)) {
    try {
      const result = fn();
      if (result instanceof Promise) {
        result.catch((error) => console.error('LocalChangeEmitter async listener error', error));
      }
    } catch (e) {
      console.error('LocalChangeEmitter listener error', e);
    }
  }
}

function notify() {
  pending = null;
  call(listeners);
}

export default {
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /**
   * Runs synchronously inside emit(), for listeners that check the emitter's
   * own state at emit time (SyncService ignores changes it is applying itself).
   */
  subscribeImmediate(fn: Listener) {
    immediateListeners.add(fn);
    return () => immediateListeners.delete(fn);
  },
  emit() {
    call(immediateListeners);
    if (pending === null) pending = setTimeout(notify, COALESCE_MS);
  },
};
