const { contextBridge, ipcRenderer } = require('electron');

// Expose safe, explicit, minimal API to renderer without exposing Node internals or ipcRenderer
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  biometric: {
    isAvailable: () => ipcRenderer.invoke('biometric:is-available'),
    capture: (options) => ipcRenderer.invoke('biometric:capture', options),
    cancelCapture: () => ipcRenderer.invoke('biometric:cancel-capture'),
    identify: (sample, candidates, threshold) => ipcRenderer.invoke('biometric:identify', { sample, candidates, threshold }),
    verify: (sample, target, threshold) => ipcRenderer.invoke('biometric:verify', { sample, target, threshold })
  },
  display: {
    getDisplays: () => ipcRenderer.invoke('display:get-displays'),
    openKiosk: (options) => ipcRenderer.invoke('display:open-kiosk', options),
    closeKiosk: () => ipcRenderer.invoke('display:close-kiosk')
  },
  window: {
    setFullScreen: (flag) => ipcRenderer.invoke('window:set-fullscreen', flag),
    isFullScreen: () => ipcRenderer.invoke('window:is-fullscreen')
  }
});

