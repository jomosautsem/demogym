
import { supabase } from './supabaseClient';
import { Client, AttendanceRecord, Activity, Package, PackageWithActivities, SystemUser, UserRole, Payment, PaymentMethod, WelcomeEmailData, Expense, SystemConfig, Product, CartItem, ClientSubscription, ScannerRescanRule, AttendanceLogResult } from '../types';
import { compare, hash, genSalt } from 'bcrypt-ts';
import { audioService } from './audioService';

// Helper to generate IDs
const generateId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        try {
            return crypto.randomUUID();
        } catch {
            // Ignore error
        }
    }
    return Math.random().toString(36).substring(2, 11) + '-' + Date.now().toString(36);
};

// Ayudante para convertir una URL de datos base64 a un Blob
export const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
  const res = await fetch(dataUrl);
  return await res.blob();
};

export const sendWelcomeEmail = async (data: WelcomeEmailData): Promise<boolean> => {
   try {
     const { error } = await supabase.functions.invoke('send-welcome-email', { body: data });
     return !error;
   } catch (err) {
     console.warn("Error enviando correo de bienvenida:", err);
     return false;
   }
};

// --- SYSTEM CONFIGURATION FUNCTIONS (BRANDING) ---

export const DEFAULT_WA_TEMPLATE = "Hola *{NOMBRE}* 👋, te recordamos que tu membresía vence en *{DIAS} días* ({FECHA}). ⏳\n\n¡No pierdas tu ritmo! Te esperamos en recepción para renovar. 💪🔥";
export const DEFAULT_WA_RECOVERY_TEMPLATE = "Hola *{NOMBRE}* 👋, notamos que tu membresía venció el *{FECHA}*. 🛑\n\n¡Tu progreso es importante! Regresa hoy y sigue alcanzando tus metas. Te esperamos. 🥊✨";
export const DEFAULT_WA_WELCOME_TEMPLATE = "Hola *{NOMBRE}* 👋, ¡Bienvenido a Kali Access! 🏋️‍♂️\n\n📋 *Detalles de tu registro:*\n📅 Inicio: *{FECHA_INICIO}*\n🏁 Fin: *{FECHA_FIN}*\n💰 Pago: *${PAGO}* ({CONCEPTO})\n\n¡A entrenar con todo! 💪🔥";
export const DEFAULT_WA_RENEWAL_TEMPLATE = "Hola *{NOMBRE}* 👋, gracias por tu pago de *${PAGO}*.\n\n✅ *RENOVACIÓN EXITOSA*\n📦 Plan: *{PLAN}*\n📅 Nuevo Vencimiento: *{FECHA_FIN}*\n\n¡A seguir entrenando con todo! 💪🔥";
export const DEFAULT_WA_PAYMENT_TEMPLATE = "Hola *{NOMBRE}*! 👋\nTe confirmamos la recepción de tu pago registrado en recepción:\n\n🧾 *COMPROBANTE DE PAGO*\n🔖 Folio: *{FOLIO}*\n📅 Fecha: *{FECHA}*\n💰 Monto: *${MONTO} MXN*\n🏷️ Concepto: *{CONCEPTO}*\n💳 Método: *{METODO}*\n👤 Atendido por: *{COACH}*\n\n✅ _Pago registrado exitosamente en caja y en tu historial de socio._\n\n¡Gracias por tu pago y buen entrenamiento! 💪🔥";

export const DEFAULT_RULES_CONTENT = 
`⚠️ REGLAMENTO DE SEGURIDAD Y CONVIVENCIA

1. ES OBLIGATORIO EL USO DE ::TOALLA INDIVIDUAL:: EN TODAS LAS ÁREAS.
2. PROHIBIDO ::AZOTAR LAS PESAS:: O MANCUERNAS. CUIDA EL EQUIPO.
3. LIMPIA Y ORDENA TU LUGAR ::DESPUÉS DE USARLO::.
4. ACCESO DENEGADO SIN ::ROPA DEPORTIVA ADECUADA:: Y CALZADO CERRADO.
5. LA ::MEMBRESÍA ES INTRANSFERIBLE::. EL USO INDEBIDO CAUSARÁ BAJA DEFINITIVA.
6. MANTÉN EL RESPETO CON STAFF Y OTROS USUARIOS. ::CERO TOLERANCIA A LA VIOLENCIA::.

EL INCUMPLIMIENTO DE ESTAS NORMAS RESULTARÁ EN ::SUSPENSIÓN INMEDIATA::.`;

const VALID_RESCAN_RULES: ScannerRescanRule[] = ['ONCE_PER_DAY', 'ALLOW_WITH_BADGE', 'WINDOW_2H', 'WINDOW_4H', 'WINDOW_5M'];

export const getSystemConfig = async (): Promise<SystemConfig> => {
    let localPaymentTpl: string | null = null;
    let localRequirePin: boolean = true;
    let localScannerDuration: number = 4;
    let localDeniedExtraTime: boolean = true;
    let localRescanRule: ScannerRescanRule = 'ONCE_PER_DAY';
    let localAllowManualReentry: boolean = true;
    let localAudioGrantedUrl: string | null = null;
    let localAudioWarningUrl: string | null = null;
    let localAudioDeniedUrl: string | null = null;
    let localAudioVolume: number = 80;
    let localAudioEnabled: boolean = true;
    let localAudioGrantedEnabled: boolean = true;
    let localAudioWarningEnabled: boolean = true;
    let localAudioDeniedEnabled: boolean = true;

    try {
        localPaymentTpl = localStorage.getItem('system_config_wa_template_payment');
        const storedPin = localStorage.getItem('system_config_require_biometric_exit_pin');
        if (storedPin !== null) {
            localRequirePin = storedPin === 'true';
        }
        const storedDuration = localStorage.getItem('system_config_scanner_message_duration');
        if (storedDuration !== null) {
            const parsed = Number(storedDuration);
            if ([3, 4, 5, 6].includes(parsed)) {
                localScannerDuration = parsed;
            }
        }
        const storedDeniedExtra = localStorage.getItem('system_config_scanner_denied_extra_time');
        if (storedDeniedExtra !== null) {
            localDeniedExtraTime = storedDeniedExtra === 'true';
        }
        const storedRescanRule = localStorage.getItem('system_config_scanner_rescan_rule') as ScannerRescanRule | null;
        if (storedRescanRule && VALID_RESCAN_RULES.includes(storedRescanRule)) {
            localRescanRule = storedRescanRule;
        }
        const storedManualReentry = localStorage.getItem('system_config_scanner_allow_manual_reentry');
        if (storedManualReentry !== null) {
            localAllowManualReentry = storedManualReentry === 'true';
        }
        localAudioGrantedUrl = localStorage.getItem('system_config_audio_granted_url') || null;
        localAudioWarningUrl = localStorage.getItem('system_config_audio_warning_url') || null;
        localAudioDeniedUrl = localStorage.getItem('system_config_audio_denied_url') || null;
        const storedVol = localStorage.getItem('system_config_audio_volume');
        if (storedVol !== null) localAudioVolume = Math.max(0, Math.min(100, Number(storedVol)));
        const storedAudEnabled = localStorage.getItem('system_config_audio_enabled');
        if (storedAudEnabled !== null) localAudioEnabled = storedAudEnabled === 'true';
        const storedGrantedEnabled = localStorage.getItem('system_config_audio_granted_enabled');
        if (storedGrantedEnabled !== null) localAudioGrantedEnabled = storedGrantedEnabled === 'true';
        const storedWarnEnabled = localStorage.getItem('system_config_audio_warning_enabled');
        if (storedWarnEnabled !== null) localAudioWarningEnabled = storedWarnEnabled === 'true';
        const storedDeniedEnabled = localStorage.getItem('system_config_audio_denied_enabled');
        if (storedDeniedEnabled !== null) localAudioDeniedEnabled = storedDeniedEnabled === 'true';
    } catch {}

    const defaultConf: SystemConfig = {
        id: 1,
        org_name: 'Kali Access',
        primary_color: '#eab308', 
        logo_url: null,
        favicon_url: null,
        wa_template_warning: DEFAULT_WA_TEMPLATE,
        wa_template_recovery: DEFAULT_WA_RECOVERY_TEMPLATE,
        wa_template_welcome: DEFAULT_WA_WELCOME_TEMPLATE,
        wa_template_renewal: DEFAULT_WA_RENEWAL_TEMPLATE,
        wa_template_payment: localPaymentTpl || DEFAULT_WA_PAYMENT_TEMPLATE,
        rules_content: DEFAULT_RULES_CONTENT,
        require_biometric_exit_pin: localRequirePin,
        scanner_message_duration: localScannerDuration,
        scanner_denied_extra_time: localDeniedExtraTime,
        scanner_rescan_rule: localRescanRule,
        scanner_allow_manual_reentry: localAllowManualReentry,
        audio_granted_url: localAudioGrantedUrl,
        audio_warning_url: localAudioWarningUrl,
        audio_denied_url: localAudioDeniedUrl,
        audio_volume: localAudioVolume,
        audio_enabled: localAudioEnabled,
        audio_granted_enabled: localAudioGrantedEnabled,
        audio_warning_enabled: localAudioWarningEnabled,
        audio_denied_enabled: localAudioDeniedEnabled
    };

    try {
        const { data, error } = await supabase.from('system_config').select('*').eq('id', 1).single();
        
        if (error) {
            audioService.syncWithConfig(defaultConf).catch(() => {});
            return defaultConf;
        }
        
        const dbDuration = Number(data.scanner_message_duration);
        const resolvedDuration = [3, 4, 5, 6].includes(dbDuration) ? dbDuration : localScannerDuration;
        const resolvedDeniedExtra = data.scanner_denied_extra_time !== undefined && data.scanner_denied_extra_time !== null
            ? Boolean(data.scanner_denied_extra_time)
            : localDeniedExtraTime;
        const resolvedPin = data.require_biometric_exit_pin !== undefined && data.require_biometric_exit_pin !== null
            ? Boolean(data.require_biometric_exit_pin)
            : localRequirePin;
        const resolvedRescanRule: ScannerRescanRule = data.scanner_rescan_rule && VALID_RESCAN_RULES.includes(data.scanner_rescan_rule)
            ? data.scanner_rescan_rule
            : localRescanRule;
        const resolvedManualReentry = data.scanner_allow_manual_reentry !== undefined && data.scanner_allow_manual_reentry !== null
            ? Boolean(data.scanner_allow_manual_reentry)
            : localAllowManualReentry;

        const resolvedAudioGranted = data.audio_granted_url !== undefined && data.audio_granted_url !== null
            ? data.audio_granted_url
            : localAudioGrantedUrl;
        const resolvedAudioWarning = data.audio_warning_url !== undefined && data.audio_warning_url !== null
            ? data.audio_warning_url
            : localAudioWarningUrl;
        const resolvedAudioDenied = data.audio_denied_url !== undefined && data.audio_denied_url !== null
            ? data.audio_denied_url
            : localAudioDeniedUrl;
        const resolvedAudioVol = data.audio_volume !== undefined && data.audio_volume !== null
            ? Number(data.audio_volume)
            : localAudioVolume;
        const resolvedAudioEnabled = data.audio_enabled !== undefined && data.audio_enabled !== null
            ? Boolean(data.audio_enabled)
            : localAudioEnabled;
        const resolvedAudioGrantedEnabled = data.audio_granted_enabled !== undefined && data.audio_granted_enabled !== null
            ? Boolean(data.audio_granted_enabled)
            : localAudioGrantedEnabled;
        const resolvedAudioWarningEnabled = data.audio_warning_enabled !== undefined && data.audio_warning_enabled !== null
            ? Boolean(data.audio_warning_enabled)
            : localAudioWarningEnabled;
        const resolvedAudioDeniedEnabled = data.audio_denied_enabled !== undefined && data.audio_denied_enabled !== null
            ? Boolean(data.audio_denied_enabled)
            : localAudioDeniedEnabled;

        // Sincronizar caché local con los valores de la base de datos
        try {
            if ([3, 4, 5, 6].includes(dbDuration)) {
                localStorage.setItem('system_config_scanner_message_duration', String(dbDuration));
            }
            if (data.scanner_denied_extra_time !== undefined && data.scanner_denied_extra_time !== null) {
                localStorage.setItem('system_config_scanner_denied_extra_time', String(Boolean(data.scanner_denied_extra_time)));
            }
            if (data.require_biometric_exit_pin !== undefined && data.require_biometric_exit_pin !== null) {
                localStorage.setItem('system_config_require_biometric_exit_pin', String(Boolean(data.require_biometric_exit_pin)));
            }
            if (data.scanner_rescan_rule && VALID_RESCAN_RULES.includes(data.scanner_rescan_rule)) {
                localStorage.setItem('system_config_scanner_rescan_rule', data.scanner_rescan_rule);
            }
            if (data.scanner_allow_manual_reentry !== undefined && data.scanner_allow_manual_reentry !== null) {
                localStorage.setItem('system_config_scanner_allow_manual_reentry', String(Boolean(data.scanner_allow_manual_reentry)));
            }
            if (resolvedAudioGranted) localStorage.setItem('system_config_audio_granted_url', resolvedAudioGranted);
            if (resolvedAudioWarning) localStorage.setItem('system_config_audio_warning_url', resolvedAudioWarning);
            if (resolvedAudioDenied) localStorage.setItem('system_config_audio_denied_url', resolvedAudioDenied);
            localStorage.setItem('system_config_audio_volume', String(resolvedAudioVol));
            localStorage.setItem('system_config_audio_enabled', String(resolvedAudioEnabled));
            localStorage.setItem('system_config_audio_granted_enabled', String(resolvedAudioGrantedEnabled));
            localStorage.setItem('system_config_audio_warning_enabled', String(resolvedAudioWarningEnabled));
            localStorage.setItem('system_config_audio_denied_enabled', String(resolvedAudioDeniedEnabled));
        } catch {}

        const finalConfig: SystemConfig = {
            ...data,
            wa_template_warning: data.wa_template_warning || DEFAULT_WA_TEMPLATE,
            wa_template_recovery: data.wa_template_recovery || DEFAULT_WA_RECOVERY_TEMPLATE,
            wa_template_welcome: data.wa_template_welcome || DEFAULT_WA_WELCOME_TEMPLATE,
            wa_template_renewal: data.wa_template_renewal || DEFAULT_WA_RENEWAL_TEMPLATE,
            wa_template_payment: localPaymentTpl || data.wa_template_payment || DEFAULT_WA_PAYMENT_TEMPLATE,
            rules_content: data.rules_content || DEFAULT_RULES_CONTENT,
            require_biometric_exit_pin: resolvedPin,
            scanner_message_duration: resolvedDuration,
            scanner_denied_extra_time: resolvedDeniedExtra,
            scanner_rescan_rule: resolvedRescanRule,
            scanner_allow_manual_reentry: resolvedManualReentry,
            audio_granted_url: resolvedAudioGranted,
            audio_warning_url: resolvedAudioWarning,
            audio_denied_url: resolvedAudioDenied,
            audio_volume: resolvedAudioVol,
            audio_enabled: resolvedAudioEnabled,
            audio_granted_enabled: resolvedAudioGrantedEnabled,
            audio_warning_enabled: resolvedAudioWarningEnabled,
            audio_denied_enabled: resolvedAudioDeniedEnabled
        };

        audioService.syncWithConfig(finalConfig).catch(() => {});
        return finalConfig;
    } catch (e) {
        audioService.syncWithConfig(defaultConf).catch(() => {});
        return defaultConf;
    }
};

