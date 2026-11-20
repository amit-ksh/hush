'use strict';
// Tiny extra preload: hands the renderer the API key from main (read from .env).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hushConfig', {
  get: () => ipcRenderer.invoke('hush:config'),
});
