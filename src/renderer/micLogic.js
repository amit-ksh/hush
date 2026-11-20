// Pure microphone level logic (no DOM, no audio APIs) so it can be unit tested with fake samples.
// Input is a level in dBFS per frame. Audio itself is never kept: only these numbers exist.
export const MIC_CFG = {
  spikeDb: 18,       // onset must reach this many dB above the room noise floor
  riseDb: 12,        // ...and rise this much above the slow envelope
  refractory: 0.6,   // seconds between sound events
  attack: 0.05,      // smoothing time constants (s): fast attack, slower release
  release: 0.4,
  slow: 0.6,
  contStartDb: 6,    // continuous contribution starts this far above the floor
  contRangeDb: 30,
  contMax: 25,       // max noise points from sustained level
  barRangeDb: 40,    // HUD bar full scale
};

export function rmsToDb(rms) { return 20 * Math.log10(Math.max(rms, 1e-8)); }

export function medianFloor(samples, fallback = -55) {
  if (!samples.length) return fallback;
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export class MicAnalyzer {
  constructor(cfg = MIC_CFG) { this.cfg = cfg; this.floorDb = -55; this.level = 0; this.slow = null; this.cool = 0; }
  setFloor(db) { this.floorDb = db; }
  reset() { this.level = 0; this.slow = null; this.cool = 0; }

  // db: instantaneous level in dBFS; dt: seconds. Returns { over, level, noise, event }.
  push(db, dt) {
    const c = this.cfg;
    const over = Math.max(0, db - this.floorDb);
    const tau = over > this.level ? c.attack : c.release;
    this.level += (over - this.level) * (1 - Math.exp(-dt / tau));
    if (this.slow == null) this.slow = over;
    this.cool = Math.max(0, this.cool - dt);
    let event = null;
    if (over >= c.spikeDb && over - this.slow >= c.riseDb && this.cool <= 0) {
      event = { loudness: 0.15 + 0.85 * Math.min(1, (over - c.spikeDb) / 20), over };
      this.cool = c.refractory;
    }
    this.slow += (over - this.slow) * (1 - Math.exp(-dt / c.slow));
    const noise = Math.min(1, Math.max(0, (this.level - c.contStartDb) / c.contRangeDb)) * c.contMax;
    return { over, level: this.level, noise, event };
  }
}
