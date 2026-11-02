import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Client, ClientSubscription, Package, Activity } from '../types';
import { 
  isElectronEnvironment, 
  checkBiometricAvailability, 
  captureFingerprint, 
  cancelBiometricCapture, 
  identifyFingerprint,
  BiometricAvailabilityResult,
  getConnectedDisplays,
  openKioskOnDisplay,
  setAppFullScreen,
  DisplayInfo
} from '../services/biometricService';
import { getCandidateFingerprints, logAttendance, getDetailedTodaysAttendance, getClientById } from '../services/storage';
import { audioService } from '../services/audioService';
import { useTheme } from '../context/ThemeContext';

interface BiometricScannerProps {
  clients: Client[];
  subscriptions: ClientSubscription[];
  packages: Package[];
  activities: Activity[];
  onAttendanceLogged: () => void;
  onSwitchToQr: () => void;
  onExitToDashboard?: () => void;
  requireBiometricExitPin?: boolean;
}

type ScanVisualState = 'IDLE' | 'WAITING_FINGER' | 'PROCESSING' | 'GRANTED' | 'WARNING' | 'DENIED' | 'OFFLINE';

export const BiometricScanner: React.FC<BiometricScannerProps> = ({
  clients,
  subscriptions,
  packages,
  activities,
  onAttendanceLogged,
  onSwitchToQr,
  onExitToDashboard,
  requireBiometricExitPin
}) => {
  const { config } = useTheme();
  const isPinRequired = requireBiometricExitPin !== undefined 
    ? requireBiometricExitPin 
    : (config?.require_biometric_exit_pin ?? true);

  const baseDurationSec = [3, 4, 5, 6].includes(Number(config?.scanner_message_duration))
    ? Number(config?.scanner_message_duration)
    : 4;
  const deniedExtraEnabled = config?.scanner_denied_extra_time !== undefined
    ? Boolean(config?.scanner_denied_extra_time)
    : true;
  const allowManualReentry = config?.scanner_allow_manual_reentry !== undefined
    ? Boolean(config?.scanner_allow_manual_reentry)
    : true;

  const [visualState, setVisualState] = useState<ScanVisualState>('IDLE');
  const [readerStatus, setReaderStatus] = useState<BiometricAvailabilityResult>({
    success: false,
    available: false,
    message: 'Comprobando lector biométrico...'
  });

  const [matchedClient, setMatchedClient] = useState<Client | null>(null);
  const [activePlanNames, setActivePlanNames] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('Iniciando estación biométrica...');
  const [subMessage, setSubMessage] = useState<string>('');
  const [warningBadgeText, setWarningBadgeText] = useState<string>('YA ESCANEADO HOY');
  const [canForceReentry, setCanForceReentry] = useState<boolean>(false);
  
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);
  const isScanningRef = useRef(false);
  const cooldownRef = useRef(false);
  const mountedRef = useRef(true);
  const resetTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Countdown bar state
  const [activeCountdownMs, setActiveCountdownMs] = useState<number>(0);
  const [countdownKey, setCountdownKey] = useState<number>(0);

  // Live Aforo and Attendances State
  const [inGymCount, setInGymCount] = useState(0);
  const [totalToday, setTotalToday] = useState(0);
  const [currentTime, setCurrentTime] = useState('');

  // Admin PIN Modal State (PIN: 1234)
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);

  // Dual Monitor State
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [showDisplayModal, setShowDisplayModal] = useState(false);
  const [isOpeningDisplay, setIsOpeningDisplay] = useState(false);

  // Immediate dismiss / Next member handler
  const handleDismissResult = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    cooldownRef.current = false;
    setActiveCountdownMs(0);
    setCanForceReentry(false);
    if (mountedRef.current && visualState !== 'OFFLINE') {
      setVisualState('IDLE');
      setMatchedClient(null);
      setActivePlanNames('');
      setStatusMessage('Lector DigitalPersona listo. Esperando huella...');
      setSubMessage('');
    }
  }, [visualState]);

  // Keyboard shortcut (Space / Escape) to dismiss result immediately
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showPinModal || showDisplayModal) return;
      if (
        (e.key === ' ' || e.key === 'Escape' || e.key === 'Enter') &&
        (visualState === 'GRANTED' || visualState === 'WARNING' || visualState === 'DENIED')
      ) {
        e.preventDefault();
        handleDismissResult();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visualState, showPinModal, showDisplayModal, handleDismissResult]);

  // 1. Enter and maintain Fullscreen automatically
  useEffect(() => {
    setAppFullScreen(true);

    return () => {
      setAppFullScreen(false);
    };
  }, []);

  // 2. Real-time Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // 3. Load Live Aforo & Displays
  const refreshLiveStats = useCallback(async () => {
    try {
      const res = await getDetailedTodaysAttendance(clients);
      setInGymCount(res.inGymCount);
      setTotalToday(res.totalToday);
    } catch (err) {
      console.warn("Aviso actualizando aforo:", err);
    }
  }, [clients]);

  // Manual Re-entry Override Handler for Reception
  const handleManualReentry = useCallback(async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!matchedClient) return;
    try {
      const res = await logAttendance(matchedClient.id, 'HUELLA', { forceReentry: true });
      audioService.playSuccess();
      setCanForceReentry(false);
      setVisualState('GRANTED');
      setStatusMessage(`¡REINGRESO AUTORIZADO: ${matchedClient.firstName.toUpperCase()}!`);
      setSubMessage(
        `${res.visitCountToday}da VISITA DEL DÍA • 1er ingreso hoy: ${res.firstCheckInTime || '--:--'} // [${activePlanNames || 'Membresía Activa'}]`
      );
      onAttendanceLogged();
      refreshLiveStats();
    } catch (err) {
      console.warn('Error en reingreso manual:', err);
    }
  }, [matchedClient, activePlanNames, onAttendanceLogged, refreshLiveStats]);

  useEffect(() => {
    refreshLiveStats();
    const interval = setInterval(refreshLiveStats, 15000);
    return () => clearInterval(interval);
  }, [refreshLiveStats]);

  // Load connected displays
  useEffect(() => {
    getConnectedDisplays().then(d => {
      setDisplays(d);
    });
  }, []);

  // 4. Check reader status
  const refreshReaderStatus = useCallback(async () => {
    if (!isElectronEnvironment()) {
      setVisualState('OFFLINE');
      setReaderStatus({
        success: false,
        available: false,
        message: 'Para usar el lector físico DigitalPersona U.are.U 4500, abra la aplicación en el ejecutable de Windows (Electron).'
      });
      return false;
    }

    try {
      const res = await checkBiometricAvailability();
      setReaderStatus(res);
      if (res.available) {
        setStatusMessage('Lector DigitalPersona listo. Esperando huella...');
        setVisualState('IDLE');
        return true;
      } else {
        setStatusMessage(res.message || 'Lector no detectado');
        setVisualState('OFFLINE');
        return false;
      }
    } catch (err: any) {
      setVisualState('OFFLINE');
      setReaderStatus({
        success: false,
        available: false,
        message: err?.message || 'Error al conectar con lector biométrico'
      });
      return false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refreshReaderStatus();

    return () => {
      mountedRef.current = false;
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      cancelBiometricCapture().catch(() => {});
    };
  }, [refreshReaderStatus]);

  // 5. Main Capture & Identification Loop with Antipassback Control
  const executeScan = useCallback(async () => {
    if (isScanningRef.current || cooldownRef.current || !mountedRef.current) return;
    
    if (!isElectronEnvironment()) {
      setVisualState('OFFLINE');
      return;
    }

    isScanningRef.current = true;
    setActiveCountdownMs(0);
    setVisualState('WAITING_FINGER');
    setStatusMessage('COLOQUE SU DEDO EN EL LECTOR');
    setSubMessage('Sensor óptico DigitalPersona activo...');

    let finalOutcomeState: ScanVisualState = 'IDLE';

    try {
      // 1. Capture fingerprint from optical reader
      const captureResult = await captureFingerprint(10);

      if (!mountedRef.current) return;

      if (!captureResult.success || !captureResult.template) {
        if (captureResult.error === 'TIMED_OUT') {
          finalOutcomeState = 'IDLE';
          setVisualState('IDLE');
          setStatusMessage('Tiempo de espera agotado');
          setSubMessage('Coloque su dedo nuevamente para iniciar.');
        } else if (captureResult.error === 'POOR_QUALITY') {
          audioService.playWarning();
          finalOutcomeState = 'WARNING';
          setVisualState('WARNING');
          setStatusMessage('CALIDAD INSUFICIENTE');
          setSubMessage('Coloque la yema del dedo centrada y firme sobre el cristal.');
        } else {
          finalOutcomeState = 'IDLE';
          setVisualState('IDLE');
          setStatusMessage(captureResult.message || 'Captura no completada');
          setSubMessage('');
        }
        return;
      }

      // 2. Fetch active candidates
      setVisualState('PROCESSING');
      setStatusMessage('VERIFICANDO IDENTIDAD...');
      setSubMessage('Comparando minucias biométricas en base de datos...');

      const candidates = await getCandidateFingerprints();
      if (!mountedRef.current) return;

      if (candidates.length === 0) {
        audioService.playAlarm();
        finalOutcomeState = 'DENIED';
        setVisualState('DENIED');
        setStatusMessage('SIN HUELLAS REGISTRADAS');
        setSubMessage('No hay ningún socio con huella registrada en el sistema.');
        return;
      }

      // 3. Identify using native helper and SDK Comparison
      const identifyResult = await identifyFingerprint(captureResult.template, candidates);
      if (!mountedRef.current) return;

      if (!identifyResult.success || !identifyResult.matched || !identifyResult.clientId) {
        audioService.playAlarm();
        finalOutcomeState = 'DENIED';
        setVisualState('DENIED');
        setMatchedClient(null);
        setActivePlanNames('');
        setStatusMessage('ACCESO DENEGADO');
        setSubMessage('Huella no registrada en el sistema. Favor de registrarse en recepción.');
        return;
      }

      // 4. Client matched! Validate authorization & membership
      let matched = clients.find(c => c.id === identifyResult.clientId);
      if (!matched) {
        try {
          matched = (await getClientById(identifyResult.clientId)) || undefined;
        } catch {}
      }

      if (!matched) {
        audioService.playAlarm();
        finalOutcomeState = 'DENIED';
        setVisualState('DENIED');
        setMatchedClient(null);
        setActivePlanNames('');
        setStatusMessage('ACCESO DENEGADO');
        setSubMessage('Socio no encontrado en registros locales.');
        return;
      }

      setMatchedClient(matched);

      // Verify active subscriptions
      const clientSubs = subscriptions.filter(s => s.client_id === matched.id);
      if (clientSubs.length === 0 && (matched.package_id || matched.activity_id || matched.membershipEnd)) {
        clientSubs.push({
          id: `legacy-${matched.id}`,
          client_id: matched.id,
          package_id: matched.package_id,
          activity_id: matched.activity_id,
          startDate: matched.membershipStart || '',
          endDate: matched.membershipEnd || '',
          amount: matched.cost || 0,
          isActive: matched.isActive
        });
      }

      const todayStr = new Date().toISOString().split('T')[0];
      const activeSubs = clientSubs.filter(s => s.isActive && s.endDate && s.endDate >= todayStr);

      if (!matched.isActive || activeSubs.length === 0) {
        // Expired or inactive: Show photo, name, and clear informative warning
        audioService.playAlarm();
        finalOutcomeState = 'DENIED';
        setVisualState('DENIED');
        setStatusMessage(`ACCESO DENEGADO: ${matched.firstName.toUpperCase()} ${matched.lastNamePaternal ? matched.lastNamePaternal.toUpperCase() : ''}`);
        
        // Find last known subscription / package / activity
        const lastKnownSub = clientSubs.length > 0 
          ? [...clientSubs].sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''))[0] 
          : null;

        const lastPlanName = lastKnownSub 
          ? (packages.find(p => p.id === lastKnownSub.package_id)?.name || activities.find(a => a.id === lastKnownSub.activity_id)?.name || 'Membresía General')
          : (packages.find(p => p.id === matched.package_id)?.name || activities.find(a => a.id === matched.activity_id)?.name || 'Membresía General');

        const lastEndDate = lastKnownSub?.endDate || matched.membershipEnd;

        if (!matched.isActive) {
          setActivePlanNames(`ESTATUS: SOCIO INACTIVO / DADO DE BAJA${lastPlanName ? ` • ÚLTIMO PLAN: ${lastPlanName}` : ''}`);
          setSubMessage('SOCIO INACTIVO EN SISTEMA - CONSULTE EN RECEPCIÓN');
        } else if (lastEndDate) {
          setActivePlanNames(`ÚLTIMO PLAN: ${lastPlanName} (Venció el ${lastEndDate})`);
          setSubMessage('NO SE ENCONTRÓ PAGO ACTUALIZADO - MEMBRESÍA VENCIDA, FAVOR DE PASAR A RECEPCIÓN');
        } else {
          setActivePlanNames('SIN PLAN CONFIGURADO');
          setSubMessage('NO SE ENCONTRÓ PAGO ACTUALIZADO - FAVOR DE PASAR A RECEPCIÓN');
        }
        return;
      }

      // 5. Client valid! Try logging attendance with Daily Rescan / Antipassback validation
      const planNames = activeSubs.map(s => {
        if (s.package_id) return packages.find(p => p.id === s.package_id)?.name || 'Plan';
        if (s.activity_id) return activities.find(a => a.id === s.activity_id)?.name || 'Disciplina';
        return 'Suscripción';
      }).join(', ');
      setActivePlanNames(planNames);

      try {
        const attResult = await logAttendance(matched.id, 'HUELLA');
        audioService.playSuccess();
        finalOutcomeState = 'GRANTED';
        setVisualState('GRANTED');
        setCanForceReentry(false);

        if (attResult.isReentry) {
          setStatusMessage(`¡HOLA DE NUEVO, ${matched.firstName.toUpperCase()}!`);
          setSubMessage(
            `${attResult.visitCountToday}da VISITA DEL DÍA • 1ra entrada hoy: ${attResult.firstCheckInTime || '--:--'} (${attResult.elapsedText || ''}) // [${planNames}]`
          );
        } else {
          setStatusMessage(`¡BIENVENIDO, ${matched.firstName.toUpperCase()}!`);
          setSubMessage(`ACCESO AUTORIZADO • 1ra ENTRADA HOY (${attResult.firstCheckInTime || ''}) // [${planNames}]`);
        }
        onAttendanceLogged();
        refreshLiveStats();
      } catch (logErr: any) {
        if (logErr?.isAntipassback || logErr?.message === 'Ya registrado recientemente') {
          audioService.playWarning();
          finalOutcomeState = 'WARNING';
          setVisualState('WARNING');
          setCanForceReentry(true);

          if (logErr?.reason === 'DAILY_LIMIT') {
            setWarningBadgeText(`YA ESCANEADO HOY (${logErr.firstCheckInTime || '--:--'})`);
            setStatusMessage(`YA REGISTRÓ ASISTENCIA HOY: ${matched.firstName.toUpperCase()}`);
            setSubMessage(
              `1ra entrada registrada hoy a las ${logErr.firstCheckInTime || '--:--'} (${logErr.elapsedText || 'hoy'}) • Plan vigente: [${planNames}]`
            );
          } else if (logErr?.reason === 'WINDOW_2H' || logErr?.reason === 'WINDOW_4H') {
            setWarningBadgeText(`YA ESCANEADO HOY (${logErr.lastCheckInTime || '--:--'})`);
            setStatusMessage(`YA ESCANEADO HOY A LAS ${logErr.lastCheckInTime || '--:--'}`);
            setSubMessage(
              `${matched.firstName.toUpperCase()} registró su entrada ${logErr.elapsedText || 'hoy'} (1ra entrada: ${logErr.firstCheckInTime || '--:--'}). Bloqueo temporal de ${logErr.windowHours || 2} hrs activo.`
            );
          } else {
            setWarningBadgeText(`HACE ${logErr?.minsAgo || 1} MIN`);
            setStatusMessage(`YA ESCANEADO RECIENTEMENTE (${logErr?.lastCheckInTime || 'HACE UN MOMENTO'})`);
            setSubMessage(
              `El socio ${matched.firstName.toUpperCase()} ya registró su asistencia ${logErr?.elapsedText || `hace ${logErr?.minsAgo || 1} minuto(s)`}. Se previene el doble marcaje.`
            );
          }
        } else {
          audioService.playWarning();
          finalOutcomeState = 'WARNING';
          setVisualState('WARNING');
          setCanForceReentry(false);
          setStatusMessage(`ACCESO PERMITIDO: ${matched.firstName.toUpperCase()}`);
          setSubMessage('Asistencia local concedida (error de sincronización remota).');
        }
      }

    } catch (err: any) {
      if (!mountedRef.current) return;
      audioService.playWarning();
      finalOutcomeState = 'IDLE';
      setVisualState('IDLE');
      setStatusMessage('Error en lector biométrico');
      setSubMessage(err?.message || 'Intente nuevamente.');
    } finally {
      isScanningRef.current = false;
      
      // Calculate configured duration (with optional +2s for DENIED)
      const isResultCard = finalOutcomeState === 'GRANTED' || finalOutcomeState === 'WARNING' || finalOutcomeState === 'DENIED';
      const extraSeconds = (finalOutcomeState === 'DENIED' && deniedExtraEnabled) ? 2 : 0;
      const effectiveDurationMs = isResultCard ? (baseDurationSec + extraSeconds) * 1000 : 1200;

      if (isResultCard) {
        setActiveCountdownMs(effectiveDurationMs);
        setCountdownKey(k => k + 1);
      } else {
        setActiveCountdownMs(0);
      }

      cooldownRef.current = true;
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          cooldownRef.current = false;
          setActiveCountdownMs(0);
          if (autoScanEnabled && visualState !== 'OFFLINE') {
            setVisualState('IDLE');
            setMatchedClient(null);
            setActivePlanNames('');
            setStatusMessage('Lector DigitalPersona listo. Esperando huella...');
            setSubMessage('');
          }
        }
      }, effectiveDurationMs);
    }
  }, [clients, subscriptions, packages, activities, onAttendanceLogged, autoScanEnabled, visualState, refreshLiveStats, baseDurationSec, deniedExtraEnabled]);

  // Auto trigger scan when idle and enabled
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (autoScanEnabled && visualState === 'IDLE' && readerStatus.available && !isScanningRef.current && !cooldownRef.current) {
      timeout = setTimeout(() => {
        executeScan();
      }, 700);
    }
    return () => clearTimeout(timeout);
  }, [autoScanEnabled, visualState, readerStatus.available, executeScan]);

  const handleCancel = async () => {
    await cancelBiometricCapture();
    isScanningRef.current = false;
    setVisualState('IDLE');
    setStatusMessage('Operación cancelada');
    setSubMessage('Presione para reiniciar lectura');
  };

  // PIN validation handler (PIN: "1234")
  const handlePinSubmit = () => {
    if (pinInput === '1234') {
      setShowPinModal(false);
      setPinInput('');
      setPinError(false);
      setAppFullScreen(false);
      if (onExitToDashboard) {
        onExitToDashboard();
      }
    } else {
      audioService.playWarning();
      setPinError(true);
      setPinInput('');
      setTimeout(() => setPinError(false), 2000);
    }
  };

  // Keypad click handler for PIN modal
  const handlePinKeyClick = (num: string) => {
    if (pinInput.length < 4) {
      const next = pinInput + num;
      setPinInput(next);
      if (next.length === 4) {
        if (next === '1234') {
          setTimeout(() => {
            setShowPinModal(false);
            setPinInput('');
            setPinError(false);
            setAppFullScreen(false);
            if (onExitToDashboard) onExitToDashboard();
          }, 200);
        } else {
          setTimeout(() => {
            audioService.playWarning();
            setPinError(true);
            setPinInput('');
            setTimeout(() => setPinError(false), 2000);
          }, 200);
        }
      }
    }
  };

  // Dual monitor kiosk launcher
  const handleLaunchSecondaryDisplay = async (displayId?: number) => {
    setIsOpeningDisplay(true);
    try {
      const res = await openKioskOnDisplay(displayId);
      if (res.success) {
        setShowDisplayModal(false);
      }
    } catch (e) {
      console.warn("Error abriendo pantalla secundaria:", e);
    } finally {
      setIsOpeningDisplay(false);
    }
  };

  // Dynamic visual styles
  const getStateColors = () => {
    switch (visualState) {
      case 'GRANTED':
        return {
          border: 'border-emerald-500',
          bg: 'bg-emerald-950/40',
          text: 'text-emerald-400',
          glow: 'shadow-[0_0_100px_rgba(16,185,129,0.35)]',
          badgeBg: 'bg-emerald-500',
          badgeText: 'text-black'
        };
      case 'DENIED':
        return {
          border: 'border-red-600',
          bg: 'bg-red-950/50',
          text: 'text-red-500',
          glow: 'shadow-[0_0_100px_rgba(220,38,38,0.45)]',
          badgeBg: 'bg-red-600',
          badgeText: 'text-white'
        };
      case 'WARNING':
        return {
          border: 'border-amber-500',
          bg: 'bg-amber-950/40',
          text: 'text-amber-400',
          glow: 'shadow-[0_0_80px_rgba(245,158,11,0.35)]',
          badgeBg: 'bg-amber-500',
          badgeText: 'text-black'
        };
      case 'WAITING_FINGER':
        return {
          border: 'border-cyan-500',
          bg: 'bg-cyan-950/30',
          text: 'text-cyan-400',
          glow: 'shadow-[0_0_80px_rgba(6,182,212,0.35)]',
          badgeBg: 'bg-cyan-500',
          badgeText: 'text-black'
        };
      case 'PROCESSING':
        return {
          border: 'border-blue-500',
          bg: 'bg-blue-950/40',
          text: 'text-blue-400',
          glow: 'shadow-[0_0_80px_rgba(59,130,246,0.35)]',
          badgeBg: 'bg-blue-500',
          badgeText: 'text-white'
        };
      case 'OFFLINE':
        return {
          border: 'border-zinc-800',
          bg: 'bg-zinc-950',
          text: 'text-zinc-500',
          glow: 'shadow-none',
          badgeBg: 'bg-zinc-800',
          badgeText: 'text-zinc-400'
        };
      default: // IDLE
        return {
          border: 'border-yellow-500/60',
          bg: 'bg-zinc-950',
          text: 'text-yellow-500',
          glow: 'shadow-[0_0_50px_rgba(234,179,8,0.2)]',
          badgeBg: 'bg-yellow-500/20',
          badgeText: 'text-yellow-400'
        };
    }
  };

  const colors = getStateColors();

  return (
    <div className="fixed inset-0 z-50 bg-black text-zinc-100 w-screen h-screen overflow-hidden flex flex-col justify-between p-4 md:p-6 select-none">
      
      {/* TOP HEADER: BRAND, LIVE AFORO, CLOCK, MULTI-MONITOR & ADMIN PIN BUTTON */}
      <header className="w-full flex items-center justify-between bg-zinc-950/90 border border-zinc-800/80 px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-md">
        
        {/* BRAND & STATUS */}
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-tech font-black text-white tracking-tighter leading-none">
              KALI <span className="text-yellow-500">ACCESS</span>
            </h1>
            <p className="text-[9px] font-mono-tech text-zinc-500 tracking-[0.25em] uppercase mt-0.5">
              ESTACIÓN DE CONTROL BIOMÉTRICO
            </p>
          </div>

          <div className="hidden sm:flex items-center gap-2 border-l border-zinc-800 pl-4">
            <span className={`w-2.5 h-2.5 rounded-full ${readerStatus.available ? 'bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]' : 'bg-red-500'}`} />
            <span className="text-[11px] font-tech font-bold uppercase text-zinc-400">
              {readerStatus.available ? 'SENSOR U.ARE.U 4500 CONECTADO' : 'MODO OFFLINE / SIN HARDWARE'}
            </span>
          </div>
        </div>

        {/* CENTER WIDGET: LIVE AFORO & CLOCK */}
        <div className="flex items-center gap-3">
          
          {/* AFORO EN VIVO BADGE */}
          <div className="bg-zinc-900/90 border border-emerald-500/30 px-3.5 py-1.5 rounded-xl flex items-center gap-2.5 shadow-inner">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              <span className="text-[10px] font-tech font-bold uppercase text-zinc-400 tracking-wider">
                AFORO EN VIVO:
              </span>
            </div>
            <span className="font-mono-tech font-black text-emerald-400 text-sm tracking-tight">
              {inGymCount} EN SALA
            </span>
            <span className="text-[10px] text-zinc-500 font-mono-tech border-l border-zinc-800 pl-2">
              HOY: {totalToday}
            </span>
          </div>

          {/* REALTIME CLOCK */}
          <div className="hidden md:flex bg-black border border-zinc-800 px-3 py-1.5 rounded-xl font-mono-tech font-bold text-xs text-yellow-500 tracking-widest shadow-inner">
            {currentTime || '--:--:--'}
          </div>
        </div>

        {/* RIGHT ACTIONS: DUAL MONITOR & ADMIN PIN EXIT */}
        <div className="flex items-center gap-2">
          
          {/* DUAL MONITOR BUTTON */}
          <button
            onClick={() => setShowDisplayModal(true)}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 rounded-xl text-[11px] font-tech font-bold uppercase transition-all flex items-center gap-1.5"
            title="Configuración de pantallas múltiples"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="hidden sm:inline">2DO MONITOR</span>
            {displays.length > 1 && (
              <span className="px-1.5 py-0.2 bg-cyan-500 text-black text-[9px] font-black rounded-md">
                {displays.length}
              </span>
            )}
          </button>

          {/* SWITCH TO QR */}
          <button
            onClick={onSwitchToQr}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-yellow-400 border border-zinc-800 rounded-xl text-[11px] font-tech font-bold uppercase transition-all flex items-center gap-1.5"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
            <span className="hidden sm:inline">ACCESO QR</span>
          </button>

          {/* ADMIN PIN EXIT OR DIRECT EXIT BUTTON */}
          {isPinRequired ? (
            <button
              onClick={() => {
                setPinInput('');
                setPinError(false);
                setShowPinModal(true);
              }}
              className="px-3.5 py-1.5 bg-red-950/60 hover:bg-red-900 text-red-300 hover:text-white border border-red-800/80 rounded-xl text-[11px] font-tech font-bold uppercase transition-all flex items-center gap-1.5 shadow-lg active:scale-95"
              title="Salir al panel mediante PIN de Administrador (1234)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              SALIR [PIN]
            </button>
          ) : (
            <button
              onClick={() => {
                setAppFullScreen(false);
                if (onExitToDashboard) onExitToDashboard();
              }}
              className="px-3.5 py-1.5 bg-zinc-900 hover:bg-red-900/60 text-zinc-300 hover:text-white border border-zinc-700 hover:border-red-600 rounded-xl text-[11px] font-tech font-bold uppercase transition-all flex items-center gap-1.5 shadow-lg active:scale-95"
              title="Salir al Dashboard (Sin PIN)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              SALIR
            </button>
          )}
        </div>
      </header>

      {/* CENTER TERMINAL SCANNER */}
      <main className="flex-1 flex flex-col items-center justify-center my-4 max-w-4xl mx-auto w-full px-2">
        <motion.div
          animate={{ scale: visualState === 'PROCESSING' ? 1.01 : 1 }}
          className={`w-full bg-zinc-950/95 border-4 ${colors.border} rounded-3xl p-6 md:p-10 flex flex-col items-center justify-center relative overflow-hidden transition-all duration-300 ${colors.glow}`}
        >
          {/* Ambient top light */}
          <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-current to-transparent opacity-75"></div>

          {/* SENSOR / FINGERPRINT ANIMATION */}
          <div className="relative mb-6">
            <div className={`w-36 h-44 rounded-3xl border-2 ${colors.border} ${colors.bg} flex flex-col items-center justify-center relative overflow-hidden transition-all duration-300 shadow-2xl`}>
              
              {/* Laser Scanning Bar */}
              {(visualState === 'WAITING_FINGER' || visualState === 'PROCESSING') && (
                <motion.div 
                  animate={{ y: [0, 140, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-x-0 h-1.5 bg-cyan-400 shadow-[0_0_20px_#22d3ee] top-2 z-10"
                />
              )}

              {/* Fingerprint Vector Graphic */}
              <svg 
                xmlns="http://www.w3.org/2000/svg" 
                className={`h-24 w-24 transition-all duration-300 ${colors.text} ${
                  visualState === 'WAITING_FINGER' ? 'animate-pulse scale-105' : ''
                }`} 
                fill="none" 
                viewBox="0 0 24 24" 
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.4} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m12 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17" />
              </svg>

              <span className="text-[10px] font-mono-tech uppercase font-black tracking-widest mt-2 opacity-90">
                {visualState === 'WAITING_FINGER' ? 'ESPERANDO DEDO' : 
                 visualState === 'PROCESSING' ? 'ANALIZANDO...' :
                 visualState === 'GRANTED' ? 'AUTORIZADO' :
                 visualState === 'WARNING' ? 'ADVERTENCIA' :
                 visualState === 'DENIED' ? 'DENEGADO' :
                 visualState === 'OFFLINE' ? 'SIN HARDWARE' : 'LISTO'}
              </span>
            </div>

            {/* Glowing Pulse Rings */}
            {visualState === 'WAITING_FINGER' && (
              <motion.div 
                animate={{ scale: [1, 1.25, 1], opacity: [0.7, 0, 0.7] }}
                transition={{ duration: 1.8, repeat: Infinity }}
                className="absolute inset-0 rounded-3xl border-2 border-cyan-400 pointer-events-none"
              />
            )}
          </div>

          {/* CLIENT MATCH INFO CARD */}
          <AnimatePresence>
            {matchedClient && (visualState === 'GRANTED' || visualState === 'WARNING' || visualState === 'DENIED') && (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                onClick={handleDismissResult}
                title="Toca para limpiar y pasar al siguiente socio inmediatamente"
                className={`flex items-center gap-4 px-6 py-3.5 rounded-2xl mb-4 shadow-2xl max-w-lg w-full transition-all border cursor-pointer relative overflow-hidden ${
                  visualState === 'DENIED'
                    ? 'bg-red-950/70 border-2 border-red-600 shadow-[0_0_35px_rgba(220,38,38,0.35)]'
                    : 'bg-zinc-900 border border-zinc-700/80'
                }`}
              >
                {matchedClient.photoUrl ? (
                  <img 
                    src={matchedClient.photoUrl} 
                    alt={matchedClient.firstName} 
                    className={`w-16 h-16 rounded-xl object-cover border-2 shadow-md ${
                      visualState === 'DENIED'
                        ? 'border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]'
                        : 'border-yellow-500'
                    }`}
                  />
                ) : (
                  <div className={`w-16 h-16 rounded-xl bg-zinc-800 border-2 flex items-center justify-center text-2xl font-tech font-black ${
                    visualState === 'DENIED'
                      ? 'border-red-500/80 text-red-400'
                      : 'border-yellow-500/50 text-yellow-400'
                  }`}>
                    {matchedClient.firstName.charAt(0)}
                  </div>
                )}
                <div className="text-left flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`text-[10px] font-mono-tech font-bold uppercase tracking-wider ${
                      visualState === 'DENIED' ? 'text-red-400 font-black' : 'text-yellow-400'
                    }`}>
                      {visualState === 'DENIED' ? 'SOCIO IDENTIFICADO' : 'SOCIO REGISTRADO'}
                    </p>
                    {visualState === 'WARNING' && (
                      <span className="text-[9px] font-mono-tech font-black px-2 py-0.5 rounded bg-amber-500 text-black uppercase">
                        {warningBadgeText}
                      </span>
                    )}
                    {visualState === 'DENIED' && (
                      <span className="text-[9px] font-mono-tech font-black px-2.5 py-0.5 rounded bg-red-600 text-white uppercase tracking-wider animate-pulse shadow-md">
                        {!matchedClient.isActive ? 'SOCIO INACTIVO' : 'PAGO PENDIENTE'}
                      </span>
                    )}
                  </div>
                  <h4 className="text-xl font-tech font-black text-white uppercase tracking-tight truncate">
                    {matchedClient.firstName} {matchedClient.lastNamePaternal}
                  </h4>
                  <p className={`text-xs font-mono-tech font-bold ${
                    visualState === 'DENIED' ? 'text-red-300' : 'text-zinc-300'
                  }`}>
                    {activePlanNames || (visualState === 'DENIED' ? 'Sin pago actualizado' : 'Membresía Activa')}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* PRIMARY STATUS BANNER */}
          <h2 className={`text-2xl md:text-4xl font-tech font-black text-center uppercase tracking-tight mb-2 ${colors.text}`}>
            {statusMessage}
          </h2>

          {/* SUB-MESSAGE / EXPLANATION */}
          {subMessage && (
            <div className={`text-sm md:text-base font-mono-tech text-center max-w-xl mb-6 leading-relaxed px-4 py-2.5 rounded-xl font-bold ${
              visualState === 'DENIED' 
                ? 'bg-red-950/80 border border-red-600/70 text-red-200 shadow-[0_0_20px_rgba(220,38,38,0.25)]' 
                : visualState === 'WARNING' 
                  ? 'bg-amber-950/60 border border-amber-500/40 text-amber-300' 
                  : 'text-zinc-400'
            }`}>
              {subMessage}
            </div>
          )}

          {/* ACTION BUTTONS */}
          <div className="flex flex-wrap items-center justify-center gap-3 mt-1">
            {visualState === 'WAITING_FINGER' ? (
              <button
                onClick={handleCancel}
                className="px-6 py-2.5 bg-red-950/60 hover:bg-red-900 text-red-300 hover:text-white border border-red-700 font-tech font-bold uppercase text-xs rounded-xl transition-all active:scale-95 shadow-lg"
              >
                CANCELAR CAPTURA
              </button>
            ) : visualState === 'OFFLINE' ? (
              <button
                onClick={refreshReaderStatus}
                className="px-6 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-yellow-400 border border-zinc-700 font-tech font-bold uppercase text-xs rounded-xl transition-all active:scale-95 shadow-lg flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                RECONECTAR LECTOR
              </button>
            ) : (visualState === 'GRANTED' || visualState === 'WARNING' || visualState === 'DENIED') ? (
              <div className="flex flex-wrap items-center justify-center gap-3">
                {visualState === 'WARNING' && canForceReentry && allowManualReentry && matchedClient && (
                  <button
                    type="button"
                    onClick={handleManualReentry}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-black font-tech font-black uppercase text-xs rounded-xl transition-all active:scale-95 shadow-[0_0_20px_rgba(16,185,129,0.4)] border border-emerald-400 flex items-center gap-2 cursor-pointer"
                  >
                    <span>✓ AUTORIZAR REINGRESO MANUAL</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDismissResult}
                  className="px-6 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white border border-zinc-600 hover:border-yellow-500 font-tech font-bold uppercase text-xs rounded-xl transition-all active:scale-95 shadow-lg flex items-center gap-2 cursor-pointer"
                >
                  <span>⚡ SIGUIENTE SOCIO / LIMPIAR</span>
                  <span className="text-[10px] font-mono-tech text-yellow-400 bg-black/60 px-2 py-0.5 rounded border border-zinc-700">
                    TOCAR / ESPACIO / ESC ({Math.round(activeCountdownMs / 1000)}s)
                  </span>
                </button>
              </div>
            ) : (
              <button
                onClick={executeScan}
                disabled={isScanningRef.current}
                className="px-8 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-tech font-black uppercase text-xs rounded-xl transition-all active:scale-95 shadow-[0_0_30px_rgba(234,179,8,0.4)] border-2 border-yellow-600 flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17" />
                </svg>
                COLOCAR HUELLA
              </button>
            )}
          </div>

          {/* VISUAL COUNTDOWN PROGRESS BAR */}
          {activeCountdownMs > 0 && (visualState === 'GRANTED' || visualState === 'WARNING' || visualState === 'DENIED') && (
            <div className="absolute bottom-0 inset-x-0 h-2 bg-zinc-900 overflow-hidden">
              <motion.div
                key={`bio-countdown-${countdownKey}`}
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: activeCountdownMs / 1000, ease: 'linear' }}
                className={`h-full ${
                  visualState === 'GRANTED'
                    ? 'bg-emerald-400 shadow-[0_0_12px_#34d399]'
                    : visualState === 'WARNING'
                    ? 'bg-amber-400 shadow-[0_0_12px_#fbbf24]'
                    : 'bg-red-500 shadow-[0_0_12px_#ef4444]'
                }`}
              />
            </div>
          )}
        </motion.div>
      </main>

      {/* BOTTOM FOOTER STATUS BAR */}
      <footer className="w-full flex flex-col sm:flex-row items-center justify-between text-[11px] font-mono-tech text-zinc-500 border-t border-zinc-900 pt-3 gap-2">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span> ACCESO PERMITIDO
          </span>
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span> ANTIPASSBACK (5 MIN)
          </span>
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-red-500"></span> MEMBRESÍA VENCIDA
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-zinc-600">
            DIGITALPERSONA SDK // FAR 0.001% CALIBRADO
          </span>
          <button
            onClick={() => setAutoScanEnabled(!autoScanEnabled)}
            className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase ${autoScanEnabled ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40' : 'bg-zinc-900 text-zinc-500'}`}
          >
            AUTO-SCAN: {autoScanEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </footer>

      {/* ========================================================================= */}
      {/* MODAL 1: PIN DE ADMINISTRADOR (1234)                                      */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showPinModal && (
          <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-zinc-950 border-2 border-yellow-500/60 rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-[0_0_60px_rgba(234,179,8,0.3)] relative"
            >
              {/* Close button */}
              <button
                onClick={() => setShowPinModal(false)}
                className="absolute top-4 right-4 text-zinc-500 hover:text-white p-2"
              >
                ✕
              </button>

              <div className="text-center mb-6">
                <div className="w-14 h-14 rounded-2xl bg-yellow-500/10 border-2 border-yellow-500 mx-auto flex items-center justify-center text-yellow-500 mb-3 shadow-[0_0_20px_rgba(234,179,8,0.2)]">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h3 className="text-xl font-tech font-black text-white uppercase tracking-tight">
                  AUTORIZACIÓN ADMIN
                </h3>
                <p className="text-xs font-mono-tech text-zinc-400 mt-1">
                  Ingrese el PIN de seguridad para salir de la estación
                </p>
              </div>

              {/* PIN DIGITS DISPLAY */}
              <div className="flex justify-center gap-3 mb-6">
                {[0, 1, 2, 3].map((idx) => (
                  <div
                    key={idx}
                    className={`w-12 h-14 rounded-xl border-2 flex items-center justify-center text-2xl font-mono-tech font-black transition-all ${
                      pinError 
                        ? 'border-red-500 bg-red-950/40 text-red-400' 
                        : pinInput.length > idx 
                          ? 'border-yellow-500 bg-yellow-500/10 text-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.3)]' 
                          : 'border-zinc-800 bg-zinc-900 text-zinc-600'
                    }`}
                  >
                    {pinInput.length > idx ? '●' : ''}
                  </div>
                ))}
              </div>

              {pinError && (
                <div className="text-center text-xs font-mono-tech font-bold text-red-500 uppercase mb-4 animate-bounce">
                  PIN INCORRECTO. INTENTE DE NUEVO.
                </div>
              )}

              {/* NUMERIC KEYPAD */}
              <div className="grid grid-cols-3 gap-2.5 mb-4">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
                  <button
                    key={k}
                    onClick={() => {
                      if (k === 'C') setPinInput('');
                      else if (k === '⌫') setPinInput(p => p.slice(0, -1));
                      else handlePinKeyClick(k);
                    }}
                    className={`py-3.5 rounded-xl font-tech font-black text-base uppercase transition-all active:scale-95 ${
                      k === 'C' 
                        ? 'bg-zinc-900 text-red-400 hover:bg-zinc-800' 
                        : k === '⌫' 
                          ? 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800' 
                          : 'bg-zinc-900 text-white hover:bg-zinc-800 hover:text-yellow-400 border border-zinc-800'
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>

              <button
                onClick={handlePinSubmit}
                disabled={pinInput.length !== 4}
                className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-black font-tech font-black text-xs uppercase rounded-xl transition-all shadow-lg shadow-yellow-500/20"
              >
                DESBLOQUEAR Y SALIR
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ========================================================================= */}
      {/* MODAL 2: CONFIGURACIÓN DOBLE MONITOR                                      */}
      {/* ========================================================================= */}
      <AnimatePresence>
        {showDisplayModal && (
          <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-zinc-950 border-2 border-cyan-500/50 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-[0_0_60px_rgba(6,182,212,0.3)] relative"
            >
              <button
                onClick={() => setShowDisplayModal(false)}
                className="absolute top-4 right-4 text-zinc-500 hover:text-white p-2"
              >
                ✕
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-cyan-500/10 border border-cyan-500 rounded-xl text-cyan-400">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-tech font-black text-white uppercase tracking-tight">
                    SOPORTE DOBLE MONITOR
                  </h3>
                  <p className="text-xs font-mono-tech text-zinc-400">
                    Proyectar pantalla de huella al monitor del cliente
                  </p>
                </div>
              </div>

              <div className="space-y-3 my-4">
                <p className="text-xs text-zinc-300 font-mono-tech leading-relaxed">
                  Monitores detectados en Windows: <span className="text-cyan-400 font-bold">{displays.length}</span>
                </p>

                {displays.map((disp, idx) => (
                  <div 
                    key={disp.id || idx}
                    className="p-3.5 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-between"
                  >
                    <div>
                      <div className="font-tech font-bold text-white text-xs uppercase flex items-center gap-2">
                        {disp.name}
                        {disp.isPrimary && (
                          <span className="text-[9px] bg-yellow-500 text-black px-1.5 py-0.5 rounded font-black">
                            PRINCIPAL
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono-tech">
                        Resolución: {disp.bounds.width}x{disp.bounds.height}
                      </div>
                    </div>

                    <button
                      onClick={() => handleLaunchSecondaryDisplay(disp.id)}
                      disabled={isOpeningDisplay}
                      className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-black font-tech font-black text-[10px] uppercase rounded-lg transition-all active:scale-95"
                    >
                      {disp.isPrimary ? 'PROYECTAR AQUÍ' : 'PROYECTAR AL 2DO MONITOR'}
                    </button>
                  </div>
                ))}
              </div>

              <div className="bg-zinc-900/60 p-3 rounded-xl border border-zinc-800/80 text-[10px] text-zinc-400 font-mono-tech leading-relaxed mt-4">
                💡 <span className="text-white font-bold">Consejo:</span> Al abrir en el Monitor 2, la pantalla del socio quedará en modo quiosco completo mientras la recepcionista puede continuar operando ventas y cobros en el Monitor 1.
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default BiometricScanner;
