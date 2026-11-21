// HUSH renderer entry: screen flow consent -> calibrate -> play -> end.
import * as THREE from 'three';
import { Biometrics } from './biometrics.js';
import { NoiseModel } from './noise.js';
import { generateLevel, mulberry32 } from './levelgen.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Creature, S } from './creature.js';
import { GameAudio } from './audio.js';
import { Hud } from './hud.js';
import { lineOfSight } from './pathfind.js';
import { MicMonitor } from './mic.js';
import { mountKeySection, refreshKeyStatus, keyStatus, onKeyChange } from './keyui.js';
import { ScareDirector, performScare, SCARE_LABELS, SCARE_IDS as SCARE_IDS_ALL } from './scares.js';

const $ = (id) => document.getElementById(id);
const SMOKE = location.hash === '#smoke';
const SMOKE_LIVE = location.hash === '#smoke-live';
const CAPTURE = location.hash === '#capture';
let ERRS = 0;
const _ce = console.error.bind(console);
console.error = (...a) => { ERRS++; _ce(...a); };
window.addEventListener('unhandledrejection', (e) => { ERRS++; _ce('[hush] unhandled rejection', e.reason && e.reason.message); });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });   // light on the GPU/CPU so the camera SDK keeps its frame rate
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);

const bio = new Biometrics();
const audio = new GameAudio();
const hud = new Hud();
const noise = new NoiseModel();
const mic = new MicMonitor();
let micWanted = false;

let cfg = { sdkError: null };
const hasKey = () => keyStatus().source !== 'none';
const sdkKey = () => window.hushKeys.getSdkKey();
let phase = 'consent';          // consent | calib | ready | play | paused | caught | end
let game = null;
let consentedCamera = false;
let resumeLive = false;         // camera was stopped (pause/end) and should restart on resume
let baselineSet = false;
let calib = null;

function showScreen(id) {
  for (const el of document.querySelectorAll('.screen')) el.classList.toggle('show', el.id === id);
}

bio.onStream = (s) => hud.setStream(s);
function errorText(err) {
  if (err.kind === 'auth') return 'Key rejected by Presage. Check the key and try again.';
  if (err.kind === 'credit') return 'This key has no credits left.';
  return 'SmartSpectra error: ' + err.message;
}
bio.onError = (err) => {
  const text = errorText(err);
  // The SDK ends the measurement when the camera frame rate stays too low (code 14). Pause and let the player restart it.
  if (err.code === 14 && (phase === 'play' || phase === 'paused')) { bio.stopLive(); bio.mode = 'live'; pauseGame('Camera frame rate was too low, so the camera stopped. Add light, close other apps using the camera, then press Resume to restart it.'); return; }
  if (!err.authOrCredit) { if (phase === 'play') hud.msg(text, 6); else $('consentErr').textContent = text; return; }
  // Camera mode never silently falls back to simulation: during play, pause with the error.
  if (phase === 'play' || phase === 'paused') { pauseGame(text + ' Fix the key in the menu, then resume.'); return; }
  // Key problem before play: stay on the consent screen (key section visible); the player chooses.
  bio.stopLive(); phase = 'consent'; showScreen('consent'); resumeLive = false;
  $('consentErr').textContent = text + ' You can play without the camera instead.';
  $('btnLive').disabled = !hasKey();
};

// ---------------------------------------------------------------- consent
async function init() {
  try { cfg = await window.hushConfig.get(); } catch (e) { console.error('[hush] config unavailable', e); }
  mountKeySection($('keyBoxConsent')); mountKeySection($('keyBoxPause'));
  onKeyChange(updateLiveButton);
  if (SMOKE) await smokeKeyTest();
  await refreshKeyStatus();
  console.log(`[hush] ready; sdkBridge=${bio.hasSdk} key=${keyStatus().source}`);
  if (SMOKE) { startSim(); }
  if (CAPTURE) runCapture();
  if (SMOKE_LIVE) {
    try { await bio.startLive(await sdkKey()); console.log('[smoke-live] startLive resolved, status=' + bio.status); }
    catch (e) { console.log('[smoke-live] startLive rejected: ' + (e.code ?? '') + ' ' + e.message); }
    setTimeout(() => console.log('[smoke-live] status=' + bio.status + ' err=' + JSON.stringify(bio.error)), 5000);
  }
}

