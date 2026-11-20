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

const $ = (id) => document.getElementById(id);
const SMOKE = location.hash === '#smoke';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight, false);

const bio = new Biometrics();
const audio = new GameAudio();
const hud = new Hud();
const noise = new NoiseModel();

let cfg = { apiKey: '', sdkError: null };
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
bio.onError = (err) => {
  const text = err.authOrCredit
    ? 'The SmartSpectra service rejected the key or the credits are used up. Switching to simulation mode.'
    : `SmartSpectra error: ${err.message}`;
  if (err.authOrCredit) { switchToSim(); }
  if (phase === 'play') hud.msg(text, 6);
  else $('consentErr').textContent = text;
};

function switchToSim() {
  bio.stopLive();
  bio.mode = 'sim'; bio.state.source = 'sim';
  bio.state.bpm = bio.sim.bpm = bio.sim.base.bpm; bio.state.br = bio.sim.br = bio.sim.base.br; bio.state.rmssd = bio.sim.rmssd = bio.sim.base.rmssd;
  hud.setMode(false); hud.hint('');
}

// ---------------------------------------------------------------- consent
async function init() {
  try { cfg = await window.hushConfig.get(); } catch (e) { console.error('[hush] config unavailable', e); }
  const canLive = bio.hasSdk && !!cfg.apiKey && !cfg.sdkError;
  $('btnLive').disabled = !canLive;
  $('keyHint').textContent = canLive ? '' :
    !cfg.apiKey ? 'Live mode needs PRESAGE_API_KEY in a .env file (see README). Simulation mode works without it.'
      : (cfg.sdkError ? `SmartSpectra SDK unavailable: ${cfg.sdkError}` : 'SmartSpectra bridge not available.');
  console.log(`[hush] ready; sdkBridge=${bio.hasSdk} keyPresent=${!!cfg.apiKey}`);
  if (SMOKE) { startSim(); }
}

$('btnLive').onclick = async () => {
  audio.init(); consentedCamera = true;
  $('consentErr').textContent = ''; $('btnLive').disabled = true;
  try {
    await bio.startLive(cfg.apiKey);
    hud.setMode(true);
    beginCalibration(false);
  } catch (e) {
    $('consentErr').textContent = `Could not start live mode: ${e.message || e}. You can still play in simulation mode.`;
    $('btnLive').disabled = false;
  }
};
$('btnSim').onclick = () => { audio.init(); startSim(); };

function startSim() {
  bio.mode = 'sim'; bio.state.source = 'sim'; hud.setMode(false);
  beginCalibration(true);
}

// ---------------------------------------------------------------- calibration
function beginCalibration(sim) {
  phase = 'calib'; showScreen('calib');
  calib = { sim, t: 0, valid: 0, bpm: 0, br: 0, brN: 0, rm: 0, rmN: 0, n: 0 };
  $('calibText').textContent = sim ? 'Simulation mode: calibrating a synthetic resting rhythm (a few seconds).'
    : 'Sit still, look at the camera and breathe normally for about 20 seconds. HUSH is learning your resting rhythm for the game.';
  $('btnCalibSim').style.display = sim ? 'none' : '';
  if (SMOKE) { calib.sim = true; }
}
function calibTick(dt) {
  const c = calib, s = bio.update(dt);
  c.t += dt;
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
  console.log('[hush] baseline', JSON.stringify(b));
  phase = 'ready';
  if (SMOKE) return startGame();
  showScreen('controls');
}
$('btnCalibSkip').onclick = () => finishCalibration(false);
$('btnCalibSim').onclick = () => { switchToSim(); beginCalibration(true); };
$('btnGo').onclick = () => { canvas.requestPointerLock(); startGame(); };

// ---------------------------------------------------------------- game
function startGame() {
  if (game) { game.world.dispose(); game.player.dispose(); }
  const seed = SMOKE ? 4242 : 1 + Math.floor(Math.random() * 999999);
  const level = generateLevel(seed);
  const world = new World(level, renderer);
  const player = new Player(level, world.camera);
  const creature = new Creature(level, mulberry32(seed ^ 0x9e3779b9));
  game = { level, world, player, creature, hasKey: false, unlocked: false, t: 0, peakBpm: 0, seed, frames: 0, creatureDist: 99 };
  noise.value = 0; noise.impulse = 0;
  player.locked = !!document.pointerLockElement || SMOKE;
  if (SMOKE) { player.keys.add('KeyW'); player.yaw = 1.2; }

  player.onFlashToggle = (on) => { world.flash.visible = on; };
  player.onInteract = () => interact();
  creature.onStep = () => audio.step();
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
  if (player.hidden) { player.leaveHiding(); audio.creak(); return; }
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
  let best = null, bd = 2.1;
  for (const h of level.hides) { const d = Math.hypot(player.x - h.x * T, player.z - h.y * T); if (d < bd) { bd = d; best = h; } }
  if (best) { player.hideIn(best); audio.creak(); hud.msg('Hiding. It can still hear your heart.', 3); }
}

