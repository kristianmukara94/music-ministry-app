'use strict';
const path = require('node:path');
const { app, BrowserWindow, Menu, clipboard, ipcMain } = require('electron');

// The generator is an ES module, and require() cannot load one on this version of Electron.
const keyService = import('./key-service.mjs');

function createWindow() {
  const win = new BrowserWindow({
    width: 440,
    height: 580,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: '#0d1118',
    title: 'APCCMMA Church Admin Key Generator',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The page is one local file, so it has no reason to go anywhere else.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('keys:generate', async (_event, prefix) => (await keyService).handleGenerate(prefix));

// Only a value this app could have produced reaches the clipboard.
ipcMain.handle('clipboard:copy', async (_event, text) => {
  const { validateChurchCode, validateSetupKey } = await keyService;
  if (!validateSetupKey(text) && !validateChurchCode(text)) return false;
  clipboard.writeText(text);
  return true;
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
