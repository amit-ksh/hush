'use strict';
// Tiny extra preload: hands the renderer the API key from main (read from .env).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hushConfig', {
  get: () => ipcRenderer.invoke('hush:config'),
});
// Narrow key API. getKeyStatus returns only the source and a masked hint.
contextBridge.exposeInMainWorld('hushKeys', {
  setKey: (key, remember) => ipcRenderer.invoke('hush:key-set', String(key), !!remember),
  clearKey: () => ipcRenderer.invoke('hush:key-clear'),
  getKeyStatus: () => ipcRenderer.invoke('hush:key-status'),
  getSdkKey: () => ipcRenderer.invoke('hush:key-for-sdk'),
  openRegister: () => ipcRenderer.invoke('hush:open-register'),
});
