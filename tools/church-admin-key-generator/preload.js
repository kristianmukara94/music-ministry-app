'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('keyGenerator', {
  generate: (prefix) => ipcRenderer.invoke('keys:generate', prefix),
  copy: (text) => ipcRenderer.invoke('clipboard:copy', text),
});