function updateLiveButton() {
  const can = bio.hasSdk && hasKey() && !cfg.sdkError;
  $('btnLive').disabled = !can;
  if (can && phase === 'consent') $('btnLive').focus({ preventScroll: true });
  $('keyHint').textContent = can ? '' : (cfg.sdkError ? 'SmartSpectra SDK unavailable: ' + cfg.sdkError : !bio.hasSdk ? 'SmartSpectra bridge not available.' : 'Add an API key below (or PRESAGE_API_KEY in .env) to use the camera.');
}

async function setupMic() {
  micWanted = !!$('chkMic').checked;
  if (!micWanted) return;
  try { await mic.start(audio.ctx); } catch (e) { micWanted = false; $('consentErr').textContent = `Microphone unavailable (${e.name || 'error'}). Continuing without it.`; }
}

$('btnLive').onclick = async () => {
  audio.init(); consentedCamera = true; await setupMic();
  $('consentErr').textContent = ''; $('btnLive').disabled = true;
  try {
    await bio.startLive(await sdkKey());
    hud.setMode(true);
    beginCalibration(false);
  } catch (e) {
    const authFail = bio.error && bio.error.kind === 'auth';
    $('consentErr').textContent = authFail ? 'Key rejected by Presage. Check the key and try again, or play in simulation mode.' : `Could not start live mode: ${e.message || e}. You can still play in simulation mode.`;
    $('btnLive').disabled = false;
  }
};
$('btnSim').onclick = async () => { audio.init(); await setupMic(); startSim(); };

function startSim() {
  bio.mode = 'sim'; bio.state.source = 'sim'; hud.setMode(false);
  beginCalibration(true);
}

// ---------------------------------------------------------------- calibration
function beginCalibration(sim) {
  phase = 'calib'; showScreen('calib');
  calib = { sim, t: 0, valid: 0, bpm: 0, br: 0, brN: 0, rm: 0, rmN: 0, n: 0 };
  $('calibText').textContent = sim ? 'Simulated calibration...' : 'Sit still and breathe normally.';
  $('calibCam').style.display = sim ? 'none' : '';
  if (SMOKE) { calib.sim = true; }
}
function calibTick(dt) {
  const c = calib, s = bio.update(dt);
  c.t += dt;
  if (mic.active) mic.collectFloor();
  const target = c.sim ? 4 : 20;
  const good = c.sim || (s.face && s.bpm > 40 && s.bpm < 200);
  if (good) {
    c.valid += dt; c.n++; c.bpm += s.bpm || 0;
    if (s.br > 0) { c.br += s.br; c.brN++; } if (s.rmssd > 0) { c.rm += s.rmssd; c.rmN++; }
  }
  $('cBpm').textContent = s.bpm > 0 ? Math.round(s.bpm) : '--';
  $('cBr').textContent = s.br > 0 ? Math.round(s.br) : '--';
  $('cHint').textContent = bio.mode === 'live' ? (bio.hint || (s.face ? '' : 'Looking for your face...')) : '';
  $('calibBar').style.width = `${clamp(c.valid / target, 0, 1) * 100}%`;
  if (c.valid >= target) finishCalibration(true);
  else if (c.t > (c.sim ? 8 : 75)) finishCalibration(false);
}
function finishCalibration(ok) {
  const c = calib;
  const b = { bpm: c.n ? c.bpm / c.n : 68, br: c.brN ? c.br / c.brN : 14, rmssd: c.rmN ? c.rm / c.rmN : 55 };
  if (!ok && !c.sim) hud.msg('Calibration incomplete - using default baseline', 4);
  if (c.sim) b.bpm = bio.sim.base.bpm;
  noise.setBaseline(b); baselineSet = true;
  if (mic.active) console.log('[hush] mic noise floor dBFS', mic.finishFloor().toFixed(1));
  console.log('[hush] baseline', JSON.stringify(b));
  phase = 'ready';
  if (SMOKE) return startGame();
  showScreen('controls');
}
$('btnCalibSkip').onclick = () => finishCalibration(false);
$('btnGo').onclick = () => { lockPointer(); startGame(); };

