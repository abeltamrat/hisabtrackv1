type Listener = () => void;

const listeners = new Set<Listener>();

export default {
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  emit() {
    for (const fn of Array.from(listeners)) {
      try {
        const res = fn();
        if (res && typeof (res as any).catch === 'function') {
          (res as Promise<any>).catch((e) => console.error('LocalChangeEmitter async listener error', e));
        }
      } catch (e) {
        console.error('LocalChangeEmitter listener error', e);
      }
    }
  },
};
