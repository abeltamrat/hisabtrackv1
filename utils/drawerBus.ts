/**
 * Lets a screen (e.g. Home's "More" quick action) ask AppShell to open the
 * side drawer, without plumbing drawer state through every screen. Mirrors
 * the LocalChangeEmitter pub-sub shape already used for data refresh.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export default {
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  open() {
    for (const fn of Array.from(listeners)) {
      try { fn(); } catch (e) { console.error('drawerBus listener error', e); }
    }
  },
};