// Pointer lock only drives mouse look; WASD works without it. A failed request is not an error.
function lockPointer() {
  try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => hud.msg('Click the screen to look around', 3)); }
  catch { /* ignore */ }
}
canvas.addEventListener('click', () => { if (phase === 'play' && document.pointerLockElement !== canvas) lockPointer(); });
// Any key press or click while playing re-acquires the pointer lock, so looking around never needs click-and-hold.
for (const ev of ['keydown', 'pointerdown']) window.addEventListener(ev, () => { if (phase === 'play' && document.pointerLockElement !== canvas) lockPointer(); }, true);
document.addEventListener('pointerlockerror', () => { if (phase === 'play') hud.msg('Click the screen to look around', 3); });

// ---------------------------------------------------------------- game
function startGame() {
  if (game) { game.world.dispose(); game.player.dispose(); }
  const seed = (SMOKE || CAPTURE) ? 4242 : 1 + Math.floor(Math.random() * 999999);
  const level = generateLevel(seed);
  const world = new World(level, renderer);
  const player = new Player(level, world.camera);
  const creature = new Creature(level, mulberry32(seed ^ 0x9e3779b9));
  game = { director: new ScareDirector({ rnd: mulberry32(seed ^ 0x51ed) }), scareLog: [], bpmHist: [], bpmSlow: 0, histAcc: 0, level, world, player, creature, hasKey: false, sawEnter: false, unlocked: false, t: 0, peakBpm: 0, seed, frames: 0, creatureDist: 99 };
  noise.value = 0; noise.impulse = 0;
  player.locked = !!document.pointerLockElement || SMOKE || CAPTURE;
  if (SMOKE) { player.keys.add('KeyW'); player.yaw = 1.2; }

  player.onFlashToggle = (on) => { world.flash.visible = on; };
  player.onInteract = () => interact();
  creature.onStep = () => audio.creatureStep(creature.x * level.TILE, creature.y * level.TILE, Math.hypot(creature.x - player.tileX, creature.y - player.tileY) * level.TILE);
  creature.onSearchStart = () => { audio.searchSound(); hud.msg('It is searching...', 2.6); };
  creature.onGiveUp = () => { game.sawEnter = false; hud.msg('It gave up. For now.', 2.5); };
  creature.onState = (s) => {
    if (s === S.HUNT) { audio.growl(); hud.msg('It heard you.', 2.5); }
    if (s === S.CATCH) caught();
  };
  hud.setSeed(seed); hud.setKey(false); hud.setMode(bio.mode === 'live'); hud.show(true);
  hud.setStream(bio.stream);
  showScreen('none'); phase = 'play';
  hud.msg('Find the key. Keep your heart quiet.', 4);
}

function interact() {
  const g = game; if (!g || phase !== 'play') return;
  const { player, level, world } = g, T = level.TILE;
  if (player.hidden) { player.leaveHiding(); g.sawEnter = false; audio.creak(); return; }
  if (!g.hasKey && Math.hypot(player.x - level.key.x * T, player.z - level.key.y * T) < 1.7) {
    g.hasKey = true; world.hideKey(); hud.setKey(true); audio.pickup(); hud.msg('You found a key.'); return;
  }
  const ex = level.exit;
  if (!g.unlocked && Math.hypot(player.x - ex.x * T, player.z - ex.y * T) < 2.6) {
    if (g.hasKey) {
      g.unlocked = true; level.solid[ex.y][ex.x] = 0; level.grid[ex.y][ex.x] = 0;
      world.unlockExit(); audio.creak(); hud.msg('The door opens. Go!', 3); return;
    }
    hud.msg('Locked. You need the key.'); return;
  }
  const best = hideTarget();
  if (best) {
    const c = g.creature, cd = Math.hypot(c.x - player.tileX, c.y - player.tileY);
    g.sawEnter = c.state !== S.WANDER ? cd < 14 && lineOfSight(level.solid, Math.round(c.x), Math.round(c.y), Math.round(player.tileX), Math.round(player.tileY))
      : cd < 8 && lineOfSight(level.solid, Math.round(c.x), Math.round(c.y), Math.round(player.tileX), Math.round(player.tileY));
    player.hideIn(best); audio.creak();
    hud.msg(g.sawEnter ? 'It saw you hide...' : 'Hiding. Stay quiet. It can still hear your heart.', 3);
  }
}

