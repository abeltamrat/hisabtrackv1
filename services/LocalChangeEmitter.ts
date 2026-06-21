type Listener = () => void | Promise<void>;

const listeners = new Set<Listener>();

export default {
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit() {
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
  },
};
