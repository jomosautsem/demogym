import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Client, ClientSubscription, Package, Activity } from '../types';
import { logAttendance, getDetailedTodaysAttendance } from '../services/storage';
import { audioService } from '../services/audioService';
import { useTheme } from '../context/ThemeContext';

interface QrScannerProps {
  onScanSuccess?: (decodedText: string) => void;
  onScanError?: (errorMessage: string) => void;
  isActive: boolean;
  clients?: Client[];
  subscriptions?: ClientSubscription[];
  packages?: Package[];
  activities?: Activity[];
  onAttendanceLogged?: () => void;
  onSwitchToBiometric?: () => void;
  onExitToDashboard?: () => void;
}

type QrVisualState = 'SCANNING' | 'GRANTED' | 'WARNING' | 'DENIED';

interface CameraDevice {
  id: string;
  label: string;
}

const QrScanner: React.FC<QrScannerProps> = ({
  onScanSuccess,
  isActive,
  clients = [],
  subscriptions = [],
  packages = [],
  activities = [],
  onAttendanceLogged,
  onSwitchToBiometric,
  onExitToDashboard
}) => {
  const { config } = useTheme();
  const baseDurationSec = [3, 4, 5, 6].includes(Number(config?.scanner_message_duration))
    ? Number(config?.scanner_message_duration)
    : 4;
  const deniedExtraEnabled = config?.scanner_denied_extra_time !== undefined
    ? Boolean(config?.scanner_denied_extra_time)
    : true;
  const allowManualReentry = config?.scanner_allow_manual_reentry !== undefined
    ? Boolean(config?.scanner_allow_manual_reentry)
    : true;

  const readerElementId = 'qr-reader-terminal';
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const isRunningRef = useRef<boolean>(false);
  const cooldownRef = useRef<boolean>(false);
  const isProcessingRef = useRef<boolean>(false);
  const lastScannedCodeRef = useRef<string>('');
  const lastScannedTimeRef = useRef<number>(0);
  const resetTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [initError, setInitError] = useState<string | null>(null);
  const [isStartingCamera, setIsStartingCamera] = useState<boolean>(false);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [restartCounter, setRestartCounter] = useState<number>(0);

  // Terminal Visual Result State
  const [visualState, setVisualState] = useState<QrVisualState>('SCANNING');
  const [matchedClient, setMatchedClient] = useState<Client | null>(null);
  const [statusTitle, setStatusTitle] = useState<string>('ESCANEA TU CÓDIGO QR');
  const [statusSubtitle, setStatusSubtitle] = useState<string>('Coloca el código QR de tu credencial o celular frente a la cámara');
  const [planBadgeText, setPlanBadgeText] = useState<string>('');
  const [photoBadgeText, setPhotoBadgeText] = useState<string>('ACCESO AUTORIZADO');
  const [canForceReentry, setCanForceReentry] = useState<boolean>(false);

  // Visual Countdown State
  const [activeCountdownMs, setActiveCountdownMs] = useState<number>(0);
  const [countdownKey, setCountdownKey] = useState<number>(0);

  // Live Aforo & Clock
  const [inGymCount, setInGymCount] = useState<number>(0);
  const [totalToday, setTotalToday] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<string>('');

  // Manual Search Fallback
  const [manualQuery, setManualQuery] = useState<string>('');

  // Immediate dismiss / Next member handler
  const handleDismissResult = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setActiveCountdownMs(0);
    setCanForceReentry(false);
    setVisualState('SCANNING');
    setMatchedClient(null);
    setStatusTitle('ESCANEA TU CÓDIGO QR');
    setStatusSubtitle('Coloca el código QR de tu credencial o celular frente a la cámara');
    setPlanBadgeText('');
    setPhotoBadgeText('ACCESO AUTORIZADO');
    isProcessingRef.current = false;
    cooldownRef.current = false;
    try {
      if (html5QrCodeRef.current && isRunningRef.current) {
        html5QrCodeRef.current.resume();
      }
    } catch {}
  }, []);

  // Keyboard shortcut (Space / Escape) to dismiss result immediately
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (
        (e.key === ' ' || e.key === 'Escape') &&
        (visualState === 'GRANTED' || visualState === 'WARNING' || visualState === 'DENIED')
      ) {
        e.preventDefault();
        handleDismissResult();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visualState, handleDismissResult]);

  // Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('es-MX', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Refresh live stats
  const refreshLiveStats = useCallback(async () => {
    if (!clients || clients.length === 0) return;
    try {
      const res = await getDetailedTodaysAttendance(clients);
      setInGymCount(res.inGymCount);
      setTotalToday(res.totalToday);
    } catch {}
  }, [clients]);

  useEffect(() => {
    refreshLiveStats();
  }, [refreshLiveStats]);

  // Schedule auto-reset after configured seconds
  const scheduleReset = useCallback(
    (outcome: QrVisualState) => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      const extraSec = outcome === 'DENIED' && deniedExtraEnabled ? 2 : 0;
      const durationMs = (baseDurationSec + extraSec) * 1000;

      setActiveCountdownMs(durationMs);
      setCountdownKey((k) => k + 1);

      resetTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          setActiveCountdownMs(0);
          setCanForceReentry(false);
          setVisualState('SCANNING');
          setMatchedClient(null);
          setStatusTitle('ESCANEA TU CÓDIGO QR');
          setStatusSubtitle('Coloca el código QR de tu credencial o celular frente a la cámara');
          setPlanBadgeText('');
          setPhotoBadgeText('ACCESO AUTORIZADO');
          isProcessingRef.current = false;
          cooldownRef.current = false;
          try {
            if (html5QrCodeRef.current && isRunningRef.current) {
              html5QrCodeRef.current.resume();
            }
          } catch {}
        }
      }, durationMs);
    },
    [baseDurationSec, deniedExtraEnabled]
  );

  // Manual Re-entry Override Handler for Reception
  const handleManualReentry = useCallback(
    async (e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      if (!matchedClient) return;
      try {
        const res = await logAttendance(matchedClient.id, 'QR', { forceReentry: true });
        audioService.playSuccess();
        setCanForceReentry(false);
        setVisualState('GRANTED');
        setPhotoBadgeText(`${res.visitCountToday}da VISITA AUTORIZADA`);
        setStatusTitle(`¡REINGRESO AUTORIZADO, ${matchedClient.firstName.toUpperCase()}!`);
        setStatusSubtitle(
          `${res.visitCountToday}da VISITA DEL DÍA • 1ra entrada hoy: ${res.firstCheckInTime || '--:--'}`
        );
        if (onAttendanceLogged) onAttendanceLogged();
        refreshLiveStats();
        scheduleReset('GRANTED');
      } catch (err) {
        console.warn('Error en reingreso manual QR:', err);
      }
    },
    [matchedClient, onAttendanceLogged, refreshLiveStats, scheduleReset]
  );

  // Process a decoded QR or manual client selection
  const processClientCheckIn = useCallback(
    async (scannedTextOrId: string) => {
      if (!scannedTextOrId || !isMountedRef.current) return;
      if (isProcessingRef.current || cooldownRef.current) return;

      const now = Date.now();
      // Si el mismo texto o QR se lee dentro de los últimos 15 segundos, ignorarlo completamente para prevenir doble registro
      if (
        lastScannedCodeRef.current === scannedTextOrId &&
        (now - lastScannedTimeRef.current) < 15000
      ) {
        return;
      }

      isProcessingRef.current = true;
      cooldownRef.current = true;
      lastScannedCodeRef.current = scannedTextOrId;
      lastScannedTimeRef.current = now;

      // Pausar el decodificador de la cámara durante el procesamiento y muestra del resultado
      try {
        if (html5QrCodeRef.current && isRunningRef.current) {
          html5QrCodeRef.current.pause(true);
        }
      } catch {}

      // Extract ID if URL (?portal=ID or /portal/ID)
      let cleanId = scannedTextOrId.trim();
      if (cleanId.includes('portal=')) {
        cleanId = cleanId.split('portal=')[1]?.split('&')[0] || cleanId;
      } else if (cleanId.includes('/portal/')) {
        cleanId = cleanId.split('/portal/')[1]?.split('/')[0]?.split('?')[0] || cleanId;
      }

      // If parent didn't pass clients list, fallback to legacy callback
      if (!clients || clients.length === 0) {
        if (onScanSuccess) onScanSuccess(scannedTextOrId);
        scheduleReset('GRANTED');
        return;
      }

      const client = clients.find(
        (c) =>
          c.id === cleanId ||
          c.id === scannedTextOrId ||
          scannedTextOrId.includes(c.id) ||
          (c.phone && c.phone.replace(/\D/g, '') === cleanId.replace(/\D/g, '') && cleanId.length >= 10)
      );

      if (!client) {
        audioService.playAlarm();
        setMatchedClient(null);
        setVisualState('DENIED');
        setStatusTitle('CÓDIGO QR NO RECONOCIDO');
        setStatusSubtitle('Este código no pertenece a ningún socio registrado en la base de datos.');
        setPlanBadgeText('FAVOR DE PASAR A RECEPCIÓN');
        scheduleReset('DENIED');
        return;
      }

      // Found Client! Evaluate subscriptions
      const clientSubs = subscriptions.filter((s) => s.client_id === client.id);
      if (clientSubs.length === 0 && (client.package_id || client.activity_id || client.membershipEnd)) {
        clientSubs.push({
          id: `legacy-${client.id}`,
          client_id: client.id,
          package_id: client.package_id,
          activity_id: client.activity_id,
          startDate: client.membershipStart || '',
          endDate: client.membershipEnd || '',
          amount: client.cost || 0,
          isActive: client.isActive
        });
      }

      const nowD = new Date();
      const todayStr = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-${String(nowD.getDate()).padStart(2, '0')}`;
      const activeSubs = clientSubs.filter((s) => s.isActive && s.endDate && s.endDate >= todayStr);

      setMatchedClient(client);

      let finalOutcome: QrVisualState = 'GRANTED';

      if (!client.isActive || activeSubs.length === 0) {
        audioService.playAlarm();
        finalOutcome = 'DENIED';
        setVisualState('DENIED');
        setStatusTitle(`ACCESO DENEGADO: ${client.firstName.toUpperCase()}`);

        const sortedSubs = [...clientSubs].sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''));
        const lastKnownSub = sortedSubs[0];
        const lastPlanName = lastKnownSub
          ? packages.find((p) => p.id === lastKnownSub.package_id)?.name ||
            activities.find((a) => a.id === lastKnownSub.activity_id)?.name ||
            'Membresía'
          : packages.find((p) => p.id === client.package_id)?.name ||
            activities.find((a) => a.id === client.activity_id)?.name ||
            'Membresía General';
        const lastEndDate = lastKnownSub?.endDate || client.membershipEnd;

        if (!client.isActive) {
          setPlanBadgeText(`ESTATUS: SOCIO DADO DE BAJA • ÚLTIMO PLAN: ${lastPlanName}`);
          setStatusSubtitle('SOCIO INACTIVO EN SISTEMA - CONSULTE EN RECEPCIÓN');
        } else if (lastEndDate) {
          setPlanBadgeText(`ÚLTIMO PLAN: ${lastPlanName} (Venció el ${lastEndDate})`);
          setStatusSubtitle('NO SE ENCONTRÓ PAGO ACTUALIZADO - FAVOR DE PASAR A RECEPCIÓN');
        } else {
          setPlanBadgeText('SIN PLAN CONFIGURADO');
          setStatusSubtitle('NO SE ENCONTRÓ PAGO ACTUALIZADO - FAVOR DE PASAR A RECEPCIÓN');
        }
      } else {
        // Active membership! Log attendance
        const activeNames = activeSubs
          .map((s) => {
            if (s.package_id) return packages.find((p) => p.id === s.package_id)?.name || 'Plan';
            if (s.activity_id) return activities.find((a) => a.id === s.activity_id)?.name || 'Disciplina';
            return 'Suscripción';
          })
          .join(', ');

        try {
          const attResult = await logAttendance(client.id, 'QR');
          audioService.playSuccess();
          finalOutcome = 'GRANTED';
          setVisualState('GRANTED');
          setCanForceReentry(false);

          if (attResult.isReentry) {
            setPhotoBadgeText(`${attResult.visitCountToday}da VISITA DEL DÍA`);
            setStatusTitle(`¡HOLA DE NUEVO, ${client.firstName.toUpperCase()}!`);
            setStatusSubtitle(
              `${attResult.visitCountToday}da VISITA HOY • 1ra entrada: ${attResult.firstCheckInTime || '--:--'} (${attResult.elapsedText || ''}) • VIGENCIA AL ${activeSubs[0].endDate}`
            );
          } else {
            setPhotoBadgeText('ACCESO AUTORIZADO');
            setStatusTitle(`¡BIENVENIDO, ${client.firstName.toUpperCase()}!`);
            setStatusSubtitle(
              `1ra ENTRADA HOY (${attResult.firstCheckInTime || ''}) // VIGENCIA AL ${activeSubs[0].endDate}`
            );
          }
          setPlanBadgeText(`PLAN ACTIVO: ${activeNames}`);
          if (onAttendanceLogged) onAttendanceLogged();
          refreshLiveStats();
        } catch (err: any) {
          audioService.playWarning();
          finalOutcome = 'WARNING';
          setVisualState('WARNING');
          setCanForceReentry(true);

          if (err?.reason === 'DAILY_LIMIT') {
            setPhotoBadgeText(`YA ESCANEADO HOY (${err.firstCheckInTime || '--:--'})`);
            setStatusTitle(`YA REGISTRÓ ASISTENCIA HOY: ${client.firstName.toUpperCase()}`);
            setStatusSubtitle(
              `1ra entrada registrada hoy a las ${err.firstCheckInTime || '--:--'} (${err.elapsedText || 'hoy'}) • No se duplica asistencia.`
            );
          } else if (err?.reason === 'WINDOW_2H' || err?.reason === 'WINDOW_4H') {
            setPhotoBadgeText(`YA ESCANEADO HOY (${err.lastCheckInTime || '--:--'})`);
            setStatusTitle(`YA ESCANEADO HOY A LAS ${err.lastCheckInTime || '--:--'}`);
            setStatusSubtitle(
              `${client.firstName.toUpperCase()} registró entrada ${err.elapsedText || 'hoy'} (1ra entrada: ${err.firstCheckInTime || '--:--'}). Ventana de ${err.windowHours || 2} hrs activa.`
            );
          } else {
            setPhotoBadgeText(`HACE ${err?.minsAgo || 1} MIN`);
            setStatusTitle(`YA ESCANEADO RECIENTEMENTE: ${client.firstName.toUpperCase()}`);
            setStatusSubtitle(
              `Ya registraste tu entrada ${err?.elapsedText || 'hace menos de 5 minutos'} (${err?.lastCheckInTime || ''}).`
            );
          }
          setPlanBadgeText(`PLAN ACTIVO: ${activeNames} (VENCE ${activeSubs[0].endDate})`);
        }
      }

      scheduleReset(finalOutcome);
    },
    [clients, subscriptions, packages, activities, onScanSuccess, onAttendanceLogged, refreshLiveStats, scheduleReset]
  );

  const processClientCheckInRef = useRef(processClientCheckIn);
  useEffect(() => {
    processClientCheckInRef.current = processClientCheckIn;
  }, [processClientCheckIn]);

  // Stop scanner helper
  const stopCurrentScanner = async () => {
    if (html5QrCodeRef.current) {
      if (isRunningRef.current) {
        isRunningRef.current = false;
        try {
          await html5QrCodeRef.current.stop();
        } catch {}
      }
      try {
        html5QrCodeRef.current.clear();
      } catch {}
      html5QrCodeRef.current = null;
    }
  };

  // Start scanner with non-blocking camera startup (compatible with Android WebView & Desktop)
  useEffect(() => {
    isMountedRef.current = true;

    const startScanner = async () => {
      if (!isActive) return;
      setIsStartingCamera(true);
      setInitError(null);

      await stopCurrentScanner();
      if (!isMountedRef.current) return;

      const html5QrCode = new Html5Qrcode(readerElementId);
      html5QrCodeRef.current = html5QrCode;

      const qrConfig = {
        fps: 12,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
      };

      const onDecoded = (decodedText: string) => {
        if (isMountedRef.current && processClientCheckInRef.current) {
          processClientCheckInRef.current(decodedText);
        }
      };

      // Build ordered list of camera constraints: start directly with facingMode first on mobile/Android
      // so Html5Qrcode.getCameras() does not lock or hang the Android camera HAL.
      const candidatesToTry: Array<string | MediaTrackConstraints> = [];
      if (selectedCameraId) {
        candidatesToTry.push(selectedCameraId);
      }
      candidatesToTry.push({ facingMode: 'environment' });
      candidatesToTry.push({ facingMode: 'user' });

      let started = false;
      for (const candidate of candidatesToTry) {
        if (!isMountedRef.current) break;
        try {
          await html5QrCode.start(candidate, qrConfig, onDecoded, () => {});
          started = true;
          break;
        } catch (tryErr) {
          console.warn('Intento de cámara QR con constraint fallido, probando siguiente...', tryErr);
        }
      }

      // If facingMode constraints didn't start, fallback to explicit camera enumeration
      if (!started && isMountedRef.current) {
        try {
          const rawCams = await Html5Qrcode.getCameras();
          if (rawCams && rawCams.length > 0) {
            const backCam = rawCams.find((c) => /back|trasera|environment|rear/i.test(c.label));
            const fallbackId = backCam ? backCam.id : rawCams[0].id;
            await html5QrCode.start(fallbackId, qrConfig, onDecoded, () => {});
            started = true;
          }
        } catch (enumErr) {
          console.warn('Fallback por ID de cámara fallido:', enumErr);
        }
      }

      if (isMountedRef.current) {
        setIsStartingCamera(false);
        if (started) {
          isRunningRef.current = true;
          setInitError(null);
          // Populate camera selector non-blockingly using standard mediaDevices
          if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
            navigator.mediaDevices
              .enumerateDevices()
              .then((devices) => {
                if (!isMountedRef.current) return;
                const videoInputs = devices
                  .filter((d) => d.kind === 'videoinput' && d.deviceId)
                  .map((d, idx) => ({
                    id: d.deviceId,
                    label: d.label || `Cámara ${idx + 1}`
                  }));
                if (videoInputs.length > 0) {
                  setCameras(videoInputs);
                }
              })
              .catch(() => {});
          }
        } else {
          isRunningRef.current = false;
          setInitError(
            'No se pudo acceder a la cámara. Verifica que ninguna otra aplicación esté ocupando la cámara y que la app tenga permisos de Cámara.'
          );
        }
      } else if (started) {
        await html5QrCode.stop().catch(() => {});
      }
    };

    const timer = setTimeout(() => {
      startScanner();
    }, 200);

    return () => {
      clearTimeout(timer);
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      isMountedRef.current = false;
      stopCurrentScanner();
    };
  }, [isActive, selectedCameraId, restartCounter]);

  // Switch to next camera
  const handleSwitchCamera = () => {
    if (cameras.length <= 1) {
      setRestartCounter((c) => c + 1);
      return;
    }
    const currentIdx = cameras.findIndex((c) => c.id === selectedCameraId);
    const nextIdx = (currentIdx + 1) % cameras.length;
    setSelectedCameraId(cameras[nextIdx].id);
  };

  // Filtered manual search suggestions
  const manualMatches = useMemo(() => {
    const q = manualQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return clients
      .filter((c) => {
        const full = `${c.firstName} ${c.lastNamePaternal} ${c.lastNameMaternal || ''}`.toLowerCase();
        const phone = (c.phone || '').replace(/\D/g, '');
        return full.includes(q) || phone.includes(q);
      })
      .slice(0, 5);
  }, [manualQuery, clients]);

  const borderColors =
    visualState === 'GRANTED'
      ? 'border-emerald-500 shadow-[0_0_50px_rgba(16,185,129,0.35)]'
      : visualState === 'WARNING'
      ? 'border-amber-500 shadow-[0_0_50px_rgba(245,158,11,0.35)]'
      : visualState === 'DENIED'
      ? 'border-red-600 shadow-[0_0_60px_rgba(220,38,38,0.45)]'
      : 'border-zinc-800 shadow-2xl';

  return (
    <div className="w-full h-full flex flex-col justify-between bg-black text-white p-2 md:p-4 select-none overflow-y-auto">
      {/* TOP BAR: STATUS, CAMERA SELECTOR, SWITCH TO FINGERPRINT */}
      <header className="w-full flex flex-wrap items-center justify-between gap-3 bg-zinc-950/90 border border-zinc-800 px-4 py-3 rounded-2xl mb-4">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg md:text-xl font-tech font-black text-white tracking-tighter leading-none">
              KALI <span className="text-yellow-500">ACCESS</span>
            </h1>
            <p className="text-[9px] font-mono-tech text-zinc-400 tracking-[0.2em] uppercase mt-0.5">
              TERMINAL DE ESCANEO QR
            </p>
          </div>

          <div className="hidden sm:flex items-center gap-2 border-l border-zinc-800 pl-3">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                !initError && !isStartingCamera
                  ? 'bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]'
                  : isStartingCamera
                  ? 'bg-yellow-500 animate-ping'
                  : 'bg-red-500'
              }`}
            />
            <span className="text-[10px] font-tech font-bold uppercase text-zinc-400">
              {isStartingCamera ? 'INICIANDO CÁMARA...' : !initError ? 'LECTOR ÓPTICO ACTIVO' : 'CÁMARA EN ESPERA'}
            </span>
          </div>
        </div>

        {/* LIVE AFORO & CLOCK */}
        <div className="hidden lg:flex items-center gap-2.5">
          <div className="bg-zinc-900 border border-emerald-500/30 px-3 py-1.5 rounded-xl flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-[10px] font-tech font-bold uppercase text-zinc-400">AFORO:</span>
            <span className="font-mono-tech font-black text-emerald-400 text-xs">{inGymCount} EN SALA</span>
            <span className="text-[10px] text-zinc-500 font-mono-tech border-l border-zinc-800 pl-2">
              HOY: {totalToday}
            </span>
          </div>

          <div className="bg-black border border-zinc-800 px-3 py-1.5 rounded-xl font-mono-tech font-bold text-xs text-yellow-500">
            {currentTime || '--:--:--'}
          </div>
        </div>

        {/* CAMERA CONTROLS & SWITCH TO BIOMETRIC */}
        <div className="flex flex-wrap items-center gap-2">
          {cameras.length > 1 && (
            <select
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
              className="bg-zinc-900 text-zinc-200 border border-zinc-700 rounded-xl px-2.5 py-1.5 text-[10px] font-tech uppercase outline-none focus:border-yellow-500 max-w-[160px]"
            >
              <option value="">CÁMARA AUTOMÁTICA</option>
              {cameras.map((cam) => (
                <option key={cam.id} value={cam.id}>
                  {cam.label}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={handleSwitchCamera}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 rounded-xl text-[10px] font-tech font-bold uppercase flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
            title="Cambiar o reiniciar cámara"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{cameras.length > 1 ? 'CAMBIAR CÁMARA' : 'REINICIAR CÁMARA'}</span>
          </button>

          {onSwitchToBiometric && (
            <button
              type="button"
              onClick={onSwitchToBiometric}
              className="px-3.5 py-1.5 bg-yellow-500 hover:bg-yellow-400 text-black font-tech font-bold text-[10px] uppercase rounded-xl flex items-center gap-1.5 border border-yellow-600 shadow-lg transition-all active:scale-95 cursor-pointer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m12 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17" />
              </svg>
              <span>LECTOR DE HUELLA</span>
            </button>
          )}

          {onExitToDashboard && (
            <button
              type="button"
              onClick={onExitToDashboard}
              className="px-3 py-1.5 bg-zinc-900 hover:bg-red-950/60 text-zinc-400 hover:text-red-300 border border-zinc-800 rounded-xl text-[10px] font-tech font-bold uppercase transition-all cursor-pointer"
            >
              SALIR
            </button>
          )}
        </div>
      </header>

      {/* MAIN SCANNER & RESULT TERMINAL */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center max-w-6xl mx-auto w-full my-auto">
        {/* LEFT COLUMN: LIVE CAMERA VIEWPORT */}
        <div className="lg:col-span-6 flex flex-col items-center">
          <div className={`relative w-full max-w-md aspect-square bg-zinc-950 rounded-3xl border-4 ${borderColors} overflow-hidden flex items-center justify-center transition-all duration-300`}>
            <div id={readerElementId} className="w-full h-full object-cover [&_video]:w-full [&_video]:h-full [&_video]:object-cover" />

            {/* Loading Camera Indicator */}
            {isStartingCamera && !initError && (
              <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center z-20 p-6 text-center">
                <div className="w-12 h-12 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="font-tech font-bold text-sm text-yellow-500 uppercase tracking-widest">
                  CONECTANDO CÁMARA ÓPTICA...
                </p>
              </div>
            )}

            {/* Friendly Error with Instant Retry */}
            {initError && isActive && (
              <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center text-center p-6 z-30">
                <div className="w-14 h-14 rounded-2xl bg-red-950/60 border border-red-700 flex items-center justify-center mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <p className="text-white font-tech font-bold text-sm uppercase mb-1">CÁMARA NO DISPONIBLE</p>
                <p className="text-zinc-400 font-mono-tech text-xs mb-5 max-w-xs">{initError}</p>
                <button
                  type="button"
                  onClick={() => setRestartCounter((c) => c + 1)}
                  className="bg-yellow-500 hover:bg-yellow-400 text-black px-5 py-2.5 rounded-xl text-xs font-tech font-bold uppercase shadow-lg transition-all active:scale-95 cursor-pointer"
                >
                  REINTENTAR CONEXIÓN DE CÁMARA
                </button>
              </div>
            )}

            {/* Cyber Targeting Frame */}
            {!initError && !isStartingCamera && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <div className="relative w-[240px] h-[240px]">
                  <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-yellow-400 rounded-tl-lg" />
                  <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-yellow-400 rounded-tr-lg" />
                  <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-yellow-400 rounded-bl-lg" />
                  <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-yellow-400 rounded-br-lg" />

                  {isActive && visualState === 'SCANNING' && (
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-yellow-400 to-transparent opacity-90 shadow-[0_0_12px_#fbbf24] animate-[scan_2s_linear_infinite]" />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: SOCIO IDENTIFICATION CARD & MANUAL CHECK-IN */}
        <div className="lg:col-span-6 flex flex-col gap-4">
          <div
            onClick={visualState !== 'SCANNING' ? handleDismissResult : undefined}
            title={visualState !== 'SCANNING' ? 'Toca para limpiar y escanear al siguiente socio' : undefined}
            className={`w-full bg-zinc-950/95 border-2 rounded-3xl p-6 flex flex-col items-center text-center transition-all duration-300 relative overflow-hidden ${
              visualState !== 'SCANNING' ? 'cursor-pointer' : ''
            } ${
              visualState === 'GRANTED'
                ? 'border-emerald-500 bg-emerald-950/15'
                : visualState === 'WARNING'
                ? 'border-amber-500 bg-amber-950/15'
                : visualState === 'DENIED'
                ? 'border-red-600 bg-red-950/20'
                : 'border-zinc-800'
            }`}
          >
            {/* Socio Photo or QR Icon */}
            {matchedClient ? (
              <div className="relative mb-4">
                <div
                  className={`w-28 h-28 md:w-32 md:h-32 rounded-2xl overflow-hidden border-4 shadow-2xl ${
                    visualState === 'GRANTED'
                      ? 'border-emerald-400'
                      : visualState === 'WARNING'
                      ? 'border-amber-400'
                      : 'border-red-500'
                  }`}
                >
                  {matchedClient.photoUrl ? (
                    <img
                      src={matchedClient.photoUrl}
                      alt={matchedClient.firstName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-zinc-900 flex items-center justify-center font-tech font-black text-4xl text-yellow-500">
                      {matchedClient.firstName.charAt(0)}
                    </div>
                  )}
                </div>
                <span
                  className={`absolute -bottom-2 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[9px] font-tech font-black uppercase tracking-wider whitespace-nowrap border ${
                    visualState === 'GRANTED'
                      ? 'bg-emerald-500 text-black border-emerald-300'
                      : visualState === 'WARNING'
                      ? 'bg-amber-500 text-black border-amber-300'
                      : 'bg-red-600 text-white border-red-400'
                  }`}
                >
                  {visualState === 'GRANTED'
                    ? photoBadgeText
                    : visualState === 'WARNING'
                    ? photoBadgeText
                    : 'ACCESO DENEGADO / PAGO PENDIENTE'}
                </span>
              </div>
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4 text-yellow-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
              </div>
            )}

            {/* Full Name if matched */}
            {matchedClient && (
              <p className="text-xs font-mono-tech text-zinc-300 uppercase tracking-widest mb-1">
                {matchedClient.firstName} {matchedClient.lastNamePaternal} {matchedClient.lastNameMaternal || ''}
              </p>
            )}

            {/* Status Title */}
            <h2
              className={`text-xl md:text-2xl font-tech font-black uppercase tracking-tight ${
                visualState === 'GRANTED'
                  ? 'text-emerald-400'
                  : visualState === 'WARNING'
                  ? 'text-amber-400'
                  : visualState === 'DENIED'
                  ? 'text-red-500'
                  : 'text-white'
              }`}
            >
              {statusTitle}
            </h2>

            <p className="text-xs font-mono-tech text-zinc-400 mt-1.5 max-w-md">{statusSubtitle}</p>

            {planBadgeText && (
              <div
                className={`mt-4 px-4 py-2 rounded-xl border text-xs font-mono-tech font-bold uppercase ${
                  visualState === 'GRANTED'
                    ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300'
                    : visualState === 'WARNING'
                    ? 'bg-amber-950/60 border-amber-700 text-amber-300'
                    : 'bg-red-950/60 border-red-800 text-red-300'
                }`}
              >
                {planBadgeText}
              </div>
            )}

            {/* Instant Dismiss / Next Socio & Manual Reentry Buttons */}
            {visualState !== 'SCANNING' && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                {visualState === 'WARNING' && canForceReentry && allowManualReentry && matchedClient && (
                  <button
                    type="button"
                    onClick={handleManualReentry}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-black font-tech font-black text-[10px] uppercase rounded-xl flex items-center gap-1.5 border border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all active:scale-95 cursor-pointer"
                  >
                    <span>✓ AUTORIZAR REINGRESO MANUAL</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDismissResult();
                  }}
                  className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white border border-zinc-700 hover:border-yellow-500 rounded-xl text-[10px] font-tech font-bold uppercase flex items-center gap-2 transition-all active:scale-95 cursor-pointer"
                >
                  <span>⚡ SIGUIENTE SOCIO / LIMPIAR</span>
                  <span className="font-mono-tech text-yellow-400 bg-black/70 px-1.5 py-0.5 rounded border border-zinc-700">
                    TOCAR / ESPACIO / ESC ({Math.round(activeCountdownMs / 1000)}s)
                  </span>
                </button>
              </div>
            )}

            {/* Visual Countdown Progress Bar */}
            {activeCountdownMs > 0 && visualState !== 'SCANNING' && (
              <div className="absolute bottom-0 inset-x-0 h-2 bg-zinc-900 overflow-hidden">
                <motion.div
                  key={`qr-countdown-${countdownKey}`}
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
          </div>

          {/* MANUAL CHECK-IN FALLBACK (FOR DAMAGED OR LOW-BRIGHTNESS SCREENS) */}
          <div className="bg-zinc-950/90 border border-zinc-800 rounded-2xl p-4">
            <label className="block text-[10px] font-tech font-bold uppercase text-yellow-500 tracking-wider mb-2">
              ¿PANTALLA ROTA O SIN BRILLO? REGISTRO MANUAL POR NOMBRE O TELÉFONO:
            </label>
            <div className="relative">
              <input
                type="text"
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                placeholder="Escribe nombre o teléfono del socio..."
                className="w-full bg-black border border-zinc-700 focus:border-yellow-500 rounded-xl px-4 py-2.5 text-xs text-white font-mono-tech outline-none"
              />
              {manualQuery && (
                <button
                  type="button"
                  onClick={() => setManualQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            {manualMatches.length > 0 && (
              <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                {manualMatches.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 px-3 py-2 rounded-xl transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-black border border-zinc-700 overflow-hidden shrink-0 flex items-center justify-center">
                        {c.photoUrl ? (
                          <img src={c.photoUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[10px] font-bold text-yellow-500">{c.firstName.charAt(0)}</span>
                        )}
                      </div>
                      <div className="truncate">
                        <p className="text-xs font-tech font-bold text-white uppercase truncate">
                          {c.firstName} {c.lastNamePaternal}
                        </p>
                        <p className="text-[10px] font-mono-tech text-zinc-400">{c.phone || 'S/N'}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setManualQuery('');
                        processClientCheckIn(c.id);
                      }}
                      className="bg-yellow-500 hover:bg-yellow-400 text-black font-tech font-bold text-[10px] uppercase px-3 py-1.5 rounded-lg shrink-0 cursor-pointer"
                    >
                      VALIDAR ACCESO
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QrScanner;