// The spot the player is close to (within ~1.2 m of its face) and looking at.
function hideTarget() {
  const g = game, { player, level } = g, T = level.TILE;
  const lx = -Math.sin(player.yaw), lz = -Math.cos(player.yaw);
  let best = null, bd = 1.95;
  for (const h of level.hides) {
    const dx = h.x * T - player.x, dz = h.y * T - player.z, d = Math.hypot(dx, dz);
    if (d < bd && (dx * lx + dz * lz) / (d || 1) > 0.55) { bd = d; best = h; }
  }
  return best;
}

function fireScare(id) {
  const g = game;
  const ok = performScare(id, { world: g.world, player: g.player, creature: g.creature, audio, hud, bio, level: g.level });
  if (!ok) { g.director.failed(); return false; }
  g.scareLog.push({ t: g.t, id, bpm0: g.bpmSlow, peak: g.bpmSlow, until: g.t + 10 });
  console.log('[hush] scare', id);
  return true;
}

// A real sound from the player (mic spike): the creature hears it at the player's position.
function soundEvent(loudness) {
  const g = game; if (!g || phase !== 'play') return;
  noise.addImpulse(loudness * 35);
  const heard = g.creature.hearSound({ x: g.player.tileX, y: g.player.tileY, radius: 4 + 14 * loudness, loud: loudness > 0.65 });
  g.micEvents = (g.micEvents || 0) + 1;
  hud.heardCue(heard ? 'It heard that.' : 'A sound...');
}

function promptText() {
  const g = game, { player, level } = g, T = level.TILE;
  if (player.hidden) return player.holdBreath ? 'holding breath...  (E: leave)' : 'E: leave   |   hold SPACE: hold breath';
  if (!g.hasKey && Math.hypot(player.x - level.key.x * T, player.z - level.key.y * T) < 1.7) return 'E: take key';
  const ex = level.exit;
  if (!g.unlocked && Math.hypot(player.x - ex.x * T, player.z - ex.y * T) < 2.6) return g.hasKey ? 'E: unlock door' : 'Locked';
  const h = hideTarget(); if (h) return `E: hide (${h.type === 'bigcrate' ? 'crate' : h.type})`;
  return '';
}

function caught() {
  if (phase !== 'play') return;
  phase = 'caught';
  document.exitPointerLock();
  audio.sting();
  $('scare').classList.add('show');
  setTimeout(() => { $('scare').classList.remove('show'); endGame(false); }, 1500);
}

function bestScareText(g) {
  const best = g.scareLog.filter((e) => e.bpm0 > 0).sort((a, b) => (b.peak - b.bpm0) - (a.peak - a.bpm0))[0];
  return best && best.peak - best.bpm0 >= 1 ? SCARE_LABELS[best.id] + ' +' + Math.round(best.peak - best.bpm0) : (g.scareLog.length ? SCARE_LABELS[g.scareLog[0].id] : 'none');
}

function drawEndGraph(g) {
  const c = $('endGraph').getContext('2d'), W = 420, H = 80; c.clearRect(0, 0, W, H);
  const pts = g.bpmHist; const vals = pts.filter((v) => v);
  if (vals.length < 2) return;
  const lo = Math.min(...vals) - 5, hi = Math.max(...vals) + 5, n = pts.length;
  const X = (i) => 6 + (i / Math.max(1, n - 1)) * (W - 12), Y = (v) => H - 6 - ((v - lo) / (hi - lo)) * (H - 12);
  c.strokeStyle = '#6fcf97'; c.lineWidth = 1.5; c.beginPath(); let started = false;
  pts.forEach((v, i) => { if (!v) return; if (!started) { c.moveTo(X(i), Y(v)); started = true; } else c.lineTo(X(i), Y(v)); }); c.stroke();
  c.strokeStyle = '#c0392b'; for (const e of g.scareLog) { const x = X(Math.min(n - 1, e.t)); c.beginPath(); c.moveTo(x, 2); c.lineTo(x, H - 2); c.stroke(); }
}

