'use strict';
// HUSH - Electron main process.
// SDK wiring pattern adapted from the official SmartSpectra Electron quickstart
// (see CREDITS.md): bindSmartSpectraIpc, SDK preload, camera-only permission handler, CSP.

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, session, ipcMain, safeStorage, shell } = require('electron');
const keys = require('./keylogic.cjs');

const ROOT = path.join(__dirname, '..', '..');

// Packaged builds must point the native binding at the unpacked runtime (same as the sample).
if (app.isPackaged && !process.env.SMARTSPECTRA_CAPI_PATH) {
  const LIB = { darwin: 'libsmartspectra_capi.dylib', win32: 'smartspectra_capi.dll', linux: 'libsmartspectra_capi.so' }[process.platform];
  if (LIB) process.env.SMARTSPECTRA_CAPI_PATH = path.join(process.resourcesPath, 'smartspectra', LIB);
}

// Minimal .env parser (no dependency). Only PRESAGE_API_KEY is used. The key is never logged.
function loadEnv() {
  const env = {};
  try {
    const txt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch { /* no .env: simulation mode only */ }
  return env;
}
const env = loadEnv();
const ENV_KEY = process.env.HUSH_CAPTURE ? '' : (process.env.PRESAGE_API_KEY || env.PRESAGE_API_KEY || '');

// API key sources, in precedence order: entered this session, saved (encrypted with the OS keystore via
// safeStorage, only if the player opted in), then PRESAGE_API_KEY from .env. The key is never logged.
let sessionKey = '';
let savedKey = '';
let encAvail = false;   // set at startup from safeStorage.isAsyncEncryptionAvailable()
const keyFile = () => path.join(app.getPath('userData'), 'hush-key.bin');
async function loadSavedKey() {
  savedKey = '';
  if (CAPTURE) return;
  try {
    if (!encAvail || !fs.existsSync(keyFile())) return;
    savedKey = (await safeStorage.decryptStringAsync(fs.readFileSync(keyFile()))).result;
  } catch { savedKey = ''; }
}
function keyStatus() {
  const r = keys.resolveKey({ session: sessionKey, saved: savedKey, env: ENV_KEY });
  return { source: r.source, hint: keys.maskKey(r.key), text: keys.statusLine(r.source), encryptionAvailable: encAvail, hasSaved: !!savedKey };
}

let bindSmartSpectraIpc = null;
let sdkLoadError = null;
try {
  ({ bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main'));
} catch (e) {
  sdkLoadError = String(e && e.message || e);
  console.error('[hush] SmartSpectra SDK failed to load, live mode disabled:', sdkLoadError);
}

const DIAG = process.env.SMARTSPECTRA_DIAGNOSTICS === '1';
const SMOKE = process.env.HUSH_SMOKE === '1';
// HUSH_CAPTURE=<dir>: screenshot mode (simulation only, no key): the renderer announces shots, main saves them as PNGs.
const CAPTURE_DIR = process.env.HUSH_CAPTURE || '';
const CAPTURE = !!CAPTURE_DIR;
let smokeDone = false;
let smokeLeak = false;
if (SMOKE || CAPTURE) { // keep rendering even if the desktop is locked/occluded
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}

function createWindow() {
  const webPreferences = { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: !(SMOKE || CAPTURE) };
  try { webPreferences.preload = require.resolve('@smartspectra/node-sdk/preload'); } catch (e) { console.error('[hush] preload resolve failed', e.message); }
  const win = new BrowserWindow({ width: CAPTURE ? Number(process.env.HUSH_CAPTURE_W) || 1280 : 1280, height: CAPTURE ? Number(process.env.HUSH_CAPTURE_H) || 720 : 800, useContentSize: true, backgroundColor: '#000000', title: 'HUSH', autoHideMenuBar: true, webPreferences });
  if (bindSmartSpectraIpc) {
    try { bindSmartSpectraIpc(win); } catch (e) { sdkLoadError = String(e.message || e); console.error('[hush] bindSmartSpectraIpc failed', sdkLoadError); }
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('console-message', (e) => {
    if (SMOKE && sessionKey && e.message.includes(sessionKey)) { smokeLeak = true; console.log('[renderer] <message suppressed: contained the key>'); return; }
    const cm = /^\[capture\] (\S+)/.exec(e.message);
    if (CAPTURE && cm) {
      if (cm[1] === 'done') { setTimeout(() => app.exit(0), 300); return; }
      setTimeout(() => win.webContents.capturePage().then((img) => { fs.mkdirSync(CAPTURE_DIR, { recursive: true }); fs.writeFileSync(path.join(CAPTURE_DIR, cm[1] + '.png'), img.toPNG()); console.log('[hush] captured ' + cm[1] + ' ' + img.getSize().width + 'x' + img.getSize().height); }).catch((err) => console.log('[hush] capture failed', err.message)), 250);
      return;
    }
    console.log('[renderer]', e.message);
    if (SMOKE && e.message.includes('[smoke] RESULT')) { process.exitCode = e.message.includes('RESULT PASS') && !smokeLeak ? 0 : 1; console.log('[hush] smoke: raw key leaked into console output = ' + smokeLeak); smokeDone = true; setTimeout(() => app.exit(process.exitCode || 0), 500); }
  });
  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'), SMOKE ? { hash: process.env.HUSH_SMOKE_LIVE === '1' ? 'smoke-live' : 'smoke' } : CAPTURE ? { hash: 'capture' } : undefined);
  if (DIAG) win.webContents.openDevTools({ mode: 'detach' });
  if (CAPTURE) setTimeout(() => { console.log('[hush] capture timed out'); app.exit(1); }, 150000);
  if (SMOKE) {
    win.webContents.on('did-finish-load', () => console.log('[hush] smoke: page loaded'));
    if (process.env.HUSH_SHOT) {
      setTimeout(() => win.webContents.capturePage().then((img) => fs.writeFileSync(process.env.HUSH_SHOT, img.toPNG())).catch(() => {}), 9000);
    }
    setTimeout(() => { if (!smokeDone) { console.log('[hush] smoke: timed out without RESULT'); process.exitCode = 1; } app.exit(process.exitCode || 0); }, 60000);
  }
}

app.whenReady().then(async () => {
  try { encAvail = await safeStorage.isAsyncEncryptionAvailable(); } catch { encAvail = false; }
  // Our tiny preload exposes the API key + SDK status to the renderer.
  try { session.defaultSession.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'hush-preload.cjs') }); }
  catch (e) { console.error('[hush] registerPreloadScript failed', e.message); }
  await loadSavedKey();
  if (SMOKE) { // verify the encrypted-storage primitives work here (dummy value, nothing written)
    try { console.log('[hush] smoke: safeStorage available=' + encAvail + ' roundtrip=' + (encAvail ? (await safeStorage.decryptStringAsync(await safeStorage.encryptStringAsync('dummy-value-123'))).result === 'dummy-value-123' : 'n/a')); } catch (e) { console.log('[hush] smoke: safeStorage roundtrip failed'); }
  }
  ipcMain.handle('hush:config', () => ({ sdkError: sdkLoadError }));
  ipcMain.handle('hush:key-status', () => keyStatus());
  // The full key only travels main -> renderer SDK (as in the SmartSpectra sample); it is never logged.
  ipcMain.handle('hush:key-for-sdk', () => keys.resolveKey({ session: sessionKey, saved: savedKey, env: ENV_KEY }).key);
  ipcMain.handle('hush:key-set', async (_e, key, remember) => {
    const v = keys.validateKey(key);
    if (!v.ok) return { ok: false, message: v.reason, ...keyStatus() };
    sessionKey = v.key;
    let message = '';
    if (remember) {
      if (encAvail) {
        try { fs.writeFileSync(keyFile(), await safeStorage.encryptStringAsync(v.key)); savedKey = v.key; message = 'Key saved (encrypted) on this device.'; }
        catch { message = 'Could not save the key; it will be used for this session only.'; }
      } else message = 'Secure storage is not available on this system, so the key is used for this session only.';
    }
    return { ok: true, message, ...keyStatus() };
  });
  ipcMain.handle('hush:key-clear', () => {
    sessionKey = ''; savedKey = '';
    try { fs.rmSync(keyFile(), { force: true }); } catch { /* ignore */ }
    return { ok: true, message: 'Saved key cleared.', ...keyStatus() };
  });
  ipcMain.handle('hush:open-register', () => { if (keys.isAllowedExternal(keys.REGISTER_URL)) shell.openExternal(keys.REGISTER_URL); });

  // Camera only, local page only.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && details.requestingUrl) || (wc && wc.getURL()) || '';
    const types = (details && details.mediaTypes) || [];
    // camera (SDK) or microphone (opt-in level meter), one kind per request, local page only
    callback(permission === 'media' && types.length === 1 && (types[0] === 'video' || types[0] === 'audio') && url.startsWith('file://'));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'media');

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
