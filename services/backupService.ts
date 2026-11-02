import { supabase } from './supabaseClient';
import { getClients, getActivities, getPackages, getPackageActivityRelations, getSystemUsers } from './storage';
import { Client, Activity, Package, SystemUser } from '../types';

export interface SystemBackupPayload {
    version: string;
    system: string;
    exported_at: string;
    counts: {
        clients: number;
        client_subscriptions: number;
        activities: number;
        packages: number;
        package_activities: number;
        attendance: number;
        payments: number;
        expenses: number;
        products: number;
        system_config: number;
        system_users: number;
    };
    data: {
        clients: any[];
        client_subscriptions: any[];
        activities: any[];
        packages: any[];
        package_activities: any[];
        attendance: any[];
        payments: any[];
        expenses: any[];
        products: any[];
        system_config: any[];
        system_users: any[];
    };
}

/**
 * Consulta todas las filas de una tabla manejando paginación automática (>1000 registros)
 */
async function fetchAllRows(tableName: string): Promise<any[]> {
    let allRows: any[] = [];
    let page = 0;
    const pageSize = 1000;

    try {
        while (true) {
            const { data, error } = await supabase
                .from(tableName)
                .select('*')
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) {
                // Si la tabla no existe en la base de datos (código 42P01), salimos sin error crítico
                if (error.code === '42P01') {
                    console.warn(`La tabla ${tableName} no existe en Supabase.`);
                } else {
                    console.warn(`Error consultando tabla ${tableName}:`, error.message);
                }
                break;
            }

            if (!data || data.length === 0) break;
            allRows.push(...data);
            if (data.length < pageSize) break;
            page++;
        }
    } catch (err) {
        console.warn(`Excepción en fetchAllRows para ${tableName}:`, err);
    }

    return allRows;
}

/**
 * Inserta o actualiza un lote de registros en Supabase por bloques para evitar límites de tamaño
 */
async function upsertInBatches(tableName: string, records: any[], onBatch?: (current: number, total: number) => void): Promise<{ inserted: number; errors: string[] }> {
    if (!records || records.length === 0) return { inserted: 0, errors: [] };

    const batchSize = 100;
    let totalInserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        try {
            const { error } = await supabase.from(tableName).upsert(batch);
            if (error) {
                // Si falla en lote, intentamos uno por uno para recuperar la mayor cantidad posible
                console.warn(`Aviso en lote de ${tableName}, reintentando individuales:`, error.message);
                for (const item of batch) {
                    try {
                        const { error: singleErr } = await supabase.from(tableName).upsert(item);
                        if (!singleErr) {
                            totalInserted++;
                        } else {
                            errors.push(`ID ${item.id || 'desconocido'}: ${singleErr.message}`);
                        }
                    } catch (e: any) {
                        errors.push(`ID ${item.id || 'desconocido'}: ${e.message}`);
                    }
                }
            } else {
                totalInserted += batch.length;
            }
        } catch (err: any) {
            errors.push(`Error general en lote: ${err.message}`);
        }

        if (onBatch) {
            onBatch(Math.min(i + batchSize, records.length), records.length);
        }
    }

    return { inserted: totalInserted, errors };
}

/**
 * Genera y descarga un archivo JSON con la copia completa de la base de datos
 */
