const reporter = {
  consecutiveNativeErrors: 0,
  nativeErrorThreshold: 8,
  nativeErrorCooldownMs: 60_000,
  disableUntil: 0,
  // While true, record() is a no-op. Used during bulk pull/push so transient
  // per-item write failures don't trigger the circuit breaker.
  suppressCounting: false,
  // throttle repeated reports to avoid log spam
  _lastRecordTs: 0,
  _minIntervalMs: 500,

  isNativeError(e: any) {
    // Only errors explicitly marked as a stale-handle/init error count
    if (e && e.isStaleHandleError) return true;
    const msg = e?.message || String(e);
    // Exclude Firebase/network errors
    if (/firestore|firebase|network|request|timeout|auth/i.test(msg)) return false;
    return /NullPointerException|NativeDatabase|prepareAsync/i.test(msg);
  },

  record(e: any) {
    try {
      if (this.suppressCounting) return;
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
