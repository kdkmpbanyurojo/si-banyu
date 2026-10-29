export const ADMIN_IDLE_MS = 10 * 60 * 1000;

// Clock/storage injection keeps the600000ms boundary testable without real waits.
export class IdleSession {
  constructor({
    now = Date.now, read = () => null, write = () => {}, onExpire = () => {},
    // Native browser timers require the global receiver, not this IdleSession.
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = timer => globalThis.clearTimeout(timer),
    timeout = ADMIN_IDLE_MS
  } = {}) {
    Object.assign(this, { now, read, write, onExpire, setTimer, clearTimer, timeout });
    this.running = false; this.last = 0; this.timer = null; this.sid = '';
  }
  start(sid, at = this.now()) {
    this.stop(); this.sid = sid; this.last = at; this.running = true;
    const shared = this.read();
    if (shared?.sid === sid) this.last = Math.max(this.last, shared.at || 0);
    if (!this.check()) return false;
    this.write({ sid, at: this.last }); this.arm(); return true;
  }
  check() {
    if (!this.running) return false;
    const shared = this.read();
    if (shared?.sid === this.sid && Number.isFinite(shared.at)) this.last = Math.max(this.last, shared.at);
    const age = this.now() - this.last;
    if (!Number.isFinite(this.last) || age < -5000 || age >= this.timeout) {
      this.stop(); this.onExpire(); return false;
    }
    return true;
  }
  activity() {
    // Check expiry before accepting a resume/click; an expired session cannot revive.
    if (!this.check()) return false;
    this.last = this.now(); this.write({ sid: this.sid, at: this.last }); this.arm(); return true;
  }
  sync() { if (this.check()) this.arm(); }
  arm() {
    if (!this.running) return;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => { if (this.check()) this.arm(); }, Math.max(1, this.timeout - (this.now() - this.last)));
  }
  stop() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null; this.running = false;
  }
}