function promptText() {
  const g = game, { player, level } = g, T = level.TILE;
  if (player.hidden) return 'E: leave hiding place';
  if (!g.hasKey && Math.hypot(player.x - level.key.x * T, player.z - level.key.y * T) < 1.7) return 'E: take key';
  const ex = level.exit;
  if (!g.unlocked && Math.hypot(player.x - ex.x * T, player.z - ex.y * T) < 2.6) return g.hasKey ? 'E: unlock door' : 'Locked';
  for (const h of level.hides) if (Math.hypot(player.x - h.x * T, player.z - h.y * T) < 2.1) return 'E: hide';
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

function endGame(win) {
  const g = game;
  phase = 'end'; hud.show(false);
  $('dim').style.opacity = 0; $('hunt').style.opacity = 0; $('hideov').style.opacity = 0;
  document.exitPointerLock();
  $('endTitle').textContent = win ? 'YOU ESCAPED' : 'IT FOUND YOU';
  $('endText').textContent = win ? 'The door shuts behind you. You can hear your own heartbeat again.' : 'It followed the sound.';
  const t = Math.round(g.t);
  const rows = [['Time', `${Math.floor(t / 60)}m ${t % 60}s`], ['Peak pulse (game signal)', g.peakBpm > 0 ? `${Math.round(g.peakBpm)} bpm` : 'n/a'],
    ['Times hunted', g.creature.timesHunted], ['Seed', g.seed], ['Signal source', bio.mode === 'live' ? 'live camera' : 'simulated']];
  $('endStats').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  showScreen('end');
  // privacy: camera off whenever we are not playing
  if (bio.mode === 'live') { resumeLive = true; bio.stopLive(); }
}
$('btnAgain').onclick = () => { canvas.requestPointerLock(); restartCameraThen(() => startGame()); };
$('btnMenu').onclick = () => { resumeLive = false; if (game) { hud.show(false); } phase = 'consent'; showScreen('consent'); $('btnLive').disabled = !(bio.hasSdk && cfg.apiKey); };

async function restartCameraThen(fn) {
  if (resumeLive && bio.mode !== 'live') {
    showScreen('none'); hud.msg('Restarting camera...', 3);
    try { await bio.startLive(cfg.apiKey); hud.setMode(true); }
    catch (e) { switchToSim(); hud.msg('Camera unavailable - simulation mode', 4); }
    resumeLive = false;
  }
  fn();
}

// ---------------------------------------------------------------- pause (Esc / pointer lock lost)
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (game) game.player.locked = locked;
  if (!locked && phase === 'play') pauseGame();
});
function pauseGame() {
  phase = 'paused';
  const wasLive = bio.mode === 'live';
  if (wasLive) { resumeLive = true; bio.stopLive(); }
  $('pauseText').textContent = wasLive ? 'Camera stopped. Nothing is measured while paused. Resume restarts the camera.' : 'Paused.';
  showScreen('pause');
}
$('btnResume').onclick = () => {
  canvas.requestPointerLock();
  restartCameraThen(() => { showScreen('none'); phase = 'play'; hud.setMode(bio.mode === 'live'); });
};
$('btnQuit').onclick = () => { resumeLive = false; hud.show(false); phase = 'consent'; showScreen('consent'); $('btnLive').disabled = !(bio.hasSdk && cfg.apiKey); };

// ---------------------------------------------------------------- input extras
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyB') bio.setSimKey('eyes', true);
  if (e.code === 'KeyT') bio.setSimKey('talk', true);
  if (e.code === 'KeyM' && phase === 'play') {
    if (bio.mode === 'live') { switchToSim(); hud.msg('Simulation mode (B: close eyes, T: whisper)', 3); }
    else if (consentedCamera && cfg.apiKey) {
      hud.msg('Starting camera...', 2);
      bio.startLive(cfg.apiKey).then(() => hud.setMode(true)).catch(() => hud.msg('Camera unavailable', 3));
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
  if (b.bpm > 0 && b.bpm < 220) g.peakBpm = Math.max(g.peakBpm, b.bpm);
  player.update(dt);
  noise.update(dt, b, { moving: player.moving, sprinting: player.sprinting, crouching: player.crouching, flashlight: player.flashlight && !player.hidden, hidden: !!player.hidden });
  creature.update(dt, { px: player.tileX, py: player.tileY, hidden: !!player.hidden, flashlight: player.flashlight, noise });
  world.setCreature(creature.x * T, creature.y * T, creature.heading, creature.speed, dt, creature.state === S.HUNT);
  world.flash.visible = player.flashlight && !player.hidden;
  world.update(dt, performance.now() / 1000);
  audio.setListener(player.x, player.z, player.yaw); audio.setCreaturePos(creature.x * T, creature.y * T);
  audio.heartbeat(b.bpm, noise.value);

  hud.update(dt, b, noise.value);
  hud.hint(bio.mode === 'live' ? (bio.hint || (b.face ? '' : 'no face found')) : '');
  const room = level.rooms.find((r) => px >= r.x0 - 0.5 && px <= r.x1 + 0.5 && py >= r.y0 - 0.5 && py <= r.y1 + 0.5);
  hud.setRoom(room ? room.name : 'doorway'); hud.prompt(promptText());
  $('dim').style.opacity = b.eyesClosed ? 0.88 : 0;
  $('hunt').style.opacity = creature.state === S.HUNT ? 1 : 0;
  $('hideov').style.opacity = player.hidden ? 1 : 0;

  if (g.unlocked && Math.hypot(player.x - level.exit.x * T, player.z - level.exit.y * T) < 0.9) { audio.win(); endGame(true); return; }
  // jump-scare camera snap
  if (creature.state === S.CATCH) { player.yaw = Math.atan2(player.x - creature.x * T, player.z - creature.y * T) + Math.PI; }
  if (SMOKE && g.t > 4 && !g.logged) { g.logged = true;
    console.log(`[smoke] OK frames=${g.frames} noise=${noise.value.toFixed(1)} state=${creature.state} bpm=${b.bpm.toFixed(0)} src=${b.source} player=(${player.tileX.toFixed(1)},${player.tileY.toFixed(1)})`);
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  try {
    if (phase === 'calib') calibTick(dt);
    else if (phase === 'play') playTick(dt);
    else if (phase === 'caught' && game) game.player.update(dt);
    if (game && phase !== 'consent') game.world.render();
  } catch (e) { console.error('[hush] frame error', e && e.stack || e); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
init();
