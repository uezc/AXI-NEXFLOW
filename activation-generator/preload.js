const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  generateActivationCode: (days, ttlHours) => ipcRenderer.invoke('generate-activation-code', days, ttlHours),
  generateActivationCodesBatch: (days, ttlHours, count) => ipcRenderer.invoke('generate-activation-codes-batch', days, ttlHours, count),
});
