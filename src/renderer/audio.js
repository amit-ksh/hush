// Procedural Web Audio (no third-party audio assets). Heartbeat follows the live BPM.
export class GameAudio {
  constructor() { this.ctx = null; this.master = null; this.nextBeat = 0; this.beatVol = 0.3; this.enabled = true; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(ctx.destination);
    // noise buffer
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    // ambient drone
    const g = ctx.createGain(); g.gain.value = 0.05;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    for (const f of [55, 55.8, 82.6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); }
    lp.connect(g); g.connect(this.master);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08; const lg = ctx.createGain(); lg.gain.value = 0.03; lfo.connect(lg); lg.connect(g.gain); lfo.start();
    // creature panner
    this.panner = ctx.createPanner(); this.panner.panningModel = 'HRTF'; this.panner.distanceModel = 'inverse'; this.panner.refDistance = 1.5; this.panner.rolloffFactor = 1.4;
    this.panner.connect(this.master);
  }

  setListener(x, z, yaw) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) { l.positionX.value = x; l.positionY.value = 1.6; l.positionZ.value = z; l.forwardX.value = -Math.sin(yaw); l.forwardY.value = 0; l.forwardZ.value = -Math.cos(yaw); l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0; }
  }
  setCreaturePos(x, z) { if (this.panner && this.panner.positionX) { this.panner.positionX.value = x; this.panner.positionY.value = 1; this.panner.positionZ.value = z; } }

  _tone(freq, t, dur, vol, type = 'sine', dest = this.master) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  _noise(t, dur, vol, type, f0, f1, dest = this.master) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  // Called each frame with the live BPM (0 = no signal) and the noise value.
  heartbeat(bpm, noise) {
    if (!this.ctx || bpm <= 30) return;
    const t = this.ctx.currentTime;
    if (this.nextBeat < t - 1) this.nextBeat = t;
    if (t + 0.1 >= this.nextBeat) {
      const vol = 0.18 + noise * 0.006;
      this._tone(62, this.nextBeat, 0.16, vol);
      this._tone(50, this.nextBeat + 0.17, 0.2, vol * 0.8);
      this.nextBeat += 60 / bpm;
    }
  }
  step() { if (this.ctx) this._noise(this.ctx.currentTime, 0.12, 0.9, 'lowpass', 260, 90, this.panner); }
  growl() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(75, t); o.frequency.linearRampToValueAtTime(48, t + 1.4);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.15); g.gain.linearRampToValueAtTime(0, t + 1.5);
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 17; const lg = this.ctx.createGain(); lg.gain.value = 0.25; lfo.connect(lg); lg.connect(g.gain);
    o.connect(lp); lp.connect(g); g.connect(this.panner); o.start(t); lfo.start(t); o.stop(t + 1.6); lfo.stop(t + 1.6);
  }
  creak() { if (this.ctx) this._noise(this.ctx.currentTime, 0.8, 0.35, 'bandpass', 380, 1100); }
  pickup() { if (!this.ctx) return; const t = this.ctx.currentTime; this._tone(880, t, 0.25, 0.15, 'triangle'); this._tone(1320, t + 0.08, 0.3, 0.12, 'triangle'); }
  sting() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this._noise(t, 0.9, 1.0, 'lowpass', 6000, 200);
    for (const f of [220, 233, 311, 466]) this._tone(f * 2, t, 1.0, 0.25, 'square');
  }
  win() { if (!this.ctx) return; const t = this.ctx.currentTime; [392, 494, 587, 784].forEach((f, i) => this._tone(f, t + i * 0.14, 0.7, 0.14, 'triangle')); }
}