export const updateSystemConfig = async (
    config: Partial<SystemConfig>, 
    logoBase64?: string, 
    faviconBase64?: string,
    audioUploads?: {
        grantedDataUrl?: string;
        warningDataUrl?: string;
        deniedDataUrl?: string;
    }
): Promise<SystemConfig> => {
    let logoUrl = config.logo_url;
    let faviconUrl = config.favicon_url;
    let audioGrantedUrl = config.audio_granted_url;
    let audioWarningUrl = config.audio_warning_url;
    let audioDeniedUrl = config.audio_denied_url;

    if (config.wa_template_payment !== undefined) {
        try {
            localStorage.setItem('system_config_wa_template_payment', config.wa_template_payment);
        } catch {}
    }

    if (config.require_biometric_exit_pin !== undefined) {
        try {
            localStorage.setItem('system_config_require_biometric_exit_pin', String(config.require_biometric_exit_pin));
        } catch {}
    }

    if (config.scanner_message_duration !== undefined) {
        try {
            localStorage.setItem('system_config_scanner_message_duration', String(config.scanner_message_duration));
        } catch {}
    }

    if (config.scanner_denied_extra_time !== undefined) {
        try {
            localStorage.setItem('system_config_scanner_denied_extra_time', String(config.scanner_denied_extra_time));
        } catch {}
    }

    if (config.scanner_rescan_rule !== undefined) {
        try {
            localStorage.setItem('system_config_scanner_rescan_rule', config.scanner_rescan_rule);
        } catch {}
    }

    if (config.scanner_allow_manual_reentry !== undefined) {
        try {
            localStorage.setItem('system_config_scanner_allow_manual_reentry', String(config.scanner_allow_manual_reentry));
        } catch {}
    }

    // Guardar opciones de audio en localStorage de inmediato para funcionamiento offline
    try {
        if (config.audio_volume !== undefined) localStorage.setItem('system_config_audio_volume', String(config.audio_volume));
        if (config.audio_enabled !== undefined) localStorage.setItem('system_config_audio_enabled', String(config.audio_enabled));
        if (config.audio_granted_enabled !== undefined) localStorage.setItem('system_config_audio_granted_enabled', String(config.audio_granted_enabled));
        if (config.audio_warning_enabled !== undefined) localStorage.setItem('system_config_audio_warning_enabled', String(config.audio_warning_enabled));
        if (config.audio_denied_enabled !== undefined) localStorage.setItem('system_config_audio_denied_enabled', String(config.audio_denied_enabled));
        if (audioGrantedUrl !== undefined) localStorage.setItem('system_config_audio_granted_url', audioGrantedUrl || '');
        if (audioWarningUrl !== undefined) localStorage.setItem('system_config_audio_warning_url', audioWarningUrl || '');
        if (audioDeniedUrl !== undefined) localStorage.setItem('system_config_audio_denied_url', audioDeniedUrl || '');
    } catch {}

    if (logoBase64) {
        const blob = await dataUrlToBlob(logoBase64);
        const filePath = `public/logo_${Date.now()}.png`;
        const { error: uploadError } = await supabase.storage.from('client_photos').upload(filePath, blob);
        if (!uploadError) {
            const { data } = supabase.storage.from('client_photos').getPublicUrl(filePath);
            logoUrl = data.publicUrl;
        }
    }

    if (faviconBase64) {
        const blob = await dataUrlToBlob(faviconBase64);
        const filePath = `public/favicon_${Date.now()}.ico`;
        const { error: uploadError } = await supabase.storage.from('client_photos').upload(filePath, blob);
        if (!uploadError) {
            const { data } = supabase.storage.from('client_photos').getPublicUrl(filePath);
            faviconUrl = data.publicUrl;
        }
    }

    // Subir archivos de audio personalizados a Supabase Storage (Nube)
    if (audioUploads?.grantedDataUrl && audioUploads.grantedDataUrl.startsWith('data:')) {
        try {
            const blob = await dataUrlToBlob(audioUploads.grantedDataUrl);
            const filePath = `audios/alarm_granted_${Date.now()}.mp3`;
            const { error: uploadErr } = await supabase.storage.from('client_photos').upload(filePath, blob, { contentType: 'audio/mpeg', upsert: true });
            if (!uploadErr) {
                const { data } = supabase.storage.from('client_photos').getPublicUrl(filePath);
                audioGrantedUrl = data.publicUrl;
                try { localStorage.setItem('system_config_audio_granted_url', audioGrantedUrl); } catch {}
            }
        } catch (e) {
            console.warn("Fallo subiendo audio granted a Supabase:", e);
        }
    }

    if (audioUploads?.warningDataUrl && audioUploads.warningDataUrl.startsWith('data:')) {
        try {
            const blob = await dataUrlToBlob(audioUploads.warningDataUrl);
            const filePath = `audios/alarm_warning_${Date.now()}.mp3`;
            const { error: uploadErr } = await supabase.storage.from('client_photos').upload(filePath, blob, { contentType: 'audio/mpeg', upsert: true });
            if (!uploadErr) {
                const { data } = supabase.storage.from('client_photos').getPublicUrl(filePath);
                audioWarningUrl = data.publicUrl;
                try { localStorage.setItem('system_config_audio_warning_url', audioWarningUrl); } catch {}
            }
        } catch (e) {
            console.warn("Fallo subiendo audio warning a Supabase:", e);
        }
    }

    if (audioUploads?.deniedDataUrl && audioUploads.deniedDataUrl.startsWith('data:')) {
        try {
            const blob = await dataUrlToBlob(audioUploads.deniedDataUrl);
            const filePath = `audios/alarm_denied_${Date.now()}.mp3`;
            const { error: uploadErr } = await supabase.storage.from('client_photos').upload(filePath, blob, { contentType: 'audio/mpeg', upsert: true });
            if (!uploadErr) {
                const { data } = supabase.storage.from('client_photos').getPublicUrl(filePath);
                audioDeniedUrl = data.publicUrl;
                try { localStorage.setItem('system_config_audio_denied_url', audioDeniedUrl); } catch {}
            }
        } catch (e) {
            console.warn("Fallo subiendo audio denied a Supabase:", e);
        }
    }

    const updates = {
        ...config,
        logo_url: logoUrl,
        favicon_url: faviconUrl,
        audio_granted_url: audioGrantedUrl,
        audio_warning_url: audioWarningUrl,
        audio_denied_url: audioDeniedUrl,
        id: 1 
    };

    const { data, error } = await supabase.from('system_config').upsert(updates).select().single();
    
    if (error) {
        if (error.code === '42P01') throw new Error("La tabla 'system_config' no existe.");
        
        const isMissingColumnError = 
            error.code === '42703' || 
            error.code === 'PGRST204' || 
            (error.message && error.message.toLowerCase().includes('schema cache')) ||
            (error.message && error.message.toLowerCase().includes('could not find'));

        if (isMissingColumnError) { 
             console.warn("Columna no encontrada en system_config de Supabase. Guardando cambios locales y reintentando upsert.");
             const fallbackUpdates: any = { ...updates };
             delete fallbackUpdates.rules_content;
             delete fallbackUpdates.wa_template_renewal;
             delete fallbackUpdates.wa_template_payment;
             delete fallbackUpdates.require_biometric_exit_pin;
             delete fallbackUpdates.scanner_message_duration;
             delete fallbackUpdates.scanner_denied_extra_time;
             delete fallbackUpdates.scanner_rescan_rule;
             delete fallbackUpdates.scanner_allow_manual_reentry;
             delete fallbackUpdates.audio_granted_url;
             delete fallbackUpdates.audio_warning_url;
             delete fallbackUpdates.audio_denied_url;
             delete fallbackUpdates.audio_volume;
             delete fallbackUpdates.audio_enabled;
             delete fallbackUpdates.audio_granted_enabled;
             delete fallbackUpdates.audio_warning_enabled;
             delete fallbackUpdates.audio_denied_enabled;
             
             const { data: retryData, error: retryError } = await supabase.from('system_config').upsert(fallbackUpdates).select().single();
             if (retryError) {
                 console.warn("Error en reintento parcial:", retryError);
                 const localFallback = {
                     id: 1,
                     org_name: updates.org_name || 'Kali Access',
                     primary_color: updates.primary_color || '#eab308',
                     logo_url: logoUrl,
                     favicon_url: faviconUrl,
                     rules_content: config.rules_content,
                     wa_template_payment: config.wa_template_payment,
                     require_biometric_exit_pin: config.require_biometric_exit_pin !== undefined ? config.require_biometric_exit_pin : true,
                     scanner_message_duration: config.scanner_message_duration ?? 4,
                     scanner_denied_extra_time: config.scanner_denied_extra_time !== undefined ? config.scanner_denied_extra_time : true,
                     scanner_rescan_rule: config.scanner_rescan_rule || 'ONCE_PER_DAY',
                     scanner_allow_manual_reentry: config.scanner_allow_manual_reentry !== undefined ? config.scanner_allow_manual_reentry : true,
                     audio_granted_url: audioGrantedUrl,
                     audio_warning_url: audioWarningUrl,
                     audio_denied_url: audioDeniedUrl,
                     audio_volume: config.audio_volume ?? 80,
                     audio_enabled: config.audio_enabled !== undefined ? config.audio_enabled : true,
                     audio_granted_enabled: config.audio_granted_enabled !== undefined ? config.audio_granted_enabled : true,
                     audio_warning_enabled: config.audio_warning_enabled !== undefined ? config.audio_warning_enabled : true,
                     audio_denied_enabled: config.audio_denied_enabled !== undefined ? config.audio_denied_enabled : true
                 } as SystemConfig;
                 audioService.syncWithConfig(localFallback).catch(() => {});
                 return localFallback;
             }
             const resultFallback = { 
                 ...retryData, 
                 rules_content: config.rules_content, 
                 wa_template_payment: config.wa_template_payment,
                 require_biometric_exit_pin: config.require_biometric_exit_pin !== undefined ? config.require_biometric_exit_pin : true,
                 scanner_message_duration: config.scanner_message_duration ?? 4,
                 scanner_denied_extra_time: config.scanner_denied_extra_time !== undefined ? config.scanner_denied_extra_time : true,
                 scanner_rescan_rule: config.scanner_rescan_rule || 'ONCE_PER_DAY',
                 scanner_allow_manual_reentry: config.scanner_allow_manual_reentry !== undefined ? config.scanner_allow_manual_reentry : true,
                 audio_granted_url: audioGrantedUrl,
                 audio_warning_url: audioWarningUrl,
                 audio_denied_url: audioDeniedUrl,
                 audio_volume: config.audio_volume ?? 80,
                 audio_enabled: config.audio_enabled !== undefined ? config.audio_enabled : true,
                 audio_granted_enabled: config.audio_granted_enabled !== undefined ? config.audio_granted_enabled : true,
                 audio_warning_enabled: config.audio_warning_enabled !== undefined ? config.audio_warning_enabled : true,
                 audio_denied_enabled: config.audio_denied_enabled !== undefined ? config.audio_denied_enabled : true
             } as SystemConfig;
             if (typeof window !== 'undefined') {
                 window.dispatchEvent(new CustomEvent('kali_system_config_updated', { detail: resultFallback }));
             }
             audioService.syncWithConfig(resultFallback).catch(() => {});
             return resultFallback;
        }
        throw error;
    }

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kali_system_config_updated', { detail: data }));
    }

    const finalResult = data as SystemConfig;
    audioService.syncWithConfig(finalResult).catch(() => {});
    return finalResult;
};

