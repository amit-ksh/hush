// Noise model: what the creature "hears". 0..100. A game signal, not a health metric.
export class NoiseModel {
  constructor() {
    this.value = 0;
    this.baseline = { bpm: 68, br: 14, rmssd: 55 };
    this.impulse = 0;       // short bursts (fear spikes, talking)
    this._fearPrev = 0;
    this.parts = { heart: 0, breath: 0, hrv: 0, move: 0, light: 0, burst: 0 };
  }

  setBaseline(b) { Object.assign(this.baseline, b); }

  // bio: normalized biometrics. p: {moving, sprinting, crouching, flashlight, hidden}
  update(dt, bio, p) {
    const b = this.baseline;
    const parts = this.parts;
    parts.heart = bio.bpm > 0 ? Math.min(45, Math.max(0, bio.bpm - (b.bpm + 5)) * 4) : 0;
    parts.breath = bio.br > 0 ? Math.min(12, Math.max(0, bio.br - (b.br + 3)) * 2.5) : 0;
    parts.hrv = bio.rmssd > 0 && b.rmssd > 0 ? Math.min(6, Math.max(0, 1 - bio.rmssd / b.rmssd) * 10) : 0;

    // Fear / surprise: burst on a rising edge above 40 confidence.
    if (bio.fear > 40 && this._fearPrev <= 40) this.impulse += 18;
    this._fearPrev = bio.fear;
    if (bio.talking) this.impulse = Math.max(this.impulse, 45);
    this.impulse = Math.max(0, this.impulse - dt * 12);
    parts.burst = this.impulse;

    parts.move = p.sprinting ? 30 : p.moving ? (p.crouching ? 4 : 12) : 0;
    parts.light = p.flashlight ? 8 : 0;

    let target = parts.heart + parts.breath + parts.hrv + parts.move + parts.light + parts.burst;
    if (p.hidden) target *= 0.6;
    if (bio.eyesClosed) target *= 0.35;       // calm-down mechanic
    target = Math.min(100, target);

    const rate = target > this.value ? 45 : (bio.eyesClosed ? 28 : 11);
    const step = rate * dt;
    this.value += Math.max(-step, Math.min(step, target - this.value));
    return this.value;
  }

  // creature hearing radius in tiles
  hearingRadius() { return 2 + this.value * 0.16; }
  get exact() { return this.value >= 60; }
}