export async function generateAndDownloadBackup(onProgress?: (step: string) => void): Promise<SystemBackupPayload> {
    onProgress?.("Recopilando datos de Socios y Huellas...");
    const clients = await fetchAllRows('clients');

    onProgress?.("Recopilando Suscripciones y Membresías...");
    const client_subscriptions = await fetchAllRows('client_subscriptions');

    onProgress?.("Recopilando Disciplinas y Paquetes...");
    const activities = await fetchAllRows('activities');
    const packages = await fetchAllRows('packages');
    const package_activities = await fetchAllRows('package_activities');

    onProgress?.("Recopilando Asistencias históricas...");
    const attendance = await fetchAllRows('attendance');

    onProgress?.("Recopilando Pagos y Cortes de Caja...");
    const payments = await fetchAllRows('payments');

    onProgress?.("Recopilando Gastos y Egresos...");
    const expenses = await fetchAllRows('expenses');

    onProgress?.("Recopilando Productos e Inventario...");
    const products = await fetchAllRows('products');

    onProgress?.("Recopilando Configuración del Sistema y Usuarios...");
    const system_config = await fetchAllRows('system_config');
    const system_users = await fetchAllRows('system_users');

    const backupPayload: SystemBackupPayload = {
        version: '2.0.0',
        system: 'KALI ACCESS',
        exported_at: new Date().toISOString(),
        counts: {
            clients: clients.length,
            client_subscriptions: client_subscriptions.length,
            activities: activities.length,
            packages: packages.length,
            package_activities: package_activities.length,
            attendance: attendance.length,
            payments: payments.length,
            expenses: expenses.length,
            products: products.length,
            system_config: system_config.length,
            system_users: system_users.length,
        },
        data: {
            clients,
            client_subscriptions,
            activities,
            packages,
            package_activities,
            attendance,
            payments,
            expenses,
            products,
            system_config,
            system_users,
        }
    };

    onProgress?.("Empaquetando archivo de respaldo...");
    const jsonStr = JSON.stringify(backupPayload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const dateStamp = now.toISOString().split('T')[0];
    const timeStamp = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `backup_kali_access_${dateStamp}_${timeStamp}.json`;

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return backupPayload;
}

/**
 * Valida la estructura de un archivo JSON de respaldo
 */
export function validateBackupFile(content: any): { isValid: boolean; message: string; payload?: SystemBackupPayload } {
    if (!content || typeof content !== 'object') {
        return { isValid: false, message: 'El archivo no contiene un JSON válido.' };
    }

    if (!content.data || typeof content.data !== 'object') {
        return { isValid: false, message: 'El archivo no tiene el bloque de datos esperado de Kali Access.' };
    }

    const requiredTables = ['clients', 'activities', 'packages'];
    for (const table of requiredTables) {
        if (!Array.isArray(content.data[table])) {
            return { isValid: false, message: `Estructura incompleta: falta la tabla obligatoria "${table}".` };
        }
    }

    return {
        isValid: true,
        message: 'Archivo de respaldo válido y compatible.',
        payload: content as SystemBackupPayload
    };
}

/**
 * Restaura los datos del backup en la base de datos de Supabase y cachés locales
 */
export async function restoreBackup(
    backup: SystemBackupPayload,
    onProgress?: (step: string, percentage: number) => void
): Promise<{ success: boolean; totalRestored: number; report: Record<string, number>; errors: string[] }> {
    const report: Record<string, number> = {};
    const allErrors: string[] = [];

    const steps = [
        { key: 'system_config', label: 'Configuración del Sistema', weight: 5 },
        { key: 'activities', label: 'Actividades y Disciplinas', weight: 10 },
        { key: 'packages', label: 'Paquetes y Planes', weight: 10 },
        { key: 'package_activities', label: 'Relaciones de Paquetes', weight: 10 },
        { key: 'products', label: 'Inventario de Productos', weight: 10 },
        { key: 'clients', label: 'Socios y Huellas Digitales', weight: 25 },
        { key: 'client_subscriptions', label: 'Suscripciones de Socios', weight: 10 },
        { key: 'payments', label: 'Historial de Pagos', weight: 10 },
        { key: 'expenses', label: 'Gastos y Egresos', weight: 5 },
        { key: 'attendance', label: 'Registros de Asistencia', weight: 5 },
    ];

    let currentProgress = 0;
    let totalRestored = 0;

    for (const step of steps) {
        const records = (backup.data as any)[step.key] || [];
        onProgress?.(`Restaurando ${step.label} (${records.length} registros)...`, currentProgress);

        if (records.length > 0) {
            const { inserted, errors } = await upsertInBatches(step.key, records);
            report[step.key] = inserted;
            totalRestored += inserted;
            if (errors.length > 0) {
                allErrors.push(...errors.map(e => `[${step.key}] ${e}`));
            }
        } else {
            report[step.key] = 0;
        }

        currentProgress += step.weight;
        onProgress?.(`Finalizado ${step.label}`, currentProgress);
    }

    // Actualizar cachés de LocalStorage para sincronización inmediata
    try {
        if (backup.data.clients && backup.data.clients.length > 0) {
            localStorage.removeItem('cached_clients_list');
        }
        if (backup.data.activities && backup.data.activities.length > 0) {
            localStorage.removeItem('cached_activities_list');
        }
        if (backup.data.packages && backup.data.packages.length > 0) {
            localStorage.removeItem('cached_packages_list');
        }
        if (backup.data.package_activities && backup.data.package_activities.length > 0) {
            localStorage.removeItem('cached_pkg_activities_relations');
        }
        if (backup.data.system_config && backup.data.system_config.length > 0) {
            window.dispatchEvent(new CustomEvent('kali_system_config_updated', { detail: backup.data.system_config[0] }));
        }
    } catch {}

    onProgress?.("Restauración completada con éxito.", 100);

    return {
        success: allErrors.length === 0 || totalRestored > 0,
        totalRestored,
        report,
        errors: allErrors
    };
}

/**
 * Escapa y formatea un valor para una celda de archivo CSV de forma segura
 */
function escapeCsvValue(val: any): string {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
}

/**
 * Genera y descarga un archivo CSV completo con todos los datos de los clientes
 */
export async function exportClientsToCsv(onProgress?: (msg: string) => void): Promise<{ totalClients: number; filename: string }> {
    onProgress?.("Cargando lista completa de clientes...");
    const clients = await getClients();

    onProgress?.("Cargando actividades, paquetes y suscripciones...");
    const [activities, packages, subscriptions, allAttendance, allPayments] = await Promise.all([
        getActivities().catch(() => [] as Activity[]),
        getPackages().catch(() => [] as Package[]),
        fetchAllRows('client_subscriptions'),
        fetchAllRows('attendance'),
        fetchAllRows('payments')
    ]);

    const actMap = new Map(activities.map(a => [a.id, a.name]));
    const pkgMap = new Map(packages.map(p => [p.id, p.name]));

    // Agrupar asistencias por socio (total y última fecha)
    const attendanceCountMap = new Map<string, number>();
    const lastAttendanceMap = new Map<string, string>();
    allAttendance.forEach((att: any) => {
        if (att.client_id) {
            const count = attendanceCountMap.get(att.client_id) || 0;
            attendanceCountMap.set(att.client_id, count + 1);

            const prevLast = lastAttendanceMap.get(att.client_id);
            if (!prevLast || new Date(att.created_at).getTime() > new Date(prevLast).getTime()) {
                lastAttendanceMap.set(att.client_id, att.created_at);
            }
        }
    });

    // Agrupar pagos por socio (monto total acumulado y último pago)
    const paymentSumMap = new Map<string, number>();
    const lastPaymentMap = new Map<string, { date: string; amount: number; concept: string }>();
    allPayments.forEach((pay: any) => {
        if (pay.client_id) {
            const sum = paymentSumMap.get(pay.client_id) || 0;
            paymentSumMap.set(pay.client_id, sum + (Number(pay.amount) || 0));

            const prevLast = lastPaymentMap.get(pay.client_id);
            if (!prevLast || new Date(pay.created_at).getTime() > new Date(prevLast.date).getTime()) {
                lastPaymentMap.set(pay.client_id, {
                    date: pay.created_at,
                    amount: Number(pay.amount) || 0,
                    concept: pay.concept || ''
                });
            }
        }
    });

    // Agrupar suscripciones activas por socio
    const activeSubsCountMap = new Map<string, number>();
    subscriptions.forEach((sub: any) => {
        if (sub.client_id && (sub.is_active || sub.isActive)) {
            const count = activeSubsCountMap.get(sub.client_id) || 0;
            activeSubsCountMap.set(sub.client_id, count + 1);
        }
    });

    onProgress?.("Formateando hoja de cálculo de socios...");

    // Encabezados descriptivos del CSV
    const headers = [
        'ID Socio',
        'Nombre',
        'Apellido Paterno',
        'Apellido Materno',
        'Nombre Completo',
        'Teléfono / Celular',
        'Correo Electrónico',
        'Estado de Cuenta',
        'Estatus Membresía',
        'Días Restantes / Días Vencido',
        'Disciplina / Actividad',
        'Paquete / Plan',
        'Costo Membresía ($ MXN)',
        'Fecha Inicio Membresía',
        'Fecha Fin Membresía',
        'Huella Biométrica Registrada',
        'Foto Registrada',
        'Credencial Digital',
        'Vencimiento Credencial',
        'Total Asistencias Históricas',
        'Última Asistencia (Fecha y Hora)',
        'Total Pagado Histórico ($ MXN)',
        'Último Pago (Monto y Concepto)',
        'Último Recordatorio Enviado',
        'Suscripciones Activas',
        'Fecha de Registro en Sistema'
    ];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rows = clients.map(c => {
        const fullName = `${c.firstName || ''} ${c.lastNamePaternal || ''} ${c.lastNameMaternal || ''}`.trim();
        const activityTitle = c.activityName || (c.activity_id ? actMap.get(c.activity_id) : '') || 'Ninguna';
        const packageTitle = c.packageName || (c.package_id ? pkgMap.get(c.package_id) : '') || 'Sin Paquete';

        let membershipStatus = 'SIN MEMBRESÍA';
        let daysDiffText = 'N/A';

        if (c.membershipEnd) {
            const [y, m, d] = c.membershipEnd.split('-').map(Number);
            const endDate = new Date(y, m - 1, d);
            endDate.setHours(0, 0, 0, 0);

            const diffTime = endDate.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (!c.isActive) {
                membershipStatus = 'INACTIVO / DE BAJA';
                daysDiffText = diffDays < 0 ? `Vencida hace ${Math.abs(diffDays)} días` : `${diffDays} días restantes`;
            } else if (diffDays < 0) {
                membershipStatus = 'VENCIDA';
                daysDiffText = `Vencida hace ${Math.abs(diffDays)} días`;
            } else if (diffDays <= 3) {
                membershipStatus = 'POR VENCER';
                daysDiffText = diffDays === 0 ? 'Vence HOY' : `${diffDays} días restantes`;
            } else {
                membershipStatus = 'VIGENTE';
                daysDiffText = `${diffDays} días restantes`;
            }
        }

        const hasFingerprint = !!c.fingerprint_template;
        const hasPhoto = !!c.photoUrl;
        const hasCredential = !!c.credentialUrl;
        const totalAttendance = attendanceCountMap.get(c.id) || 0;
        const rawLastAtt = lastAttendanceMap.get(c.id);
        const lastAttendanceFormatted = rawLastAtt ? new Date(rawLastAtt).toLocaleString('es-MX') : 'Sin registros';

        const totalPayments = paymentSumMap.get(c.id) || 0;
        const lastPaymentObj = lastPaymentMap.get(c.id);
        const lastPaymentFormatted = lastPaymentObj 
            ? `$${lastPaymentObj.amount} (${lastPaymentObj.concept}) - ${new Date(lastPaymentObj.date).toLocaleDateString('es-MX')}` 
            : 'Sin pagos';

        const activeSubsCount = activeSubsCountMap.get(c.id) || 0;
        const createdAtFormatted = c.created_at ? new Date(c.created_at).toLocaleDateString('es-MX') : 'N/A';

        return [
            escapeCsvValue(c.id),
            escapeCsvValue(c.firstName || ''),
            escapeCsvValue(c.lastNamePaternal || ''),
            escapeCsvValue(c.lastNameMaternal || ''),
            escapeCsvValue(fullName),
            escapeCsvValue(c.phone || ''),
            escapeCsvValue(c.email || ''),
            escapeCsvValue(c.isActive ? 'ACTIVO' : 'INACTIVO'),
            escapeCsvValue(membershipStatus),
            escapeCsvValue(daysDiffText),
            escapeCsvValue(activityTitle),
            escapeCsvValue(packageTitle),
            escapeCsvValue(c.cost !== null && c.cost !== undefined ? c.cost : 0),
            escapeCsvValue(c.membershipStart || ''),
            escapeCsvValue(c.membershipEnd || ''),
            escapeCsvValue(hasFingerprint ? 'SÍ' : 'NO'),
            escapeCsvValue(hasPhoto ? 'SÍ' : 'NO'),
            escapeCsvValue(hasCredential ? 'SÍ' : 'NO'),
            escapeCsvValue(c.credentialExpiresAt || 'N/A'),
            escapeCsvValue(totalAttendance),
            escapeCsvValue(lastAttendanceFormatted),
            escapeCsvValue(totalPayments),
            escapeCsvValue(lastPaymentFormatted),
            escapeCsvValue(c.lastReminderSent ? new Date(c.lastReminderSent).toLocaleString('es-MX') : 'Ninguno'),
            escapeCsvValue(activeSubsCount),
            escapeCsvValue(createdAtFormatted)
        ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.map(h => `"${h}"`).join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const dateStamp = now.toISOString().split('T')[0];
    const filename = `clientes_kali_access_${dateStamp}.csv`;

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return { totalClients: clients.length, filename };
}