// --- AUTH ---

export const KALI_STAFF_PERMS_KEY = 'kali_staff_permissions_map';

export const getStaffPermissionsMap = (): Record<string, { can_manage_fingerprints?: boolean; can_renew?: boolean; can_edit_membership?: boolean }> => {
  try {
    const raw = localStorage.getItem(KALI_STAFF_PERMS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

export const saveStaffPermission = (userId: string, email: string, permissions: { can_manage_fingerprints?: boolean; can_renew?: boolean; can_edit_membership?: boolean }) => {
  try {
    const current = getStaffPermissionsMap();
    if (userId) {
      current[userId] = { ...current[userId], ...permissions };
    }
    if (email && email.trim()) {
      current[email.toLowerCase().trim()] = { ...current[email.toLowerCase().trim()], ...permissions };
    }
    localStorage.setItem(KALI_STAFF_PERMS_KEY, JSON.stringify(current));

    // Notificar en tiempo real al resto de la aplicación y otras pestañas
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('kali_staff_perms_changed', {
        detail: { userId, email: email ? email.toLowerCase().trim() : '', permissions }
      }));
    }
  } catch (e) {
    console.warn("Error guardando mapa local de permisos de staff:", e);
  }
};

export const removeStaffPermission = (userId: string, email?: string) => {
  try {
    const current = getStaffPermissionsMap();
    if (userId && current[userId]) delete current[userId];
    if (email && current[email.toLowerCase().trim()]) delete current[email.toLowerCase().trim()];
    localStorage.setItem(KALI_STAFF_PERMS_KEY, JSON.stringify(current));
  } catch {}
};

export const authenticateUser = async (email: string, passwordInput: string): Promise<{ isAuthenticated: boolean; role: UserRole; name: string; allowedActivityIds?: string[]; allowedPackageIds?: string[]; canRenew?: boolean; canManageFingerprints?: boolean; canEditMembership?: boolean; email?: string } | null> => {
  try {
    const { data, error } = await supabase.from('system_users').select('*').eq('email', email).single();

    if (!error && data) {
      if (!data.is_active) throw new Error("Usuario desactivado.");

      let passwordIsValid = false;
      const storedPass = data.password || '';
      if (storedPass.startsWith('INVITE_TOKEN::')) {
        throw new Error("Tu cuenta tiene una invitación pendiente de activar. Abre el enlace enviado a tu correo o WhatsApp para crear tu contraseña.");
      }
      const isHashed = storedPass.startsWith('$2');

      if (isHashed) {
        passwordIsValid = await compare(passwordInput, storedPass);
      } else {
        if (storedPass === passwordInput) {
          passwordIsValid = true;
          const newHash = await hash(passwordInput, 10);
          await supabase.from('system_users').update({ password: newHash }).eq('id', data.id);
        }
      }

      if (passwordIsValid) {
        const permsMap = getStaffPermissionsMap();
        const userPerm = permsMap[data.id] || (data.email ? permsMap[data.email.toLowerCase().trim()] : undefined);
        const canRenewVal = userPerm?.can_renew !== undefined ? userPerm.can_renew : (data.can_renew ?? false);
        const canManageBioVal = userPerm?.can_manage_fingerprints !== undefined ? userPerm.can_manage_fingerprints : (data.can_manage_fingerprints ?? false);
        const canEditMemVal = userPerm?.can_edit_membership !== undefined ? userPerm.can_edit_membership : (data.can_edit_membership ?? false);

        return { 
          isAuthenticated: true, 
          role: data.role as UserRole, 
          name: data.name,
          allowedActivityIds: data.allowed_activity_ids || [],
          allowedPackageIds: data.allowed_package_ids || [],
          canRenew: canRenewVal,
          canManageFingerprints: canManageBioVal,
          canEditMembership: canEditMemVal,
          email: data.email
        };
      }
    }
  } catch (err: any) {
    if (err?.message && err.message.includes('invitación pendiente')) {
      throw err;
    }
    console.warn("Error verificando usuario:", err);
  }

  // Fallback Admin
  if (email === 'demoaccess@gmail.com' && passwordInput === 'demoaccess1') {
    return { isAuthenticated: true, role: UserRole.ADMIN, name: 'Admin Respaldo', allowedActivityIds: [], allowedPackageIds: [], canRenew: true, canManageFingerprints: true, canEditMembership: true, email: email };
  }

  return null;
};

export const validateSessionUser = async (email: string): Promise<boolean> => {
    if (email === 'demoaccess@gmail.com') return true;
    try {
        const { data, error } = await supabase.from('system_users').select('is_active').eq('email', email).single();
        if (error || !data) return false;
        return data.is_active;
    } catch (e) {
        return false;
    }
};

export const generateInviteTokenString = (): string => {
  const randomPart = Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
  return `INVITE_TOKEN::${randomPart}`;
};

export const buildStaffInvitationLink = (user: { id?: string; email: string; name: string }, token?: string): string => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const params = new URLSearchParams();
  params.set('staff_invite', '1');
  if (user.id) params.set('uid', user.id);
  params.set('email', user.email.toLowerCase().trim());
  if (user.name) params.set('name', user.name.trim());
  if (token) {
    const cleanToken = token.replace(/^INVITE_TOKEN::/, '');
    params.set('token', cleanToken);
  }
  return `${origin}/?${params.toString()}`;
};

export const sendSupabaseStaffInvitationEmail = async (
  email: string,
  name: string,
  redirectLink: string
): Promise<{ sent: boolean; warning?: string }> => {
  const cleanEmail = email.toLowerCase().trim();
  try {
    // 1. Intentar enviar Magic Link / Invitación OTP de Supabase Auth con creación automática de usuario
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirectLink,
        data: {
          full_name: name.trim(),
          invited_to_kali: true
        }
      }
    });

    if (!otpError) {
      return { sent: true };
    }

    // 2. Respaldo: si el usuario ya existe o signInWithOtp tiene restricción, intentar envío de correo de recuperación/establecimiento
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: redirectLink
    });

    if (!resetError) {
      return { sent: true };
    }

    return {
      sent: false,
      warning: otpError.message || resetError.message || 'Límite de envío de correo de Supabase alcanzado. Usa el enlace directo o WhatsApp.'
    };
  } catch (err: any) {
    return {
      sent: false,
      warning: err?.message || 'No se pudo enviar el correo automático. Usa el enlace directo por WhatsApp.'
    };
  }
};

export const activateInvitedUser = async (
  email: string, 
  name: string, 
  passwordInput: string,
  uid?: string
): Promise<{ 
  isAuthenticated: boolean; 
  role: UserRole; 
  name: string; 
  allowedActivityIds?: string[]; 
  allowedPackageIds?: string[]; 
  canRenew?: boolean; 
  canManageFingerprints?: boolean; 
  canEditMembership?: boolean; 
  email?: string 
}> => {
  const salt = await genSalt(10);
  const hashedPassword = await hash(passwordInput, salt);
  const cleanEmail = email.toLowerCase().trim();
  const displayName = name.trim() || cleanEmail.split('@')[0].toUpperCase();

  // 1. Revisar si el usuario ya existe en system_users (por uid o por email)
  let existingUser: any = null;
  if (uid) {
    const { data: byId } = await supabase
      .from('system_users')
      .select('*')
      .eq('id', uid)
      .maybeSingle();
    if (byId) existingUser = byId;
  }

  if (!existingUser && cleanEmail) {
    const { data: byEmail } = await supabase
      .from('system_users')
      .select('*')
      .ilike('email', cleanEmail)
      .maybeSingle();
    if (byEmail) existingUser = byEmail;
  }

  if (existingUser) {
    const finalName = name.trim() ? name.trim() : (existingUser.name || displayName);
    const { data: updated } = await supabase
      .from('system_users')
      .update({
        name: finalName,
        password: hashedPassword,
        is_active: true
      })
      .eq('id', existingUser.id)
      .select()
      .single();

    const targetUser = updated || { ...existingUser, name: finalName, is_active: true };
    const permsMap = getStaffPermissionsMap();
    const userPerm = permsMap[targetUser.id] || permsMap[cleanEmail];

    return {
      isAuthenticated: true,
      role: targetUser.role as UserRole,
      name: targetUser.name,
      allowedActivityIds: targetUser.allowed_activity_ids || [],
      allowedPackageIds: targetUser.allowed_package_ids || [],
      canRenew: userPerm?.can_renew ?? targetUser.can_renew ?? false,
      canManageFingerprints: userPerm?.can_manage_fingerprints ?? targetUser.can_manage_fingerprints ?? false,
      canEditMembership: userPerm?.can_edit_membership ?? targetUser.can_edit_membership ?? false,
      email: targetUser.email
    };
  }

  // 2. Si no existía, crear el registro en system_users
  const newUserRecord = {
    name: displayName,
    email: cleanEmail,
    password: hashedPassword,
    role: UserRole.COACH,
    is_active: true,
    allowed_activity_ids: [],
    allowed_package_ids: [],
    can_renew: false,
    can_manage_fingerprints: false,
    can_edit_membership: false
  };

  try {
    const { data: inserted, error: insertError } = await supabase
      .from('system_users')
      .insert(newUserRecord)
      .select()
      .single();

    if (insertError) {
      console.warn("Aviso insertando en system_users:", insertError);
    }

    return {
      isAuthenticated: true,
      role: (inserted?.role as UserRole) || UserRole.COACH,
      name: inserted?.name || displayName,
      allowedActivityIds: inserted?.allowed_activity_ids || [],
      allowedPackageIds: inserted?.allowed_package_ids || [],
      canRenew: inserted?.can_renew ?? false,
      canManageFingerprints: inserted?.can_manage_fingerprints ?? false,
      canEditMembership: inserted?.can_edit_membership ?? false,
      email: cleanEmail
    };
  } catch (e) {
    return {
      isAuthenticated: true,
      role: UserRole.COACH,
      name: displayName,
      allowedActivityIds: [],
      allowedPackageIds: [],
      canRenew: false,
      canManageFingerprints: false,
      canEditMembership: false,
      email: cleanEmail
    };
  }
};

