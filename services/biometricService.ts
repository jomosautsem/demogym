// Biometric service bridging React with Electron's native helper API

export interface BiometricReaderInfo {
  name: string;
  serial: string;
  modality: string;
  technology: string;
  id: string;
  vendor?: string;
  product?: string;
}

export interface BiometricAvailabilityResult {
  success: boolean;
  available: boolean;
  count?: number;
  readers?: BiometricReaderInfo[];
  message: string;
  error?: string;
}

export interface BiometricCaptureResult {
  success: boolean;
  template?: string; // Base64 encoded XML string (ANSI INCITS 378-2004 format)
  quality?: string;
  format?: string;
  message?: string;
  error?: string;
}

export interface BiometricCandidate {
  id: string;
  name: string;
  template: string;
}

export interface BiometricIdentifyResult {
  success: boolean;
  matched: boolean;
  clientId?: string;
  clientName?: string;
  score?: number;
  threshold?: number;
  candidatesEvaluated?: number;
  message?: string;
  error?: string;
}

export interface DisplayInfo {
  id: number;
  name: string;
  isPrimary: boolean;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// Window declaration for TypeScript
declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      biometric: {
        isAvailable: () => Promise<BiometricAvailabilityResult>;
        capture: (options?: { timeout?: number }) => Promise<BiometricCaptureResult>;
        cancelCapture: () => Promise<{ success: boolean; message?: string }>;
        identify: (sample: string, candidates: BiometricCandidate[], threshold?: number) => Promise<BiometricIdentifyResult>;
        verify: (sample: string, target: string, threshold?: number) => Promise<any>;
      };
      display?: {
        getDisplays: () => Promise<DisplayInfo[]>;
        openKiosk: (options?: { displayId?: number }) => Promise<{ success: boolean; message?: string }>;
        closeKiosk: () => Promise<{ success: boolean }>;
      };
      window?: {
        setFullScreen: (flag: boolean) => Promise<boolean>;
        isFullScreen: () => Promise<boolean>;
      };
    };
  }
}


export const isElectronEnvironment = (): boolean => {
  return typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron;
};

export const checkBiometricAvailability = async (): Promise<BiometricAvailabilityResult> => {
  if (!isElectronEnvironment()) {
    return {
      success: false,
      available: false,
      message: 'El lector biométrico físico DigitalPersona U.are.U 4500 requiere la versión de escritorio de Windows (Electron).'
    };
  }

  try {
    return await window.electronAPI!.biometric.isAvailable();
  } catch (err: any) {
    return {
      success: false,
      available: false,
      message: `Error comunicando con el controlador biométrico: ${err?.message || err}`
    };
  }
};

export const captureFingerprint = async (timeoutSeconds = 15): Promise<BiometricCaptureResult> => {
  if (!isElectronEnvironment()) {
    return {
      success: false,
      error: 'NOT_DESKTOP',
      message: 'Esta función requiere la aplicación de escritorio instalada en Windows.'
    };
  }

  try {
    return await window.electronAPI!.biometric.capture({ timeout: timeoutSeconds });
  } catch (err: any) {
    return {
      success: false,
      error: 'CAPTURE_INVOCATION_ERROR',
      message: err?.message || 'Error al invocar captura biométrica'
    };
  }
};

export const cancelBiometricCapture = async (): Promise<void> => {
  if (isElectronEnvironment()) {
    try {
      await window.electronAPI!.biometric.cancelCapture();
    } catch {
      // Ignore cancel error
    }
  }
};

export const identifyFingerprint = async (
  sampleTemplate: string,
  candidates: BiometricCandidate[]
): Promise<BiometricIdentifyResult> => {
  if (!isElectronEnvironment()) {
    return {
      success: false,
      matched: false,
      error: 'NOT_DESKTOP',
      message: 'Comparación biométrica nativa no disponible en navegador web.'
    };
  }

  try {
    return await window.electronAPI!.biometric.identify(sampleTemplate, candidates, 21474);
  } catch (err: any) {
    return {
      success: false,
      matched: false,
      error: 'IDENTIFY_FAILED',
      message: err?.message || 'Error en proceso de identificación biométrica.'
    };
  }
};

// --- MULTI-MONITOR / DISPLAY HELPERS ---

export const getConnectedDisplays = async (): Promise<DisplayInfo[]> => {
  if (isElectronEnvironment() && window.electronAPI?.display?.getDisplays) {
    try {
      return await window.electronAPI.display.getDisplays();
    } catch {
      // Fallback
    }
  }

  // Fallback for web browser
  return [
    {
      id: 1,
      name: 'Monitor Principal',
      isPrimary: true,
      bounds: {
        x: 0,
        y: 0,
        width: typeof window !== 'undefined' ? window.screen.width : 1920,
        height: typeof window !== 'undefined' ? window.screen.height : 1080
      }
    }
  ];
};

export const openKioskOnDisplay = async (displayId?: number): Promise<{ success: boolean; message?: string }> => {
  if (isElectronEnvironment() && window.electronAPI?.display?.openKiosk) {
    try {
      return await window.electronAPI.display.openKiosk({ displayId });
    } catch (err: any) {
      return { success: false, message: err?.message };
    }
  }

  // Web fallback: Open pop-up window in full size with hash
  if (typeof window !== 'undefined') {
    const w = window.open(
      `${window.location.origin}${window.location.pathname}#kiosk-biometric`,
      'KaliKioskWindow',
      'fullscreen=yes,width=1280,height=800,menubar=no,toolbar=no,location=no,status=no'
    );
    if (w) {
      return { success: true, message: 'Ventana de kiosco abierta en navegador.' };
    }
  }

  return { success: false, message: 'No se pudo abrir la ventana secundaria.' };
};

export const closeKioskWindow = async (): Promise<void> => {
  if (isElectronEnvironment() && window.electronAPI?.display?.closeKiosk) {
    try {
      await window.electronAPI.display.closeKiosk();
    } catch {
      // Ignore
    }
  }
};

// Fullscreen toggle helpers
export const setAppFullScreen = async (flag: boolean): Promise<boolean> => {
  if (isElectronEnvironment() && window.electronAPI?.window?.setFullScreen) {
    try {
      return await window.electronAPI.window.setFullScreen(flag);
    } catch {
      // Fall through to DOM fallback
    }
  }

  // Web DOM API fallback
  if (typeof document !== 'undefined') {
    try {
      if (flag) {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
          return true;
        }
      } else {
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen();
          return true;
        }
      }
    } catch {
      // Ignore full screen permissions error in iframe or unsupported browsers
    }
  }

  return false;
};

