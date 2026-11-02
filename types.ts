
export interface Activity {
  id: string;
  name: string;
  cost: number;
}

export interface Package {
  id: string;
  name: string;
  cost: number;
  discount_amount: number;
  duration_days: number; // Nuevo campo: 1, 7, 30, 365
  requires_credential?: boolean; // NUEVO: Indica si el paquete requiere evidencia
}

export interface PackageWithActivities extends Package {
  activities: Activity[];
}

export interface Client {
  id:string;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal:string;
  email?: string | null;
  phone?: string | null; // Nuevo campo para celular
  photoUrl: string | null;
  photoBase64?: string;
  face_embedding?: number[] | null;
  membershipStart: string;
  membershipEnd: string;
  activity_id: string | null;
  activityName?: string;
  cost: number | null;
  package_id: string | null;
  packageName?: string;
  isActive: boolean;
  lastReminderSent?: string | null; // NUEVO: Fecha del último recordatorio enviado
  lastAttendance?: string | null; // NUEVO: Fecha de la última asistencia registrada
  // NUEVOS CAMPOS PARA CREDENCIAL
  credentialUrl?: string | null;
  credentialExpiresAt?: string | null;
  fingerprint_template?: string | null; // Plantilla biométrica DigitalPersona (ANSI INCITS 378 / XML Base64)
  created_at?: string; // NUEVO: Fecha de registro en sistema
}

export enum AccessStatus {
  GRANTED = 'GRANTED',
  WARNING = 'WARNING',
  DENIED = 'DENIED',
  UNKNOWN = 'UNKNOWN',
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING' // Nuevo estado
}

export interface ScanResult {
  status: AccessStatus;
  client?: Client;
  message: string;
}

export interface AttendanceRecord {
  id: string;
  created_at: string;
  client_id: string;
}

// --- NUEVOS TIPOS PARA SISTEMA DE USUARIOS ---

export enum UserRole {
  ADMIN = 'ADMIN',
  COACH = 'COACH',
  MONITOR = 'MONITOR' // Nuevo Rol
}

export interface SystemUser {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  is_active: boolean;
  allowed_activity_ids?: string[]; // Permisos específicos Actividades
  allowed_package_ids?: string[];  // NUEVO: Permisos específicos Paquetes
  can_renew?: boolean;             // NUEVO: Permiso para renovar membresías
  can_manage_fingerprints?: boolean; // NUEVO: Permiso granular para capturar, actualizar y eliminar huellas
  can_edit_membership?: boolean;     // NUEVO: Permiso para editar la sección "MEMBRESÍA Y PLAN" al editar un cliente
  created_at?: string;
}

export type ScannerRescanRule = 'ONCE_PER_DAY' | 'ALLOW_WITH_BADGE' | 'WINDOW_2H' | 'WINDOW_4H' | 'WINDOW_5M';

export interface AttendanceLogResult {
    isReentry: boolean;
    visitCountToday: number;
    firstCheckInTime?: string;
    lastCheckInTime?: string;
    elapsedText?: string;
}

// --- NUEVO TIPO PARA CONFIGURACIÓN DEL SISTEMA ---
export interface SystemConfig {
    id: number;
    org_name: string;
    logo_url?: string | null;
    favicon_url?: string | null;
    primary_color: string; // Hex code
    secondary_color?: string; // Hex code
    updated_at?: string;
    // --- CAMPOS NUEVOS PARA PLANTILLAS WHATSAPP ---
    wa_template_warning?: string;
    wa_template_recovery?: string;
    wa_template_welcome?: string; 
    wa_template_renewal?: string; // NUEVO
    wa_template_payment?: string; // NUEVO: Comprobante de cobro directo / abono en POS
    // --- NUEVO CAMPO REGLAMENTO ---
    rules_content?: string;
    // --- CONTROL DE ACCESO BIOMÉTRICO Y ESCÁNERES ---
    require_biometric_exit_pin?: boolean; // Si es true (default), exige PIN 1234 para salir de Acceso Huella
    scanner_message_duration?: number; // Duración en segundos (3, 4, 5 o 6) del mensaje en QR y Huella (default: 4)
    scanner_denied_extra_time?: boolean; // Si es true, otorga +2 segundos adicionales cuando el acceso es DENEGADO
    scanner_rescan_rule?: ScannerRescanRule; // Regla cuando un socio vuelve a escanear el mismo día
    scanner_allow_manual_reentry?: boolean; // Permite botón en recepción para autorizar reingreso manual cuando está bloqueado
    // --- SISTEMA DE ALARMAS Y AUDIO (HÍBRIDO NUBE + CACHÉ LOCAL OFFLINE) ---
    audio_granted_url?: string | null;
    audio_warning_url?: string | null;
    audio_denied_url?: string | null;
    audio_volume?: number; // 0 a 100 (default: 80)
    audio_enabled?: boolean; // Maestro: activa o silencia todo el audio (default: true)
    audio_granted_enabled?: boolean; // default: true
    audio_warning_enabled?: boolean; // default: true
    audio_denied_enabled?: boolean; // default: true
}

// --- FINANZAS ---
export enum PaymentMethod {
  CASH = 'EFECTIVO',
  CARD = 'TARJETA',
  TRANSFER = 'TRANSFERENCIA'
}

export interface Payment {
  id: string;
  client_id: string | null;
  amount: number;
  method: PaymentMethod;
  concept: string;
  created_at: string;
  created_by?: string;
  clientName?: string; 
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  category: 'SALARIOS' | 'SERVICIOS' | 'MANTENIMIENTO' | 'EQUIPO' | 'OTROS';
  created_at: string;
  created_by: string;
}

export interface WelcomeEmailData {
  email: string;
  fullName: string;
  concept: string;
  amount: number;
  startDate: string;
  endDate: string;
}

// --- TIENDA / INVENTARIO ---
export interface Product {
  id: string;
  name: string;
  category: 'BEBIDAS' | 'SUPLEMENTOS' | 'ROPA' | 'ACCESORIOS' | 'OTROS';
  price_buy: number;
  price_sell: number;
  stock: number;
  image_url?: string | null;
  is_active: boolean;
}

export interface CartItem extends Product {
  quantity: number;
}

// --- DASHBOARD METRICS ---
export interface DashboardMetrics {
  activeClientsCount: number;
  todaysAttendanceCount: number;
  expiringSoonCount: number;
  monthlyRevenue: number;
  dailyRevenue: number;
}

export interface ClientSubscription {
  id: string;
  client_id: string;
  package_id: string | null;
  activity_id: string | null;
  startDate: string;
  endDate: string;
  packageName?: string;
  activityName?: string;
  amount: number;
  isActive: boolean;
  status?: string; // 'ACTIVO', 'VENCIDO', 'DE_BAJA', 'POR_VENCER'
}