export const getSystemUsers = async (): Promise<SystemUser[]> => {
  let allUsers: SystemUser[] = [];
  let page = 0;
  const size = 1000;

  try {
    while(true) {
        const { data, error } = await supabase.from('system_users').select('*').order('created_at', { ascending: false }).range(page * size, (page + 1) * size - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allUsers.push(...data);
        if (data.length < size) break;
        page++;
    }
  } catch (err) {
    console.warn("Aviso consultando system_users en Supabase:", err);
  }

  // Fusionar permisos persistidos localmente (garantiza persistencia inmediata si la columna aún no está creada en Supabase)
  const permsMap = getStaffPermissionsMap();
  return allUsers.map(u => {
    const userPerm = permsMap[u.id] || (u.email ? permsMap[u.email.toLowerCase().trim()] : undefined);
    return {
      ...u,
      can_renew: userPerm?.can_renew !== undefined ? userPerm.can_renew : (u.can_renew ?? false),
      can_manage_fingerprints: userPerm?.can_manage_fingerprints !== undefined ? userPerm.can_manage_fingerprints : (u.can_manage_fingerprints ?? false),
      can_edit_membership: userPerm?.can_edit_membership !== undefined ? userPerm.can_edit_membership : (u.can_edit_membership ?? false)
    };
  });
};

export const addSystemUser = async (user: Omit<SystemUser, 'id' | 'created_at'>): Promise<SystemUser> => {
  const cleanEmail = user.email.toLowerCase().trim();
  let secureUser: any = { ...user, email: cleanEmail };
  if (user.password && !user.password.startsWith('INVITE_TOKEN::')) {
      const salt = await genSalt(10);
      secureUser.password = await hash(user.password, salt);
  }

  // Verificar primero si el correo ya existe en system_users para actualizarlo sin error de llave duplicada (system_users_email_key)
  const { data: existingByEmail } = await supabase
    .from('system_users')
    .select('*')
    .ilike('email', cleanEmail)
    .maybeSingle();

  if (existingByEmail?.id) {
    // Si ya tenía una contraseña real activa ($2...) y se está re-invitando con INVITE_TOKEN, mantenemos su contraseña actual para no bloquear su login actual hasta que defina una nueva
    if (
      secureUser.password?.startsWith('INVITE_TOKEN::') &&
      existingByEmail.password &&
      existingByEmail.password.startsWith('$2')
    ) {
      delete secureUser.password;
    }

    await updateSystemUser(existingByEmail.id, secureUser);
    return {
      ...existingByEmail,
      ...secureUser,
      id: existingByEmail.id,
      password: secureUser.password || existingByEmail.password,
      can_manage_fingerprints: user.can_manage_fingerprints ?? false,
      can_renew: user.can_renew ?? false,
      can_edit_membership: user.can_edit_membership ?? false
    } as SystemUser;
  }
  
  try {
      const { data, error } = await supabase.from('system_users').insert(secureUser).select().single();
      if (error) throw error;
      
      if (data?.id) {
        saveStaffPermission(data.id, cleanEmail, {
          can_manage_fingerprints: user.can_manage_fingerprints ?? false,
          can_renew: user.can_renew ?? false,
          can_edit_membership: user.can_edit_membership ?? false
        });
      }
      return data as SystemUser;
  } catch (error: any) {
      // Si por condición de carrera ocurre 23505 (system_users_email_key), actualizar el registro existente
      if (
        error?.code === '23505' ||
        (error?.message && error.message.includes('system_users_email_key'))
      ) {
        const { data: raceExisting } = await supabase
          .from('system_users')
          .select('*')
          .ilike('email', cleanEmail)
          .maybeSingle();

        if (raceExisting?.id) {
          await updateSystemUser(raceExisting.id, secureUser);
          return {
            ...raceExisting,
            ...secureUser,
            id: raceExisting.id,
            can_manage_fingerprints: user.can_manage_fingerprints ?? false,
            can_renew: user.can_renew ?? false,
            can_edit_membership: user.can_edit_membership ?? false
          } as SystemUser;
        }
      }

      const isMissingCol = 
          error.code === '42703' || 
          error.code === 'PGRST204' || 
          (error.message && error.message.toLowerCase().includes('schema cache')) ||
          (error.message && error.message.toLowerCase().includes('could not find'));

      if (isMissingCol) {
          const fallbackUser = { ...secureUser };
          delete fallbackUser.allowed_package_ids;
          delete fallbackUser.can_renew;
          delete fallbackUser.can_manage_fingerprints;
          delete fallbackUser.can_edit_membership;
          const { data, error: retryError } = await supabase.from('system_users').insert(fallbackUser).select().single();
          if (retryError) throw retryError;

          if (data?.id) {
            saveStaffPermission(data.id, cleanEmail, {
              can_manage_fingerprints: user.can_manage_fingerprints ?? false,
              can_renew: user.can_renew ?? false,
              can_edit_membership: user.can_edit_membership ?? false
            });
          }
          return {
            ...data,
            can_manage_fingerprints: user.can_manage_fingerprints ?? false,
            can_renew: user.can_renew ?? false,
            can_edit_membership: user.can_edit_membership ?? false
          } as SystemUser;
      }
      throw error;
  }
};

export const updateSystemUser = async (id: string, updates: Partial<SystemUser>): Promise<void> => {
  const secureUpdates: any = { ...updates };
  if (secureUpdates.password && secureUpdates.password.trim() !== '') {
      if (!secureUpdates.password.startsWith('INVITE_TOKEN::')) {
          const salt = await genSalt(10);
          secureUpdates.password = await hash(secureUpdates.password, salt);
      }
  } else {
      delete secureUpdates.password;
  }

  // Guardar SIEMPRE inmediatamente en el mapa persistente de permisos
  if (updates.can_manage_fingerprints !== undefined || updates.can_renew !== undefined || updates.can_edit_membership !== undefined) {
    saveStaffPermission(id, updates.email || '', {
      can_manage_fingerprints: updates.can_manage_fingerprints,
      can_renew: updates.can_renew,
      can_edit_membership: updates.can_edit_membership
    });
  }

  try {
      const { error } = await supabase.from('system_users').update(secureUpdates).eq('id', id);
      if (error) throw error;
  } catch (error: any) {
      const isMissingCol = 
          error.code === '42703' || 
          error.code === 'PGRST204' || 
          (error.message && error.message.toLowerCase().includes('schema cache')) ||
          (error.message && error.message.toLowerCase().includes('could not find'));

      if (isMissingCol) {
          const fallbackUpdates = { ...secureUpdates };
          delete fallbackUpdates.allowed_package_ids;
          delete fallbackUpdates.can_renew;
          delete fallbackUpdates.can_manage_fingerprints;
          delete fallbackUpdates.can_edit_membership;
          const { error: retryError } = await supabase.from('system_users').update(fallbackUpdates).eq('id', id);
          if (retryError) throw retryError;
          return;
      }
      throw error;
  }
};

export const deleteSystemUser = async (id: string): Promise<void> => {
  removeStaffPermission(id);
  const { error } = await supabase.from('system_users').delete().eq('id', id);
  if (error) throw error;
};

// --- ACTIVITIES & PACKAGES ---

export const getActivities = async (): Promise<Activity[]> => {
  try {
    const { data, error } = await supabase.from('activities').select('*').order('name');
    if (!error && data) {
      try { localStorage.setItem('cached_activities_list', JSON.stringify(data)); } catch {}
      return data;
    }
  } catch (err) {
    console.warn("Aviso consultando actividades en Supabase, usando respaldo local:", err);
  }
  try {
    const cached = localStorage.getItem('cached_activities_list');
    if (cached) return JSON.parse(cached);
  } catch {}
  return [];
};

export const addActivity = async (name: string, cost: number, packageIds: string[]) => { 
    const { data, error } = await supabase.from('activities').insert({ name, cost }).select().single();
    if (error) throw error;
    
    // Si hay paquetes seleccionados, crear relaciones
    if (packageIds && packageIds.length > 0) {
        const relations = packageIds.map(pkgId => ({ package_id: pkgId, activity_id: data.id }));
        await supabase.from('package_activities').insert(relations);
    }
    return data;
};

export const updateActivity = async (id: string, name: string, cost: number, packageIds: string[]) => { 
    const { data, error } = await supabase.from('activities').update({ name, cost }).eq('id', id).select().single();
    if (error) throw error;

    // Actualizar relaciones (borrar y crear)
    await supabase.from('package_activities').delete().eq('activity_id', id);
    if (packageIds && packageIds.length > 0) {
        const relations = packageIds.map(pkgId => ({ package_id: pkgId, activity_id: id }));
        await supabase.from('package_activities').insert(relations);
    }
    return data;
};

export const deleteActivity = async (id: string) => { 
    const { error } = await supabase.from('activities').delete().eq('id', id);
    if (error) throw error;
};

export const getPackages = async (): Promise<Package[]> => { 
    try {
        const { data, error } = await supabase.from('packages').select('*').order('name');
        if (!error && data) {
            try { localStorage.setItem('cached_packages_list', JSON.stringify(data)); } catch {}
            return data;
        }
    } catch (err) {
        console.warn("Aviso consultando paquetes en Supabase, usando respaldo local:", err);
    }
    try {
        const cached = localStorage.getItem('cached_packages_list');
        if (cached) return JSON.parse(cached);
    } catch {}
    return [];
};

export const getPackageActivityRelations = async () => { 
    try {
        const { data, error } = await supabase.from('package_activities').select('*');
        if (!error && data) {
            try { localStorage.setItem('cached_pkg_activities_relations', JSON.stringify(data)); } catch {}
            return data;
        }
    } catch (err) {
        console.warn("Aviso consultando relaciones paquete-actividad:", err);
    }
    try {
        const cached = localStorage.getItem('cached_pkg_activities_relations');
        if (cached) return JSON.parse(cached);
    } catch {}
    return []; 
};

export const addPackage = async (pkg: any, activityIds: string[]) => { 
    const { data, error } = await supabase.from('packages').insert(pkg).select().single();
    if (error) throw error;

    if (activityIds && activityIds.length > 0) {
        const relations = activityIds.map(actId => ({ package_id: data.id, activity_id: actId }));
        await supabase.from('package_activities').insert(relations);
    }
    return data;
};

export const updatePackage = async (id: string, pkg: any, activityIds: string[]) => { 
    const { error } = await supabase.from('packages').update(pkg).eq('id', id);
    if (error) throw error;

    await supabase.from('package_activities').delete().eq('package_id', id);
    if (activityIds && activityIds.length > 0) {
        const relations = activityIds.map(actId => ({ package_id: id, activity_id: actId }));
        await supabase.from('package_activities').insert(relations);
    }
};

export const deletePackage = async (id: string) => { 
    const { error } = await supabase.from('packages').delete().eq('id', id);
    if (error) throw error;
};

// --- CLIENTS ---

export const searchClientsPublic = async (identifier: string): Promise<Client[]> => {
    let clientsFound: any[] = [];
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

    if (isUuid) {
        const { data } = await supabase.from('clients').select('*').eq('id', identifier).maybeSingle();
        if (data) clientsFound.push(data);
    } else {
        const cleanIdentifier = identifier.trim();
        const { data } = await supabase.from('clients').select('*').ilike('phone', `%${cleanIdentifier}%`).order('first_name');
        if (data) clientsFound = data;
    }

    if (clientsFound.length === 0) return [];

    const results = await Promise.all(clientsFound.map(async (data) => {
        let activityName, packageName;
        if (data.activity_id) {
            const { data: act } = await supabase.from('activities').select('name').eq('id', data.activity_id).single();
            if (act) activityName = act.name;
        }
        if (data.package_id) {
            const { data: pkg } = await supabase.from('packages').select('name').eq('id', data.package_id).single();
            if (pkg) packageName = pkg.name;
        }

        return {
            id: data.id,
            firstName: data.first_name,
            lastNamePaternal: data.last_name_paternal,
            lastNameMaternal: data.last_name_maternal,
            email: data.email || '',
            phone: data.phone || '',
            photoUrl: data.photo_url,
            membershipStart: data.membership_start,
            membershipEnd: data.membership_end,
            activity_id: data.activity_id,
            cost: data.cost,
            package_id: data.package_id,
            isActive: data.is_active,
            activityName,
            packageName,
            lastReminderSent: data.last_reminder_sent_at || null,
            credentialUrl: data.credential_url || null,
            credentialExpiresAt: data.credential_expires_at || null,
            fingerprint_template: data.fingerprint_template || null,
            created_at: data.created_at
        } as Client;
    }));

    return results;
};

export const searchClientsInternal = async (query: string): Promise<Client[]> => {
    const q = query.trim();
    if (!q) return [];
    try {
        const { data, error } = await supabase.from('clients')
            .select('*')
            .or(`first_name.ilike.%${q}%,last_name_paternal.ilike.%${q}%,last_name_maternal.ilike.%${q}%,phone.ilike.%${q}%`)
            .order('first_name', { ascending: true })
            .limit(20);

        if (error || !data) {
            const all = await getClients();
            return all.filter(c => 
                `${c.firstName} ${c.lastNamePaternal} ${c.lastNameMaternal} ${c.phone}`.toLowerCase().includes(q.toLowerCase())
            );
        }

        const { data: actData } = await supabase.from('activities').select('id, name');
        const actMap = new Map((actData || []).map(a => [a.id, a.name]));
        const { data: pkgData } = await supabase.from('packages').select('id, name');
        const pkgMap = new Map((pkgData || []).map(p => [p.id, p.name]));

        return data.map((c: any) => ({
            id: c.id,
            firstName: c.first_name,
            lastNamePaternal: c.last_name_paternal,
            lastNameMaternal: c.last_name_maternal || '',
            email: c.email || '',
            phone: c.phone || '',
            photoUrl: c.photo_url || null,
            membershipStart: c.membership_start,
            membershipEnd: c.membership_end,
            isActive: c.is_active,
            activity_id: c.activity_id,
            package_id: c.package_id,
            cost: c.cost,
            activityName: c.activity_id ? actMap.get(c.activity_id) : undefined,
            packageName: c.package_id ? pkgMap.get(c.package_id) : undefined,
            credentialUrl: c.credential_url,
            credentialExpiresAt: c.credential_expires_at,
            fingerprint_template: c.fingerprint_template || null,
            created_at: c.created_at
        }));
    } catch {
        const all = await getClients();
        return all.filter(c => 
            `${c.firstName} ${c.lastNamePaternal} ${c.lastNameMaternal} ${c.phone}`.toLowerCase().includes(q.toLowerCase())
        );
    }
};

export const getClients = async (): Promise<Client[]> => { 
    let clientsData: any[] | null = null;
    let queryError: any = null;

    // Retry loop for network resiliency in iframe/mobile environments
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const { data, error } = await supabase.from('clients').select('*').order('first_name', { ascending: true });
            if (!error && data) {
                clientsData = data;
                queryError = null;
                break;
            }
            queryError = error;
        } catch (err: any) {
            queryError = err;
        }
        if (attempt < 2) {
            await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
        }
    }

    if (!clientsData && queryError) {
        console.warn("Aviso de red al cargar clientes desde Supabase, intentando respaldo local:", queryError?.message || queryError);
        try {
            const cached = localStorage.getItem('cached_clients_list');
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed;
                }
            }
        } catch {}
        return [];
    }

    try {
        const actList = await getActivities();
        const actMap = new Map(actList.map(a => [a.id, a.name]));
        
        const pkgList = await getPackages();
        const pkgMap = new Map(pkgList.map(p => [p.id, p.name]));

        const results: Client[] = (clientsData || []).map((c: any) => ({ 
            id: c.id, 
            firstName: c.first_name, 
            lastNamePaternal: c.last_name_paternal, 
            lastNameMaternal: c.last_name_maternal || '',
            email: c.email || '',
            phone: c.phone || '',
            photoUrl: c.photo_url || null,
            membershipStart: c.membership_start,
            membershipEnd: c.membership_end, 
            isActive: c.is_active,
            activity_id: c.activity_id,
            package_id: c.package_id,
            cost: c.cost,
            activityName: c.activity_id ? actMap.get(c.activity_id) : undefined,
            packageName: c.package_id ? pkgMap.get(c.package_id) : undefined,
            lastReminderSent: c.last_reminder_sent_at,
            credentialUrl: c.credential_url,
            credentialExpiresAt: c.credential_expires_at,
            face_embedding: c.face_embedding,
            fingerprint_template: c.fingerprint_template || null,
            created_at: c.created_at
        }));

        try {
            localStorage.setItem('cached_clients_list', JSON.stringify(results));
        } catch {}

        return results;
    } catch (e) {
        console.warn("Aviso procesando datos de clientes:", e);
        try {
            const cached = localStorage.getItem('cached_clients_list');
            if (cached) return JSON.parse(cached);
        } catch {}
        return [];
    }
};

