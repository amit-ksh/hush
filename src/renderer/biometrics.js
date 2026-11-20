// Biometric source: live SmartSpectra SDK or simulation. Both emit the same normalized state:
// { bpm, br, rmssd, fear, talking, eyesClosed, confidence, face, source }
import {
  SmartSpectraSDK, ProcessingStatus, ValidationCode, SmartSpectraErrorCode,
  breathingMetrics, cardioMetrics, faceMetrics,
} from '@smartspectra/node-sdk/renderer';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';

const EXPR_FEAR = 4, EXPR_SURPRISE = 8;
const VALIDATION_NAMES = Object.fromEntries(Object.entries(ValidationCode).map(([k, v]) => [v, k.replace(/^k/, '')]));
const VALIDATION_TEXT = {
  NoFaceFound: 'No face found - look at the camera', MultipleFacesFound: 'More than one face in view',
  FaceNotCentered: 'Centre your face', TooDark: 'Too dark - add light', TooBright: 'Too bright',
  ExcessiveMotion: 'Hold still', FaceTooClose: 'Move back a little', FaceTooFar: 'Move closer',
  FaceTooHigh: 'Lower the camera / head', FaceTooLow: 'Raise the camera / head', FaceNotForward: 'Face the camera',
  CameraTuning: 'Camera is tuning...', FrameRateTooLow: 'Camera frame rate too low', ChestNotVisible: 'Chest not visible',
};

const lastOf = (a) => (a && a.length ? a[a.length - 1] : null);
const pick = (o, camel, snake) => (o ? (o[camel] !== undefined ? o[camel] : o[snake]) : undefined);
const num = (v) => (v == null ? null : typeof v === 'number' ? v : Number(v));

export class Biometrics {
  constructor() {
    this.mode = 'sim';           // 'live' | 'sim'
    this.state = { bpm: 70, br: 14, rmssd: 50, fear: 0, talking: false, eyesClosed: false, confidence: 0, face: false, source: 'sim' };
    this.hint = '';
    this.error = null;           // { code, message, authOrCredit }
    this.status = 'idle';
    this.stream = null;
    this.onStream = null;        // (MediaStream|null) => void
    this.onError = null;
    this.sdk = null;
    this._loggedFirst = false;
    this._blinkSince = null;
    this._lastLive = 0;
    // simulation
    this.sim = { bpm: 70, br: 14, rmssd: 50, fear: 0, base: { bpm: 68, br: 14, rmssd: 55 }, ctx: { sprinting: false, threat: 0, hunted: false }, keys: { eyes: false, talk: false } };
  }

  get hasSdk() { return typeof window !== 'undefined' && !!window.__smartspectraBridge; }

  // ---- live ----
  async startLive(apiKey) {
    this.error = null;
    if (!this.hasSdk) throw new Error('SmartSpectra bridge unavailable (preload not loaded)');
    if (!apiKey) throw new Error('No PRESAGE_API_KEY found in .env');
    if (this.sdk) await this.stopLive();
    // FACE_LANDMARKS (11) is skipped: the game only needs blinking, talking and expressions.
    const requested = [...breathingMetrics, ...cardioMetrics, ...faceMetrics.filter((m) => m !== 11)];
    this.sdk = new SmartSpectraSDK({ apiKey, requestedMetrics: requested, enableAccumulatedOutput: false, enableTelemetry: false });
    this.sdk.on('processingStatus', (s) => { this.status = Object.keys(ProcessingStatus).find((k) => ProcessingStatus[k] === s)?.replace(/^k/, '') || String(s); });
    this.sdk.on('validationStatus', (code, ts, hint) => {
      const name = VALIDATION_NAMES[code] || `Code${code}`;
      this.hint = code === ValidationCode.kOk ? '' : (VALIDATION_TEXT[name] || hint || name);
    });
    this.sdk.on('metrics', (buf) => { try { this._ingest(decodeMetrics(buf)); } catch (e) { console.error('[hush] decode failed', e); } });
    this.sdk.on('error', (code, message, retryable) => {
      const auth = code === SmartSpectraErrorCode.kAuthenticationFailed || code === SmartSpectraErrorCode.kCreditExhausted;
      this.error = { code, message, retryable, authOrCredit: auth };
      console.error('[hush] sdk error', code, message);
      if (this.onError) this.onError(this.error);
    });
    this.sdk.on('streamAvailable', (stream) => { this.stream = stream; if (this.onStream) this.onStream(stream); });
    try {
      await this.sdk.start();
    } catch (e) {
      const err = { code: e.code ?? 'JS', message: e.message, authOrCredit: false };
      this.error = err; this.mode = 'sim'; this.state.source = 'sim';
      try { this.sdk.destroy(); } catch { /* ignore */ }
      this.sdk = null;
      throw e;
    }
    this.mode = 'live'; this.state.source = 'live';
    this.state.bpm = 0; this.state.br = 0; this.state.rmssd = 0;
  }

