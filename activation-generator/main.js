const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { generateActivationCode } = require('./licenseLogic.js');

let mainWindow = null;

const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
const iconPathIco = path.join(__dirname, '..', 'build', 'icon.ico');
const hasIcon = fs.existsSync(iconPathIco) ? iconPathIco : (fs.existsSync(iconPath) ? iconPath : null);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 580,
    icon: hasIcon || undefined,
    minWidth: 400,
    minHeight: 480,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('generate-activation-code', (_, days, ttlHours) => {
  const d = typeof days === 'number' && !Number.isNaN(days) ? Math.max(1, Math.min(3650, Math.floor(days))) : 30;
  const ttl = ttlHours != null && !Number.isNaN(Number(ttlHours)) ? Math.max(0, Math.min(999, Math.floor(ttlHours))) : 48;
  const code = generateActivationCode(d, ttl);
  clipboard.writeText(code);
  return { code };
});

ipcMain.handle('generate-activation-codes-batch', (_, days, ttlHours, count) => {
  const d = typeof days === 'number' && !Number.isNaN(days) ? Math.max(1, Math.min(3650, Math.floor(days))) : 30;
  const ttl = ttlHours != null && !Number.isNaN(Number(ttlHours)) ? Math.max(0, Math.min(999, Math.floor(ttlHours))) : 48;
  const n = Math.max(1, Math.min(100, Math.floor(count) || 1));
  const codes = [];
  for (let i = 0; i < n; i++) {
    codes.push(generateActivationCode(d, ttl));
  }
  const text = codes.join('\n');
  clipboard.writeText(text);
  return { codes, text };
});