export const getClientById = async (id: string): Promise<Client | null> => { 
    const { data, error } = await supabase.from('clients').select('*').eq('id', id).single();
    if (error || !data) return null;
    
    // Fetch names manually if needed or return minimal data for portal
    return {
        id: data.id,
        firstName: data.first_name,
        lastNamePaternal: data.last_name_paternal,
        lastNameMaternal: data.last_name_maternal,
        email: data.email,
        phone: data.phone,
        photoUrl: data.photo_url,
        membershipStart: data.membership_start,
        membershipEnd: data.membership_end,
        isActive: data.is_active,
        activity_id: data.activity_id,
        package_id: data.package_id,
        cost: data.cost,
        credentialUrl: data.credential_url,
        credentialExpiresAt: data.credential_expires_at,
        fingerprint_template: data.fingerprint_template || null,
        created_at: data.created_at
    } as Client;
};

export const logClientReminder = async (id: string) => {
    try {
        await supabase.from('clients').update({ last_reminder_sent_at: new Date().toISOString() }).eq('id', id);
    } catch (e) {
        console.error("Error updating Supabase reminder dates", e);
    }
    
    try {
        const storedLogs = localStorage.getItem('whatsapp_reminders_log');
        const logs = storedLogs ? JSON.parse(storedLogs) : [];
        logs.push({
            clientId: id,
            timestamp: new Date().toISOString()
        });
        localStorage.setItem('whatsapp_reminders_log', JSON.stringify(logs));
    } catch(err) {
        console.error("Error saving local WhatsApp reminder", err);
    }
};

export const getClientReminderCountLast3Days = (clientId: string): number => {
    try {
        const storedLogs = localStorage.getItem('whatsapp_reminders_log');
        if (!storedLogs) return 0;
        const logs = JSON.parse(storedLogs) as { clientId: string, timestamp: string }[];
        
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        
        const count = logs.filter(log => 
            log.clientId === clientId && 
            new Date(log.timestamp) >= threeDaysAgo
        ).length;
        
        return count;
    } catch (err) {
        return 0;
    }
};

export const saveClient = async (data: any) => { 
    let photoUrl = null;
    let credentialUrl = null;

    if (data.photoBase64) {
        const blob = await dataUrlToBlob(data.photoBase64);
        const fileName = `${Date.now()}_profile.jpg`;
        const { error: upErr } = await supabase.storage.from('client_photos').upload(fileName, blob);
        if (!upErr) {
            const { data: publicData } = supabase.storage.from('client_photos').getPublicUrl(fileName);
            photoUrl = publicData.publicUrl;
        }
    }

    if (data.credentialBase64) {
        const blob = await dataUrlToBlob(data.credentialBase64);
        const fileName = `${Date.now()}_cred.jpg`;
        const { error: upErr } = await supabase.storage.from('client_photos').upload(fileName, blob);
        if (!upErr) {
            const { data: publicData } = supabase.storage.from('client_photos').getPublicUrl(fileName);
            credentialUrl = publicData.publicUrl;
        }
    }

    const firstSub = data.subscriptions && data.subscriptions.length > 0 ? data.subscriptions[0] : null;

    const payload = {
        first_name: data.firstName,
        last_name_paternal: data.lastNamePaternal,
        last_name_maternal: data.lastNameMaternal,
        email: data.email,
        phone: data.phone,
        membership_start: firstSub ? firstSub.startDate : data.membershipStart,
        membership_end: firstSub ? firstSub.endDate : data.membershipEnd,
        activity_id: firstSub ? (firstSub.activity_id || null) : (data.activity_id || null),
        package_id: firstSub ? (firstSub.package_id || null) : (data.package_id || null),
        cost: data.cost,
        is_active: data.isActive,
        photo_url: photoUrl,
        credential_url: credentialUrl,
        credential_expires_at: data.credentialExpiresAt || null,
        fingerprint_template: data.fingerprint_template || null
    };

    const { data: newClient, error } = await supabase.from('clients').insert(payload).select().single();
    if (error) throw error;

    if (data.subscriptions && data.subscriptions.length > 0) {
        for (const sub of data.subscriptions) {
            const newSub: ClientSubscription = {
                id: generateId(),
                client_id: newClient.id,
                activity_id: sub.activity_id || null,
                package_id: sub.package_id || null,
                startDate: sub.startDate,
                endDate: sub.endDate,
                amount: sub.cost,
                isActive: true
            };
            await saveClientSubscription(newSub);
        }
    } else {
        const newSub: ClientSubscription = {
            id: generateId(),
            client_id: newClient.id,
            activity_id: data.activity_id || null,
            package_id: data.package_id || null,
            startDate: data.membershipStart,
            endDate: data.membershipEnd,
            amount: data.cost,
            isActive: true
        };
        await saveClientSubscription(newSub);
    }
    
    // Retornamos objeto CON FORMATO CAMELCASE para que el frontend lo lea correctamente
    return { 
        ...data, // Hereda los campos camelCase originales del formulario
        activity_id: firstSub ? (firstSub.activity_id || null) : (data.activity_id || null),
        package_id: firstSub ? (firstSub.package_id || null) : (data.package_id || null),
        membershipStart: firstSub ? firstSub.startDate : data.membershipStart,
        membershipEnd: firstSub ? firstSub.endDate : data.membershipEnd,
        id: newClient.id, 
        photoUrl: photoUrl || data.photoUrl,
        credentialUrl: credentialUrl || data.credentialUrl,
        created_at: newClient.created_at
    } as any;
};

export const updateClient = async (data: any) => {
    let photoUrl = data.photoUrl;
    let credentialUrl = data.credentialUrl;

    if (data.newPhotoBase64) {
        const blob = await dataUrlToBlob(data.newPhotoBase64);
        const fileName = `${Date.now()}_profile_up.jpg`;
        const { error } = await supabase.storage.from('client_photos').upload(fileName, blob);
        if (!error) {
            const { data: d } = supabase.storage.from('client_photos').getPublicUrl(fileName);
            photoUrl = d.publicUrl;
        }
    }

    if (data.newCredentialBase64) {
        const blob = await dataUrlToBlob(data.newCredentialBase64);
        const fileName = `${Date.now()}_cred_up.jpg`;
        const { error } = await supabase.storage.from('client_photos').upload(fileName, blob);
        if (!error) {
            const { data: d } = supabase.storage.from('client_photos').getPublicUrl(fileName);
            credentialUrl = d.publicUrl;
        }
    }

    const updates = {
        first_name: data.firstName,
        last_name_paternal: data.lastNamePaternal,
        last_name_maternal: data.lastNameMaternal,
        email: data.email,
        phone: data.phone,
        membership_start: data.membershipStart,
        membership_end: data.membershipEnd,
        activity_id: data.activity_id || null,
        package_id: data.package_id || null,
        cost: data.cost,
        is_active: data.isActive,
        photo_url: photoUrl,
        credential_url: credentialUrl,
        credential_expires_at: data.credentialExpiresAt || null,
        ...(data.fingerprint_template !== undefined ? { fingerprint_template: data.fingerprint_template } : {})
    };

    const { error } = await supabase.from('clients').update(updates).eq('id', data.id);
    if (error) throw error;

    // --- AUTOMATIC SYNCHRONIZATION TO SUBSCRIPTIONS TABLE ---
    // If client has an active package or activity, we ensure their subscription is in sync.
    if (data.package_id || data.activity_id) {
        try {
            const existing = await getClientSubscriptionsByClientId(data.id);
            
            // Find existing subscription matching either the package or activity
            const match = existing.find(s => 
                (data.activity_id && s.activity_id === data.activity_id) || 
                (data.package_id && s.package_id === data.package_id)
            );

            const subId = match && !match.id.startsWith('reconstructed-') ? match.id : generateId();

            const synchedSub: ClientSubscription = {
                id: subId,
                client_id: data.id,
                activity_id: data.activity_id || null,
                package_id: data.package_id || null,
                startDate: data.membershipStart,
                endDate: data.membershipEnd,
                amount: data.cost || 0,
                isActive: data.isActive
            };

            await saveClientSubscription(synchedSub);
        } catch (subErr) {
            console.warn("Could not sync subscription during client update:", subErr);
        }
    }
};

