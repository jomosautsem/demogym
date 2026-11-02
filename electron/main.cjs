const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow = null;
let kioskWindow = null;
let currentCaptureProcess = null;

// Resolve helper path across dev and packaged modes
function getHelperPath() {
  const isDev = !app.isPackaged;
  const candidates = [
    // 1. Packaged resources path
    path.join(process.resourcesPath || '', 'native', 'KaliAccessBiometric.exe'),
    // 2. Dev path after dotnet publish
    path.join(__dirname, '../native/KaliAccessBiometric/bin/Release/net8.0-windows/win-x64/publish/KaliAccessBiometric.exe'),
    // 3. Alternative local build path
    path.join(__dirname, '../native/KaliAccessBiometric/bin/Debug/net8.0-windows/win-x64/publish/KaliAccessBiometric.exe'),
    // 4. In app directory
    path.join(app.getAppPath(), 'native', 'KaliAccessBiometric.exe')
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  // Return primary production / dev candidate as default
  return isDev ? candidates[1] : candidates[0];
}

// Robust loader: prioritizes compiled dist files for 100% offline reliability,
// or connects to local Vite dev server if running, with clear UI fallback if unbuilt.
function loadContent(win, hash = '') {
  const distPath = path.join(__dirname, '../dist/index.html');
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  // Toggle DevTools with F12
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      win.webContents.toggleDevTools();
    }
  });

  // 1. If explicit dev URL is provided via env var, use it
  if (devServerUrl) {
    const fullUrl = hash ? `${devServerUrl}#${hash}` : devServerUrl;
    win.loadURL(fullUrl).catch(() => {
      if (fs.existsSync(distPath)) {
        win.loadFile(distPath, hash ? { hash } : {});
      }
    });
    return;
  }

  // 2. If dist/index.html exists, load it directly (instant, reliable, no port collisions)
  if (fs.existsSync(distPath)) {
    win.loadFile(distPath, hash ? { hash } : {}).catch((err) => {
      console.error('Error loading dist/index.html:', err);
    });
    return;
  }

  // 3. Fallback: Try live Vite dev server on port 3000, then 5173
  const target3000 = hash ? `http://localhost:3000#${hash}` : 'http://localhost:3000';
  win.loadURL(target3000).catch(() => {
    const target5173 = hash ? `http://localhost:5173#${hash}` : 'http://localhost:5173';
    win.loadURL(target5173).catch(() => {
      // Friendly message explaining how to build instead of a black screen
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Kali Access</title>
          <style>
            body { background: #000; color: #eab308; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px; box-sizing: border-box; }
            h2 { font-size: 26px; font-weight: 900; letter-spacing: -0.5px; color: #fff; margin-bottom: 6px; }
            h2 span { color: #eab308; }
            p { font-size: 14px; color: #a1a1aa; max-width: 460px; line-height: 1.5; margin: 6px 0; }
            code { background: #18181b; border: 1px solid #3f3f46; color: #facc15; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-family: monospace; display: inline-block; margin: 10px 0; }
            .btn { background: #eab308; color: #000; font-weight: 800; border: none; padding: 12px 24px; border-radius: 10px; cursor: pointer; margin-top: 14px; text-transform: uppercase; font-size: 12px; letter-spacing: 1px; }
            .btn:hover { background: #facc15; }
          </style>
        </head>
        <body>
          <h2>KALI <span>ACCESS</span></h2>
          <p>Para cargar la aplicación por primera vez en esta computadora, genera la compilación ejecutando en tu terminal:</p>
          <code>npm run build</code>
          <p style="font-size: 12px; color: #71717a;">O inicia el servidor con <code>npm run dev</code> en otra ventana.</p>
          <button class="btn" onclick="location.reload()">REINTENTAR CARGA</button>
        </body>
        </html>
      `)}`);
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#000000',
    title: 'Kali Access - Control de Acceso y Gestión Deportiva',
    icon: path.join(__dirname, '../public/favicon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  mainWindow.setMenuBarVisibility(false);

  loadContent(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (currentCaptureProcess) {
      try { currentCaptureProcess.kill(); } catch (e) { }
      currentCaptureProcess = null;
    }
  });
}

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Setup secure validated IPC handlers
function setupIpcHandlers() {
  // Check if running inside Electron
  ipcMain.handle('biometric:is-electron', () => {
    return true;
  });

  // Check physical biometric reader availability
  ipcMain.handle('biometric:is-available', async () => {
    const helperPath = getHelperPath();
    if (!fs.existsSync(helperPath)) {
      return {
        success: false,
        available: false,
        error: 'HELPER_NOT_FOUND',
        message: 'El ejecutable biométrico nativo no se encuentra instalado en la ruta configurada.'
      };
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn(helperPath, ['check'], {
        windowsHide: true,
        shell: false
      });

      const timer = setTimeout(() => {
        try { proc.kill(); } catch (e) { }
        resolve({
          success: false,
          available: false,
          error: 'TIMEOUT',
          message: 'Tiempo de espera agotado al consultar lector biométrico.'
        });
      }, 5000);

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(parsed);
        } catch (e) {
          resolve({
            success: false,
            available: false,
            error: 'PARSE_ERROR',
            message: stdout || stderr || 'Respuesta no válida del lector biométrico.'
          });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          available: false,
          error: 'SPAWN_ERROR',
          message: err.message
        });
      });
    });
  });

  // Capture fingerprint
  ipcMain.handle('biometric:capture', async (event, options = {}) => {
    if (currentCaptureProcess) {
      return {
        success: false,
        error: 'ALREADY_CAPTURING',
        message: 'Ya hay una captura en progreso. Por favor espere o cancele la actual.'
      };
    }

    const helperPath = getHelperPath();
    if (!fs.existsSync(helperPath)) {
      return {
        success: false,
        error: 'HELPER_NOT_FOUND',
        message: 'No se encontró el controlador biométrico nativo.'
      };
    }

    const timeoutSec = Math.max(3, Math.min(60, Number(options.timeout) || 15));

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      currentCaptureProcess = spawn(helperPath, ['capture', '--timeout', String(timeoutSec)], {
        windowsHide: true,
        shell: false
      });

      const safetyTimer = setTimeout(() => {
        if (currentCaptureProcess) {
          try { currentCaptureProcess.kill(); } catch (e) { }
          currentCaptureProcess = null;
          resolve({
            success: false,
            error: 'TIMED_OUT',
            message: 'Tiempo límite de captura agotado.'
          });
        }
      }, (timeoutSec + 2) * 1000);

      currentCaptureProcess.stdout.on('data', (d) => { stdout += d.toString(); });
      currentCaptureProcess.stderr.on('data', (d) => { stderr += d.toString(); });

      currentCaptureProcess.on('close', (code) => {
        clearTimeout(safetyTimer);
        currentCaptureProcess = null;
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(parsed);
        } catch (e) {
          // Check for Windows 0xC0000005 (STATUS_ACCESS_VIOLATION in signed/unsigned)
          if (code === -1073741819 || code === 3221225477 || (stderr && stderr.includes('0xC0000005'))) {
            resolve({
              success: false,
              error: 'HARDWARE_RECOVERED',
              message: 'El controlador USB del lector DigitalPersona se ha reiniciado. Por favor coloque el dedo firmemente sobre el sensor.'
            });
            return;
          }
          resolve({
            success: false,
            error: 'CAPTURE_FAILED',
            message: stdout || stderr || 'Error en la respuesta del lector biométrico.'
          });
        }
      });

      currentCaptureProcess.on('error', (err) => {
        clearTimeout(safetyTimer);
        currentCaptureProcess = null;
        resolve({
          success: false,
          error: 'PROCESS_ERROR',
          message: err.message
        });
      });
    });
  });

  // Cancel current capture
  ipcMain.handle('biometric:cancel-capture', async () => {
    if (currentCaptureProcess) {
      try {
        currentCaptureProcess.kill();
        currentCaptureProcess = null;
        // 250ms cooldown to allow Windows USB stack to recycle endpoint
        await new Promise(r => setTimeout(r, 250));
        return { success: true, message: 'Captura cancelada.' };
      } catch (err) {
        return { success: false, message: err.message };
      }
    }
    return { success: true, message: 'No había captura activa.' };
  });

  // Identify captured fingerprint against candidate templates
  ipcMain.handle('biometric:identify', async (event, payload) => {
    if (!payload || !payload.sample || !Array.isArray(payload.candidates)) {
      return {
        success: false,
        matched: false,
        error: 'INVALID_ARGUMENTS',
        message: 'Argumentos requeridos: sample (string) y candidates (array).'
      };
    }

    const helperPath = getHelperPath();
    if (!fs.existsSync(helperPath)) {
      return {
        success: false,
        matched: false,
        error: 'HELPER_NOT_FOUND',
        message: 'Helper biométrico no encontrado.'
      };
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn(helperPath, ['identify'], {
        windowsHide: true,
        shell: false
      });

      const timer = setTimeout(() => {
        try { proc.kill(); } catch (e) { }
        resolve({
          success: false,
          matched: false,
          error: 'TIMEOUT',
          message: 'Tiempo de comparación excedido.'
        });
      }, 10000);

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(parsed);
        } catch (e) {
          resolve({
            success: false,
            matched: false,
            error: 'PARSE_ERROR',
            message: stdout || stderr || 'Error en la respuesta del comparador biométrico.'
          });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          matched: false,
          error: 'PROCESS_ERROR',
          message: err.message
        });
      });

      // Write payload into stdin and close stream
      try {
        const jsonStr = JSON.stringify({
          sample: payload.sample,
          candidates: payload.candidates,
          threshold: payload.threshold || 21474
        });
        proc.stdin.write(jsonStr, 'utf8');
        proc.stdin.end();
      } catch (writeErr) {
        try { proc.kill(); } catch (e) { }
        clearTimeout(timer);
        resolve({
          success: false,
          matched: false,
          error: 'WRITE_ERROR',
          message: writeErr.message
        });
      }
    });
  });

  // Verify 1:1 fingerprint
  ipcMain.handle('biometric:verify', async (event, payload) => {
    if (!payload || !payload.sample || !payload.target) {
      return {
        success: false,
        matched: false,
        error: 'INVALID_ARGUMENTS'
      };
    }

    const helperPath = getHelperPath();
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn(helperPath, ['verify'], {
        windowsHide: true,
        shell: false
      });

      const timer = setTimeout(() => {
        try { proc.kill(); } catch (e) { }
        resolve({ success: false, matched: false, error: 'TIMEOUT' });
      }, 5000);

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch {
          resolve({ success: false, matched: false, error: 'PARSE_ERROR' });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({ success: false, matched: false, error: err.message });
      });

      proc.stdin.write(JSON.stringify(payload), 'utf8');
      proc.stdin.end();
    });
  });

  // Display & Multi-Monitor Support
  ipcMain.handle('display:get-displays', () => {
    try {
      const allDisplays = screen.getAllDisplays();
      const primaryId = screen.getPrimaryDisplay().id;
      return allDisplays.map((d, index) => ({
        id: d.id,
        name: `Pantalla ${index + 1}${d.id === primaryId ? ' (Principal)' : ' (Secundaria)'}`,
        isPrimary: d.id === primaryId,
        bounds: d.bounds
      }));
    } catch (e) {
      return [{ id: 1, name: 'Pantalla 1 (Principal)', isPrimary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }];
    }
  });

  // Open kiosk biometric window on chosen display (e.g. secondary monitor)
  ipcMain.handle('display:open-kiosk', (event, { displayId } = {}) => {
    try {
      if (kioskWindow) {
        kioskWindow.focus();
        return { success: true, message: 'Ventana de kiosco ya se encuentra activa.' };
      }

      const allDisplays = screen.getAllDisplays();
      const primaryId = screen.getPrimaryDisplay().id;
      let targetDisplay = null;

      if (displayId) {
        targetDisplay = allDisplays.find(d => d.id === displayId);
      }
      if (!targetDisplay) {
        // Default to secondary display if present, else primary
        const secondary = allDisplays.find(d => d.id !== primaryId);
        targetDisplay = secondary || screen.getPrimaryDisplay();
      }

      kioskWindow = new BrowserWindow({
        x: targetDisplay.bounds.x,
        y: targetDisplay.bounds.y,
        width: targetDisplay.bounds.width,
        height: targetDisplay.bounds.height,
        fullscreen: true,
        kiosk: true,
        backgroundColor: '#000000',
        title: 'Kali Access - Estación de Huella Biométrica',
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          webSecurity: true
        }
      });

      kioskWindow.setMenuBarVisibility(false);

      loadContent(kioskWindow, 'kiosk-biometric');

      kioskWindow.on('closed', () => {
        kioskWindow = null;
      });

      return { success: true, display: targetDisplay.bounds };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Close kiosk window
  ipcMain.handle('display:close-kiosk', () => {
    if (kioskWindow) {
      try { kioskWindow.close(); } catch (e) {}
      kioskWindow = null;
    }
    return { success: true };
  });

  // Window FullScreen Control
  ipcMain.handle('window:set-fullscreen', (event, flag) => {
    if (mainWindow) {
      mainWindow.setFullScreen(!!flag);
    }
    return true;
  });

  ipcMain.handle('window:is-fullscreen', () => {
    return mainWindow ? mainWindow.isFullScreen() : false;
  });
}