function endGame(win) {
  const g = game;
  phase = 'end'; hud.show(false);
  $('dim').style.opacity = 0; $('hunt').style.opacity = 0; $('hideov').style.opacity = 0;
  document.exitPointerLock();
  $('endTitle').textContent = win ? 'ESCAPED' : 'CAUGHT';
  const t = Math.round(g.t);
  const rows = [['Time', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`], ['Peak BPM', g.peakBpm > 0 ? Math.round(g.peakBpm) : 'n/a'], ['Biggest scare', bestScareText(g)]];
  $('endStats').innerHTML = rows.map(([a, b]) => `<div><b>${b}</b><span>${a}</span></div>`).join('');
  drawEndGraph(g);
  showScreen('end');
  mic.stop();
  // privacy: camera off whenever we are not playing
  if (bio.mode === 'live') { resumeLive = true; bio.stopLive(); }
}
$('btnAgain').onclick = () => { lockPointer(); restartCameraThen(() => startGame()); };
$('btnMenu').onclick = () => { resumeLive = false; mic.stop(); bio.stopLive(); if (game) { hud.show(false); } phase = 'consent'; showScreen('consent'); updateLiveButton(); };

async function restartCameraThen(fn) {
  if (micWanted && !mic.active) { try { await mic.start(audio.ctx); mic.analyzer.reset(); } catch { micWanted = false; } }
  if (resumeLive && bio.mode === 'live' && !bio.liveRunning) {
    showScreen('none'); hud.msg('Restarting camera...', 3);
    try { await bio.startLive(await sdkKey()); hud.setMode(true); }
    catch (e) {
      // Camera mode was chosen: do not fall back to simulation. Stay paused so the player can retry or quit.
      bio.mode = 'live'; document.exitPointerLock();
      if (game) pauseGame(`Camera could not restart (${e.message || e}). Resume to try again.`);
      else { phase = 'consent'; showScreen('consent'); $('consentErr').textContent = `Camera could not restart (${e.message || e}).`; }
      return;
    }
  }
  resumeLive = false;
  fn();
}

// ---------------------------------------------------------------- pause (Esc / pointer lock lost)
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (game) game.player.locked = locked;
  if (!locked && phase === 'play') pauseGame();
});
function pauseGame(reason) {
  phase = 'paused';
  const wasLive = bio.mode === 'live';
  mic.stop();
  if (wasLive) { resumeLive = true; bio.stopLive(); }
  if (document.pointerLockElement) document.exitPointerLock();
  const base = wasLive ? 'Camera and mic are off. Resume restarts them.' : (micWanted ? 'Mic is off.' : 'Nothing is being measured.');
  $('pauseText').textContent = reason || base;
  showScreen('pause');
}
$('btnResume').onclick = () => {
  lockPointer();
  restartCameraThen(() => { showScreen('none'); phase = 'play'; hud.setMode(bio.mode === 'live'); });
};
$('btnQuit').onclick = () => { resumeLive = false; mic.stop(); bio.stopLive(); hud.show(false); phase = 'consent'; showScreen('consent'); updateLiveButton(); };

// ---------------------------------------------------------------- input extras
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyB' && bio.mode === 'sim') bio.setSimKey('eyes', true);
  if (e.code === 'KeyT' && bio.mode === 'sim') bio.setSimKey('talk', true);
  if (e.code === 'KeyV' && phase === 'play') mic.injectSpike(0.9);
  // Without pointer lock the browser does not pause on Esc, so do it here.
  if (e.code === 'Escape' && phase === 'play' && document.pointerLockElement !== canvas) pauseGame();
  if (e.code === 'KeyM' && phase === 'play') {
    // Camera mode stays camera mode (no switch to simulation).
    if (bio.mode === 'live') hud.msg('Camera mode: simulation is off', 2.5);
    else if (consentedCamera && hasKey()) {
      hud.msg('Starting camera...', 2);
      sdkKey().then((k) => bio.startLive(k)).then(() => hud.setMode(true)).catch(() => hud.msg('Camera unavailable', 3));
    } else hud.msg('Live mode needs consent + key: return to the menu', 3);
  }
});
window.addEventListener('keyup', (e) => { if (e.code === 'KeyB') bio.setSimKey('eyes', false); if (e.code === 'KeyT') bio.setSimKey('talk', false); });
window.addEventListener('resize', () => { renderer.setSize(window.innerWidth, window.innerHeight, false); if (game) game.world.resize(); });
window.addEventListener('beforeunload', () => { try { bio.sdk && bio.sdk.destroy(); } catch { /* ignore */ } });
window.addEventListener('error', (e) => console.error('[hush] window error', e.message, e.filename, e.lineno));

// ---------------------------------------------------------------- main loop
function playTick(dt) {
  const g = game, { player, creature, world, level } = g, T = level.TILE;
  g.t += dt; g.frames++;
  const px = player.tileX, py = player.tileY;
  const cd = Math.hypot(creature.x - px, creature.y - py); g.creatureDist = cd;
  bio.setSimContext({ sprinting: player.sprinting, threat: clamp(1 - cd / 12, 0, 1), hunted: creature.state === S.HUNT });
  const b = bio.update(dt);
  if (b.bpm > 0 && b.bpm < 220) {
    g.peakBpm = Math.max(g.peakBpm, b.bpm);
    g.bpmSlow = g.bpmSlow ? g.bpmSlow + (b.bpm - g.bpmSlow) * Math.min(1, dt / 3) : b.bpm;
  }
  g.histAcc += dt; if (g.histAcc >= 1) { g.histAcc = 0; g.bpmHist.push(b.bpm > 0 && b.bpm < 220 ? b.bpm : null); }
  for (const e of g.scareLog) if (g.t < e.until && b.bpm > 0 && b.bpm < 220) e.peak = Math.max(e.peak, b.bpm);
  if (!SMOKE && !CAPTURE) {
    const chase = [S.HUNT, S.SEARCH, S.CATCH].includes(creature.state);
    const sid = g.director.update(dt, { chase });
    if (sid) fireScare(sid);
  }
  player.update(dt, true);
  const m = mic.update(dt);
  if (m.event) soundEvent(m.event.loudness, m.event.over);
  noise.update(dt, b, { moving: player.moving, sprinting: player.sprinting, crouching: player.crouching, flashlight: player.flashlight && !player.hidden, hidden: !!player.hidden, holdBreath: player.holdBreath, holdSecs: player.holdSecs, mic: m.noise });
  if ((!SMOKE || g.t > 9) && !CAPTURE) creature.update(dt, { px: player.tileX, py: player.tileY, hidden: !!player.hidden, hiddenProp: player.hidden, sawEnter: g.sawEnter, flashlight: player.flashlight, noise });
  if (player.gasp) { noise.addImpulse(30); audio.zap(); hud.msg('You gasp for air.', 2); }
  world.highlight(player.hidden ? null : hideTarget());
  world.setCreature(creature.x * T, creature.y * T, creature.heading, creature.speed, dt, creature.state === S.HUNT);
  world.flash.visible = player.flashlight && !player.hidden;
  world.update(dt, performance.now() / 1000);
  audio.setListener(player.x, player.z, player.yaw); audio.setCreaturePos(creature.x * T, creature.y * T);
  audio.heartbeat(b.bpm, noise.value);

  hud.setStress(b.bpm > 0 ? (b.bpm - (noise.baseline.bpm + 6)) / 30 : 0);
  hud.update(dt, b, noise.value);
  hud.mic(mic.active || mic.fakeT > 0, mic.barFrac, mic.thresholdFrac);
  hud.hint(bio.mode === 'live' ? (bio.hint || (b.face ? '' : 'no face found')) : '');
  const room = level.rooms.find((r) => px >= r.x0 - 0.5 && px <= r.x1 + 0.5 && py >= r.y0 - 0.5 && py <= r.y1 + 0.5);
  hud.setRoom(room ? room.name : 'doorway'); hud.prompt(promptText());
  $('dim').style.opacity = b.eyesClosed ? 0.88 : 0;
  $('hunt').style.opacity = creature.state === S.HUNT ? 1 : 0;
  $('hideov').style.opacity = player.hidden ? 1 : 0;

  if (g.unlocked && Math.hypot(player.x - level.exit.x * T, player.z - level.exit.y * T) < 0.9) { audio.win(); endGame(true); return; }
  // jump-scare camera snap
  if (creature.state === S.CATCH) { player.yaw = Math.atan2(player.x - creature.x * T, player.z - creature.y * T) + Math.PI; }
  if (SMOKE) smokeStep(g, b, dt);
}

// Smoke: set a fake session key through IPC; status must show only the masked value.
const SMOKE_FAKE_KEY = 'zz-fake-SMOKE-key-9f3a';
async function smokeKeyTest() {
  const r = await window.hushKeys.setKey(SMOKE_FAKE_KEY, false);
  await refreshKeyStatus();
  const st = keyStatus();
  const painted = document.querySelector('.keystatus') ? document.querySelector('.keystatus').textContent : '';
  smokeKey.ok = r.ok && st.source === 'session' && st.hint === '\u2022\u2022\u2022\u20229f3a' && painted.includes('\u2022\u2022\u2022\u20229f3a') && !painted.includes('SMOKE') && !JSON.stringify(st).includes('fake');
  smokeKey.line = st.source + ':' + st.hint;
}
const smokeKey = { ok: false, line: '' };

// ---------------------------------------------------------------- screenshot mode (HUSH_CAPTURE=<dir>, simulation only)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  if (game) console.log('[hush] cap-debug ' + name + ' player=' + game.player.tileX.toFixed(2) + ',' + game.player.tileY.toFixed(2) + ' yaw=' + game.player.yaw.toFixed(2) + ' pitch=' + game.player.pitch.toFixed(2) + ' creature=' + game.creature.x.toFixed(1) + ',' + game.creature.y.toFixed(1));
  console.log('[capture] ' + name); await sleep(900);
};
function bestView(g) { // yaw with the longest open line of sight from the player
  const { player, level } = g; let best = { d: 0, yaw: 0 };
  for (let k = 0; k < 32; k++) {
    const yaw = (k / 32) * Math.PI * 2; let d = 0;
    while (d < 14) { const x = Math.round(player.tileX - Math.sin(yaw) * d), y = Math.round(player.tileY - Math.cos(yaw) * d); if (level.solid[y][x]) break; d += 0.25; }
    if (d > best.d) best = { d, yaw };
  }
  return best;
}
async function runCapture() {
  await sleep(700); await shot('01-consent');
  $('btnSim').click();
  await sleep(1800); await shot('02-calibration');
  while (phase !== 'ready') await sleep(100);
  startGame(); const g = game, { player, creature, world, level } = g;
  const view = bestView(g); player.yaw = view.yaw; player.pitch = -0.05;
  await sleep(2500); await shot('03-gameplay');
  // creature standing in the beam a few tiles away
  const dist = Math.max(2, Math.min(2.8, view.d - 2));
  creature.x = player.tileX - Math.sin(view.yaw) * dist; creature.y = player.tileY - Math.cos(view.yaw) * dist;
  creature.heading = Math.atan2(player.tileX - creature.x, player.tileY - creature.y); creature.state = S.HUNT;
  await sleep(1200); await shot('04-creature');
  creature.x = 1; creature.y = 1;
  const spot = level.hides.find((h) => h.room === level.spawn.room) || level.hides[0];
  player.hideIn(spot); world.ambient.intensity = 3.2; await sleep(1500); await shot('05-hidden'); world.ambient.intensity = 1.0;
  player.leaveHiding(); player.yaw = view.yaw;
  fireScare('whisper'); await sleep(2500); fireScare('heartbeat'); await sleep(3500);
  const v2 = bestView(g); player.yaw = v2.yaw;
  fireScare('silhouette') || (player.yaw += 1, fireScare('silhouette'));
  world.fakeT = 3; await sleep(500); await shot('06-scare');
  await sleep(11000);
  { if (player.hidden) player.leaveHiding(); const v3 = bestView(g); player.yaw = v3.yaw; player.pitch = 0; player.flashlight = true; world.flash.visible = true;
    for (let k = 0; k < 8 && !fireScare('crawler'); k++) player.yaw = k * Math.PI / 4;
    await sleep(350); await shot('10-crawler'); await sleep(1500);
    for (let k = 0; k < 8 && !fireScare('dolls'); k++) player.yaw = k * Math.PI / 4;
    await sleep(900); await shot('11-dolls'); }
  endGame(true); await sleep(600); await shot('07-end');
  showScreen('pause'); await sleep(300); await shot('08-pause');
  phase = 'consent'; showScreen('consent'); $('keyDetails').open = true; $('privacy').open = true; await sleep(300); await shot('09-consent-details');
  console.log('[capture] done');
}

// ---------------------------------------------------------------- smoke test hook (HUSH_SMOKE=1)
const smoke = { scares: {}, i: 0, micFired: false, hid: false, searched: false, gaveUp: false, done: false, errs: [] };
function smokeStep(g, b, dt) {
  const { player, creature, level } = g, T = level.TILE;
  const guard = (name, fn) => { try { return fn(); } catch (e) { ERRS++; console.error('[smoke] ' + name + ' threw: ' + (e && e.stack || e)); return false; } };
  if (g.t > 2 && player.keys.has('KeyW') && g.t < 2.1) player.keys.delete('KeyW');
  // each scare type once, 0.7 s apart
  if (g.t > 2.5 + smoke.i * 0.7 && smoke.i < SCARE_IDS_ALL.length) {
    const id = SCARE_IDS_ALL[smoke.i++];
    let ok = false;
    if (id === 'silhouette' || id === 'crawler') { for (let k = 0; k < 8 && !ok; k++) { player.yaw = k * Math.PI / 4; ok = guard(id, () => fireScare(id)); } }
    else ok = guard(id, () => fireScare(id));
    smoke.scares[id] = ok; console.log('[smoke] scare ' + id + ' -> ' + (ok ? 'ok' : 'NOT STAGED'));
  }
  if (g.t > 9 && !smoke.micFired) { smoke.micFired = true; mic.injectSpike(0.9); }
  // hiding + search test: put the creature in the room, hide with "it saw you", expect SEARCH then give-up
  if (g.t > 10 && !smoke.hid) {
    smoke.hid = true;
    const spot = level.hides.find((h) => h.room === level.spawn.room) || level.hides[0];
    const room = level.rooms[spot.room];
    player.leaveHiding && player.hidden && player.leaveHiding();
    player.hideIn(spot); g.sawEnter = true;
    const free = [[room.cx, room.cy], [room.cx - 1, room.cy], [room.cx, room.cy - 1], [room.cx + 1, room.cy + 1]].find(([x, y]) => !level.solid[y][x]);
    creature.x = free[0]; creature.y = free[1]; creature.path = []; creature.state = S.WANDER;
    noise.value = 0; noise.impulse = 0;
    console.log('[smoke] hiding in ' + spot.type + ' (room ' + room.name + '), creature placed nearby');
  }
  if (creature.state === S.SEARCH) smoke.searched = true;
  if (smoke.searched && creature.state === S.WANDER && !g.sawEnter) smoke.gaveUp = true;
  if (g.t > 30 && !smoke.done) {
    smoke.done = true;
    const allScares = SCARE_IDS_ALL.every((id) => smoke.scares[id]);
    const mic1 = (g.micEvents || 0) >= 1;
    const pass = smokeKey.ok && ERRS === 0 && allScares && mic1 && smoke.searched && smoke.gaveUp;
    console.log('[smoke] OK frames=' + g.frames + ' state=' + creature.state + ' bpm=' + b.bpm.toFixed(0) + ' src=' + b.source);
    console.log('[smoke] RESULT ' + (pass ? 'PASS' : 'FAIL') + ' scares=' + SCARE_IDS_ALL.filter((id) => smoke.scares[id]).length + '/' + SCARE_IDS_ALL.length +
      ' micEvents=' + (g.micEvents || 0) + ' searched=' + smoke.searched + ' gaveUp=' + smoke.gaveUp + ' consoleErrors=' + ERRS + ' keyStatus=' + smokeKey.line + ' keyStatusOk=' + smokeKey.ok);
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  try {
    if (phase === 'calib') calibTick(dt);
    else if (phase === 'play') playTick(dt);
    else if (phase === 'caught' && game) game.player.update(dt, false);
    if (game && phase !== 'consent') game.world.render();
  } catch (e) { console.error('[hush] frame error', e && e.stack || e); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
init();