// --- GESTIÓN BIOMÉTRICA (DIGITALPERSONA U.ARE.U 4500) ---

export const saveClientFingerprint = async (clientId: string, templateBase64: string): Promise<boolean> => {
    if (!clientId || !templateBase64) return false;
    try {
        const { error } = await supabase.from('clients')
            .update({ fingerprint_template: templateBase64 })
            .eq('id', clientId);
        if (error) {
            console.error("Error guardando huella biométrica:", error);
            return false;
        }
        return true;
    } catch (e) {
        console.error("Excepción guardando huella:", e);
        return false;
    }
};

export const deleteClientFingerprint = async (clientId: string): Promise<boolean> => {
    if (!clientId) return false;
    try {
        const { error } = await supabase.from('clients')
            .update({ fingerprint_template: null })
            .eq('id', clientId);
        if (error) {
            console.error("Error eliminando huella biométrica:", error);
            return false;
        }
        return true;
    } catch (e) {
        console.error("Excepción eliminando huella:", e);
        return false;
    }
};

export const getCandidateFingerprints = async (): Promise<{ id: string, name: string, template: string }[]> => {
    try {
        // Consulta autorizada: todos los socios con plantilla biométrica registrada (activos o inactivos)
        // para permitir reconocimiento e identificación precisa en torniquetes y estaciones de acceso
        const { data, error } = await supabase.from('clients')
            .select('id, first_name, last_name_paternal, fingerprint_template')
            .not('fingerprint_template', 'is', null);

        if (error || !data) return [];

        return data
            .filter(c => c.fingerprint_template && c.fingerprint_template.trim().length > 10)
            .map(c => ({
                id: c.id,
                name: `${c.first_name || ''} ${c.last_name_paternal || ''}`.trim(),
                template: c.fingerprint_template
            }));
    } catch (err) {
        console.warn("Error obteniendo candidatos biométricos:", err);
        return [];
    }
};

export const setClientActiveStatus = async (id: string, status: boolean) => {
    const { error } = await supabase.from('clients').update({ is_active: status }).eq('id', id);
    if (error) throw error;

    // Sincronizar también el estado de sus suscripciones
    try {
        const { error: subError } = await supabase.from('client_subscriptions')
            .update({ is_active: status })
            .eq('client_id', id);
        if (subError && subError.code !== '42P01') {
            console.warn("Could not sync subscriptions active status in Supabase:", subError);
        }

        // Sincronizar cache local
        const subs = getLocalSubscriptions();
        let changed = false;
        subs.forEach(s => {
            if (s.client_id === id) {
                s.isActive = status;
                changed = true;
            }
        });
        if (changed) {
            localStorage.setItem('client_subscriptions', JSON.stringify(subs));
        }
    } catch (e) {
        console.warn("Failed syncing subscription status locally/Supabase:", e);
    }
};

export const bulkSetClientsInactive = async (ids: string[]) => {
    if (ids.length === 0) return;
    const { error } = await supabase.from('clients').update({ is_active: false }).in('id', ids);
    if (error) throw error;

    // Sincronizar también suscripciones
    try {
        const { error: subError } = await supabase.from('client_subscriptions')
            .update({ is_active: false })
            .in('client_id', ids);
        if (subError && subError.code !== '42P01') {
            console.warn("Could not sync bulk subscriptions active status in Supabase:", subError);
        }

        const subs = getLocalSubscriptions();
        let changed = false;
        subs.forEach(s => {
            if (ids.includes(s.client_id)) {
                s.isActive = false;
                changed = true;
            }
        });
        if (changed) {
            localStorage.setItem('client_subscriptions', JSON.stringify(subs));
        }
    } catch (e) {
        console.warn("Failed bulk syncing subscriptions status:", e);
    }
};

export const deleteClient = async (c: any) => {
    // Primero eliminar pagos y asistencias asociados para evitar FK constraint
    await supabase.from('payments').delete().eq('client_id', c.id);
    await supabase.from('attendance').delete().eq('client_id', c.id);
    const { error } = await supabase.from('clients').delete().eq('id', c.id);
    if (error) throw error;
};

// --- ATTENDANCE & PAYMENTS ---

export interface DetailedAttendanceItem {
    id: string;
    client_id: string;
    created_at: string;
    clientName: string;
    clientPhoto: string | null;
    clientPhone: string;
    method: 'HUELLA' | 'QR';
    planName: string;
    isActive: boolean;
    membershipEnd: string;
    isInGym: boolean; // Ingresó dentro de las últimas 2 horas
}

export const getTodaysAttendance = async () => { 
    try {
        const d = new Date();
        const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString();
        const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString();
        const { data, error } = await supabase.from('attendance')
            .select('*')
            .gte('created_at', startOfDay)
            .lte('created_at', endOfDay)
            .order('created_at', { ascending: false });
        if (!error && data) return data;
    } catch (e) {
        console.warn("Aviso consultando asistencias de hoy:", e);
    }
    return [];
};

export const getDetailedTodaysAttendance = async (
    clientsList?: Client[]
): Promise<{
    items: DetailedAttendanceItem[];
    totalToday: number;
    inGymCount: number;
    fingerprintCount: number;
    qrCount: number;
}> => {
    try {
        const records = await getTodaysAttendance();
        const clients = clientsList && clientsList.length > 0 ? clientsList : await getClients();
        const clientsMap = new Map<string, Client>(clients.map(c => [c.id, c]));

        const now = new Date().getTime();
        const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
        const todayStr = new Date().toISOString().split('T')[0];

        let localMeta: Record<string, { method: 'HUELLA' | 'QR'; at: string }> = {};
        try {
            localMeta = JSON.parse(localStorage.getItem(`att_meta_${todayStr}`) || '{}');
        } catch {}

        let fingerprintCount = 0;
        let qrCount = 0;
        let inGymCount = 0;

        const items: DetailedAttendanceItem[] = records.map((r: any) => {
            const client = clientsMap.get(r.client_id);
            const recordTime = new Date(r.created_at).getTime();
            const isInGym = (now - recordTime) <= TWO_HOURS_MS;
            if (isInGym) inGymCount++;

            // Método determinado por BD, cache o si el socio tiene huella enrolada
            let method: 'HUELLA' | 'QR' = r.method || localMeta[r.client_id]?.method || (client?.fingerprint_template ? 'HUELLA' : 'QR');
            if (method === 'HUELLA') fingerprintCount++;
            else qrCount++;

            const clientName = client 
                ? `${client.firstName} ${client.lastNamePaternal} ${client.lastNameMaternal || ''}`.trim()
                : 'Socio Registrado';

            const planName = client?.packageName || client?.activityName || 'Membresía General';

            return {
                id: r.id || `${r.client_id}_${r.created_at}`,
                client_id: r.client_id,
                created_at: r.created_at,
                clientName,
                clientPhoto: client?.photoUrl || null,
                clientPhone: client?.phone || '',
                method,
                planName,
                isActive: client?.isActive ?? true,
                membershipEnd: client?.membershipEnd || '',
                isInGym
            };
        });

        return {
            items,
            totalToday: items.length,
            inGymCount,
            fingerprintCount,
            qrCount
        };
    } catch (e) {
        console.warn("Error generando asistencias detalladas:", e);
        return { items: [], totalToday: 0, inGymCount: 0, fingerprintCount: 0, qrCount: 0 };
    }
};

// Prevención estricta de doble marcaje concurrente y Regla de Re-escaneo Diario (Antipassback Configurable)
const inFlightAttendanceLock = new Set<string>();
const recentAttendanceTimestamps = new Map<string, number>();
const ANTIPASSBACK_5M_MS = 5 * 60 * 1000;
const ANTIPASSBACK_2H_MS = 2 * 60 * 60 * 1000;
const ANTIPASSBACK_4H_MS = 4 * 60 * 60 * 1000;

const formatLocalTimeAmPm = (dateInput: string | number | Date): string => {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
};

