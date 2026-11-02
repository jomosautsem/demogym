
import React, { useState, useRef, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { updateSystemConfig } from '../services/storage';
import { useToast } from '../context/ToastContext';
import { ScannerRescanRule } from '../types';
import { audioService, AudioAlarmType } from '../services/audioService';
import { 
    generateAndDownloadBackup, 
    validateBackupFile, 
    restoreBackup, 
    exportClientsToCsv, 
    SystemBackupPayload 
} from '../services/backupService';

const DURATION_OPTIONS = [
    {
        seconds: 3,
        title: '3 SEGUNDOS',
        badge: 'FLUJO RÁPIDO',
        desc: 'Ideal para horas pico con fila continua de socios en recepción.'
    },
    {
        seconds: 4,
        title: '4 SEGUNDOS',
        badge: 'ESTÁNDAR (POR DEFECTO)',
        desc: 'Equilibrio óptimo entre velocidad de paso y lectura de vigencia.'
    },
    {
        seconds: 5,
        title: '5 SEGUNDOS',
        badge: 'LECTURA CÓMODA',
        desc: 'Tiempo amplio para visualizar foto, nombre y fecha de vencimiento.'
    },
    {
        seconds: 6,
        title: '6 SEGUNDOS',
        badge: 'LECTURA EXTENDIDA',
        desc: 'Revisión detallada en recepción para validar planes y avisos.'
    }
];

const RESCAN_RULE_OPTIONS: Array<{
    value: ScannerRescanRule;
    title: string;
    badge: string;
    desc: string;
    example: string;
}> = [
    {
        value: 'ONCE_PER_DAY',
        title: '1 ENTRADA POR DÍA (TODO EL DÍA)',
        badge: 'RECOMENDADO • CONTROL ESTRICTO',
        desc: 'Si el socio ya escaneó hoy (desde las 00:00 hrs), al volver a escanear horas después no duplica asistencia y muestra alerta amarilla con la hora de su 1ra entrada.',
        example: 'Alerta: "YA REGISTRÓ ASISTENCIA HOY • 1ra entrada: 08:30 AM (hace 4 hrs)"'
    },
    {
        value: 'ALLOW_WITH_BADGE',
        title: 'PERMITIR 2DA VISITA CON AVISO',
        badge: 'DOBLE SESIÓN / VARIAS CLASES',
        desc: 'Ideal para socios que entrenan en la mañana y regresan en la tarde. Les autoriza el acceso pero avisa en pantalla que es su 2da visita del día.',
        example: 'Verde: "¡HOLA DE NUEVO! • 2da VISITA DEL DÍA (1er ingreso hoy: 08:30 AM)"'
    },
    {
        value: 'WINDOW_2H',
        title: 'VENTANA DE 2 HORAS',
        badge: 'BLOQUEO DE 2 HRS',
        desc: 'Si vuelve a escanear dentro de las siguientes 2 horas, avisa que ya fue escaneado hoy. Pasadas las 2 horas, permite un nuevo ingreso.',
        example: 'Alerta durante 2 hrs: "YA ESCANEADO HOY A LAS 08:30 AM (Ventana de 2 hrs)"'
    },
    {
        value: 'WINDOW_4H',
        title: 'VENTANA DE 4 HORAS',
        badge: 'BLOQUEO DE 4 HRS',
        desc: 'Si vuelve a escanear dentro de las siguientes 4 horas, avisa que ya fue escaneado hoy. Pasadas las 4 horas (ej. mañana y noche), permite reingreso.',
        example: 'Alerta durante 4 hrs: "YA ESCANEADO HOY A LAS 08:30 AM (Ventana de 4 hrs)"'
    },
    {
        value: 'WINDOW_5M',
        title: 'SOLO ANTI-REBOTE (5 MINUTOS)',
        badge: 'MODO BÁSICO DE PUERTA',
        desc: 'Solo bloquea escaneos repetidos dentro de los primeros 5 minutos para evitar lecturas dobles accidentales frente al lector.',
        example: 'Alerta durante 5 min: "Ya registraste tu entrada hace menos de 5 minutos"'
    }
];

const SUPABASE_SQL_SNIPPET = `-- Ejecutar en el SQL Editor de Supabase para sincronizar en todos los dispositivos:
ALTER TABLE public.system_config 
ADD COLUMN IF NOT EXISTS require_biometric_exit_pin BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS scanner_message_duration INTEGER DEFAULT 4,
ADD COLUMN IF NOT EXISTS scanner_denied_extra_time BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS scanner_rescan_rule TEXT DEFAULT 'ONCE_PER_DAY',
ADD COLUMN IF NOT EXISTS scanner_allow_manual_reentry BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS audio_granted_url TEXT,
ADD COLUMN IF NOT EXISTS audio_warning_url TEXT,
ADD COLUMN IF NOT EXISTS audio_denied_url TEXT,
ADD COLUMN IF NOT EXISTS audio_volume INTEGER DEFAULT 80,
ADD COLUMN IF NOT EXISTS audio_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS audio_granted_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS audio_warning_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS audio_denied_enabled BOOLEAN DEFAULT true;

-- Recargar caché del esquema de Supabase API:
NOTIFY pgrst, 'reload schema';`;

const SystemConfigPanel: React.FC = () => {
    const { config, refreshConfig } = useTheme();
    const { showToast } = useToast();
    
    const [orgName, setOrgName] = useState(config.org_name);
    const [primaryColor, setPrimaryColor] = useState(config.primary_color);
    
    // Rules Content
    const [rulesContent, setRulesContent] = useState(config.rules_content || '');
    
    // Biometric exit PIN toggle
    const [requireBiometricExitPin, setRequireBiometricExitPin] = useState(
        config.require_biometric_exit_pin !== undefined ? config.require_biometric_exit_pin : true
    );

    // Scanner message duration (3, 4, 5, 6 seconds) & extra time for Denied
    const [scannerMessageDuration, setScannerMessageDuration] = useState<number>(
        [3, 4, 5, 6].includes(Number(config.scanner_message_duration)) ? Number(config.scanner_message_duration) : 4
    );
    const [scannerDeniedExtraTime, setScannerDeniedExtraTime] = useState<boolean>(
        config.scanner_denied_extra_time !== undefined ? config.scanner_denied_extra_time : true
    );
    const [scannerRescanRule, setScannerRescanRule] = useState<ScannerRescanRule>(
        config.scanner_rescan_rule || 'ONCE_PER_DAY'
    );
    const [scannerAllowManualReentry, setScannerAllowManualReentry] = useState<boolean>(
        config.scanner_allow_manual_reentry !== undefined ? config.scanner_allow_manual_reentry : true
    );
    const [showSqlModal, setShowSqlModal] = useState(false);

    // --- CONFIGURACIÓN DE AUDIO Y ALARMAS (HÍBRIDO NUBE + CACHÉ OFFLINE) ---
    const [audioVolume, setAudioVolume] = useState<number>(
        config.audio_volume !== undefined ? Number(config.audio_volume) : 80
    );
    const [audioEnabled, setAudioEnabled] = useState<boolean>(
        config.audio_enabled !== undefined ? config.audio_enabled : true
    );
    const [audioGrantedEnabled, setAudioGrantedEnabled] = useState<boolean>(
        config.audio_granted_enabled !== undefined ? config.audio_granted_enabled : true
    );
    const [audioWarningEnabled, setAudioWarningEnabled] = useState<boolean>(
        config.audio_warning_enabled !== undefined ? config.audio_warning_enabled : true
    );
    const [audioDeniedEnabled, setAudioDeniedEnabled] = useState<boolean>(
        config.audio_denied_enabled !== undefined ? config.audio_denied_enabled : true
    );

    const [audioGrantedUrl, setAudioGrantedUrl] = useState<string | null>(config.audio_granted_url || null);
    const [audioWarningUrl, setAudioWarningUrl] = useState<string | null>(config.audio_warning_url || null);
    const [audioDeniedUrl, setAudioDeniedUrl] = useState<string | null>(config.audio_denied_url || null);

    const [audioGrantedDataUrl, setAudioGrantedDataUrl] = useState<string | null>(null);
    const [audioWarningDataUrl, setAudioWarningDataUrl] = useState<string | null>(null);
    const [audioDeniedDataUrl, setAudioDeniedDataUrl] = useState<string | null>(null);

    const [audioGrantedName, setAudioGrantedName] = useState<string>('');
    const [audioWarningName, setAudioWarningName] = useState<string>('');
    const [audioDeniedName, setAudioDeniedName] = useState<string>('');

    const [playingType, setPlayingType] = useState<AudioAlarmType | 'MASTER' | null>(null);

    const grantedAudioInputRef = useRef<HTMLInputElement>(null);
    const warningAudioInputRef = useRef<HTMLInputElement>(null);
    const deniedAudioInputRef = useRef<HTMLInputElement>(null);

    // Sincronizar estado local si el config global se actualiza desde Supabase
    useEffect(() => {
        setOrgName(config.org_name);
        setPrimaryColor(config.primary_color);
        setRulesContent(config.rules_content || '');
        if (config.require_biometric_exit_pin !== undefined) {
            setRequireBiometricExitPin(config.require_biometric_exit_pin);
        }
        if ([3, 4, 5, 6].includes(Number(config.scanner_message_duration))) {
            setScannerMessageDuration(Number(config.scanner_message_duration));
        }
        if (config.scanner_denied_extra_time !== undefined) {
            setScannerDeniedExtraTime(config.scanner_denied_extra_time);
        }
        if (config.scanner_rescan_rule) {
            setScannerRescanRule(config.scanner_rescan_rule);
        }
        if (config.scanner_allow_manual_reentry !== undefined) {
            setScannerAllowManualReentry(config.scanner_allow_manual_reentry);
        }
        if (config.audio_volume !== undefined) {
            setAudioVolume(Number(config.audio_volume));
        }
        if (config.audio_enabled !== undefined) {
            setAudioEnabled(config.audio_enabled);
        }
        if (config.audio_granted_enabled !== undefined) {
            setAudioGrantedEnabled(config.audio_granted_enabled);
        }
        if (config.audio_warning_enabled !== undefined) {
            setAudioWarningEnabled(config.audio_warning_enabled);
        }
        if (config.audio_denied_enabled !== undefined) {
            setAudioDeniedEnabled(config.audio_denied_enabled);
        }
        if (config.audio_granted_url !== undefined) {
            setAudioGrantedUrl(config.audio_granted_url);
        }
        if (config.audio_warning_url !== undefined) {
            setAudioWarningUrl(config.audio_warning_url);
        }
        if (config.audio_denied_url !== undefined) {
            setAudioDeniedUrl(config.audio_denied_url);
        }
    }, [config]);

    // File inputs
    const logoInputRef = useRef<HTMLInputElement>(null);
    const favInputRef = useRef<HTMLInputElement>(null);
    
    const [logoPreview, setLogoPreview] = useState<string | null>(config.logo_url || null);
    const [favPreview, setFavPreview] = useState<string | null>(config.favicon_url || null);
    const [isSaving, setIsSaving] = useState(false);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setPreview: (val: string) => void) => {
        if (e.target.files && e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (ev.target?.result) setPreview(ev.target.result as string);
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    };

    const handleAudioFileSelect = async (
        type: AudioAlarmType,
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 8 * 1024 * 1024) {
            showToast('EL ARCHIVO EXCEDE 8MB. SE SUGIERE USAR AUDIOS CORTOS (<2MB)', 'warning');
        }

        try {
            audioService.init();
            // Cargar inmediatamente en memoria y guardar en caché local IndexedDB
            const { dataUrl } = await audioService.loadAndCacheFile(type, file, file.name);

            if (type === 'GRANTED') {
                setAudioGrantedDataUrl(dataUrl);
                setAudioGrantedUrl(dataUrl);
                setAudioGrantedName(file.name);
            } else if (type === 'WARNING') {
                setAudioWarningDataUrl(dataUrl);
                setAudioWarningUrl(dataUrl);
                setAudioWarningName(file.name);
            } else if (type === 'DENIED') {
                setAudioDeniedDataUrl(dataUrl);
                setAudioDeniedUrl(dataUrl);
                setAudioDeniedName(file.name);
            }

            showToast(`AUDIO CARGADO EN CACHÉ LOCAL OFFLINE. GUARDA PARA SINCRONIZAR A LA NUBE`, 'success');
            // Probar el sonido
            handleTestAudio(type, dataUrl);
        } catch (err: any) {
            console.error('Error cargando audio:', err);
            showToast(`ERROR AL PROCESAR AUDIO: ${err.message}`, 'error');
        } finally {
            if (e.target) e.target.value = '';
        }
    };

    const handleTestAudio = async (type: AudioAlarmType | 'MASTER', previewDataUrl?: string) => {
        audioService.init();
        audioService.setVolume(audioVolume);
        audioService.setMasterEnabled(audioEnabled);
        setPlayingType(type);

        try {
            if (type === 'MASTER') {
                await audioService.playPreview('GRANTED');
            } else {
                let targetUrl = previewDataUrl;
                if (!targetUrl) {
                    if (type === 'GRANTED') targetUrl = audioGrantedDataUrl || audioGrantedUrl || undefined;
                    if (type === 'WARNING') targetUrl = audioWarningDataUrl || audioWarningUrl || undefined;
                    if (type === 'DENIED') targetUrl = audioDeniedDataUrl || audioDeniedUrl || undefined;
                }
                await audioService.playPreview(type, targetUrl);
            }
        } finally {
            setTimeout(() => {
                setPlayingType(null);
            }, 800);
        }
    };

    const handleResetAudioToDefault = async (type: AudioAlarmType) => {
        audioService.init();
        await audioService.resetToDefault(type);
        if (type === 'GRANTED') {
            setAudioGrantedUrl(null);
            setAudioGrantedDataUrl(null);
            setAudioGrantedName('');
        } else if (type === 'WARNING') {
            setAudioWarningUrl(null);
            setAudioWarningDataUrl(null);
            setAudioWarningName('');
        } else if (type === 'DENIED') {
            setAudioDeniedUrl(null);
            setAudioDeniedDataUrl(null);
            setAudioDeniedName('');
        }
        showToast(`TONO RESTABLECIDO AL PITIDO SINTÉTICO DE FÁBRICA`, 'success');
        handleTestAudio(type);
    };

    const handleCopySql = () => {
        navigator.clipboard.writeText(SUPABASE_SQL_SNIPPET);
        showToast('CÓDIGO SQL COPIADO AL PORTAPAPELES', 'success');
    };

    // --- COPIA DE SEGURIDAD (BACKUP), RESTAURACIÓN Y EXPORTACIÓN CSV ---
    const restoreFileInputRef = useRef<HTMLInputElement>(null);
    const [isBackingUp, setIsBackingUp] = useState(false);
    const [backupProgress, setBackupProgress] = useState('');

    const [isExportingCsv, setIsExportingCsv] = useState(false);
    const [csvProgress, setCsvProgress] = useState('');

    const [showRestoreModal, setShowRestoreModal] = useState(false);
    const [restorePayload, setRestorePayload] = useState<SystemBackupPayload | null>(null);
    const [restoreFileName, setRestoreFileName] = useState('');
    const [restoreConfirmText, setRestoreConfirmText] = useState('');
    const [isRestoring, setIsRestoring] = useState(false);
    const [restoreProgressText, setRestoreProgressText] = useState('');
    const [restorePercent, setRestorePercent] = useState(0);
    const [restoreSummary, setRestoreSummary] = useState<{ totalRestored: number; report: Record<string, number>; errors: string[] } | null>(null);

    const handleDownloadBackup = async () => {
        setIsBackingUp(true);
        setBackupProgress('Iniciando lectura de tablas...');
        try {
            const res = await generateAndDownloadBackup((step) => {
                setBackupProgress(step);
            });
            showToast(`RESPALDO GENERADO: ${res.counts.clients} SOCIOS, ${res.counts.attendance} ASISTENCIAS, ${res.counts.payments} PAGOS`, 'success');
        } catch (err: any) {
            console.error("Error al generar backup:", err);
            showToast(`ERROR AL GENERAR RESPALDO: ${err.message}`, 'error');
        } finally {
            setIsBackingUp(false);
            setBackupProgress('');
        }
    };

    const handleFileSelectedForRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const text = event.target?.result as string;
                const json = JSON.parse(text);
                const validation = validateBackupFile(json);
                if (!validation.isValid || !validation.payload) {
                    showToast(validation.message, 'error');
                    return;
                }

                setRestoreFileName(file.name);
                setRestorePayload(validation.payload);
                setRestoreConfirmText('');
                setRestoreSummary(null);
                setRestorePercent(0);
                setRestoreProgressText('');
                setShowRestoreModal(true);
            } catch (err: any) {
                showToast('EL ARCHIVO NO ES UN JSON VÁLIDO', 'error');
            } finally {
                if (restoreFileInputRef.current) {
                    restoreFileInputRef.current.value = '';
                }
            }
        };
        reader.readAsText(file);
    };

    const handleConfirmRestore = async () => {
        if (restoreConfirmText.trim().toUpperCase() !== 'RESTAURAR') {
            showToast('DEBES ESCRIBIR "RESTAURAR" PARA CONFIRMAR LA OPERACIÓN', 'warning');
            return;
        }
        if (!restorePayload) return;

        setIsRestoring(true);
        setRestoreProgressText('Iniciando proceso de restauración...');
        setRestorePercent(0);

        try {
            const result = await restoreBackup(restorePayload, (step, pct) => {
                setRestoreProgressText(step);
                setRestorePercent(pct);
            });

            setRestoreSummary(result);
            await refreshConfig();
            showToast(`RESTAURACIÓN FINALIZADA CON ÉXITO: ${result.totalRestored} REGISTROS`, 'success');
        } catch (err: any) {
            console.error("Error en restauración:", err);
            showToast(`ERROR AL RESTAURAR: ${err.message}`, 'error');
        } finally {
            setIsRestoring(false);
        }
    };

    const handleExportClientsCsv = async () => {
        setIsExportingCsv(true);
        setCsvProgress('Iniciando exportación de socios...');
        try {
            const { totalClients, filename } = await exportClientsToCsv((step) => {
                setCsvProgress(step);
            });
            showToast(`CSV GENERADO: ${totalClients} SOCIOS DESCARGADOS EN ${filename}`, 'success');
        } catch (err: any) {
            console.error("Error al exportar CSV:", err);
            showToast(`ERROR AL EXPORTAR CSV: ${err.message}`, 'error');
        } finally {
            setIsExportingCsv(false);
            setCsvProgress('');
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);

        try {
            // Check if previews are new base64 strings or existing URLs
            const newLogo = logoPreview?.startsWith('data:') ? logoPreview : undefined;
            const newFav = favPreview?.startsWith('data:') ? favPreview : undefined;

            await updateSystemConfig({
                org_name: orgName,
                primary_color: primaryColor,
                rules_content: rulesContent,
                require_biometric_exit_pin: requireBiometricExitPin,
                scanner_message_duration: scannerMessageDuration,
                scanner_denied_extra_time: scannerDeniedExtraTime,
                scanner_rescan_rule: scannerRescanRule,
                scanner_allow_manual_reentry: scannerAllowManualReentry,
                audio_volume: audioVolume,
                audio_enabled: audioEnabled,
                audio_granted_enabled: audioGrantedEnabled,
                audio_warning_enabled: audioWarningEnabled,
                audio_denied_enabled: audioDeniedEnabled,
                audio_granted_url: audioGrantedUrl,
                audio_warning_url: audioWarningUrl,
                audio_denied_url: audioDeniedUrl
            }, newLogo, newFav, {
                grantedDataUrl: audioGrantedDataUrl || undefined,
                warningDataUrl: audioWarningDataUrl || undefined,
                deniedDataUrl: audioDeniedDataUrl || undefined
            });

            await refreshConfig();
            // Limpiar los temporales de subida
            setAudioGrantedDataUrl(null);
            setAudioWarningDataUrl(null);
            setAudioDeniedDataUrl(null);

            showToast('CONFIGURACIÓN DEL SISTEMA Y ALARMAS ACTUALIZADAS EN TODOS LOS DISPOSITIVOS', 'success');
        } catch (error: any) {
            console.error(error);
            showToast(`Error: ${error.message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const labelStyle = "block text-xs font-tech text-yellow-500/80 mb-2 uppercase tracking-widest";
    const inputStyle = "w-full bg-black/50 border-2 border-zinc-700 px-4 py-3 text-white focus:border-yellow-500 outline-none font-mono-tech";

    return (
        <div className="max-w-4xl mx-auto animate-[fadeIn_0.5s_ease-out]">
            <h2 className="text-3xl font-tech font-bold mb-8 text-white">CONFIGURACIÓN <span className="text-yellow-500">DEL SISTEMA</span></h2>
            
            <form onSubmit={handleSave} className="bg-zinc-900/50 border border-zinc-800 p-8 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/5 rounded-full blur-3xl"></div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                    {/* Branding Text */}
                    <div className="space-y-6">
                        <div>
                            <label className={labelStyle}>NOMBRE DE LA ORGANIZACIÓN</label>
                            <input 
                                value={orgName} 
                                onChange={e => setOrgName(e.target.value)} 
                                className={inputStyle}
                                placeholder="Ej. Kali Access"
                            />
                            <p className="text-[10px] text-zinc-500 mt-1">Aparece en el título de la pestaña y en la cabecera.</p>
                        </div>

                        <div>
                            <label className={labelStyle}>COLOR PRIMARIO (MARCA)</label>
                            <div className="flex items-center gap-4">
                                <input 
                                    type="color" 
                                    value={primaryColor} 
                                    onChange={e => setPrimaryColor(e.target.value)} 
                                    className="h-12 w-20 bg-black border border-zinc-700 cursor-pointer p-1"
                                />
                                <div className="flex-1">
                                    <input 
                                        value={primaryColor} 
                                        onChange={e => setPrimaryColor(e.target.value)} 
                                        className={inputStyle} 
                                    />
                                </div>
                            </div>
                            <p className="text-[10px] text-zinc-500 mt-1">
                                Este color reemplazará al "Amarillo" predeterminado en toda la aplicación.
                            </p>
                        </div>
                    </div>

                    {/* Images */}
                    <div className="space-y-6">
                        <div>
                            <label className={labelStyle}>LOGO DEL SISTEMA (PNG/SVG)</label>
                            <div className="flex items-center gap-4 bg-black/30 p-4 border border-zinc-700">
                                <div className="w-16 h-16 bg-black border border-zinc-600 flex items-center justify-center overflow-hidden">
                                    {logoPreview ? (
                                        <img src={logoPreview} className="w-full h-full object-contain" alt="Logo" />
                                    ) : (
                                        <span className="text-xs text-zinc-600">N/A</span>
                                    )}
                                </div>
                                <div className="flex-1">
                                    <button 
                                        type="button" 
                                        onClick={() => logoInputRef.current?.click()}
                                        className="bg-zinc-800 text-white text-xs px-4 py-2 border border-zinc-600 hover:bg-zinc-700 uppercase font-tech"
                                    >
                                        Subir Nuevo
                                    </button>
                                    <input ref={logoInputRef} type="file" accept="image/*" hidden onChange={e => handleFileChange(e, setLogoPreview)} />
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className={labelStyle}>FAVICON (ICO/PNG)</label>
                            <div className="flex items-center gap-4 bg-black/30 p-4 border border-zinc-700">
                                <div className="w-16 h-16 bg-black border border-zinc-600 flex items-center justify-center overflow-hidden">
                                    {favPreview ? (
                                        <img src={favPreview} className="w-8 h-8 object-contain" alt="Favicon" />
                                    ) : (
                                        <span className="text-xs text-zinc-600">N/A</span>
                                    )}
                                </div>
                                <div className="flex-1">
                                    <button 
                                        type="button" 
                                        onClick={() => favInputRef.current?.click()}
                                        className="bg-zinc-800 text-white text-xs px-4 py-2 border border-zinc-600 hover:bg-zinc-700 uppercase font-tech"
                                    >
                                        Subir Nuevo
                                    </button>
                                    <input ref={favInputRef} type="file" accept="image/*" hidden onChange={e => handleFileChange(e, setFavPreview)} />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* RULES EDITOR */}
                <div className="border-t border-zinc-800 pt-8 mt-8">
                    <h3 className="text-xl font-tech font-bold text-yellow-500 mb-4 uppercase">EDITOR DE REGLAMENTO INTERNO</h3>
                    <p className="text-xs text-zinc-400 font-mono-tech mb-4">
                        Este texto aparecerá en la pantalla de Login con estilo de "ALTA SEGURIDAD".
                        <br/>
                        <span className="text-emerald-400">TIP:</span> Usa dobles dos puntos (::) para resaltar texto como marcatextos. 
                        Ejemplo: <span className="bg-yellow-500 text-black px-1 font-bold">::NO CORRER::</span> se verá resaltado.
                    </p>
                    
                    <textarea 
                        value={rulesContent}
                        onChange={(e) => setRulesContent(e.target.value)}
                        className="w-full h-64 bg-black border-2 border-emerald-500/50 p-4 text-emerald-400 font-mono-tech text-sm leading-relaxed outline-none focus:border-emerald-400 focus:shadow-[0_0_15px_rgba(16,185,129,0.2)] resize-y"
                        placeholder="Escribe aquí el reglamento..."
                    />
                </div>

                {/* =========================================================================== */}
                {/* NUEVO CONTROL: TIEMPO DE VISUALIZACIÓN DE MENSAJES DE ACCESO (QR Y HUELLA)  */}
                {/* =========================================================================== */}
                <div className="border-t border-zinc-800 pt-8 mt-8">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]"></span>
                                <h3 className="text-xl font-tech font-bold text-white uppercase">
                                    TIEMPO DE VISUALIZACIÓN DE MENSAJES DE ACCESO (QR Y HUELLA)
                                </h3>
                            </div>
                            <p className="text-xs text-zinc-400 font-mono-tech mt-1.5 leading-relaxed">
                                Selecciona cuántos segundos permanecerá en pantalla la ficha del socio ("¡Bienvenido!", "Por vencer" o "Acceso Denegado") antes de reactivar el lector para la siguiente persona.
                            </p>
                        </div>
                        <span className="px-3 py-1 bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 font-mono-tech text-xs font-bold rounded-lg self-start sm:self-center shrink-0">
                            ACTIVO: {scannerMessageDuration} SEGUNDOS
                        </span>
                    </div>

                    {/* Botones de Selección Rápida: 3s, 4s, 5s, 6s */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                        {DURATION_OPTIONS.map((opt) => {
                            const isSelected = scannerMessageDuration === opt.seconds;
                            return (
                                <button
                                    key={opt.seconds}
                                    type="button"
                                    onClick={() => setScannerMessageDuration(opt.seconds)}
                                    className={`text-left p-4 rounded-2xl border-2 transition-all duration-200 flex flex-col justify-between relative overflow-hidden cursor-pointer ${
                                        isSelected
                                            ? 'bg-yellow-500/15 border-yellow-500 shadow-[0_0_25px_rgba(234,179,8,0.25)] scale-[1.01]'
                                            : 'bg-black/50 border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900/60'
                                    }`}
                                >
                                    <div>
                                        <div className="flex items-center justify-between gap-2 mb-1.5">
                                            <span className={`font-tech font-black text-lg tracking-tight ${isSelected ? 'text-yellow-400' : 'text-white'}`}>
                                                {opt.title}
                                            </span>
                                            <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] font-bold ${
                                                isSelected
                                                    ? 'bg-yellow-500 border-yellow-400 text-black'
                                                    : 'border-zinc-700 text-transparent'
                                            }`}>
                                                ✓
                                            </span>
                                        </div>
                                        <span className={`inline-block text-[9px] font-mono-tech font-bold uppercase px-2 py-0.5 rounded mb-2 ${
                                            isSelected
                                                ? 'bg-yellow-500 text-black'
                                                : 'bg-zinc-800 text-zinc-400'
                                        }`}>
                                            {opt.badge}
                                        </span>
                                    </div>
                                    <p className="text-[11px] font-mono-tech text-zinc-400 leading-snug">
                                        {opt.desc}
                                    </p>
                                </button>
                            );
                        })}
                    </div>

                    {/* Opción de Tiempo Diferenciado para Acceso Denegado (+2s) */}
                    <div className="p-4 rounded-2xl border border-zinc-800 bg-black/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3">
                            <div className={`p-2 rounded-xl border shrink-0 mt-0.5 ${
                                scannerDeniedExtraTime
                                    ? 'bg-red-500/10 border-red-500/40 text-red-400'
                                    : 'bg-zinc-800/60 border-zinc-700 text-zinc-500'
                            }`}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <div>
                                <h4 className="text-sm font-tech font-bold text-white uppercase">
                                    TIEMPO DIFERENCIADO PARA "ACCESO DENEGADO" (+2 SEGUNDOS EXTRA)
                                </h4>
                                <p className="text-xs font-mono-tech text-zinc-400 mt-0.5">
                                    {scannerDeniedExtraTime ? (
                                        <>
                                            Activado: Los accesos autorizados durarán <strong className="text-emerald-400">{scannerMessageDuration}s</strong> y las alertas rojas de <strong className="text-red-400">Acceso Denegado</strong> durarán <strong className="text-red-400">{scannerMessageDuration + 2}s</strong> para que el socio alcance a leer la fecha en que venció su plan.
                                        </>
                                    ) : (
                                        <>
                                            Desactivado: Tanto los accesos autorizados como los denegados durarán exactamente <strong className="text-yellow-400">{scannerMessageDuration}s</strong>.
                                        </>
                                    )}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
                            <span className={`text-xs font-tech font-bold uppercase ${scannerDeniedExtraTime ? 'text-red-400' : 'text-zinc-500'}`}>
                                {scannerDeniedExtraTime ? '+2s EN DENEGADO' : 'MISMO TIEMPO'}
                            </span>
                            <button
                                type="button"
                                onClick={() => setScannerDeniedExtraTime(!scannerDeniedExtraTime)}
                                className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-300 focus:outline-none cursor-pointer ${
                                    scannerDeniedExtraTime ? 'bg-red-600 justify-end' : 'bg-zinc-800 justify-start'
                                }`}
                            >
                                <span className="w-6 h-6 rounded-full bg-white shadow-md transform transition-transform duration-300" />
                            </button>
                        </div>
                    </div>

                    {/* Resumen de funciones activas en ambos escáneres */}
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-mono-tech">
                        <div className="p-3 rounded-xl bg-zinc-950/80 border border-zinc-800/80 flex items-center gap-2.5 text-zinc-300">
                            <span className="text-cyan-400 font-bold text-sm">⏳</span>
                            <span>
                                <strong className="text-white">Barra de cuenta regresiva:</strong> Visible en la parte inferior de la tarjeta en Huella y QR.
                            </span>
                        </div>
                        <div className="p-3 rounded-xl bg-zinc-950/80 border border-zinc-800/80 flex items-center gap-2.5 text-zinc-300">
                            <span className="text-yellow-400 font-bold text-sm">⚡</span>
                            <span>
                                <strong className="text-white">Cierre inmediato:</strong> Toca la tarjeta o presiona <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-yellow-400">Espacio</code> / <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-yellow-400">Esc</code> para pasar al siguiente socio al instante.
                            </span>
                        </div>
                    </div>
                </div>

                {/* =========================================================================== */}
                {/* NUEVO CONTROL: REGLA DE RE-ESCANEO DIARIO (ANTIPASSBACK / 2DA VISITA)        */}
                {/* =========================================================================== */}
                <div className="border-t border-zinc-800 pt-8 mt-8">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]"></span>
                                <h3 className="text-xl font-tech font-bold text-white uppercase">
                                    REGLA DE RE-ESCANEO EN EL MISMO DÍA (HUELLA Y QR)
                                </h3>
                            </div>
                            <p className="text-xs text-zinc-400 font-mono-tech mt-1.5 leading-relaxed">
                                Elige cómo debe responder el sistema cuando un socio que ya registró su entrada hoy vuelve a escanear su huella o código QR horas más tarde en el mismo día.
                            </p>
                        </div>
                        <span className="px-3 py-1 bg-amber-500/10 border border-amber-500/40 text-amber-300 font-mono-tech text-xs font-bold rounded-lg self-start sm:self-center shrink-0">
                            {RESCAN_RULE_OPTIONS.find(r => r.value === scannerRescanRule)?.title || '1 ENTRADA POR DÍA'}
                        </span>
                    </div>

                    {/* Tarjetas de Selección de Regla de Re-escaneo */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
                        {RESCAN_RULE_OPTIONS.map((opt) => {
                            const isSelected = scannerRescanRule === opt.value;
                            return (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setScannerRescanRule(opt.value)}
                                    className={`text-left p-4 rounded-2xl border-2 transition-all duration-200 flex flex-col justify-between relative overflow-hidden cursor-pointer ${
                                        opt.value === 'ONCE_PER_DAY' ? 'md:col-span-2' : ''
                                    } ${
                                        isSelected
                                            ? 'bg-amber-500/15 border-amber-400 shadow-[0_0_25px_rgba(245,158,11,0.25)] scale-[1.005]'
                                            : 'bg-black/50 border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900/60'
                                    }`}
                                >
                                    <div>
                                        <div className="flex items-center justify-between gap-2 mb-1.5">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`font-tech font-black text-base tracking-tight ${isSelected ? 'text-amber-300' : 'text-white'}`}>
                                                    {opt.title}
                                                </span>
                                                <span className={`inline-block text-[9px] font-mono-tech font-bold uppercase px-2 py-0.5 rounded ${
                                                    isSelected
                                                        ? 'bg-amber-400 text-black'
                                                        : 'bg-zinc-800 text-zinc-400'
                                                }`}>
                                                    {opt.badge}
                                                </span>
                                            </div>
                                            <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] font-bold shrink-0 ${
                                                isSelected
                                                    ? 'bg-amber-400 border-amber-300 text-black'
                                                    : 'border-zinc-700 text-transparent'
                                            }`}>
                                                ✓
                                            </span>
                                        </div>
                                        <p className="text-xs font-mono-tech text-zinc-300 leading-relaxed mb-2">
                                            {opt.desc}
                                        </p>
                                    </div>
                                    <div className={`px-3 py-1.5 rounded-lg text-[10px] font-mono-tech border ${
                                        isSelected
                                            ? 'bg-black/70 border-amber-500/40 text-amber-200'
                                            : 'bg-zinc-950/80 border-zinc-800 text-zinc-400'
                                    }`}>
                                        {opt.example}
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {/* Interruptor: Botón de "Permitir Reingreso Manual" para Recepción */}
                    <div className="p-4 rounded-2xl border border-zinc-800 bg-black/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3">
                            <div className={`p-2 rounded-xl border shrink-0 mt-0.5 ${
                                scannerAllowManualReentry
                                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400'
                                    : 'bg-zinc-800/60 border-zinc-700 text-zinc-500'
                            }`}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <div>
                                <h4 className="text-sm font-tech font-bold text-white uppercase">
                                    BOTÓN DE "AUTORIZAR REINGRESO MANUAL" EN RECEPCIÓN
                                </h4>
                                <p className="text-xs font-mono-tech text-zinc-400 mt-0.5">
                                    {scannerAllowManualReentry ? (
                                        <>
                                            Activado: Cuando el lector muestre <strong className="text-amber-300">"YA REGISTRÓ ASISTENCIA HOY"</strong>, aparecerá un botón en la tarjeta para que recepción pueda <strong className="text-emerald-400">autorizarle un reingreso manual</strong> si el socio salió momentáneamente o viene a una 2da clase.
                                        </>
                                    ) : (
                                        <>
                                            Desactivado: La pantalla mostrará únicamente el aviso de que ya fue escaneado en el día sin botón de reingreso manual.
                                        </>
                                    )}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
                            <span className={`text-xs font-tech font-bold uppercase ${scannerAllowManualReentry ? 'text-emerald-400' : 'text-zinc-500'}`}>
                                {scannerAllowManualReentry ? 'BOTÓN ACTIVO' : 'OCULTO'}
                            </span>
                            <button
                                type="button"
                                onClick={() => setScannerAllowManualReentry(!scannerAllowManualReentry)}
                                className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-300 focus:outline-none cursor-pointer ${
                                    scannerAllowManualReentry ? 'bg-emerald-600 justify-end' : 'bg-zinc-800 justify-start'
                                }`}
                            >
                                <span className="w-6 h-6 rounded-full bg-white shadow-md transform transition-transform duration-300" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* BIOMETRIC PIN EXIT SECURITY */}
                <div className="border-t border-zinc-800 pt-8 mt-8">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex-1">
                            <div className="flex items-center gap-2">
                                <span className={`w-2.5 h-2.5 rounded-full ${requireBiometricExitPin ? 'bg-yellow-500 shadow-[0_0_8px_#eab308]' : 'bg-zinc-600'}`}></span>
                                <h3 className="text-xl font-tech font-bold text-white uppercase">
                                    SEGURIDAD EN ACCESO HUELLA (PIN DE SALIDA)
                                </h3>
                            </div>
                            <p className="text-xs text-zinc-400 font-mono-tech mt-2 leading-relaxed">
                                Activa o desactiva la solicitud de PIN de Administrador (1234) al pulsar el botón "SALIR" en la terminal de Acceso Huella.
                            </p>
                        </div>

                        {/* Interactive Cyber Switch */}
                        <div className="flex items-center gap-3 bg-black/60 p-2.5 border border-zinc-800 rounded-xl self-start sm:self-auto">
                            <span className={`text-xs font-tech font-bold uppercase transition-colors ${requireBiometricExitPin ? 'text-yellow-400' : 'text-zinc-500'}`}>
                                {requireBiometricExitPin ? 'PIN ACTIVADO' : 'PIN DESACTIVADO'}
                            </span>
                            <button
                                type="button"
                                onClick={() => setRequireBiometricExitPin(!requireBiometricExitPin)}
                                className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-300 focus:outline-none cursor-pointer ${
                                    requireBiometricExitPin ? 'bg-yellow-500 justify-end' : 'bg-zinc-800 justify-start'
                                }`}
                            >
                                <span className={`w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 flex items-center justify-center ${
                                    requireBiometricExitPin ? 'bg-black text-yellow-500' : 'bg-zinc-500 text-zinc-900'
                                }`}>
                                    {requireBiometricExitPin ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                            <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
                                        </svg>
                                    )}
                                </span>
                            </button>
                        </div>
                    </div>

                    <div className="mt-4 p-4 rounded-xl border border-zinc-800 bg-black/40 flex items-start gap-3">
                        <div className={`p-2 rounded-lg border shrink-0 ${requireBiometricExitPin ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'}`}>
                            {requireBiometricExitPin ? (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                </svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                                </svg>
                            )}
                        </div>
                        <div className="flex-1 text-xs font-mono-tech">
                            {requireBiometricExitPin ? (
                                <p className="text-zinc-300">
                                    <span className="text-yellow-400 font-bold">SEGURIDAD ALTA (PIN EXIGIDO):</span> Al presionar <strong className="text-white">SALIR [PIN]</strong> en la pantalla de Acceso Huella, se abrirá la ventana para ingresar el PIN de administrador (<code className="bg-zinc-800 px-1 py-0.5 text-yellow-300 rounded font-bold">1234</code>) antes de regresar al panel.
                                </p>
                            ) : (
                                <p className="text-zinc-300">
                                    <span className="text-emerald-400 font-bold">SALIDA RÁPIDA (SIN PIN):</span> El botón de salida en Acceso Huella dirá simplemente <strong className="text-white">SALIR</strong> y volverá al Dashboard inmediatamente al hacer clic, sin abrir ninguna ventana de PIN.
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                {/* =========================================================================== */}
                {/* SISTEMA DE ALARMAS Y AUDIO (OPCIÓN C: HÍBRIDO NUBE + CACHÉ LOCAL OFFLINE)  */}
                {/* =========================================================================== */}
                <div className="border-t border-zinc-800 pt-8 mt-8">
                    {/* Hidden audio file inputs */}
                    <input 
                        ref={grantedAudioInputRef} 
                        type="file" 
                        accept="audio/*,.mp3,.wav,.ogg,.m4a" 
                        className="hidden" 
                        onChange={(e) => handleAudioFileSelect('GRANTED', e)} 
                    />
                    <input 
                        ref={warningAudioInputRef} 
                        type="file" 
                        accept="audio/*,.mp3,.wav,.ogg,.m4a" 
                        className="hidden" 
                        onChange={(e) => handleAudioFileSelect('WARNING', e)} 
                    />
                    <input 
                        ref={deniedAudioInputRef} 
                        type="file" 
                        accept="audio/*,.mp3,.wav,.ogg,.m4a" 
                        className="hidden" 
                        onChange={(e) => handleAudioFileSelect('DENIED', e)} 
                    />

                    {/* Section Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]"></span>
                                <h3 className="text-xl font-tech font-bold text-white uppercase tracking-wider">
                                    SISTEMA DE ALARMAS Y AUDIO (HÍBRIDO NUBE + OFFLINE)
                                </h3>
                            </div>
                            <p className="text-xs text-zinc-400 font-mono-tech mt-1.5 leading-relaxed">
                                Sube tus propios archivos de sonido (<code className="text-yellow-400">.mp3</code>, <code className="text-yellow-400">.wav</code>, <code className="text-yellow-400">.ogg</code>) para los estados del lector de huellas y QR.
                                Se guardan en la nube para compartirse entre todos tus equipos y se almacenan en la memoria local (IndexedDB) de tu equipo para sonar en <strong className="text-emerald-400">&lt;5ms</strong> sin depender de internet.
                            </p>
                        </div>
                        <span className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 font-mono-tech text-xs font-bold rounded-lg self-start sm:self-center shrink-0">
                            OPCIÓN C: HÍBRIDO ACTIVO
                        </span>
                    </div>

                    {/* Master Controls: Master Switch & Volume Slider */}
                    <div className="p-5 rounded-2xl border border-zinc-800 bg-black/60 mb-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                            {/* Master Toggle */}
                            <div className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800/80">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2.5 rounded-xl border ${
                                        audioEnabled 
                                            ? 'bg-yellow-500/10 border-yellow-500/40 text-yellow-400' 
                                            : 'bg-zinc-800/60 border-zinc-700 text-zinc-500'
                                    }`}>
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            {audioEnabled ? (
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                            ) : (
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z m12-4l-6 6m0-6l6 6" />
                                            )}
                                        </svg>
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-tech font-bold text-white uppercase">
                                            AUDIO GENERAL DEL SISTEMA
                                        </h4>
                                        <p className="text-[11px] font-mono-tech text-zinc-400">
                                            {audioEnabled ? 'Activado en todos los lectores' : 'Silenciado por completo'}
                                        </p>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => {
                                        const next = !audioEnabled;
                                        setAudioEnabled(next);
                                        audioService.setMasterEnabled(next);
                                    }}
                                    className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-300 focus:outline-none cursor-pointer ${
                                        audioEnabled ? 'bg-yellow-500 justify-end' : 'bg-zinc-800 justify-start'
                                    }`}
                                >
                                    <span className={`w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${
                                        audioEnabled ? 'bg-black' : 'bg-zinc-500'
                                    }`} />
                                </button>
                            </div>

                            {/* Volume Slider */}
                            <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800/80 flex flex-col justify-between">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-tech font-bold text-zinc-300 uppercase">
                                        VOLUMEN MAESTRO: <strong className="text-yellow-400 text-sm">{audioVolume}%</strong>
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => handleTestAudio('MASTER')}
                                        disabled={!audioEnabled}
                                        className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-yellow-400 border border-yellow-500/30 text-[10px] font-tech font-bold uppercase rounded cursor-pointer transition-all disabled:opacity-40"
                                    >
                                        {playingType === 'MASTER' ? 'SONANDO...' : 'PROBAR VOLUMEN'}
                                    </button>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-zinc-500">0%</span>
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        step="5"
                                        value={audioVolume}
                                        disabled={!audioEnabled}
                                        onChange={(e) => {
                                            const val = Number(e.target.value);
                                            setAudioVolume(val);
                                            audioService.setVolume(val);
                                        }}
                                        className="flex-1 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-yellow-500 disabled:opacity-40"
                                    />
                                    <span className="text-xs text-zinc-500">100%</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 3 Status Alarm Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                        
                        {/* 1. ACCESO PERMITIDO (GRANTED) */}
                        <div className="bg-black/60 border border-emerald-500/30 rounded-2xl p-5 flex flex-col justify-between shadow-lg relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none"></div>

                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]"></span>
                                        <h4 className="text-sm font-tech font-bold text-white uppercase tracking-wider">
                                            ACCESO PERMITIDO
                                        </h4>
                                    </div>
                                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 text-[10px] font-tech font-bold uppercase rounded">
                                        VÁLIDO
                                    </span>
                                </div>

                                <p className="text-xs text-zinc-400 font-mono-tech mb-4 leading-relaxed">
                                    Suena en el lector cuando el socio tiene su plan activo y se valida su ingreso.
                                </p>

                                {/* Estado del Audio */}
                                <div className="p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800 mb-4 flex items-center justify-between">
                                    <span className="text-[10px] font-tech uppercase font-bold text-zinc-400">ESTADO:</span>
                                    <span className={`text-[10px] font-mono-tech font-bold px-2 py-0.5 rounded ${
                                        audioGrantedUrl || audioGrantedDataUrl
                                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                            : 'bg-zinc-800 text-zinc-300'
                                    }`}>
                                        {audioGrantedUrl || audioGrantedDataUrl ? 'AUDIO PERSONALIZADO' : 'TONO SINTÉTICO'}
                                    </span>
                                </div>
                                {audioGrantedName && (
                                    <p className="text-[10px] text-zinc-500 font-mono-tech truncate mb-2">
                                        Archivo: {audioGrantedName}
                                    </p>
                                )}
                            </div>

                            <div className="pt-4 border-t border-zinc-800 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => grantedAudioInputRef.current?.click()}
                                        className="py-2 px-3 bg-zinc-800 hover:bg-zinc-700 text-emerald-400 border border-emerald-500/30 text-xs font-tech font-bold uppercase rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                        </svg>
                                        SUBIR MP3
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => handleTestAudio('GRANTED')}
                                        className={`py-2 px-3 text-xs font-tech font-bold uppercase rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                            playingType === 'GRANTED'
                                                ? 'bg-emerald-500 text-black font-extrabold shadow-[0_0_12px_#34d399]'
                                                : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                        }`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        {playingType === 'GRANTED' ? 'SONANDO' : 'PROBAR'}
                                    </button>
                                </div>

                                {(audioGrantedUrl || audioGrantedDataUrl) && (
                                    <button
                                        type="button"
                                        onClick={() => handleResetAudioToDefault('GRANTED')}
                                        className="w-full py-1.5 text-[10px] font-tech uppercase text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                                    >
                                        ↺ RESTABLECER TONO DE FÁBRICA
                                    </button>
                                )}

                                <div className="flex items-center justify-between pt-1">
                                    <span className="text-[11px] font-tech text-zinc-400 uppercase">Habilitar sonido</span>
                                    <button
                                        type="button"
                                        onClick={() => setAudioGrantedEnabled(!audioGrantedEnabled)}
                                        className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                                            audioGrantedEnabled ? 'bg-emerald-500 justify-end' : 'bg-zinc-800 justify-start'
                                        }`}
                                    >
                                        <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* 2. ACCESO DENEGADO (DENIED) */}
                        <div className="bg-black/60 border border-rose-500/30 rounded-2xl p-5 flex flex-col justify-between shadow-lg relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full blur-2xl pointer-events-none"></div>

                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]"></span>
                                        <h4 className="text-sm font-tech font-bold text-white uppercase tracking-wider">
                                            ACCESO DENEGADO
                                        </h4>
                                    </div>
                                    <span className="px-2 py-0.5 bg-rose-500/20 text-rose-300 text-[10px] font-tech font-bold uppercase rounded">
                                        BLOQUEO
                                    </span>
                                </div>

                                <p className="text-xs text-zinc-400 font-mono-tech mb-4 leading-relaxed">
                                    Suena con alarma audible cuando una persona no está registrada o su pase no es válido.
                                </p>

                                {/* Estado del Audio */}
                                <div className="p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800 mb-4 flex items-center justify-between">
                                    <span className="text-[10px] font-tech uppercase font-bold text-zinc-400">ESTADO:</span>
                                    <span className={`text-[10px] font-mono-tech font-bold px-2 py-0.5 rounded ${
                                        audioDeniedUrl || audioDeniedDataUrl
                                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                            : 'bg-zinc-800 text-zinc-300'
                                    }`}>
                                        {audioDeniedUrl || audioDeniedDataUrl ? 'AUDIO PERSONALIZADO' : 'ALARMA SINTÉTICA'}
                                    </span>
                                </div>
                                {audioDeniedName && (
                                    <p className="text-[10px] text-zinc-500 font-mono-tech truncate mb-2">
                                        Archivo: {audioDeniedName}
                                    </p>
                                )}
                            </div>

                            <div className="pt-4 border-t border-zinc-800 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => deniedAudioInputRef.current?.click()}
                                        className="py-2 px-3 bg-zinc-800 hover:bg-zinc-700 text-rose-400 border border-rose-500/30 text-xs font-tech font-bold uppercase rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                        </svg>
                                        SUBIR MP3
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => handleTestAudio('DENIED')}
                                        className={`py-2 px-3 text-xs font-tech font-bold uppercase rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                            playingType === 'DENIED'
                                                ? 'bg-rose-500 text-white font-extrabold shadow-[0_0_12px_#f43f5e]'
                                                : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                        }`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        {playingType === 'DENIED' ? 'SONANDO' : 'PROBAR'}
                                    </button>
                                </div>

                                {(audioDeniedUrl || audioDeniedDataUrl) && (
                                    <button
                                        type="button"
                                        onClick={() => handleResetAudioToDefault('DENIED')}
                                        className="w-full py-1.5 text-[10px] font-tech uppercase text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                                    >
                                        ↺ RESTABLECER TONO DE FÁBRICA
                                    </button>
                                )}

                                <div className="flex items-center justify-between pt-1">
                                    <span className="text-[11px] font-tech text-zinc-400 uppercase">Habilitar sonido</span>
                                    <button
                                        type="button"
                                        onClick={() => setAudioDeniedEnabled(!audioDeniedEnabled)}
                                        className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                                            audioDeniedEnabled ? 'bg-rose-500 justify-end' : 'bg-zinc-800 justify-start'
                                        }`}
                                    >
                                        <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* 3. MEMBRESÍA VENCIDA O POR VENCER (WARNING) */}
                        <div className="bg-black/60 border border-amber-500/30 rounded-2xl p-5 flex flex-col justify-between shadow-lg relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl pointer-events-none"></div>

                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_#fbbf24]"></span>
                                        <h4 className="text-sm font-tech font-bold text-white uppercase tracking-wider">
                                            VENCIDO / POR VENCER
                                        </h4>
                                    </div>
                                    <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 text-[10px] font-tech font-bold uppercase rounded">
                                        AVISO
                                    </span>
                                </div>

                                <p className="text-xs text-zinc-400 font-mono-tech mb-4 leading-relaxed">
                                    Suena como advertencia cuando la membresía del socio vence hoy o ya expiró.
                                </p>

                                {/* Estado del Audio */}
                                <div className="p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800 mb-4 flex items-center justify-between">
                                    <span className="text-[10px] font-tech uppercase font-bold text-zinc-400">ESTADO:</span>
                                    <span className={`text-[10px] font-mono-tech font-bold px-2 py-0.5 rounded ${
                                        audioWarningUrl || audioWarningDataUrl
                                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                            : 'bg-zinc-800 text-zinc-300'
                                    }`}>
                                        {audioWarningUrl || audioWarningDataUrl ? 'AUDIO PERSONALIZADO' : 'AVISO SINTÉTICO'}
                                    </span>
                                </div>
                                {audioWarningName && (
                                    <p className="text-[10px] text-zinc-500 font-mono-tech truncate mb-2">
                                        Archivo: {audioWarningName}
                                    </p>
                                )}
                            </div>

                            <div className="pt-4 border-t border-zinc-800 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => warningAudioInputRef.current?.click()}
                                        className="py-2 px-3 bg-zinc-800 hover:bg-zinc-700 text-amber-400 border border-amber-500/30 text-xs font-tech font-bold uppercase rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                        </svg>
                                        SUBIR MP3
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => handleTestAudio('WARNING')}
                                        className={`py-2 px-3 text-xs font-tech font-bold uppercase rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                            playingType === 'WARNING'
                                                ? 'bg-amber-400 text-black font-extrabold shadow-[0_0_12px_#fbbf24]'
                                                : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                        }`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        {playingType === 'WARNING' ? 'SONANDO' : 'PROBAR'}
                                    </button>
                                </div>

                                {(audioWarningUrl || audioWarningDataUrl) && (
                                    <button
                                        type="button"
                                        onClick={() => handleResetAudioToDefault('WARNING')}
                                        className="w-full py-1.5 text-[10px] font-tech uppercase text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                                    >
                                        ↺ RESTABLECER TONO DE FÁBRICA
                                    </button>
                                )}

                                <div className="flex items-center justify-between pt-1">
                                    <span className="text-[11px] font-tech text-zinc-400 uppercase">Habilitar sonido</span>
                                    <button
                                        type="button"
                                        onClick={() => setAudioWarningEnabled(!audioWarningEnabled)}
                                        className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                                            audioWarningEnabled ? 'bg-amber-500 justify-end' : 'bg-zinc-800 justify-start'
                                        }`}
                                    >
                                        <span className="w-4 h-4 rounded-full bg-white shadow-sm" />
                                    </button>
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* Resilience Banner */}
                    <div className="mt-5 p-4 rounded-xl border border-emerald-500/20 bg-emerald-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono-tech text-zinc-300">
                        <div className="flex items-center gap-2 text-emerald-400 font-bold">
                            <span className="text-base">⚡</span>
                            <span>RESILIENCIA 100% OFFLINE + NUBE:</span>
                        </div>
                        <div className="text-zinc-400 text-[11px]">
                            Los audios se descargan en la caché del navegador para sonar inmediatamente incluso si se desconecta el cable de red o cae el WiFi en el quiosco.
                        </div>
                    </div>
                </div>

                {/* BOTÓN Y CÓDIGO SQL PARA SINCRONIZACIÓN EN SUPABASE */}
                <div className="border-t border-zinc-800 pt-6 mt-8">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="text-xs font-mono-tech text-zinc-400">
                            ¿Deseas asegurarte de que la tabla <code className="text-yellow-400">system_config</code> en Supabase tenga las nuevas columnas para sincronizar entre todos tus dispositivos?
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowSqlModal(!showSqlModal)}
                            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-yellow-400 border border-yellow-500/40 rounded-xl text-xs font-tech font-bold uppercase shrink-0 cursor-pointer transition-all"
                        >
                            {showSqlModal ? 'OCULTAR CÓDIGO SQL' : 'VER CÓDIGO SQL (BASE DE DATOS)'}
                        </button>
                    </div>

                    {showSqlModal && (
                        <div className="mt-4 p-4 bg-black border border-yellow-500/40 rounded-xl">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[11px] font-tech font-bold uppercase text-yellow-400">
                                    SCRIPT SQL PARA SUPABASE (SQL EDITOR)
                                </span>
                                <button
                                    type="button"
                                    onClick={handleCopySql}
                                    className="px-3 py-1 bg-yellow-500 hover:bg-yellow-400 text-black font-tech font-bold text-[10px] uppercase rounded-lg cursor-pointer"
                                >
                                    COPIAR SQL
                                </button>
                            </div>
                            <pre className="text-xs font-mono-tech text-emerald-400 overflow-x-auto p-3 bg-zinc-950 rounded-lg border border-zinc-800 select-all">
                                {SUPABASE_SQL_SNIPPET}
                            </pre>
                        </div>
                    )}
                </div>

                <div className="mt-8 pt-6 border-t border-zinc-800 flex justify-end">
                    <button 
                        type="submit" 
                        disabled={isSaving}
                        className="bg-yellow-500 text-black font-tech font-bold text-lg uppercase px-8 py-3 hover:bg-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.4)] transition-all disabled:opacity-50 cursor-pointer"
                    >
                        {isSaving ? 'GUARDANDO...' : 'APLICAR CAMBIOS'}
                    </button>
                </div>
            </form>

            {/* SECCIÓN DE BACKUP, RESTAURACIÓN Y EXPORTACIÓN CSV */}
            <div className="mt-10 bg-zinc-900/50 border border-zinc-800 p-8 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/5 rounded-full blur-3xl pointer-events-none"></div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 shadow-[0_0_8px_#eab308]"></span>
                            <h3 className="text-xl font-tech font-bold text-white uppercase tracking-wider">
                                RESPALDO, RESTAURACIÓN Y EXPORTACIÓN DE DATOS
                            </h3>
                        </div>
                        <p className="text-xs text-zinc-400 font-mono-tech mt-1">
                            Herramientas de seguridad administrativa para exportar copias completas de la base de datos, restaurar el sistema y descargar la base de clientes.
                        </p>
                    </div>
                    <span className="self-start sm:self-auto px-3 py-1 bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 text-[10px] font-tech font-bold uppercase rounded-lg tracking-wider">
                        ADMIN TOOLS • DATABASE
                    </span>
                </div>

                {/* Input oculto para cargar archivo JSON de restauración */}
                <input
                    ref={restoreFileInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={handleFileSelectedForRestore}
                />

                {/* Cuadrícula de 3 tarjetas de acción */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
                    {/* TARJETA 1: GENERAR BACKUP JSON */}
                    <div className="bg-black/60 border border-zinc-800 hover:border-yellow-500/40 p-6 rounded-2xl flex flex-col justify-between transition-all group shadow-lg">
                        <div>
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 rounded-xl bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center text-yellow-400 group-hover:scale-110 transition-transform">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                </div>
                                <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-300 text-[10px] font-tech font-bold uppercase rounded">
                                    JSON COMPLETO
                                </span>
                            </div>
                            <h4 className="text-base font-tech font-bold text-white uppercase group-hover:text-yellow-400 transition-colors">
                                GENERAR BACKUP
                            </h4>
                            <p className="text-xs text-zinc-400 font-mono-tech mt-2 leading-relaxed">
                                Descarga un archivo JSON estructurado con todos los datos del sistema: socios, huellas biométricas, planes, suscripciones, asistencias, cobros, egresos y catálogo.
                            </p>
                        </div>

                        <div className="mt-6 pt-4 border-t border-zinc-800/80">
                            {isBackingUp ? (
                                <div className="flex items-center justify-center gap-2 py-3 px-4 bg-yellow-500/20 border border-yellow-500 text-yellow-400 font-tech font-bold text-xs uppercase rounded-xl animate-pulse">
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span>{backupProgress || 'GENERANDO RESPALDO...'}</span>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={handleDownloadBackup}
                                    className="w-full py-3 px-4 bg-yellow-500 hover:bg-yellow-400 text-black font-tech font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-[0_0_15px_rgba(234,179,8,0.2)] flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    DESCARGAR BACKUP (.JSON)
                                </button>
                            )}
                        </div>
                    </div>

                    {/* TARJETA 2: RESTAURAR BACKUP JSON */}
                    <div className="bg-black/60 border border-zinc-800 hover:border-emerald-500/40 p-6 rounded-2xl flex flex-col justify-between transition-all group shadow-lg">
                        <div>
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                    </svg>
                                </div>
                                <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 text-[10px] font-tech font-bold uppercase rounded">
                                    RESTAURACIÓN
                                </span>
                            </div>
                            <h4 className="text-base font-tech font-bold text-white uppercase group-hover:text-emerald-400 transition-colors">
                                RESTAURAR BACKUP
                            </h4>
                            <p className="text-xs text-zinc-400 font-mono-tech mt-2 leading-relaxed">
                                Carga un archivo JSON de respaldo para recuperar o actualizar la base de datos completa. Cuenta con validación de estructura y confirmación de seguridad.
                            </p>
                        </div>

                        <div className="mt-6 pt-4 border-t border-zinc-800/80">
                            <button
                                type="button"
                                onClick={() => restoreFileInputRef.current?.click()}
                                className="w-full py-3 px-4 bg-zinc-800 hover:bg-emerald-600 hover:text-white text-emerald-400 border border-emerald-500/40 font-tech font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                                SELECCIONAR ARCHIVO (.JSON)
                            </button>
                        </div>
                    </div>

                    {/* TARJETA 3: EXPORTAR CSV CLIENTES */}
                    <div className="bg-black/60 border border-zinc-800 hover:border-blue-500/40 p-6 rounded-2xl flex flex-col justify-between transition-all group shadow-lg">
                        <div>
                            <div className="flex items-center justify-between mb-4">
                                <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                </div>
                                <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 text-[10px] font-tech font-bold uppercase rounded">
                                    EXCEL / CSV
                                </span>
                            </div>
                            <h4 className="text-base font-tech font-bold text-white uppercase group-hover:text-blue-400 transition-colors">
                                EXPORTAR CLIENTES (CSV)
                            </h4>
                            <p className="text-xs text-zinc-400 font-mono-tech mt-2 leading-relaxed">
                                Descarga una hoja de cálculo completa con todos los datos de los socios: teléfonos, estatus de vigencia, asistencias totales, pagos acumulados, huella y credencial.
                            </p>
                        </div>

                        <div className="mt-6 pt-4 border-t border-zinc-800/80">
                            {isExportingCsv ? (
                                <div className="flex items-center justify-center gap-2 py-3 px-4 bg-blue-500/20 border border-blue-500 text-blue-400 font-tech font-bold text-xs uppercase rounded-xl animate-pulse">
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span>{csvProgress || 'EXPORTANDO CSV...'}</span>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={handleExportClientsCsv}
                                    className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 text-white font-tech font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-[0_0_15px_rgba(37,99,235,0.2)] flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                    DESCARGAR CSV DE CLIENTES
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* MODAL DE CONFIRMACIÓN DE RESTAURACIÓN DE BACKUP */}
            {showRestoreModal && restorePayload && (
                <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
                    <div className="bg-zinc-950 border-2 border-yellow-500/50 max-w-xl w-full p-6 sm:p-8 rounded-2xl shadow-[0_0_50px_rgba(234,179,8,0.2)] relative animate-[fadeIn_0.3s_ease-out] max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-yellow-400">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                    </svg>
                                </div>
                                <div>
                                    <h3 className="text-lg font-tech font-bold text-white uppercase">
                                        CONFIRMAR RESTAURACIÓN DE BACKUP
                                    </h3>
                                    <p className="text-xs text-zinc-400 font-mono-tech">
                                        Archivo: <span className="text-yellow-400 font-bold">{restoreFileName}</span>
                                    </p>
                                </div>
                            </div>
                            {!isRestoring && (
                                <button
                                    onClick={() => setShowRestoreModal(false)}
                                    className="text-zinc-500 hover:text-white p-1 text-lg font-bold"
                                >
                                    ✕
                                </button>
                            )}
                        </div>

                        {/* Metadatos y conteo de registros */}
                        <div className="mt-5 bg-black/60 border border-zinc-800 p-4 rounded-xl">
                            <div className="text-[11px] font-tech font-bold text-yellow-500 uppercase tracking-wider mb-3">
                                CONTENIDO DETECTADO EN EL ARCHIVO:
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono-tech">
                                <div className="p-2 bg-zinc-900/80 rounded border border-zinc-800">
                                    <span className="text-zinc-400 block text-[10px]">SOCIOS / CLIENTES</span>
                                    <strong className="text-white text-base">{restorePayload.counts?.clients ?? restorePayload.data?.clients?.length ?? 0}</strong>
                                </div>
                                <div className="p-2 bg-zinc-900/80 rounded border border-zinc-800">
                                    <span className="text-zinc-400 block text-[10px]">SUSCRIPCIONES</span>
                                    <strong className="text-white text-base">{restorePayload.counts?.client_subscriptions ?? restorePayload.data?.client_subscriptions?.length ?? 0}</strong>
                                </div>
                                <div className="p-2 bg-zinc-900/80 rounded border border-zinc-800">
                                    <span className="text-zinc-400 block text-[10px]">PLANES / PAQUETES</span>
                                    <strong className="text-white text-base">{restorePayload.counts?.packages ?? restorePayload.data?.packages?.length ?? 0}</strong>
                                </div>
                                <div className="p-2 bg-zinc-900/80 rounded border border-zinc-800">
                                    <span className="text-zinc-400 block text-[10px]">DISCIPLINAS</span>
                                    <strong className="text-white text-base">{restorePayload.counts?.activities ?? restorePayload.data?.activities?.length ?? 0}</strong>
                                </div>
                                <div className="p-2 bg-zinc-900/80 rounded border border-zinc-800">
                                    <span className="text-zinc-400 block text-[10px]">ASISTENCIAS</span>
                                    <strong className="text-white text-base">{restorePayload.counts?.attendance ?? restorePayload.data?.attendance?.length ?? 0}</strong>
                                </div>
                                <div className="p-2 bg-zinc-900/80 rounded border border-zinc-800">
                                    <span className="text-zinc-400 block text-[10px]">PAGOS / CAJA</span>
                                    <strong className="text-white text-base">{restorePayload.counts?.payments ?? restorePayload.data?.payments?.length ?? 0}</strong>
                                </div>
                            </div>
                            {restorePayload.exported_at && (
                                <p className="text-[10px] text-zinc-500 font-mono-tech mt-3">
                                    Fecha de generación del backup: {new Date(restorePayload.exported_at).toLocaleString('es-MX')}
                                </p>
                            )}
                        </div>

                        {/* Estado durante restauración */}
                        {isRestoring && (
                            <div className="mt-5 p-4 bg-yellow-500/10 border border-yellow-500/40 rounded-xl space-y-3">
                                <div className="flex items-center justify-between text-xs font-tech font-bold text-yellow-400 uppercase">
                                    <span>{restoreProgressText || 'Restaurando base de datos...'}</span>
                                    <span>{restorePercent}%</span>
                                </div>
                                <div className="w-full bg-zinc-900 h-3 rounded-full overflow-hidden border border-zinc-700">
                                    <div
                                        className="bg-yellow-500 h-full transition-all duration-300 shadow-[0_0_10px_#eab308]"
                                        style={{ width: `${restorePercent}%` }}
                                    ></div>
                                </div>
                                <p className="text-[10px] text-zinc-400 font-mono-tech text-center">
                                    Por favor no cierres esta ventana mientras se actualizan las tablas en Supabase.
                                </p>
                            </div>
                        )}

                        {/* Resumen al terminar */}
                        {restoreSummary && (
                            <div className="mt-5 p-4 bg-emerald-500/10 border border-emerald-500/40 rounded-xl">
                                <div className="flex items-center gap-2 text-emerald-400 font-tech font-bold text-sm uppercase mb-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                    RESTAURACIÓN FINALIZADA CON ÉXITO
                                </div>
                                <p className="text-xs text-zinc-300 font-mono-tech">
                                    Se insertaron / sincronizaron un total de <strong className="text-white">{restoreSummary.totalRestored}</strong> registros en la base de datos de Supabase.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowRestoreModal(false);
                                        window.location.reload();
                                    }}
                                    className="mt-4 w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-tech font-bold text-xs uppercase rounded-xl transition-all cursor-pointer"
                                >
                                    ENTENDIDO / RECARGAR SISTEMA
                                </button>
                            </div>
                        )}

                        {/* Confirmación antes de restaurar */}
                        {!isRestoring && !restoreSummary && (
                            <>
                                <div className="mt-5 p-4 bg-red-950/30 border border-red-500/40 rounded-xl text-xs font-mono-tech text-red-200 leading-relaxed">
                                    <strong className="text-red-400 font-bold block mb-1 uppercase font-tech tracking-wider">
                                        ⚠️ AVISO IMPORTANTE DE SEGURIDAD:
                                    </strong>
                                    Esta operación sincronizará e insertará los registros del backup en la base de datos. Los registros existentes con el mismo identificador serán actualizados con la información del archivo.
                                </div>

                                <div className="mt-5 space-y-2">
                                    <label className="block text-xs font-tech text-zinc-300 uppercase tracking-wider">
                                        Para autorizar, escribe <span className="text-yellow-400 font-bold">RESTAURAR</span> a continuación:
                                    </label>
                                    <input
                                        type="text"
                                        value={restoreConfirmText}
                                        onChange={(e) => setRestoreConfirmText(e.target.value.toUpperCase())}
                                        placeholder="Escribe RESTAURAR"
                                        className="w-full bg-black border-2 border-zinc-700 px-4 py-3 text-white font-mono-tech text-center text-sm font-bold tracking-widest focus:border-yellow-500 outline-none rounded-xl uppercase"
                                    />
                                </div>

                                <div className="mt-6 flex flex-col sm:flex-row items-center justify-end gap-3 pt-4 border-t border-zinc-800">
                                    <button
                                        type="button"
                                        onClick={() => setShowRestoreModal(false)}
                                        className="w-full sm:w-auto px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-tech font-bold text-xs uppercase rounded-xl transition-all cursor-pointer"
                                    >
                                        CANCELAR
                                    </button>
                                    <button
                                        type="button"
                                        disabled={restoreConfirmText.trim().toUpperCase() !== 'RESTAURAR'}
                                        onClick={handleConfirmRestore}
                                        className="w-full sm:w-auto px-6 py-2.5 bg-yellow-500 hover:bg-yellow-400 text-black font-tech font-bold text-xs uppercase rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(234,179,8,0.3)] cursor-pointer"
                                    >
                                        CONFIRMAR Y RESTAURAR BASE DE DATOS
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
            
            <div className="mt-8 p-4 border border-yellow-500/20 bg-yellow-900/5 text-yellow-500/60 text-xs font-mono-tech text-center">
                NOTA: Al guardar, la configuración se sincroniza en la base de datos de Supabase y aplica en todas las terminales de Huella y QR.
            </div>
        </div>
    );
};

export default SystemConfigPanel;
