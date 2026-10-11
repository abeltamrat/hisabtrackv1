import { AppState, Platform } from 'react-native';

class InternetStatusService {
  private online: boolean | null = null;
  private listeners = new Set<(online: boolean | null) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private appStateSubscription: { remove(): void } | null = null;
  private checking: Promise<boolean> | null = null;

  getCurrent() { return this.online; }

  private publish(value: boolean) {
    if (value === this.online) return;
    this.online = value;
    this.listeners.forEach(listener => listener(value));
  }

  async check(): Promise<boolean> {
    if (this.checking) return this.checking;
    this.checking = (async () => {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.onLine === false) {
        this.publish(false);
        return false;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        await fetch(`https://www.gstatic.com/generate_204?hisab=${Date.now()}`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        this.publish(true);
        return true;
      } catch {
        this.publish(false);
        return false;
      } finally {
        clearTimeout(timeout);
        this.checking = null;
      }
    })();
    return this.checking;
  }

  subscribe(listener: (online: boolean | null) => void) {
    this.listeners.add(listener);
    listener(this.online);
    if (this.listeners.size === 1) {
      void this.check();
      this.timer = setInterval(() => void this.check(), 15000);
      this.appStateSubscription = AppState.addEventListener('change', state => {
        if (state === 'active') void this.check();
      });
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.appStateSubscription?.remove();
        this.appStateSubscription = null;
      }
    };
  }
}

export default new InternetStatusService();