const formatElapsedDuration = (diffMs: number): string => {
    const totalMins = Math.max(1, Math.round(Math.abs(diffMs) / 60000));
    if (totalMins < 60) {
        return `hace ${totalMins} ${totalMins === 1 ? 'minuto' : 'minutos'}`;
    }
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (mins === 0) {
        return `hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
    }
    return `hace ${hours} h ${mins} min`;
};

const getActiveRescanRule = (): ScannerRescanRule => {
    try {
        const stored = localStorage.getItem('system_config_scanner_rescan_rule') as ScannerRescanRule | null;
        if (stored && VALID_RESCAN_RULES.includes(stored)) {
            return stored;
        }
    } catch {}
    return 'ONCE_PER_DAY';
};

export const logAttendance = async (
    id: string,
    method: 'HUELLA' | 'QR' = 'HUELLA',
    options?: { forceReentry?: boolean }
): Promise<AttendanceLogResult> => {
    if (!id) {
        return { isReentry: false, visitCountToday: 1 };
    }

    const now = new Date();
    const nowMs = now.getTime();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();
    const localDateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const forceReentry = Boolean(options?.forceReentry);
    const activeRule = getActiveRescanRule();

    // 1. Candado en vuelo: Si otra llamada idéntica está ejecutándose en este instante
    if (inFlightAttendanceLock.has(id)) {
        const err: any = new Error("Ya registrado recientemente");
        err.isAntipassback = true;
        err.reason = 'RECENT_5M';
        err.minsAgo = 1;
        err.elapsedText = 'hace menos de 1 minuto';
        throw err;
    }

    // 2. Candado rápido en memoria y LocalStorage para anti-rebote inmediato (< 5 min) salvo reingreso manual forzado
    if (!forceReentry) {
        const lastMemoryTime = recentAttendanceTimestamps.get(id);
        let localLast = 0;
        try {
            localLast = Number(localStorage.getItem(`att_last_time_${id}`) || '0');
        } catch {}
        const mostRecentLocal = Math.max(lastMemoryTime || 0, localLast || 0);

        if (mostRecentLocal > 0 && (nowMs - mostRecentLocal) < ANTIPASSBACK_5M_MS) {
            const diffMs = nowMs - mostRecentLocal;
            const minsAgo = Math.max(1, Math.round(diffMs / 60000));
            recentAttendanceTimestamps.set(id, mostRecentLocal);
            const err: any = new Error("Ya registrado recientemente");
            err.isAntipassback = true;
            err.reason = 'RECENT_5M';
            err.minsAgo = minsAgo;
            err.firstCheckInTime = formatLocalTimeAmPm(mostRecentLocal);
            err.lastCheckInTime = formatLocalTimeAmPm(mostRecentLocal);
            err.elapsedText = formatElapsedDuration(diffMs);
            err.ruleApplied = activeRule;
            throw err;
        }
    }

    inFlightAttendanceLock.add(id);

    try {
        let todayTimestamps: number[] = [];

        // 3. Consultar registros del socio durante el día de hoy en Supabase (desde las 00:00 hrs hora local)
        try {
            const { data: existingToday, error: checkError } = await supabase.from('attendance')
                .select('id, created_at')
                .eq('client_id', id)
                .gte('created_at', startOfToday.toISOString())
                .order('created_at', { ascending: true });
                
            if (!checkError && existingToday && existingToday.length > 0) {
                todayTimestamps = existingToday
                    .map((r: any) => new Date(r.created_at).getTime())
                    .filter((t: number) => !isNaN(t) && t >= startOfTodayMs);
            }
        } catch (dbErr: any) {
            console.warn("Aviso verificando asistencias del día en Supabase:", dbErr);
        }

        // Incorporar también respaldo local del día de hoy por si algún escaneo previo ocurrió con red lenta
        try {
            const localLast = Number(localStorage.getItem(`att_last_time_${id}`) || '0');
            if (localLast >= startOfTodayMs) {
                const alreadyInList = todayTimestamps.some(t => Math.abs(t - localLast) < 5000);
                if (!alreadyInList) {
                    todayTimestamps.push(localLast);
                }
            }
            const metaLocal = JSON.parse(localStorage.getItem(`att_meta_${localDateKey}`) || '{}');
            if (metaLocal[id]?.firstAt) {
                const firstLocalMs = new Date(metaLocal[id].firstAt).getTime();
                if (!isNaN(firstLocalMs) && firstLocalMs >= startOfTodayMs) {
                    const alreadyInList = todayTimestamps.some(t => Math.abs(t - firstLocalMs) < 5000);
                    if (!alreadyInList) {
                        todayTimestamps.push(firstLocalMs);
                    }
                }
            }
        } catch {}

        todayTimestamps.sort((a, b) => a - b);

        const todayCount = todayTimestamps.length;
        const firstTimeTodayMs = todayCount > 0 ? todayTimestamps[0] : null;
        const lastTimeTodayMs = todayCount > 0 ? todayTimestamps[todayCount - 1] : null;

        // 4. Evaluar Regla de Re-escaneo Diario si el socio ya escaneó hoy y NO es un reingreso manual forzado
        if (todayCount > 0 && firstTimeTodayMs && lastTimeTodayMs && !forceReentry) {
            const diffFromLastMs = Math.max(0, nowMs - lastTimeTodayMs);
            const diffFromFirstMs = Math.max(0, nowMs - firstTimeTodayMs);
            const firstFormatted = formatLocalTimeAmPm(firstTimeTodayMs);
            const lastFormatted = formatLocalTimeAmPm(lastTimeTodayMs);

            // 4a. Siempre prevenir doble lectura accidental dentro de los primeros 5 minutos
            if (diffFromLastMs < ANTIPASSBACK_5M_MS) {
                recentAttendanceTimestamps.set(id, lastTimeTodayMs);
                try { localStorage.setItem(`att_last_time_${id}`, String(lastTimeTodayMs)); } catch {}
                const err: any = new Error("Ya registrado recientemente");
                err.isAntipassback = true;
                err.reason = 'RECENT_5M';
                err.minsAgo = Math.max(1, Math.round(diffFromLastMs / 60000));
                err.firstCheckInTime = firstFormatted;
                err.lastCheckInTime = lastFormatted;
                err.elapsedText = formatElapsedDuration(diffFromLastMs);
                err.visitCountToday = todayCount;
                err.ruleApplied = activeRule;
                throw err;
            }

            // 4b. Regla 'ONCE_PER_DAY': Bloquear/Advertir durante todo el resto del día
            if (activeRule === 'ONCE_PER_DAY') {
                recentAttendanceTimestamps.set(id, lastTimeTodayMs);
                const err: any = new Error("Ya registró asistencia hoy");
                err.isAntipassback = true;
                err.reason = 'DAILY_LIMIT';
                err.minsAgo = Math.max(1, Math.round(diffFromFirstMs / 60000));
                err.firstCheckInTime = firstFormatted;
                err.lastCheckInTime = lastFormatted;
                err.elapsedText = formatElapsedDuration(diffFromFirstMs);
                err.visitCountToday = todayCount;
                err.ruleApplied = activeRule;
                throw err;
            }

            // 4c. Regla 'WINDOW_2H': Bloquear/Advertir si no han pasado 2 horas desde el último escaneo
            if (activeRule === 'WINDOW_2H' && diffFromLastMs < ANTIPASSBACK_2H_MS) {
                recentAttendanceTimestamps.set(id, lastTimeTodayMs);
                const err: any = new Error("Ya registrado en las últimas 2 horas");
                err.isAntipassback = true;
                err.reason = 'WINDOW_2H';
                err.minsAgo = Math.max(1, Math.round(diffFromLastMs / 60000));
                err.firstCheckInTime = firstFormatted;
                err.lastCheckInTime = lastFormatted;
                err.elapsedText = formatElapsedDuration(diffFromLastMs);
                err.visitCountToday = todayCount;
                err.windowHours = 2;
                err.ruleApplied = activeRule;
                throw err;
            }

            // 4d. Regla 'WINDOW_4H': Bloquear/Advertir si no han pasado 4 horas desde el último escaneo
            if (activeRule === 'WINDOW_4H' && diffFromLastMs < ANTIPASSBACK_4H_MS) {
                recentAttendanceTimestamps.set(id, lastTimeTodayMs);
                const err: any = new Error("Ya registrado en las últimas 4 horas");
                err.isAntipassback = true;
                err.reason = 'WINDOW_4H';
                err.minsAgo = Math.max(1, Math.round(diffFromLastMs / 60000));
                err.firstCheckInTime = firstFormatted;
                err.lastCheckInTime = lastFormatted;
                err.elapsedText = formatElapsedDuration(diffFromLastMs);
                err.visitCountToday = todayCount;
                err.windowHours = 4;
                err.ruleApplied = activeRule;
                throw err;
            }
        }

        // 5. Inserción en Supabase (Primera entrada del día o reingreso permitido)
        try {
            const { error: insertErr } = await supabase.from('attendance').insert({ client_id: id, method });
            if (insertErr) {
                await supabase.from('attendance').insert({ client_id: id });
            }
        } catch {
            // Fallback si la columna method aún no existe en Supabase
            await supabase.from('attendance').insert({ client_id: id });
        }

        // 6. Actualizar marcas de tiempo exitosas
        recentAttendanceTimestamps.set(id, nowMs);
        try {
            localStorage.setItem(`att_last_time_${id}`, String(nowMs));
            const todayIsoStr = now.toISOString().split('T')[0];
            for (const keySuffix of [todayIsoStr, localDateKey]) {
                const cachedKey = `att_meta_${keySuffix}`;
                const existingMeta = JSON.parse(localStorage.getItem(cachedKey) || '{}');
                const prevFirstAt = existingMeta[id]?.firstAt || (firstTimeTodayMs ? new Date(firstTimeTodayMs).toISOString() : now.toISOString());
                existingMeta[id] = {
                    method,
                    at: now.toISOString(),
                    firstAt: prevFirstAt,
                    count: todayCount + 1
                };
                localStorage.setItem(cachedKey, JSON.stringify(existingMeta));
            }
        } catch {}

        const isReentry = todayCount > 0;
        return {
            isReentry,
            visitCountToday: todayCount + 1,
            firstCheckInTime: firstTimeTodayMs ? formatLocalTimeAmPm(firstTimeTodayMs) : formatLocalTimeAmPm(nowMs),
            lastCheckInTime: lastTimeTodayMs ? formatLocalTimeAmPm(lastTimeTodayMs) : formatLocalTimeAmPm(nowMs),
            elapsedText: firstTimeTodayMs ? formatElapsedDuration(nowMs - firstTimeTodayMs) : '1ra entrada del día'
        };
    } finally {
        inFlightAttendanceLock.delete(id);
    }
};


export const addPayment = async (p: any): Promise<Payment> => {
    const payload = {
        ...p,
        created_at: p.created_at || new Date().toISOString()
    };
    const { data, error } = await supabase.from('payments').insert(payload).select().single();
    if (error) {
        console.error("Error al registrar pago en Supabase:", error);
        throw error;
    }
    return data as Payment;
};

// Registro de pago directo a socio (sin renovar membresía, exclusivo para historial y corte de caja)
export const recordClientDirectPayment = async (
    clientId: string,
    amount: number,
    method: PaymentMethod,
    concept: string,
    userName: string
): Promise<Payment> => {
    return await addPayment({
        client_id: clientId,
        amount: Number(amount),
        method: method,
        concept: concept.trim(),
        created_by: userName,
        created_at: new Date().toISOString()
    });
};

export const getPayments = async (start?:string, end?:string) => { 
    let query = supabase.from('payments').select(`
        *,
        clients (first_name, last_name_paternal)
    `).order('created_at', { ascending: false });

    if (start) query = query.gte('created_at', start);
    if (end) query = query.lte('created_at', end);

    const { data, error } = await query;
    if (error) return [];

    return data.map((p: any) => ({
        ...p,
        clientName: p.clients ? `${p.clients.first_name} ${p.clients.last_name_paternal}` : 'Cliente Eliminado / Venta General'
    }));
};

export const getPaymentsByClientId = async (id: string) => { 
    const { data } = await supabase.from('payments').select('*').eq('client_id', id).order('created_at', { ascending: false });
    return data || [];
};

export const renewClientMembership = async (id: string, start:string, end:string, pkgId:string|null, cost:number, method:any, user:string) => {
    // 1. Actualizar cliente
    const { error: clientError } = await supabase.from('clients').update({
        membership_start: start,
        membership_end: end,
        package_id: pkgId,
        cost: cost,
        is_active: true
    }).eq('id', id);
    if (clientError) throw clientError;

    // 2. Registrar Pago
    await addPayment({
        client_id: id,
        amount: cost,
        method: method,
        concept: `RENOVACIÓN MEMBRESÍA (${start} a ${end})`,
        created_by: user
    });
};

export const addExpense = async (e: any) => {
    await supabase.from('expenses').insert(e);
};

export const getExpenses = async (start?:string, end?:string) => { 
    let query = supabase.from('expenses').select('*').order('created_at', { ascending: false });
    if (start) query = query.gte('created_at', start);
    if (end) query = query.lte('created_at', end);
    const { data } = await query;
    return data || [];
};

export const deleteExpense = async (id: string) => {
    await supabase.from('expenses').delete().eq('id', id);
};

export const getMonthlyRevenue = async () => { 
    try {
        const date = new Date();
        const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).toISOString();
        const { data, error } = await supabase.from('payments').select('amount').gte('created_at', firstDay);
        if (!error && data) {
            return data.reduce((acc, curr) => acc + Number(curr.amount), 0) || 0;
        }
    } catch (e) {
        console.warn("Aviso consultando ingresos mensuales:", e);
    }
    return 0;
};

export const getDailyShiftRevenue = async () => { 
    try {
        // Ingresos del día actual (00:00 a 23:59)
        const today = new Date().toISOString().split('T')[0];
        const { data: payments } = await supabase.from('payments').select('amount').gte('created_at', `${today}T00:00:00`).lte('created_at', `${today}T23:59:59`);
        const totalP = payments?.reduce((acc, curr) => acc + Number(curr.amount), 0) || 0;
        
        // Restar gastos del día
        const { data: expenses } = await supabase.from('expenses').select('amount').gte('created_at', `${today}T00:00:00`).lte('created_at', `${today}T23:59:59`);
        const totalE = expenses?.reduce((acc, curr) => acc + Number(curr.amount), 0) || 0;

        return totalP - totalE;
    } catch (e) {
        console.warn("Aviso consultando ingresos de turno diario:", e);
        return 0;
    }
};

// --- PRODUCTS / INVENTORY (RESTAURADO) ---

export const getProducts = async (): Promise<Product[]> => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('name');
  
  if (error) {
      console.error("Error fetching products:", error);
      return [];
  }
  
  return data.map((p: any) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      price_buy: p.price_buy,
      price_sell: p.price_sell,
      stock: p.stock,
      image_url: p.image_url,
      is_active: p.is_active
  }));
};

export const saveProduct = async (product: Partial<Product>, imageBase64?: string): Promise<void> => {
    let imageUrl = product.image_url;

    if (imageBase64) {
        const blob = await dataUrlToBlob(imageBase64);
        const filePath = `products/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
        const { error: uploadError } = await supabase.storage.from('client_photos').upload(filePath, blob);
        
        if (!uploadError) {
            const { data } = supabase.storage.from('client_photos').getPublicUrl(filePath);
            imageUrl = data.publicUrl;
        }
    }

    const payload = {
        name: product.name,
        category: product.category,
        price_buy: product.price_buy,
        price_sell: product.price_sell,
        stock: product.stock,
        image_url: imageUrl,
        is_active: true // Ensure it's active on save
    };

    if (product.id) {
        // Update
        const { error } = await supabase.from('products').update(payload).eq('id', product.id);
        if (error) throw error;
    } else {
        // Insert
        const { error } = await supabase.from('products').insert(payload);
        if (error) throw error;
    }
};

export const deleteProduct = async (id: string): Promise<void> => {
    // Soft delete to keep history in sales
    const { error } = await supabase.from('products').update({ is_active: false }).eq('id', id);
    if (error) throw error;
};

export const updateProductStock = async (id: string, newStock: number): Promise<void> => {
    const { error } = await supabase.from('products').update({ stock: newStock }).eq('id', id);
    if (error) throw error;
};