  async stopLive() {
    if (!this.sdk) return;
    try { await this.sdk.stop(); } catch (e) { console.error('[hush] stop failed', e); }
    try { this.sdk.destroy(); } catch { /* already destroyed */ }
    this.sdk = null; this.stream = null;
    if (this.onStream) this.onStream(null);
    this.hint = '';
  }

  _ingest(m) {
    if (!this._loggedFirst) {
      this._loggedFirst = true;
      console.log('[hush] first decoded metrics keys:', JSON.stringify(Object.keys(m || {})),
        'cardio:', JSON.stringify(Object.keys(m?.cardio || {})), 'breathing:', JSON.stringify(Object.keys(m?.breathing || {})), 'face:', JSON.stringify(Object.keys(m?.face || {})));
    }
    const s = this.state;
    const pulse = lastOf(pick(m.cardio, 'pulseRate', 'pulse_rate'));
    if (pulse && num(pulse.value) > 0) { s.bpm = num(pulse.value); s.confidence = pulse.stable ? 1 : 0.5; }
    const br = lastOf(m.breathing?.rate);
    if (br && num(br.value) > 0) s.br = num(br.value);
    const hrv = lastOf(m.cardio?.hrv);
    if (hrv && num(hrv.rmssd) > 0) s.rmssd = num(hrv.rmssd);
    const f = m.face;
    if (f) {
      const ex = lastOf(f.expression);
      if (ex && ex.scores) {
        let v = 0;
        for (const sc of ex.scores) if (sc.type === EXPR_FEAR || sc.type === EXPR_SURPRISE) v = Math.max(v, num(sc.confidence) || 0);
        s.fear = v; // 0..100
      }
      const tk = lastOf(f.talking);
      if (tk) s.talking = !!tk.detected;
      for (const b of f.blinking || []) {
        const t = num(b.timestamp) / 1000 || performance.now();
        if (b.detected) { if (this._blinkSince == null) this._blinkSince = t; s.eyesClosed = (t - this._blinkSince) >= 1000; }
        else { this._blinkSince = null; s.eyesClosed = false; }
      }
      s.face = true;
    }
    this._lastLive = performance.now();
  }

  // ---- simulation ----
  setSimContext(ctx) { Object.assign(this.sim.ctx, ctx); }
  setSimKey(name, down) { this.sim.keys[name] = down; }

  update(dt) {
    if (this.mode === 'live') {
      // Live values go stale (no face) -> let eyes/talking flags fall back.
      if (performance.now() - this._lastLive > 3000) { this.state.face = false; this.state.eyesClosed = false; this.state.talking = false; }
      return this.state;
    }
    const sm = this.sim, c = sm.ctx, s = this.state;
    const targetBpm = sm.base.bpm + (c.sprinting ? 14 : 0) + c.threat * 38 + (c.hunted ? 12 : 0) + (sm.keys.talk ? 4 : 0);
    const targetBr = sm.base.br + (c.sprinting ? 5 : 0) + c.threat * 9 + (c.hunted ? 4 : 0);
    const targetRm = sm.base.rmssd * (1 - 0.6 * Math.min(1, c.threat + (c.hunted ? 0.3 : 0)));
    const calm = sm.keys.eyes ? 2.2 : 1;
    const k = 1 - Math.exp(-dt * (targetBpm > sm.bpm ? 0.5 : 0.25) * calm);
    sm.bpm += (targetBpm - sm.bpm) * k;
    sm.br += (targetBr - sm.br) * (1 - Math.exp(-dt * 0.3 * calm));
    sm.rmssd += (targetRm - sm.rmssd) * (1 - Math.exp(-dt * 0.3));
    const targetFear = (c.hunted ? 70 : c.threat * 60);
    sm.fear += (targetFear - sm.fear) * (1 - Math.exp(-dt * 1.5));
    s.bpm = sm.bpm + Math.sin(performance.now() / 1300) * 1.2; s.br = sm.br; s.rmssd = sm.rmssd; s.fear = sm.fear;
    s.talking = sm.keys.talk; s.eyesClosed = sm.keys.eyes; s.confidence = 1; s.face = true; s.source = 'sim';
    return s;
  }
}
