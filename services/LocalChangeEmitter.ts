type Listener = () => void | Promise<void>;

const listeners = new Set<Listener>();

// A sync or SMS batch writes many rows, each emitting a change. Listeners reload
// whole data sets, so collapse a burst of emits into one notification.
const COALESCE_MS = 80;
let pending: ReturnType<typeof setTimeout> | null = null;

function notify() {
  pending = null;
  for (const fn of Array.from(listeners)) {
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

export default {
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit() {
    if (pending === null) pending = setTimeout(notify, COALESCE_MS);
  },
};