export const processProductSale = async (
    cart: CartItem[], 
    method: PaymentMethod, 
    clientId: string | null, 
    userName: string
): Promise<void> => {
    const totalAmount = cart.reduce((sum, item) => sum + (item.price_sell * item.quantity), 0);
    const description = `VENTA TIENDA: ${cart.map(i => `${i.quantity}x ${i.name}`).join(', ')}`;

    // 1. Registrar Pago (Ingreso)
    const { error: payError } = await supabase.from('payments').insert({
        client_id: clientId,
        amount: totalAmount,
        method: method,
        concept: description,
        created_by: userName
    });
    
    if (payError) throw payError;

    // 2. Descontar Stock solo para productos reales de inventario
    for (const item of cart) {
        if (!item.id.startsWith('custom-')) {
            const newStock = Math.max(0, item.stock - item.quantity);
            await supabase.from('products').update({ stock: newStock }).eq('id', item.id);
        }
    }
};

// --- MULTIPLE SUBSCRIPTIONS SYSTEM ---

export const getReconstructedSubscriptions = async (): Promise<ClientSubscription[]> => {
    try {
        const { data: payments, error } = await supabase.from('payments').select('*');
        if (error || !payments) return getLocalSubscriptions();

        const pkgs = await getPackages();
        const acts = await getActivities();
        const clients = await getClients();

        const reconstructed: ClientSubscription[] = [];
        const dateRegex = /(\d{4}-\d{2}-\d{2})\s*(?:AL|a|to|-)\s*(\d{4}-\d{2}-\d{2})/i;

        payments.forEach((p: any) => {
            const concept = p.concept || '';
            const match = concept.match(dateRegex);
            if (match) {
                const startDate = match[1];
                const endDate = match[2];
                let package_id: string | null = null;
                let activity_id: string | null = null;

                const clientObj = clients.find(c => c.id === p.client_id);

                if (concept.toUpperCase().startsWith('PLAN:')) {
                    const namePart = concept.substring(5).split('(')[0].trim();
                    const foundPkg = pkgs.find(pkg => pkg.name.trim().toUpperCase() === namePart.toUpperCase());
                    if (foundPkg) package_id = foundPkg.id;
                } else if (concept.toUpperCase().startsWith('CLASE:')) {
                    const namePart = concept.substring(6).split('(')[0].trim();
                    const foundAct = acts.find(act => act.name.trim().toUpperCase() === namePart.toUpperCase());
                    if (foundAct) activity_id = foundAct.id;
                } else if (concept.toUpperCase().includes('RENOVACIÓN MEMBRESÍA')) {
                    if (clientObj) {
                        if (clientObj.package_id) package_id = clientObj.package_id;
                        else if (clientObj.activity_id) activity_id = clientObj.activity_id;
                    }
                }

                if (package_id || activity_id) {
                    reconstructed.push({
                        id: `reconstructed-${p.id}`,
                        client_id: p.client_id,
                        package_id,
                        activity_id,
                        startDate,
                        endDate,
                        amount: p.amount || 0,
                        isActive: true
                    });
                }
            }
        });

        // Ordenamos por fecha de término ascendente para que las renovaciones más recientes sobrescriban a las viejas al mezclarse
        reconstructed.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());

        const local = getLocalSubscriptions();
        local.forEach(l => {
            const duplicate = reconstructed.some(r => r.id === l.id);
            if (!duplicate) {
                reconstructed.push(l);
            }
        });

        // Deduplicar para conservar únicamente la suscripción más reciente por cada paquete o actividad de cada cliente
        const deduplicatedMap = new Map<string, ClientSubscription>();
        reconstructed.forEach(sub => {
            const key = sub.package_id 
                ? `${sub.client_id}_pkg_${sub.package_id}` 
                : `${sub.client_id}_act_${sub.activity_id}`;
            const existing = deduplicatedMap.get(key);
            if (!existing || new Date(sub.endDate).getTime() > new Date(existing.endDate).getTime()) {
                deduplicatedMap.set(key, sub);
            }
        });

        return Array.from(deduplicatedMap.values());
    } catch (err) {
        console.warn("Error reconstructing subscriptions from payment logs:", err);
        return getLocalSubscriptions();
    }
};

export const getClientSubscriptions = async (): Promise<ClientSubscription[]> => {
    try {
        const { data, error } = await supabase.from('client_subscriptions').select('*');
        if (error) {
            if (error.code === '42P01') {
                return getReconstructedSubscriptions();
            }
            throw error;
        }

        const reconstructed = await getReconstructedSubscriptions();
        const existingList = (data || []).map((sub: any) => ({
            id: sub.id,
            client_id: sub.client_id,
            package_id: sub.package_id,
            activity_id: sub.activity_id,
            startDate: sub.start_date || sub.startDate,
            endDate: sub.end_date || sub.endDate,
            amount: sub.amount,
            isActive: sub.is_active !== undefined ? sub.is_active : sub.isActive
        }));

        const combined = [...existingList];
        reconstructed.forEach(rec => {
            const duplicate = combined.some(ex => ex.id === rec.id);
            if (!duplicate) {
                combined.push(rec);
            }
        });

        // Asegurar que solo devolvemos la suscripción más reciente por paquete o actividad de cada cliente
        const finalMap = new Map<string, ClientSubscription>();
        combined.forEach(sub => {
            const key = sub.package_id 
                ? `${sub.client_id}_pkg_${sub.package_id}` 
                : `${sub.client_id}_act_${sub.activity_id}`;
            const existing = finalMap.get(key);
            if (!existing) {
                finalMap.set(key, sub);
            } else {
                const subTime = new Date(sub.endDate).getTime();
                const existingTime = new Date(existing.endDate).getTime();
                if (subTime > existingTime) {
                    finalMap.set(key, sub);
                } else if (subTime === existingTime) {
                    // Si tienen la misma fecha, preferir la suscripción explícita (que no empieza con reconstructed-)
                    if (existing.id.startsWith('reconstructed-') && !sub.id.startsWith('reconstructed-')) {
                        finalMap.set(key, sub);
                    }
                }
            }
        });

        return Array.from(finalMap.values());
    } catch (e) {
        console.warn("Falling back to local storage and payment reconstruction for subscriptions:", e);
        return getReconstructedSubscriptions();
    }
};

const getLocalSubscriptions = (): ClientSubscription[] => {
    const local = localStorage.getItem('client_subscriptions');
    return local ? JSON.parse(local) : [];
};

export const getClientSubscriptionsByClientId = async (clientId: string): Promise<ClientSubscription[]> => {
    const all = await getClientSubscriptions();
    return all.filter(s => s.client_id === clientId);
};

export const saveClientSubscription = async (sub: ClientSubscription): Promise<ClientSubscription> => {
    const payload = {
        id: sub.id,
        client_id: sub.client_id,
        package_id: sub.package_id,
        activity_id: sub.activity_id,
        start_date: sub.startDate,
        end_date: sub.endDate,
        amount: sub.amount,
        is_active: sub.isActive
    };

    try {
        const { error } = await supabase.from('client_subscriptions').upsert(payload);
        if (error) {
            if (error.code === '42P01') {
                saveLocalSubscription(sub);
                return sub;
            }
            throw error;
        }
        
        // Parallel sync to local cache
        saveLocalSubscription(sub);
        return sub;
    } catch (e) {
        console.warn("Falling back to local storage saving for subscriptions:", e);
        saveLocalSubscription(sub);
        return sub;
    }
};

const saveLocalSubscription = (sub: ClientSubscription) => {
    const subs = getLocalSubscriptions();
    const idx = subs.findIndex(s => s.id === sub.id);
    if (idx >= 0) {
        subs[idx] = sub;
    } else {
        subs.push(sub);
    }
    localStorage.setItem('client_subscriptions', JSON.stringify(subs));
};

export const deleteClientSubscription = async (id: string, subObj?: ClientSubscription): Promise<void> => {
    try {
        if (id.startsWith('reconstructed-') && subObj) {
            // Es una reconstruida de pagos. Para desactivarla sin alterar pagos, guardamos una entrada explícita inactiva
            const payload = {
                id: generateId(),
                client_id: subObj.client_id,
                package_id: subObj.package_id || null,
                activity_id: subObj.activity_id || null,
                start_date: subObj.startDate,
                end_date: subObj.endDate,
                amount: subObj.amount,
                is_active: false
            };
            const { error } = await supabase.from('client_subscriptions').upsert(payload);
            if (error && error.code !== '42P01') throw error;
            
            // Sincronizar localmente también
            const localSub: ClientSubscription = {
                id: payload.id,
                client_id: payload.client_id,
                package_id: payload.package_id,
                activity_id: payload.activity_id,
                startDate: payload.start_date,
                endDate: payload.end_date,
                amount: payload.amount,
                isActive: false
            };
            saveLocalSubscription(localSub);
        } else {
            // Es una suscripción normal en client_subscriptions.
            // Para estar seguros de que no se reactive por pagos y quede inactiva, la marcamos como is_active = false
            if (subObj) {
                const payload = {
                    id: id,
                    client_id: subObj.client_id,
                    package_id: subObj.package_id || null,
                    activity_id: subObj.activity_id || null,
                    start_date: subObj.startDate,
                    end_date: subObj.endDate,
                    amount: subObj.amount,
                    is_active: false
                };
                const { error } = await supabase.from('client_subscriptions').upsert(payload);
                if (error && error.code !== '42P01') throw error;
                
                const localSub: ClientSubscription = {
                    id: payload.id,
                    client_id: payload.client_id,
                    package_id: payload.package_id,
                    activity_id: payload.activity_id,
                    startDate: payload.start_date,
                    endDate: payload.end_date,
                    amount: payload.amount,
                    isActive: false
                };
                saveLocalSubscription(localSub);
            } else {
                const { error } = await supabase.from('client_subscriptions').delete().eq('id', id);
                if (error && error.code !== '42P01') throw error;
                
                const subs = getLocalSubscriptions();
                const filtered = subs.filter(s => s.id !== id);
                localStorage.setItem('client_subscriptions', JSON.stringify(filtered));
            }
        }
    } catch (e) {
        console.warn("Failed deleting/deactivating subscription from Supabase:", e);
        if (subObj) {
            const localSub: ClientSubscription = {
                id: id.startsWith('reconstructed-') ? generateId() : id,
                client_id: subObj.client_id,
                package_id: subObj.package_id || null,
                activity_id: subObj.activity_id || null,
                startDate: subObj.startDate,
                endDate: subObj.endDate,
                amount: subObj.amount,
                isActive: false
            };
            saveLocalSubscription(localSub);
        }
    }
};

// Main entry point for subscription renewals
export const renewClientSubscription = async (
    clientId: string,
    activityId: string | null,
    packageId: string | null,
    startDate: string,
    endDate: string,
    amount: number,
    method: PaymentMethod,
    user: string
): Promise<ClientSubscription> => {
    const existing = await getClientSubscriptionsByClientId(clientId);
    
    // Check if there's an existing subscription for either the specified package or activity to reuse ID (excluding reconstructed ones)
    const match = existing.find(s => 
        !s.id.startsWith('reconstructed-') && (
            (activityId && s.activity_id === activityId) || 
            (packageId && s.package_id === packageId)
        )
    );

    const subId = match ? match.id : generateId();

    const newSub: ClientSubscription = {
        id: subId,
        client_id: clientId,
        activity_id: activityId,
        package_id: packageId,
        startDate,
        endDate,
        amount,
        isActive: true
    };

    await saveClientSubscription(newSub);

    // Update the main client record so that fallback/search indexes pointing directly to the clients table remain active
    try {
        const updates: any = {
            is_active: true,
            membership_start: startDate,
            membership_end: endDate,
            cost: amount,
            package_id: packageId || null,
            activity_id: activityId || null
        };
        const { error } = await supabase.from('clients').update(updates).eq('id', clientId);
        if (error) throw error;
    } catch (err) {
        console.error("Could not update legacy client fields in Supabase:", err);
        throw err;
    }

    // Register Box Cashier Payment Transaction
    let concept = "RENOVACIÓN PLAN";
    if (packageId) {
        const { data: pkg } = await supabase.from('packages').select('name').eq('id', packageId).single();
        concept = `PLAN: ${pkg?.name || 'Suscripción'}`;
    } else if (activityId) {
        const { data: act } = await supabase.from('activities').select('name').eq('id', activityId).single();
        concept = `CLASE: ${act?.name || 'Disciplina'}`;
    }

    await addPayment({
        client_id: clientId,
        amount,
        method,
        concept: `${concept} (${startDate} AL ${endDate})`,
        created_by: user
    });

    return newSub;
};

