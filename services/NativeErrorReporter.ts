const reporter = {
  consecutiveNativeErrors: 0,
  nativeErrorThreshold: 3,
  nativeErrorCooldownMs: 60_000,
  disableUntil: 0,
  // throttle repeated reports to avoid log spam
  _lastRecordTs: 0,
  _minIntervalMs: 200,

  isNativeError(e: any) {
    const msg = e?.message || String(e);
    return /NativeDatabase|prepareAsync|execAsync|NullPointerException/i.test(msg);
  },

  record(e: any) {
    try {
      if (!this.isNativeError(e)) return;
      const now = Date.now();
      if (now - (this._lastRecordTs || 0) < this._minIntervalMs) return;
      this._lastRecordTs = now;
      this.consecutiveNativeErrors = (this.consecutiveNativeErrors || 0) + 1;
      console.warn('NativeErrorReporter: detected native DB error', { count: this.consecutiveNativeErrors, threshold: this.nativeErrorThreshold });
      if (this.consecutiveNativeErrors >= this.nativeErrorThreshold) {
        this.disableUntil = Date.now() + this.nativeErrorCooldownMs;
        console.error('NativeErrorReporter: disabling auto-sync until', new Date(this.disableUntil).toISOString());
      }
    } catch (err) {
      console.error('NativeErrorReporter.record failed', err);
    }
  },

  reset() {
    this.consecutiveNativeErrors = 0;
    this.disableUntil = 0;
  }
};

export default reporter;
