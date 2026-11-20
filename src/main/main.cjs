'use strict';
// HUSH - Electron main process.
// SDK wiring pattern adapted from the official SmartSpectra Electron quickstart
// (see CREDITS.md): bindSmartSpectraIpc, SDK preload, camera-only permission handler, CSP.

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, session, ipcMain } = require('electron');

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
const API_KEY = process.env.PRESAGE_API_KEY || env.PRESAGE_API_KEY || '';

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

function createWindow() {
  const webPreferences = { contextIsolation: true, sandbox: true, nodeIntegration: false };
  try { webPreferences.preload = require.resolve('@smartspectra/node-sdk/preload'); } catch (e) { console.error('[hush] preload resolve failed', e.message); }
  const win = new BrowserWindow({ width: 1280, height: 800, backgroundColor: '#000000', title: 'HUSH', autoHideMenuBar: true, webPreferences });
  if (bindSmartSpectraIpc) {
    try { bindSmartSpectraIpc(win); } catch (e) { sdkLoadError = String(e.message || e); console.error('[hush] bindSmartSpectraIpc failed', sdkLoadError); }
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('console-message', (e) => {
    console.log('[renderer]', e.message);
  });
  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'), SMOKE ? { hash: process.env.HUSH_SMOKE_LIVE === '1' ? 'smoke-live' : 'smoke' } : undefined);
  if (DIAG) win.webContents.openDevTools({ mode: 'detach' });
  if (SMOKE) {
    win.webContents.on('did-finish-load', () => console.log('[hush] smoke: page loaded'));
    if (process.env.HUSH_SHOT) {
      setTimeout(() => win.webContents.capturePage().then((img) => fs.writeFileSync(process.env.HUSH_SHOT, img.toPNG())).catch(() => {}), 9000);
    }
    setTimeout(() => app.quit(), 14000);
  }
}

app.whenReady().then(() => {
  // Our tiny preload exposes the API key + SDK status to the renderer.
  try { session.defaultSession.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'hush-preload.cjs') }); }
  catch (e) { console.error('[hush] registerPreloadScript failed', e.message); }
  ipcMain.handle('hush:config', () => ({ apiKey: API_KEY, sdkError: sdkLoadError }));

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
