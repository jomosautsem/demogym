
import React, { useState, useMemo, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Client, DashboardMetrics, Package, Activity, UserRole, SystemConfig, ClientSubscription } from '../types';
import RenewalModal from './RenewalModal';
import PaymentHistoryModal from './PaymentHistoryModal';
import RegistrationSuccessModal from './RegistrationSuccessModal';
import ShiftDetailsModal from './ShiftDetailsModal';
import { getSystemConfig, updateSystemConfig, logClientReminder, getClientReminderCountLast3Days, DEFAULT_WA_TEMPLATE, DEFAULT_WA_RECOVERY_TEMPLATE, DEFAULT_WA_WELCOME_TEMPLATE, DEFAULT_WA_RENEWAL_TEMPLATE, DEFAULT_WA_PAYMENT_TEMPLATE, bulkSetClientsInactive } from '../services/storage';
import { useToast } from '../context/ToastContext';
import { useRef } from 'react';

interface DashboardProps {
  metrics: DashboardMetrics;
  clients: Client[];
  subscriptions?: ClientSubscription[];
  expiredClients: Client[];
  packages: Package[];
  activities: Activity[];
  userName: string;
  userRole: UserRole;
  allowedActivityIds: string[];
  allowedPackageIds: string[];
  isLoading: boolean;
  onRefreshData: () => void;
  onShowQr?: (client: Client) => void;
  onEditClient?: (client: Client) => void;
  onDeleteClient?: (client: Client) => void;
  onToggleStatus?: (client: Client) => void;
  canRenew: boolean;
  onSwitchCamera?: () => void;
  viewMode: 'DASHBOARD' | 'CLIENTS_DB';
  onAddExpense?: () => void; 
  packageRelations?: {package_id: string, activity_id: string}[];
  onOpenAttendancePanel?: () => void;
  canManageFingerprints?: boolean;
}

type QuickFilterType = 'ALL' | 'EXPIRED_ONLY' | 'EXPIRED_ALL' | 'EXPIRING' | 'ACTIVE_HEALTHY' | 'ATTENDANCE';
type TemplateType = 'WARNING' | 'RECOVERY' | 'WELCOME' | 'RENEWAL' | 'PAYMENT';

const getDaysDiff = (dateStr?: string) => {
    if (!dateStr) return -9999;
    const [y, m, d] = dateStr.split('-').map(Number);
    const end = new Date(y, m - 1, d);
    const now = new Date();
    now.setHours(0,0,0,0);
    return Math.ceil((end.getTime() - now.getTime()) / 864e5);
};

const getPlanDuration = (startStr?: string, endStr?: string) => {
    if (!startStr || !endStr) return 0;
    const [sy, sm, sd] = startStr.split('-').map(Number);
    const [ey, em, ed] = endStr.split('-').map(Number);
    const start = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    return Math.ceil((end.getTime() - start.getTime()) / 864e5);
};

const Dashboard: React.FC<DashboardProps> = ({
  metrics,
  clients,
  subscriptions = [],
  expiredClients,
  packages,
  activities,
  userName,
  userRole,
  allowedActivityIds,
  allowedPackageIds,
  isLoading,
  onRefreshData,
  onShowQr,
  onEditClient,
  onDeleteClient,
  onToggleStatus,
  canRenew,
  viewMode,
  onAddExpense,
  packageRelations = [],
  onOpenAttendancePanel,
  canManageFingerprints = false
}) => {
  const { showToast } = useToast();

  const getClientDisciplinesList = (item: any) => {
      const clientObj = item.originClient || item.client || item;
      const activeDisciplines = new Set<string>();

      // 1. Obtener de su paquete principal (y sus actividades vinculadas)
      if (clientObj.package_id) {
          const pId = clientObj.package_id;
          const pkg = packages.find(p => p.id === pId);
          if (pkg) {
              const relActivityIds = packageRelations
                  .filter(r => r.package_id === pId)
                  .map(r => r.activity_id);
              
              relActivityIds.forEach(actId => {
                  const actObj = activities.find(a => a.id === actId);
                  if (actObj) activeDisciplines.add(actObj.name);
              });
          }
      }

      // 2. Obtener de su actividad principal directa
      if (clientObj.activity_id) {
          const actObj = activities.find(a => a.id === clientObj.activity_id);
          if (actObj) activeDisciplines.add(actObj.name);
      }

      // 3. Obtener de otras suscripciones activas vinculadas
      const subList = subscriptions || [];
      const clientSubs = subList.filter(s => s.client_id === clientObj.id && s.isActive);
      clientSubs.forEach(sub => {
          if (sub.package_id) {
              const relActivityIds = packageRelations
                  .filter(r => r.package_id === sub.package_id)
                  .map(r => r.activity_id);
              
              relActivityIds.forEach(actId => {
                  const actObj = activities.find(a => a.id === actId);
                  if (actObj) activeDisciplines.add(actObj.name);
              });
          }
          if (sub.activity_id) {
              const actObj = activities.find(a => a.id === sub.activity_id);
              if (actObj) activeDisciplines.add(actObj.name);
          }
      });

      return Array.from(activeDisciplines);
  };

  const getClientDisciplinesWithDates = (item: any) => {
      const clientObj = item.originClient || item.client || item;
      const disciplinesMap = new Map<string, { endDate: string; name: string }>();

      // 1. Primero, obtener de las suscripciones activas vinculadas (más precisas por disciplina)
      const subList = subscriptions || [];
      const clientSubs = subList.filter(s => s.client_id === clientObj.id && s.isActive);
      
      clientSubs.forEach(sub => {
          if (sub.package_id) {
              const relActivityIds = packageRelations
                  .filter(r => r.package_id === sub.package_id)
                  .map(r => r.activity_id);
              
              if (relActivityIds.length > 0) {
                  relActivityIds.forEach(actId => {
                      const actObj = activities.find(a => a.id === actId);
                      if (actObj) {
                          const existing = disciplinesMap.get(actObj.name);
                          if (!existing || sub.endDate > existing.endDate) {
                              disciplinesMap.set(actObj.name, {
                                  name: actObj.name,
                                  endDate: sub.endDate
                              });
                          }
                      }
                  });
              } else {
                  const pkg = packages.find(p => p.id === sub.package_id);
                  if (pkg) {
                      const existing = disciplinesMap.get(pkg.name);
                      if (!existing || sub.endDate > existing.endDate) {
                          disciplinesMap.set(pkg.name, {
                              name: pkg.name,
                              endDate: sub.endDate
                          });
                      }
                  }
              }
          }
          if (sub.activity_id) {
              const actObj = activities.find(a => a.id === sub.activity_id);
              if (actObj) {
                  const existing = disciplinesMap.get(actObj.name);
                  if (!existing || sub.endDate > existing.endDate) {
                      disciplinesMap.set(actObj.name, {
                          name: actObj.name,
                          endDate: sub.endDate
                      });
                  }
              }
          }
      });

      // 2. Como fallback para soporte legacy/retrocompatibilidad, agregamos disciplinas del cliente general y forzamos fechas actualizadas
      if (clientObj.package_id) {
          const pId = clientObj.package_id;
          const pkg = packages.find(p => p.id === pId);
          if (pkg) {
              const relActivityIds = packageRelations
                  .filter(r => r.package_id === pId)
                  .map(r => r.activity_id);
              
              if (relActivityIds.length > 0) {
                  relActivityIds.forEach(actId => {
                      const actObj = activities.find(a => a.id === actId);
                      if (actObj) {
                          const existing = disciplinesMap.get(actObj.name);
                          if (!existing || clientObj.membershipEnd > existing.endDate) {
                              disciplinesMap.set(actObj.name, {
                                  name: actObj.name,
                                  endDate: clientObj.membershipEnd
                              });
                          }
                      }
                  });
              } else {
                  const existing = disciplinesMap.get(pkg.name);
                  if (!existing || clientObj.membershipEnd > existing.endDate) {
                      disciplinesMap.set(pkg.name, {
                          name: pkg.name,
                          endDate: clientObj.membershipEnd
                      });
                  }
              }
          }
      }

      if (clientObj.activity_id) {
          const actObj = activities.find(a => a.id === clientObj.activity_id);
          if (actObj) {
              const existing = disciplinesMap.get(actObj.name);
              if (!existing || clientObj.membershipEnd > existing.endDate) {
                  disciplinesMap.set(actObj.name, {
                      name: actObj.name,
                      endDate: clientObj.membershipEnd
                  });
              }
          }
      }

      return Array.from(disciplinesMap.values());
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  
  // Nuevo estado para filtrar por Actividad o Paquete específico
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  // Configuración inicial del filtro:
  const [quickFilter, setQuickFilter] = useState<QuickFilterType>(
      viewMode === 'DASHBOARD' ? 'EXPIRED_ONLY' : 'ALL'
  );

  // --- ESTADOS PARA GESTIÓN DE PLANTILLAS ---
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [isEditingTemplate, setIsEditingTemplate] = useState(false);
  const [activeTemplateTab, setActiveTemplateTab] = useState<TemplateType>('WARNING');
  const [currentTemplateText, setCurrentTemplateText] = useState('');

  // Estados para modales de acción
  const [renewingClient, setRenewingClient] = useState<Client | null>(null);
  const [viewingHistoryClient, setViewingHistoryClient] = useState<Client | null>(null);
  
  // Modales Dashboard
  const [showExpiringModal, setShowExpiringModal] = useState(false);
  const [showDebenPagarModal, setShowDebenPagarModal] = useState(false);
  const [showShiftModal, setShowShiftModal] = useState(false);

  // Estado para éxito de renovación
  const [renewalSuccessData, setRenewalSuccessData] = useState<{client: Client, amount: number, concept: string} | null>(null);

  // Estado para bloquear botones de recordatorio localmente
  const [recentlySent, setRecentlySent] = useState<Set<string>>(new Set());

  // --- LÓGICA DE LIMPIEZA AUTOMÁTICA (MÁS DE 5 DÍAS VENCIDOS) ---
  const cleanupPerformed = useRef(false);

  useEffect(() => {
    const performCleanup = async () => {
      if (cleanupPerformed.current || clients.length === 0 || isLoading) return;
      cleanupPerformed.current = true;

      const clientsToDeactivate = clients.filter(c => {
        if (!c.isActive || !c.membershipEnd) return false;
        const diff = getDaysDiff(c.membershipEnd);
        return diff <= -6; // Cumplido el sexto día posterior a la fecha de vencimiento (período de gracia de 5 días: días -1 a -5)
      });

      if (clientsToDeactivate.length > 0) {
        try {
          const ids = clientsToDeactivate.map(c => c.id);
          await bulkSetClientsInactive(ids);
          onRefreshData(); // Refrescar para ver cambios
          showToast(`LIMPIEZA: ${clientsToDeactivate.length} SOCIOS DADOS DE BAJA (MÁS DE 5 DÍAS VENCIDOS)`, 'info');
        } catch (error) {
          console.error("Error en limpieza automática", error);
        }
      }
    };
    
    performCleanup();
  }, [clients, isLoading, onRefreshData]);

  // Cargar configuración al montar
  useEffect(() => {
      loadSystemConfig();
  }, []);

  const loadSystemConfig = async () => {
      try {
          const loadedConfig = await getSystemConfig();
          setConfig(loadedConfig);
      } catch (error) {
          console.error("Error loading config", error);
      }
  };

  // Al abrir el editor, cargar el texto de la pestaña activa
  useEffect(() => {
      if (isEditingTemplate && config) {
          switch (activeTemplateTab) {
              case 'WARNING': setCurrentTemplateText(config.wa_template_warning || DEFAULT_WA_TEMPLATE); break;
              case 'RECOVERY': setCurrentTemplateText(config.wa_template_recovery || DEFAULT_WA_RECOVERY_TEMPLATE); break;
              case 'WELCOME': setCurrentTemplateText(config.wa_template_welcome || DEFAULT_WA_WELCOME_TEMPLATE); break;
              case 'RENEWAL': setCurrentTemplateText(config.wa_template_renewal || DEFAULT_WA_RENEWAL_TEMPLATE); break;
              case 'PAYMENT': setCurrentTemplateText(config.wa_template_payment || DEFAULT_WA_PAYMENT_TEMPLATE); break;
          }
      }
  }, [activeTemplateTab, isEditingTemplate, config]);

  const handleSaveTemplate = async () => {
      try {
          const updates: Partial<SystemConfig> = {};
          
          switch (activeTemplateTab) {
              case 'WARNING': updates.wa_template_warning = currentTemplateText; break;
              case 'RECOVERY': updates.wa_template_recovery = currentTemplateText; break;
              case 'WELCOME': updates.wa_template_welcome = currentTemplateText; break;
              case 'RENEWAL': updates.wa_template_renewal = currentTemplateText; break;
              case 'PAYMENT': updates.wa_template_payment = currentTemplateText; break;
          }

          const newConfig = await updateSystemConfig(updates);
          setConfig(newConfig);
          showToast('PLANTILLA GUARDADA CORRECTAMENTE', 'success');
          setIsEditingTemplate(false);
      } catch (error) {
          showToast('Error al guardar plantilla', 'error');
      }
  };

  const getWhatsAppLink = (client: Client, diffDays: number, cleanLink: boolean = false, customMsg?: string, disciplineName: string = 'Membresía') => {
      if (!client.phone) return null;
      
      const cleanPhone = client.phone.replace(/\D/g, '');
      const phone = cleanPhone.length === 10 ? '52' + cleanPhone : cleanPhone;
      
      // Si es enlace limpio (Base de datos), no agregamos texto
      if (cleanLink) {
          return `https://wa.me/${phone}`;
      }

      const formattedDiscipline = disciplineName || 'Membresía';

      if (customMsg) {
          const msg = customMsg
              .replace(/\{nombre\}/gi, client.firstName)
              .replace(/\{dias\}/gi, Math.abs(diffDays).toString())
              .replace(/\{fecha\}/gi, client.membershipEnd || '')
              .replace(/\{disciplina\}/gi, formattedDiscipline)
              .replace(/\{plan\}/gi, formattedDiscipline);
          return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
      }

      if (!config) return `https://wa.me/${phone}`;
      
      let template = '';
      
      if (diffDays < 0) {
          template = config.wa_template_recovery || DEFAULT_WA_RECOVERY_TEMPLATE;
      } else {
          template = config.wa_template_warning || DEFAULT_WA_TEMPLATE;
      }

      const msg = template
          .replace(/\{NOMBRE\}/gi, client.firstName)
          .replace(/\{DIAS\}/gi, Math.abs(diffDays).toString())
          .replace(/\{FECHA\}/gi, client.membershipEnd || '')
          .replace(/\{DISCIPLINA\}/gi, formattedDiscipline)
          .replace(/\{PLAN\}/gi, formattedDiscipline);
      
      return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  };

  const isToday = (dateString?: string | null) => {
      if (!dateString) return false;
      const date = new Date(dateString);
      const today = new Date();
      return date.getDate() === today.getDate() &&
             date.getMonth() === today.getMonth() &&
             date.getFullYear() === today.getFullYear();
  };

  const handleRecordReminder = (clientId: string) => {
      setRecentlySent(prev => new Set(prev).add(clientId));
      logClientReminder(clientId).catch(err => console.error("Error logging reminder", err));
  };

  useEffect(() => {
      setQuickFilter(viewMode === 'DASHBOARD' ? 'EXPIRED_ONLY' : 'ALL');
      setStatusFilter('ALL');
      setCategoryFilter('ALL'); // Resetear filtro de categoría al cambiar vista
  }, [viewMode]);

  const [previewPhoto, setPreviewPhoto] = useState<{url: string, name: string} | null>(null);
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [queueIndex, setQueueIndex] = useState(0);
  const [customBulkMessage, setCustomBulkMessage] = useState('');

  // Al cambiar filtros o búsqueda, limpiar selección para evitar errores
  useEffect(() => {
      setSelectedClients(new Set());
  }, [searchTerm, statusFilter, categoryFilter, quickFilter]);

  const toggleSelectClient = (clientId: string) => {
      setSelectedClients(prev => {
          const next = new Set(prev);
          if (next.has(clientId)) {
              next.delete(clientId);
          } else {
              next.add(clientId);
          }
          return next;
      });
  };

  const toggleSelectAll = () => {
      if (selectedClients.size === displayItems.length) {
          setSelectedClients(new Set());
      } else {
          setSelectedClients(new Set(displayItems.map(c => c.client_id)));
      }
  };

  const selectedList = useMemo(() => {
      return Array.from(selectedClients).map(id => clients.find(c => c.id === id)).filter(Boolean) as Client[];
  }, [selectedClients, clients]);

  const handlePhotoPreview = (e: React.MouseEvent, url: string, name: string) => {
      e.stopPropagation();
      setPreviewPhoto({ url, name });
  };

  // --- FILTRO DE SEGURIDAD PARA MONITORES ---
  const visibleClients = useMemo(() => {
      if (userRole !== UserRole.MONITOR) return clients;

      return clients.filter(c => {
          const allowByActivity = c.activity_id ? allowedActivityIds.includes(c.activity_id) : false;
          const allowByPackage = c.package_id ? allowedPackageIds.includes(c.package_id) : false;
          return allowByActivity || allowByPackage;
      });
  }, [clients, userRole, allowedActivityIds, allowedPackageIds]);

  const filteredClients = useMemo(() => {
    // 1. MAGIC WORD "ALL"
    if (searchTerm.toUpperCase() === 'ALL') {
        return visibleClients;
    }

    return visibleClients.filter(client => {
      const term = searchTerm.toLowerCase();
      
      // 2. Coincidencia por Texto
      const matchesSearch = 
        client.firstName.toLowerCase().includes(term) ||
        client.lastNamePaternal.toLowerCase().includes(term) ||
        (client.email && client.email.toLowerCase().includes(term));
      
      // Si hay un término de búsqueda, ignoramos los demás filtros para encontrar a cualquier socio
      if (term) return matchesSearch;

      // 3. Filtro de Estado (Activo/Inactivo)
      const matchesStatus = 
        statusFilter === 'ALL' ? true :
        statusFilter === 'ACTIVE' ? client.isActive :
        !client.isActive;

      // 4. Filtro por Categoría (Actividad o Paquete) - Robustecido
      const matchesCategory = 
        categoryFilter === 'ALL' ? true :
        (categoryFilter.startsWith('ACT_') && client.activity_id && String(client.activity_id) === categoryFilter.replace('ACT_', '')) ||
        (categoryFilter.startsWith('PKG_') && client.package_id && String(client.package_id) === categoryFilter.replace('PKG_', ''));

      // 5. Filtro Rápido (Quick Filters)
      let matchesQuick = true;
      const diff = getDaysDiff(client.membershipEnd);
      
      if (quickFilter === 'EXPIRED_ONLY') {
          matchesQuick = diff < 0 && diff >= -5 && client.isActive;
      } else if (quickFilter === 'EXPIRED_ALL') {
          matchesQuick = diff < 0;
      } else if (quickFilter === 'EXPIRING') {
          matchesQuick = diff >= 0 && diff <= 3 && client.isActive;
      } else if (quickFilter === 'ACTIVE_HEALTHY') {
          matchesQuick = diff > 3 && client.isActive;
      } else if (quickFilter === 'ATTENDANCE') {
          matchesQuick = isToday(client.lastAttendance);
      }

      return matchesStatus && matchesCategory && matchesQuick;
    }).sort((a, b) => {
        if (quickFilter === 'EXPIRED_ONLY' || quickFilter === 'EXPIRED_ALL') {
            // Más recientes vencidos arriba (ej: -1 antes que -10)
            return getDaysDiff(b.membershipEnd) - getDaysDiff(a.membershipEnd);
        }
        if (quickFilter === 'EXPIRING') {
            // Próximos a vencer arriba (ej: 0 antes que 3)
            return getDaysDiff(a.membershipEnd) - getDaysDiff(b.membershipEnd);
        }
        return 0;
    });
  }, [visibleClients, searchTerm, statusFilter, categoryFilter, quickFilter]);

  // --- MULTI-DISCIPLINE SUBSCRIPTIONS PARSER AND LISTING ---
  const allSubDisplayItems = useMemo(() => {
      const list: any[] = [];
      const subList = subscriptions || [];
      
      visibleClients.forEach(c => {
          // Filter to only include subscriptions that are active (not deactivated / given "baja")
          const clientSubs = subList.filter(s => s.client_id === c.id && s.isActive);
          
          if (clientSubs.length > 0) {
              // Group active subscriptions of the same client into a single display item.
              // Prioritize active (non-expired) subscriptions first. If multiple are active,
              // sort by earliest end date (most urgent). If all are expired, sort by most recent end date first.
              const sortedSubs = [...clientSubs].sort((a, b) => {
                  const aActive = (a.isActive && getDaysDiff(a.endDate) >= 0) ? 1 : 0;
                  const bActive = (b.isActive && getDaysDiff(b.endDate) >= 0) ? 1 : 0;
                  
                  if (aActive !== bActive) {
                      return bActive - aActive; // Active ones first
                  }
                  
                  if (aActive === 1) {
                      // Both are active: sort by endDate ascending (earliest first, most urgent)
                      return a.endDate.localeCompare(b.endDate);
                  } else {
                      // Both are expired: sort by endDate descending (most recently expired first)
                      return b.endDate.localeCompare(a.endDate);
                  }
              });

              const mostUrgentSub = sortedSubs[0];

              // Option A: If there are active/unexpired subscriptions, show those.
              // If ALL subscriptions are expired, ONLY show the most recently expired one, NOT all historical ones combined!
              const activeSubs = clientSubs.filter(sub => sub.isActive && getDaysDiff(sub.endDate) >= 0);
              const targetSubsForNames = activeSubs.length > 0 ? activeSubs : (mostUrgentSub ? [mostUrgentSub] : []);

              const packageNames = targetSubsForNames.map(sub => {
                  const pkgName = sub.package_id ? packages.find(p => p.id === sub.package_id)?.name : undefined;
                  const actName = sub.activity_id ? activities.find(a => a.id === sub.activity_id)?.name : undefined;
                  return pkgName || actName || 'Suscripción';
              }).filter(Boolean);

              const combinedPackageName = Array.from(new Set(packageNames)).join(" + ");

              // Sum the costs for all subscriptions
              const totalAmount = clientSubs.reduce((sum, sub) => sum + (sub.amount || 0), 0);
              const isAnyActive = clientSubs.some(sub => sub.isActive) || c.isActive;

              list.push({
                  id: `${c.id}_grouped`,
                  client: c,
                  subscriptions: clientSubs,
                  subscription: mostUrgentSub, // for backward compatibility/filtering fallback
                  startDate: mostUrgentSub ? mostUrgentSub.startDate : c.membershipStart,
                  endDate: mostUrgentSub ? mostUrgentSub.endDate : c.membershipEnd,
                  packageName: combinedPackageName || 'Suscripción',
                  amount: mostUrgentSub ? mostUrgentSub.amount : (c.cost || 0),
                  isActive: isAnyActive,
                  categoryName: combinedPackageName || 'Suscripción'
              });
          } else if (c.package_id || c.activity_id || c.membershipEnd) {
              const pkgName = c.package_id ? packages.find(p => p.id === c.package_id)?.name : undefined;
              const actName = c.activity_id ? activities.find(a => a.id === c.activity_id)?.name : undefined;
              
              list.push({
                  id: `${c.id}_legacy`,
                  client: c,
                  subscriptions: [],
                  subscription: null,
                  startDate: c.membershipStart,
                  endDate: c.membershipEnd,
                  packageName: pkgName || actName || c.packageName || c.activityName || 'Suscripción',
                  amount: c.cost || 0,
                  isActive: c.isActive,
                  categoryName: pkgName || actName || c.packageName || c.activityName || 'Suscripción'
              });
          }
      });
      
      return list;
  }, [visibleClients, subscriptions, packages, activities]);

  const displayItems = useMemo(() => {
      if (viewMode === 'CLIENTS_DB') {
          return filteredClients.map(c => ({
              id: c.id,
              client_id: c.id,
              client: c,
              firstName: c.firstName,
              lastNamePaternal: c.lastNamePaternal,
              lastNameMaternal: c.lastNameMaternal,
              phone: c.phone,
              email: c.email,
              photoUrl: c.photoUrl,
              membershipStart: c.membershipStart,
              membershipEnd: c.membershipEnd,
              packageName: c.packageName || c.activityName || 'N/A',
              cost: c.cost,
              isActive: c.isActive,
              lastAttendance: c.lastAttendance,
              lastReminderSent: c.lastReminderSent,
              originClient: c
          }));
      } else {
          if (searchTerm.toUpperCase() === 'ALL') {
              return allSubDisplayItems.map(item => ({
                  id: item.id,
                  client_id: item.client.id,
                  client: item.client,
                  firstName: item.client.firstName,
                  lastNamePaternal: item.client.lastNamePaternal,
                  lastNameMaternal: item.client.lastNameMaternal,
                  phone: item.client.phone,
                  email: item.client.email,
                  photoUrl: item.client.photoUrl,
                  membershipStart: item.startDate,
                  membershipEnd: item.endDate,
                  packageName: item.packageName,
                  cost: item.amount,
                  isActive: item.isActive,
                  lastAttendance: item.client.lastAttendance,
                  lastReminderSent: item.client.lastReminderSent,
                  originClient: item.client,
                  activityId: item.subscription?.activity_id || item.client.activity_id,
                  packageId: item.subscription?.package_id || item.client.package_id
              }));
          }

          const term = searchTerm.toLowerCase();
          
          return allSubDisplayItems.filter(item => {
              const c = item.client;
              const matchesSearch = 
                  c.firstName.toLowerCase().includes(term) ||
                  c.lastNamePaternal.toLowerCase().includes(term) ||
                  (c.email && c.email.toLowerCase().includes(term));
                  
              if (term) return matchesSearch;
              
              const diff = getDaysDiff(item.endDate);
              
              let matchesCategory = true;
              if (categoryFilter !== 'ALL') {
                  const subs = item.subscriptions || [];
                  if (categoryFilter.startsWith('ACT_')) {
                      const actId = categoryFilter.replace('ACT_', '');
                      matchesCategory = subs.length > 0 
                          ? subs.some(sub => sub.activity_id === actId)
                          : c.activity_id === actId;
                  } else if (categoryFilter.startsWith('PKG_')) {
                      const pkgId = categoryFilter.replace('PKG_', '');
                      matchesCategory = subs.length > 0
                          ? subs.some(sub => sub.package_id === pkgId)
                          : c.package_id === pkgId;
                  }
              }
              
              let matchesQuick = true;
              if (quickFilter === 'EXPIRED_ONLY') {
                  matchesQuick = diff < 0 && diff >= -5 && item.client.isActive;
              } else if (quickFilter === 'EXPIRED_ALL') {
                  matchesQuick = diff < 0;
              } else if (quickFilter === 'EXPIRING') {
                  matchesQuick = diff >= 0 && diff <= 3 && item.isActive;
              } else if (quickFilter === 'ACTIVE_HEALTHY') {
                  matchesQuick = diff > 3 && item.isActive;
              } else if (quickFilter === 'ATTENDANCE') {
                  matchesQuick = isToday(c.lastAttendance);
              }
              
              return matchesCategory && matchesQuick;
          }).sort((a, b) => {
              if (quickFilter === 'EXPIRED_ONLY' || quickFilter === 'EXPIRED_ALL') {
                  return getDaysDiff(b.endDate) - getDaysDiff(a.endDate);
              }
              if (quickFilter === 'EXPIRING') {
                  return getDaysDiff(a.endDate) - getDaysDiff(b.endDate);
              }
              return 0;
          }).map(item => ({
              id: item.id,
              client_id: item.client.id,
              client: item.client,
              firstName: item.client.firstName,
              lastNamePaternal: item.client.lastNamePaternal,
              lastNameMaternal: item.client.lastNameMaternal,
              phone: item.client.phone,
              email: item.client.email,
              photoUrl: item.client.photoUrl,
              membershipStart: item.startDate,
              membershipEnd: item.endDate,
              packageName: item.packageName,
              cost: item.amount,
              isActive: item.isActive,
              lastAttendance: item.client.lastAttendance,
              lastReminderSent: item.client.lastReminderSent,
              originClient: item.client,
              activityId: item.subscription?.activity_id || item.client.activity_id,
              packageId: item.subscription?.package_id || item.client.package_id
          }));
      }
  }, [viewMode, filteredClients, allSubDisplayItems, searchTerm, categoryFilter, quickFilter]);

  // --- CALCULOS PARA RESUMEN DE OPERACIÓN (SMART SUMMARY) ---
  const operationSummary = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    
    // 1. Nuevos socios hoy (Usamos visibleClients para que el resumen sea global al contexto)
    const newsToday = visibleClients.filter(c => c.created_at?.startsWith(today)).length;
    
    // 2. Deben pagar hoy (Solo los que vencieron exactamente ayer according to local logic)
    const expiresToday = visibleClients.filter(c => {
        // Quitamos la restricción estricta de isActive si queremos contar a todos los que vencieron ayer 
        // y están en la lista de "Urgentes". Usamos getDaysDiff para consistencia.
        return getDaysDiff(c.membershipEnd) === -1;
    }).length;
    
    // 3. Pagos grandes (> $1000 o configurable)
    // Nota: Necesitamos acceder a los pagos actuales que se cargan en el gráfico o FinancePanel
    // Por ahora usaremos métricas de clientes nuevos/vencidos como eventos críticos principales.
    
    // 4. Stock crítico
    // Como no tenemos los productos aquí directamente, esto es un placeholder visual
    // Pero si estuvieran cargados, filtraríamos stock < 3.

    return {
      newsToday,
      expiresToday,
      activeRate: clients.length > 0 ? Math.round((clients.filter(c => c.isActive).length / clients.length) * 100) : 0
    };
  }, [visibleClients, clients]);

  const isAdmin = userRole === UserRole.ADMIN;
  const isMonitor = userRole === UserRole.MONITOR;
  const canUserRenew = isAdmin || canRenew;
  const canEditClient = isAdmin || canManageFingerprints || userRole === UserRole.COACH;
  const isBioAllowed = isAdmin || Boolean(canManageFingerprints);

  // ALTAS RECIENTES: Últimos 5 socios ordenados por fecha de creación (o ID si no hay fecha)
  const recentClients = useMemo(() => {
      return [...visibleClients]
          .sort((a, b) => {
              const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
              const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
              return dateB - dateA;
          })
          .slice(0, 5);
  }, [visibleClients]);

  // Lista específica para el modal de "Por Vencer"
  const expiringClientsList = useMemo(() => {
      return visibleClients.filter(c => {
          const days = getDaysDiff(c.membershipEnd);
          return c.isActive && days >= 0 && days <= 3;
      }).sort((a, b) => getDaysDiff(a.membershipEnd) - getDaysDiff(b.membershipEnd));
  }, [visibleClients]);

  // Lista específica para el modal de "Deben Pagar Hoy" (Vencieron ayer)
  const debenPagarClientsList = useMemo(() => {
    return visibleClients.filter(c => {
        return getDaysDiff(c.membershipEnd) === -1;
    }).sort((a, b) => {
        const nameA = `${a.firstName} ${a.lastNamePaternal}`.toLowerCase();
        const nameB = `${b.firstName} ${b.lastNamePaternal}`.toLowerCase();
        return nameA.localeCompare(nameB);
    });
  }, [visibleClients]);

  const totalExpired = visibleClients.filter(c => {
      const d = getDaysDiff(c.membershipEnd);
      return c.isActive && c.membershipEnd && d < 0 && d >= -5;
  }).length;

  const handleResetDashboard = () => {
      if (viewMode === 'DASHBOARD') {
          setQuickFilter('EXPIRED_ONLY');
      }
      setCategoryFilter('ALL');
      setSearchTerm('');
      onRefreshData();
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-yellow-500 font-mono-tech animate-pulse text-xl">CARGANDO SISTEMA...</div>
      </div>
    );
  }

  const MetricCard = ({ title, value, subtext, icon, active, onClick, colorClass = "text-white" }: any) => (
      <div 
        onClick={onClick}
        className={`relative bg-black border p-4 overflow-hidden group transition-all h-32 flex flex-col justify-between
        ${active ? 'border-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.1)]' : 'border-zinc-800'}
        ${onClick ? 'cursor-pointer hover:border-zinc-600' : 'cursor-default'}`}
      >
          <div className="flex justify-between items-start z-10 relative">
              <span className={`text-[10px] font-tech font-bold uppercase tracking-widest ${active ? 'text-yellow-500' : 'text-zinc-500'}`}>
                  {title}
              </span>
              {active && <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>}
          </div>
          
          <div className={`text-4xl font-mono-tech font-bold ${colorClass} z-10 relative tracking-tighter`}>
              {value}
          </div>
          
          <div className="text-[10px] text-zinc-600 font-mono-tech z-10 relative truncate">
              {subtext}
          </div>

          <div className="absolute -right-2 -bottom-4 text-zinc-900 group-hover:text-zinc-800 transition-colors pointer-events-none">
              {icon}
          </div>
      </div>
  );

  return (
    <div className="space-y-6 animate-[fadeIn_0.5s_ease-out] pb-20">
      
      {/* HEADER ROW */}
      <div className="flex flex-col md:flex-row justify-between items-end border-b border-zinc-800 pb-4 gap-4">
          <div>
              <h1 className="text-3xl font-tech font-black text-white uppercase tracking-tighter">
                  DASHBOARD <span className="text-yellow-500">ANALÍTICO</span>
              </h1>
              <p className="text-[10px] text-zinc-600 font-mono-tech tracking-[0.2em] uppercase">
                  MÉTRICAS CLAVE DEL NEGOCIO EN TIEMPO REAL
              </p>
          </div>
          
          <div className="flex gap-2 w-full md:w-auto">
              <button 
                  onClick={handleResetDashboard}
                  className="bg-zinc-900 border border-zinc-700 text-zinc-400 px-4 py-2 hover:bg-zinc-800 hover:text-white hover:border-zinc-500 transition-all font-tech font-bold text-xs uppercase flex items-center gap-2"
              >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  ACTUALIZAR
              </button>
              
              <div className="relative flex-1 md:w-64">
                  <input 
                      type="text" 
                      placeholder='BUSCAR (O "ALL")...'
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full bg-black border border-zinc-700 py-2 pl-8 pr-8 text-white text-xs font-mono-tech focus:border-yellow-500 outline-none h-full transition-all"
                  />
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-zinc-600 absolute left-2 top-1/2 transform -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  
                  {/* BOTÓN LIMPIAR BÚSQUEDA (SALIR MODO ENFOQUE) */}
                  {searchTerm && (
                    <button 
                        onClick={() => setSearchTerm('')}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-zinc-500 hover:text-red-500 transition-colors"
                        title="Limpiar búsqueda"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                    </button>
                  )}
              </div>
          </div>
      </div>

      {/* ACCIONES MASIVAS */}
      {selectedClients.size > 0 && (
          <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50">
              <motion.div 
                  initial={{ y: 50, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="flex items-center gap-3 bg-yellow-500 text-black px-6 py-3 rounded-full shadow-[0_10px_40px_rgba(234,179,8,0.4)] border-2 border-yellow-400"
              >
                  <span className="text-xs font-black uppercase tracking-tighter">
                      {selectedClients.size} SOCIOS SELECCIONADOS
                  </span>
                  <div className="h-6 w-[1px] bg-black/20 mx-2"></div>
                  <button 
                      onClick={() => {
                          const firstClient = selectedList[0];
                          if (firstClient) {
                              const diff = getDaysDiff(firstClient.membershipEnd);
                              let template = '';
                              if (diff < 0) {
                                  template = config?.wa_template_recovery || DEFAULT_WA_RECOVERY_TEMPLATE;
                              } else {
                                  template = config?.wa_template_warning || DEFAULT_WA_TEMPLATE;
                              }
                              setCustomBulkMessage(template);
                          }
                          setQueueIndex(0);
                          setShowQueueModal(true);
                      }}
                      className="bg-black text-yellow-500 px-5 py-2 rounded-full text-xs font-black uppercase hover:bg-zinc-900 transition-all flex items-center gap-2 shadow-lg"
                  >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.017-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                      ENVIAR COLA
                  </button>
                  <button 
                      onClick={() => setSelectedClients(new Set())}
                      className="text-black hover:bg-black/10 p-2 rounded-full transition-colors"
                  >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  </button>
              </motion.div>
          </div>
      )}

      {/* METRICS ROW - MODO ENFOQUE: OCULTAR SI HAY BÚSQUEDA */}
      {viewMode === 'DASHBOARD' && searchTerm === '' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-[fadeIn_0.3s_ease-out]">
           
           {/* Card 1: VENCEN (3 DÍAS) */}
           <div 
                onClick={() => setShowExpiringModal(true)}
                className={`relative overflow-hidden group transition-all h-32 flex flex-col justify-between p-4 cursor-pointer rounded-2xl shadow-lg hover:shadow-yellow-500/20 hover:scale-[1.02] active:scale-95
                    bg-gradient-to-br from-yellow-400 via-yellow-500 to-orange-500
                `}
           >
                <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent pointer-events-none"></div>
                <div className="absolute top-0 right-0 p-4 opacity-30 pointer-events-none">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 text-black mix-blend-overlay" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                
                <div className="flex justify-between items-start z-10 relative">
                    <span className="text-[10px] font-tech font-bold uppercase tracking-widest text-black/80 drop-shadow-sm">
                        {isMonitor ? 'MIS VENCIMIENTOS' : 'VENCEN (3 DÍAS)'}
                    </span>
                </div>
                
                <div className="text-5xl font-mono-tech font-black text-black z-10 relative tracking-tighter drop-shadow-sm leading-none mt-1">
                    {/* Si es monitor, mostramos el conteo de SU lista permitida, no la global */}
                    {isMonitor ? expiringClientsList.length : metrics.expiringSoonCount}
                </div>
                
                <div className="text-[10px] text-black/90 font-mono-tech z-10 relative font-bold uppercase tracking-wider flex items-center gap-1">
                    <span>Click para ver lista</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </div>
           </div>

           {/* Card 2: ACTIVOS */}
           <MetricCard 
                title={isMonitor ? "MIS SOCIOS ACTIVOS" : "CLIENTES ACTIVOS"}
                value={isMonitor ? visibleClients.filter(c => c.isActive).length : metrics.activeClientsCount}
                subtext="Total de socios con acceso permitido."
                active={false}
                onClick={undefined}
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>}
           />
           {/* Card 3: ASISTENCIAS */}
           <MetricCard 
                title="ASISTENCIAS (HOY)" 
                value={metrics.todaysAttendanceCount}
                subtext="Entradas registradas hoy. Click para ver en vivo."
                active={false}
                onClick={onOpenAttendancePanel}
                icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
           />
           
           {/* Card 4: CAJA (MODIFICADA) */}
           <div 
                onClick={() => setShowShiftModal(true)}
                className="relative bg-black border border-zinc-800 p-4 overflow-hidden h-32 flex flex-col justify-between group cursor-pointer hover:border-emerald-500 hover:shadow-[0_0_15px_rgba(16,185,129,0.2)] transition-all"
           >
                <div className="flex justify-between items-start z-10">
                    <span className="text-[10px] font-tech font-bold uppercase tracking-widest text-zinc-500 group-hover:text-emerald-500">CORTE CAJA (HOY)</span>
                    {onAddExpense && (isAdmin || userRole === UserRole.COACH) && (
                        <button 
                            onClick={(e) => {
                                e.stopPropagation(); // Evitar abrir modal
                                onAddExpense();
                            }}
                            className="bg-red-900/30 text-red-500 border border-red-900/50 hover:bg-red-900/50 hover:border-red-500 px-2 py-1 text-[9px] font-bold uppercase transition-all flex items-center gap-1 z-20 rounded-sm"
                            title="Registrar Gasto"
                        >
                            <span>- GASTO</span>
                        </button>
                    )}
                </div>
                <div className="flex items-end gap-4 z-10 relative">
                    <div>
                        <div className="text-3xl font-mono-tech font-bold text-white tracking-tighter group-hover:text-emerald-400">
                            ${metrics.dailyRevenue.toLocaleString('en-US', {maximumFractionDigits:0})}
                        </div>
                        <div className="text-[10px] text-zinc-600 font-mono-tech mt-1">HOY (NETO)</div>
                    </div>
                    {/* SECCIÓN DEL MES ELIMINADA COMO SOLICITADO */}
                </div>
                
                <div className="absolute bottom-2 right-4 text-[9px] text-zinc-600 font-tech uppercase flex items-center gap-1 group-hover:text-emerald-500/80">
                    <span>VER DETALLES</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                </div>

                <div className="absolute -right-2 -bottom-4 text-zinc-900 group-hover:text-zinc-800 transition-colors pointer-events-none">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v.01M12 12v4m0 4v.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                </div>
           </div>
        </div>
      )}

      {/* --- SECCIÓN ALTAS RECIENTES (NUEVA) --- */}
      {viewMode === 'DASHBOARD' && searchTerm === '' && recentClients.length > 0 && (
          <div className="bg-zinc-900/20 border border-zinc-800 p-4 rounded-xl animate-[fadeIn_0.5s_ease-out]">
              <div className="flex items-center gap-2 mb-4 px-2">
                  <div className="w-1 h-4 bg-emerald-500 rounded-full"></div>
                  <h3 className="font-tech font-black uppercase text-xs tracking-[0.2em] text-zinc-300">ALTAS RECIENTES</h3>
                  <span className="text-[10px] font-mono-tech text-emerald-500/60 font-bold ml-auto uppercase">Últimos Registros</span>
              </div>
              
              <div className="flex flex-wrap gap-4 px-2">
                  {recentClients.map((c) => (
                      <div key={c.id} className="flex flex-col items-center gap-2 group cursor-default">
                              <div className="relative">
                                  <div 
                                    className="w-16 h-16 rounded-full border-2 border-emerald-500/30 p-1 group-hover:border-emerald-500 transition-all duration-300 overflow-hidden bg-black shadow-[0_0_10px_rgba(16,185,129,0.1)] group-hover:shadow-[0_0_15px_rgba(16,185,129,0.3)] cursor-pointer"
                                    onClick={(e) => c.photoUrl && handlePhotoPreview(e, c.photoUrl, `${c.firstName} ${c.lastNamePaternal}`)}
                                  >
                                      {c.photoUrl ? (
                                          <img src={c.photoUrl} alt="" className="w-full h-full object-cover rounded-full" />
                                      ) : (
                                          <div className="w-full h-full flex items-center justify-center text-xl bg-zinc-900 rounded-full">👤</div>
                                      )}
                                  </div>
                              {/* Indicador de "Nuevo" (si fue hoy o ayer) */}
                              <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-black rounded-full shadow-lg shadow-emerald-500/50 animate-pulse"></div>
                          </div>
                          <div className="text-center">
                              <p className="text-[10px] font-tech font-bold text-white uppercase group-hover:text-emerald-400 transition-colors truncate w-20">
                                  {c.firstName}
                              </p>
                              <p className="text-[8px] font-mono-tech text-zinc-600 uppercase tracking-tighter">
                                  {c.activityName || 'Socio'}
                              </p>
                          </div>
                      </div>
                  ))}
                  
                  {/* Botón rápido para registrar (Shortcut) */}
                  <button 
                      onClick={() => document.querySelector<HTMLButtonElement>('button[onClick*="REGISTER"]')?.click()}
                      className="w-16 h-16 rounded-full border-2 border-dashed border-zinc-700 hover:border-yellow-500 flex items-center justify-center text-zinc-600 hover:text-yellow-500 transition-all duration-300 group"
                      title="Registrar Nuevo"
                  >
                      <span className="text-2xl group-hover:scale-125 transition-transform">+</span>
                  </button>
              </div>
          </div>
      )}

      {/* --- SECCIÓN RESUMEN DE OPERACIÓN CRÍTICA (NUEVA) --- */}
      {viewMode === 'DASHBOARD' && searchTerm === '' && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6 animate-[fadeIn_0.6s_ease-out]">
              <div className="bg-zinc-900/40 border border-zinc-800/50 p-4 rounded-xl flex items-center gap-4 hover:border-emerald-500/30 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/20">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
                  </div>
                  <div>
                      <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest">Altas Hoy</p>
                      <p className="text-xl font-black text-white leading-none mt-1">{operationSummary.newsToday}</p>
                  </div>
              </div>

              <div 
                  onClick={() => setShowDebenPagarModal(true)}
                  className="bg-zinc-900/40 border border-zinc-800/50 p-4 rounded-xl flex items-center gap-4 hover:bg-zinc-800/60 hover:border-red-500/50 hover:shadow-[0_0_20px_rgba(239,68,68,0.1)] transition-all duration-300 cursor-pointer group active:scale-[0.98] relative overflow-hidden"
              >
                  <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500 border border-red-500/20 group-hover:bg-red-500/20 group-hover:scale-110 transition-all">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                  <div className="flex-1">
                      <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest">Deben Pagar Hoy</p>
                      <p className="text-xl font-black text-white leading-none mt-1">{operationSummary.expiresToday}</p>
                  </div>
                  {/* CLICK Indicator */}
                  <div className="absolute right-4 flex items-center transition-all duration-300">
                      <span className="text-[8px] font-black bg-red-500 text-white px-1.5 py-0.5 rounded animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)] tracking-tighter">CLICK</span>
                  </div>
              </div>

              <div className="bg-zinc-900/40 border border-zinc-800/50 p-4 rounded-xl flex items-center gap-4 hover:border-blue-500/30 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                  <div>
                      <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest">Salud Base</p>
                      <p className="text-xl font-black text-white leading-none mt-1">{operationSummary.activeRate}%</p>
                  </div>
              </div>

              <div className={`bg-zinc-900/40 border p-4 rounded-xl flex items-center gap-4 transition-all ${operationSummary.expiresToday > 0 ? 'border-red-500/50 animate-pulse bg-red-500/5' : 'border-zinc-800/50'}`}>
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${operationSummary.expiresToday > 0 ? 'bg-red-500/20 text-red-500 border-red-500/30' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                  <div>
                      <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest">Estatus de Operación</p>
                      <p className={`text-xs font-black leading-none mt-1 ${operationSummary.expiresToday > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                        {operationSummary.expiresToday > 0 ? '⚠️ ATENCIÓN REQUERIDA' : '✅ TODO NORMAL'}
                      </p>
                  </div>
              </div>
          </div>
      )}

      {/* ALERTS BANNER - MODO ENFOQUE: OCULTAR SI HAY BÚSQUEDA */}
      {viewMode === 'DASHBOARD' && searchTerm === '' && totalExpired > 0 && (
          <div className="flex items-center gap-3 py-2 px-1">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
              <p className="font-tech text-red-500 font-bold uppercase tracking-widest text-sm">
                  ALERTA: <span className="text-white">{totalExpired} MEMBRESÍAS VENCIDAS</span> REQUIEREN ATENCIÓN
              </p>
          </div>
      )}

      {/* TABLE SECTION */}
      <div className="border-t border-zinc-800 pt-4">
         <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 px-1 gap-4">
            <h3 className="font-tech font-bold uppercase text-xs tracking-widest border-l-2 pl-3 border-red-500 text-red-500">
                {viewMode === 'CLIENTS_DB' ? 'BASE DE DATOS COMPLETA' : 
                 searchTerm.toUpperCase() === 'ALL' ? 'LISTADO COMPLETO (SIN FILTROS)' :
                 searchTerm.length > 0 ? 'RESULTADOS DE BÚSQUEDA' :
                 quickFilter === 'EXPIRED_ONLY' ? 'LISTADO DE MEMBRESÍAS VENCIDAS (URGENTES)' :
                 quickFilter === 'EXPIRED_ALL' ? 'LISTADO DE MEMBRESÍAS VENCIDAS (TODOS - INCLUYE INACTIVOS)' :
                 quickFilter === 'EXPIRING' ? 'PRÓXIMOS A VENCER (3 DÍAS)' :
                 quickFilter === 'ACTIVE_HEALTHY' ? 'LISTADO DE SOCIOS ACTIVOS' : 'RESULTADOS DE BÚSQUEDA'}
            </h3>
            
            {viewMode === 'CLIENTS_DB' && (
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                     {/* NUEVO FILTRO: CATEGORÍAS (ACTIVIDAD / PAQUETE) */}
                     <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="bg-zinc-950 border border-zinc-700 text-white text-xs font-bold uppercase p-2 focus:border-yellow-500 outline-none font-tech"
                     >
                        <option value="ALL">TODAS LAS DISCIPLINAS</option>
                        <optgroup label="ACTIVIDADES (CLASES)">
                            {activities.map(act => (
                                <option key={`ACT_${act.id}`} value={`ACT_${act.id}`}>CLASE: {act.name}</option>
                            ))}
                        </optgroup>
                        <optgroup label="PAQUETES (MEMBRESÍAS)">
                            {packages.map(pkg => (
                                <option key={`PKG_${pkg.id}`} value={`PKG_${pkg.id}`}>PLAN: {pkg.name}</option>
                            ))}
                        </optgroup>
                     </select>

                     <div className="flex gap-2">
                        <button onClick={() => setStatusFilter('ALL')} className={`text-[10px] uppercase font-bold px-2 py-1 border ${statusFilter === 'ALL' ? 'border-yellow-500 text-yellow-500' : 'border-zinc-800 text-zinc-600'}`}>TODOS</button>
                        <button onClick={() => setStatusFilter('ACTIVE')} className={`text-[10px] uppercase font-bold px-2 py-1 border ${statusFilter === 'ACTIVE' ? 'border-emerald-500 text-emerald-500' : 'border-zinc-800 text-zinc-600'}`}>ACTIVOS</button>
                        <button onClick={() => setStatusFilter('INACTIVE')} className={`text-[10px] uppercase font-bold px-2 py-1 border ${statusFilter === 'INACTIVE' ? 'border-red-500 text-red-500' : 'border-zinc-800 text-zinc-600'}`}>INACTIVOS</button>
                     </div>
                </div>
            )}
            
            {viewMode === 'DASHBOARD' && (
                <div className="flex gap-2">
                     <button onClick={() => setQuickFilter('EXPIRED_ONLY')} className={`text-[10px] uppercase font-bold px-2 py-1 border ${quickFilter === 'EXPIRED_ONLY' ? 'border-red-500 text-red-500 bg-red-900/10' : 'border-zinc-800 text-zinc-600'}`}>VENCIDAS</button>
                     <button onClick={() => setQuickFilter('EXPIRED_ALL')} className={`text-[10px] uppercase font-bold px-2 py-1 border ${quickFilter === 'EXPIRED_ALL' ? 'border-red-500 text-red-500 bg-red-900/10' : 'border-zinc-800 text-zinc-600'}`}>TODOS</button>
                     <button onClick={() => setQuickFilter('EXPIRING')} className={`text-[10px] uppercase font-bold px-2 py-1 border ${quickFilter === 'EXPIRING' ? 'border-yellow-500 text-yellow-500 bg-yellow-900/10' : 'border-zinc-800 text-zinc-600'}`}>POR VENCER</button>
                </div>
            )}
         </div>

         <div className="bg-zinc-950 border border-zinc-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead>
                  <tr className="bg-black border-b border-zinc-900 text-[10px] font-tech text-zinc-500 uppercase tracking-widest">
                    <th className="p-3 pl-4 w-10">
                        <input 
                            type="checkbox" 
                            checked={displayItems.length > 0 && selectedClients.size === displayItems.length}
                            onChange={toggleSelectAll}
                            className="accent-yellow-500 cursor-pointer"
                        />
                    </th>
                    <th className="p-3">CLIENTE</th>
                    <th className="p-3">VENCE</th>
                    <th className="p-3">PLAN / ACTIVIDAD</th>
                    <th className="p-3">AVISO / WHATSAPP</th>
                    <th className="p-3 text-right pr-4">ESTADO / ACCIONES</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900 text-xs font-mono-tech text-zinc-400">
                    {displayItems.length === 0 ? (
                        <tr>
                            <td colSpan={5} className="p-12 text-center text-zinc-600 font-tech uppercase tracking-widest">
                                {isMonitor && searchTerm === '' ? 'NO HAY SOCIOS ASIGNADOS O PENDIENTES' : 
                                 (quickFilter === 'EXPIRED_ONLY' || quickFilter === 'EXPIRED_ALL') && searchTerm === '' ? 'NO HAY MEMBRESÍAS VENCIDAS PENDIENTES' : 'NO SE ENCONTRARON REGISTROS'}
                            </td>
                        </tr>
                    ) : (
                    displayItems.map(c => {
                        const diff = getDaysDiff(c.membershipEnd);
                        const planDuration = getPlanDuration(c.membershipStart, c.membershipEnd);
                        const isMultiMonth = planDuration > 31;
                        let statusBadge = null;
                        
                        if (!c.isActive) {
                             statusBadge = <span className="bg-red-950 text-red-500 border border-red-900 px-2 py-0.5 text-[9px] uppercase tracking-wider">BAJA</span>;
                        } else if (c.membershipEnd) {
                            if (diff < 0) {
                                 statusBadge = <span className="bg-red-900/20 text-red-500 border border-red-500/30 px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold">VENCIDO</span>;
                            } else if (diff <= 3) {
                                 statusBadge = <span className="bg-yellow-900/20 text-yellow-500 border border-yellow-500/30 px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold">POR VENCER</span>;
                            } else if (isMultiMonth) {
                                 statusBadge = <span className="bg-blue-900/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 text-[9px] uppercase tracking-wider font-bold">PLAN MULTI-MES</span>;
                            } else {
                                 statusBadge = <span className="bg-emerald-900/20 text-emerald-500 border border-emerald-500/30 px-2 py-0.5 text-[9px] uppercase tracking-wider">ACTIVO</span>;
                            }
                        }

                        // Lógica de Enlaces WhatsApp
                        const isDbView = viewMode === 'CLIENTS_DB';
                        const waLink = getWhatsAppLink(c.originClient || (c as any), diff, isDbView, undefined, c.packageName);
                        
                        // Simplificación: Solo verificar si se envió HOY para control visual, 
                        // pero permitiremos el reenvío si el usuario lo desea o si se modificaron fechas.
                        const sentToday = isToday(c.lastReminderSent) || recentlySent.has(c.client_id);
                        
                        // Cálculo de hace cuántos días fue el último aviso (para información del usuario)
                        const lastReminderDays = c.lastReminderSent ? getDaysDiff(c.lastReminderSent.split('T')[0]) : null;
                        const wasRecentlyNotified = lastReminderDays !== null && Math.abs(lastReminderDays) <= 3;

                        return (
                            <tr key={c.id} className={`hover:bg-zinc-900 transition-colors group ${!c.isActive ? 'opacity-50 grayscale' : ''} ${selectedClients.has(c.client_id) ? 'bg-yellow-500/5' : ''}`}>
                                <td className="p-3 pl-4">
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center">
                                            <input 
                                                type="checkbox" 
                                                checked={selectedClients.has(c.client_id)}
                                                onChange={(e) => {
                                                    e.stopPropagation();
                                                    toggleSelectClient(c.client_id);
                                                }}
                                                className="accent-yellow-500 cursor-pointer w-4 h-4 mr-2"
                                            />
                                        </div>
                                        <div 
                                            className="w-8 h-8 bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden cursor-pointer hover:border-yellow-500 transition-colors"
                                            onClick={(e) => c.photoUrl && handlePhotoPreview(e, c.photoUrl, `${c.firstName} ${c.lastNamePaternal}`)}
                                        >
                                            {c.photoUrl ? (
                                                <img src={c.photoUrl} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <span className="text-zinc-700">👤</span>
                                            )}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-1.5">
                                                <p className="font-bold text-zinc-200 uppercase leading-none">{c.firstName} {c.lastNamePaternal}</p>
                                                {(c.fingerprint_template || (c.originClient && c.originClient.fingerprint_template)) ? (
                                                    <button 
                                                        type="button"
                                                        disabled={!isBioAllowed}
                                                        onClick={(e) => { 
                                                            if (!isBioAllowed) return;
                                                            e.stopPropagation(); 
                                                            onEditClient && onEditClient(c.originClient || c); 
                                                        }}
                                                        title={isBioAllowed 
                                                            ? "Huella biométrica registrada - Clic para ver / actualizar / eliminar" 
                                                            : "Huella registrada (Gestión desactivada para tu perfil)"} 
                                                        className={`inline-flex items-center transition-transform ${
                                                            isBioAllowed 
                                                                ? 'text-emerald-400 hover:text-emerald-300 hover:scale-125 cursor-pointer' 
                                                                : 'text-zinc-600 opacity-40 cursor-not-allowed'
                                                        }`}
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m12 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17" />
                                                        </svg>
                                                    </button>
                                                ) : (
                                                    <button 
                                                        type="button"
                                                        disabled={!isBioAllowed}
                                                        onClick={(e) => { 
                                                            if (!isBioAllowed) return;
                                                            e.stopPropagation(); 
                                                            onEditClient && onEditClient(c.originClient || c); 
                                                        }}
                                                        title={isBioAllowed 
                                                            ? "Sin huella registrada - Clic para capturar huella" 
                                                            : "Sin huella (Gestión desactivada para tu perfil)"} 
                                                        className={`inline-flex items-center transition-transform ${
                                                            isBioAllowed 
                                                                ? 'text-zinc-600 hover:text-yellow-400 opacity-40 hover:opacity-100 hover:scale-125 cursor-pointer' 
                                                                : 'text-zinc-700 opacity-20 cursor-not-allowed'
                                                        }`}
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m12 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                            <p className="text-[9px] text-zinc-600 mt-0.5">{c.phone || 'SIN TEL'}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="p-3">
                                    {(() => {
                                        const discWithDates = getClientDisciplinesWithDates(c);
                                        if (discWithDates.length === 0) {
                                            return (
                                                <div className="flex flex-col">
                                                    <div className="flex items-center gap-1">
                                                        <span className={`font-bold ${diff < 0 ? 'text-red-500' : diff <= 3 ? 'text-yellow-500' : 'text-zinc-300'}`}>
                                                            {c.membershipEnd || 'N/A'}
                                                        </span>
                                                        {c.membershipEnd && (
                                                            <span className="text-[9px] text-zinc-600">({diff}d)</span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        
                                        return (
                                            <div className="flex flex-col gap-1.5">
                                                {discWithDates.map(dd => {
                                                    const dDiff = getDaysDiff(dd.endDate);
                                                    return (
                                                        <div key={dd.name} className="flex flex-col leading-tight">
                                                            <span className="text-[8px] text-yellow-500/80 font-bold uppercase tracking-wider font-tech">{dd.name}:</span>
                                                            <div className="flex items-center gap-1">
                                                                <span className={`font-bold text-[11px] ${dDiff < 0 ? 'text-red-500' : dDiff <= 3 ? 'text-yellow-500' : 'text-zinc-300'}`}>
                                                                    {dd.endDate || 'N/A'}
                                                                </span>
                                                                {dd.endDate && (
                                                                    <span className="text-[8px] text-zinc-500">({dDiff}d)</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()}
                                </td>
                                <td className="p-3">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-zinc-300 font-semibold leading-normal">{c.packageName || c.activityName || 'N/A'}</span>
                                        {(() => {
                                            const disciplines = getClientDisciplinesList(c);
                                            if (disciplines.length === 0) return null;
                                            return (
                                                <div className="flex flex-wrap gap-1 mt-0.5">
                                                    {disciplines.map(dispName => (
                                                        <span key={dispName} className="text-[8px] bg-zinc-900 text-zinc-400 border border-zinc-800 px-1.5 py-0.5 rounded font-black uppercase tracking-wider font-mono">
                                                            {dispName}
                                                        </span>
                                                    ))}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </td>
                                <td className="p-3">
                                    {waLink ? (
                                        <div className="flex flex-col gap-1">
                                            <a 
                                                href={waLink} 
                                                target="_blank" 
                                                rel="noreferrer" 
                                                onClick={() => handleRecordReminder(c.client_id || c.id)}
                                                className={`inline-block text-center text-white border px-3 py-1 text-[9px] uppercase transition-all font-bold tracking-wider shadow-[0_0_10px_rgba(0,0,0,0.3)]
                                                    ${isDbView ? 'bg-blue-900/30 hover:bg-blue-800 text-blue-400 border-blue-800' : 
                                                      diff < 0 ? 'bg-red-600 hover:bg-red-500 border-red-500' : 'bg-yellow-600 hover:bg-yellow-500 border-yellow-500 text-black'}
                                                `}
                                            >
                                                {isDbView ? 'ABRIR CHAT' : 
                                                 sentToday ? 'REENVIAR (ENVIADO HOY)' :
                                                 diff < 0 ? 'AVISO VENCIDO' : 'RECORDATORIO'}
                                            </a>
                                            {wasRecentlyNotified && !sentToday && (
                                                <span className="text-[8px] text-yellow-500/70 font-bold uppercase text-center animate-pulse">
                                                    Avisado hace {Math.abs(lastReminderDays!)} días
                                                </span>
                                            )}
                                            {getClientReminderCountLast3Days(c.client_id || c.id) > 0 && (
                                                <span className="text-[8px] bg-yellow-900/20 text-yellow-500 border border-yellow-500/20 px-1.5 py-0.5 rounded text-center font-bold uppercase block mt-0.5 font-mono-tech">
                                                    {getClientReminderCountLast3Days(c.client_id || c.id)} Enviados (últ. 3 días)
                                                </span>
                                            )}
                                        </div>
                                    ) : (
                                        <span className="text-zinc-700 text-[9px]">--</span>
                                    )}
                                </td>
                                 <td className="p-3 pr-4 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        {statusBadge}
                                        
                                        {!isMonitor && (
                                            <div className="flex items-center gap-1.5 ml-2">
                                                {/* ACCESO RÁPIDO BIOMÉTRICO (DIRECTO PARA COACHES Y ADMIN) */}
                                                {onEditClient && (
                                                    <button 
                                                        type="button"
                                                        disabled={!isBioAllowed}
                                                        onClick={(e) => {
                                                             if (!isBioAllowed) return;
                                                             e.stopPropagation();
                                                             onEditClient(c.originClient || c);
                                                        }} 
                                                        className={`px-2 py-1 rounded border text-[9px] font-tech font-bold uppercase transition-all flex items-center gap-1.5 shadow-sm ${
                                                             !isBioAllowed
                                                                 ? 'bg-zinc-900/80 text-zinc-500 border-zinc-700/60 cursor-not-allowed opacity-60'
                                                                 : (c.fingerprint_template || (c.originClient && c.originClient.fingerprint_template))
                                                                     ? 'bg-emerald-950/60 text-emerald-400 border-emerald-700/80 hover:bg-emerald-900 hover:text-white cursor-pointer active:scale-95' 
                                                                     : 'bg-amber-950/60 text-amber-300 border-amber-500/80 hover:bg-amber-500 hover:text-black cursor-pointer active:scale-95 shadow-[0_0_8px_rgba(245,158,11,0.25)]'
                                                        }`}
                                                        title={!isBioAllowed 
                                                             ? "Gestión de huellas desactivada por el Administrador" 
                                                             : (c.fingerprint_template || (c.originClient && c.originClient.fingerprint_template))
                                                                 ? "Huella digital configurada - Clic para Actualizar o Eliminar"
                                                                 : "Sin huella - Clic para Registrar o Capturar Huella"}
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m12 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17" />
                                                        </svg>
                                                        <span className="tracking-wider whitespace-nowrap">
                                                             {(c.fingerprint_template || (c.originClient && c.originClient.fingerprint_template)) ? 'HUELLA OK' : '+ HUELLA'}
                                                        </span>
                                                    </button>
                                                )}

                                                {/* PASE QR DIGITAL DIRECTO */}
                                                {onShowQr && (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onShowQr(c.originClient || c);
                                                        }}
                                                        className="px-2 py-1 rounded border border-yellow-500/80 bg-yellow-950/70 text-yellow-300 hover:bg-yellow-400 hover:text-black text-[9px] font-tech font-bold uppercase transition-all flex items-center gap-1 cursor-pointer active:scale-95 shadow-[0_0_8px_rgba(234,179,8,0.25)]"
                                                        title="Ver / Enviar Pase QR del Socio"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                                                        </svg>
                                                        <span className="tracking-wider font-extrabold text-yellow-300">QR</span>
                                                    </button>
                                                )}

                                                {/* EDICIÓN GENERAL: ADMIN Y COACHES */}
                                                {canEditClient && onEditClient && (
                                                    <button onClick={() => onEditClient(c.originClient || c)} className="text-zinc-500 hover:text-white p-1 rounded hover:bg-zinc-800" title="Editar Socio">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                    </button>
                                                )}
                                                
                                                {canUserRenew && (
                                                     <button onClick={() => setRenewingClient(c.originClient || c)} className="text-zinc-500 hover:text-yellow-500 p-1 rounded hover:bg-zinc-800" title="Renovar">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                                    </button>
                                                )}

                                                <button onClick={() => setViewingHistoryClient(c.originClient || c)} className="text-zinc-500 hover:text-blue-500 p-1 rounded hover:bg-zinc-800" title="Historial">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                </button>
                                                
                                                {isAdmin && onDeleteClient && (
                                                    <button onClick={() => onDeleteClient(c.originClient || c)} className="text-zinc-500 hover:text-red-500 p-1 rounded hover:bg-zinc-800" title="Eliminar">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                    </button>
                                                )}

                                                {/* TOGGLE STATUS: SOLO ADMIN */}
                                                {onToggleStatus && isAdmin && (
                                                    <button onClick={(e) => { e.stopPropagation(); onToggleStatus(c.originClient || c); }} className={`text-zinc-500 ${c.isActive ? 'hover:text-red-500' : 'hover:text-emerald-500'} p-1 rounded hover:bg-zinc-800`} title={c.isActive ? 'Dar de Baja' : 'Reactivar'}>
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        )
                    }))}
                </tbody>
              </table>
            </div>
         </div>
      </div>

      {/* MODAL PRÓXIMOS A VENCER */}
      {showExpiringModal && (
        <div className="fixed inset-0 z-[90] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_0.3s_ease-out]" onClick={() => setShowExpiringModal(false)}>
            <div className="w-full max-w-6xl max-h-[90vh] bg-zinc-950 border-2 border-yellow-500 shadow-[0_0_50px_rgba(234,179,8,0.2)] flex flex-col rounded-2xl overflow-hidden relative" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-gradient-to-r from-yellow-900/20 to-zinc-900">
                     <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-yellow-500 flex items-center justify-center shadow-lg shadow-yellow-500/20">
                            <span className="text-2xl text-black font-bold">⚠</span>
                        </div>
                        <div>
                            <h2 className="text-2xl font-tech font-black text-white uppercase tracking-tighter">
                                MEMBRESÍAS POR VENCER
                            </h2>
                            <p className="text-yellow-500 font-mono-tech text-xs font-bold tracking-widest">
                                PRÓXIMOS 3 DÍAS ({expiringClientsList.length})
                            </p>
                        </div>
                     </div>
                     <div className="flex gap-2">
                        {/* BOTÓN CONFIGURACIÓN PLANTILLAS */}
                        <button onClick={() => setIsEditingTemplate(true)} className="bg-zinc-800 hover:bg-zinc-700 text-yellow-500 p-3 rounded-full border border-yellow-500/50 transition-all hover:scale-105" title="Configurar Mensajes">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        </button>
                        <button onClick={() => setShowExpiringModal(false)} className="bg-black/50 hover:bg-zinc-800 text-white p-3 rounded-full border border-zinc-700 transition-all">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                     </div>
                </div>

                {/* Table Container */}
                <div className="flex-1 overflow-auto bg-zinc-950 custom-scrollbar">
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-black z-10 shadow-md border-b border-zinc-800">
                          <tr className="text-[10px] font-tech text-zinc-500 uppercase tracking-widest">
                            <th className="p-4 pl-6">CLIENTE</th>
                            <th className="p-4">VENCIMIENTO</th>
                            <th className="p-4">PLAN / ACTIVIDAD</th>
                            <th className="p-4">COMUNICACIÓN</th>
                            <th className="p-4 text-right pr-6">ACCIONES</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-900/50 text-xs font-mono-tech text-zinc-300">
                            {expiringClientsList.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-12 text-center text-zinc-600 font-tech uppercase tracking-widest">
                                        NO HAY CLIENTES CON VENCIMIENTO PRÓXIMO
                                    </td>
                                </tr>
                            ) : (
                                expiringClientsList.map(c => {
                                    const diff = getDaysDiff(c.membershipEnd);
                                    const waLink = getWhatsAppLink(c, diff);
                                    const sentToday = isToday(c.lastReminderSent) || recentlySent.has(c.id);
                                    const lastReminderDays = c.lastReminderSent ? getDaysDiff(c.lastReminderSent.split('T')[0]) : null;
                                    const wasRecentlyNotified = lastReminderDays !== null && Math.abs(lastReminderDays) <= 3;

                                    return (
                                        <tr key={c.id} className="hover:bg-yellow-900/10 transition-colors">
                                            <td className="p-4 pl-6">
                                                <div className="flex items-center gap-3">
                                                    <div 
                                                        className="w-10 h-10 bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden rounded-full cursor-pointer hover:border-yellow-500 transition-colors"
                                                        onClick={(e) => c.photoUrl && handlePhotoPreview(e, c.photoUrl, `${c.firstName} ${c.lastNamePaternal}`)}
                                                    >
                                                        {c.photoUrl ? (
                                                            <img src={c.photoUrl} alt="" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <span className="text-zinc-700">👤</span>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-1.5">
                                                            <p className="font-bold text-white uppercase leading-none">{c.firstName} {c.lastNamePaternal}</p>
                                                            {c.fingerprint_template && (
                                                                <span title="Huella biométrica registrada" className="text-emerald-400 inline-flex items-center">
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m12 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17" />
                                                                    </svg>
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-[9px] text-zinc-500 mt-0.5">{c.phone || 'SIN TEL'}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <span className="font-bold text-yellow-500 text-sm">
                                                    {c.membershipEnd}
                                                </span>
                                                <span className="ml-3 text-xs font-black bg-yellow-500 text-black px-3 py-1 rounded shadow-[0_0_10px_rgba(234,179,8,0.5)] tracking-wider inline-block">
                                                    {diff === 0 ? 'HOY' : `${diff} DÍAS`}
                                                </span>
                                            </td>
                                            <td className="p-4 text-zinc-400">
                                                {c.packageName || c.activityName || 'N/A'}
                                            </td>
                                            <td className="p-4">
                                                {waLink ? (
                                                    <div className="flex flex-col gap-1 items-start">
                                                        <a 
                                                            href={waLink} 
                                                            target="_blank" 
                                                            rel="noreferrer" 
                                                            onClick={() => handleRecordReminder(c.id)}
                                                            className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider ${sentToday ? 'text-zinc-500 hover:text-white' : 'text-emerald-500 hover:text-emerald-400'}`}
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.017-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                                                            {sentToday ? 'REENVIAR (AVISADO HOY)' : 'ENVIAR RECORDATORIO'}
                                                        </a>
                                                        {wasRecentlyNotified && !sentToday && (
                                                            <span className="text-[8px] text-yellow-500 font-bold uppercase animate-pulse">
                                                                Avisado hace {Math.abs(lastReminderDays!)} días
                                                            </span>
                                                        )}
                                                        {getClientReminderCountLast3Days(c.id) > 0 && (
                                                            <span className="text-[8px] bg-yellow-900/20 text-yellow-500 border border-yellow-500/10 px-1.5 py-0.5 rounded font-bold uppercase block mt-0.5 font-mono-tech">
                                                                {getClientReminderCountLast3Days(c.id)} Enviados (últ. 3 días)
                                                            </span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-zinc-600 text-[9px]">SIN WHATSAPP</span>
                                                )}
                                            </td>
                                            <td className="p-4 pr-6 text-right">
                                                <div className="flex justify-end gap-2">
                                                    {canUserRenew && (
                                                        <button onClick={() => setRenewingClient(c)} className="bg-yellow-500 hover:bg-yellow-400 text-black px-3 py-1 font-bold text-[10px] uppercase rounded shadow-lg shadow-yellow-500/20">
                                                            RENOVAR AHORA
                                                        </button>
                                                    )}
                                                    {/* EDICIÓN: ADMIN Y COACHES */}
                                                    {canEditClient && (
                                                        <button onClick={() => onEditClient && onEditClient(c)} className="text-zinc-400 hover:text-white border border-zinc-700 px-2 py-1 rounded hover:bg-zinc-800" title="Editar">
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
                
                <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 flex justify-end">
                     <button onClick={() => setShowExpiringModal(false)} className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-white font-tech uppercase text-xs border border-zinc-600 rounded">Cerrar</button>
                </div>
            </div>
        </div>
      )}

      {/* MODAL DEBEN PAGAR HOY (VENCIDOS AYER) */}
      {showDebenPagarModal && (
        <div className="fixed inset-0 z-[90] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_0.3s_ease-out]" onClick={() => setShowDebenPagarModal(false)}>
            <div className="w-full max-w-6xl max-h-[90vh] bg-zinc-950 border-2 border-red-500 shadow-[0_0_50px_rgba(239,68,68,0.2)] flex flex-col rounded-2xl overflow-hidden relative" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-gradient-to-r from-red-900/20 to-zinc-900">
                     <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-red-500 flex items-center justify-center shadow-lg shadow-red-500/20 text-white">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <div>
                            <h2 className="text-2xl font-tech font-black text-white uppercase tracking-tighter">
                                SOCIOS QUE DEBEN PAGAR HOY
                            </h2>
                            <p className="text-red-500 font-mono-tech text-xs font-bold tracking-widest">
                                VENCIDOS AYER ({debenPagarClientsList.length})
                            </p>
                        </div>
                     </div>
                     <div className="flex gap-2">
                        <button onClick={() => setIsEditingTemplate(true)} className="bg-zinc-800 hover:bg-zinc-700 text-red-500 p-3 rounded-full border border-red-500/40 transition-all hover:scale-105" title="Configurar Mensajes">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        </button>
                        <button onClick={() => setShowDebenPagarModal(false)} className="bg-black/50 hover:bg-zinc-800 text-white p-3 rounded-full border border-zinc-700 transition-all">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                     </div>
                </div>

                <div className="flex-1 overflow-auto bg-zinc-950 custom-scrollbar">
                    <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-black z-10 shadow-md border-b border-zinc-800">
                          <tr className="text-[10px] font-tech text-zinc-500 uppercase tracking-widest">
                            <th className="p-4 pl-6">CLIENTE</th>
                            <th className="p-4">VENCIMIENTO</th>
                            <th className="p-4">PLAN / ACTIVIDAD</th>
                            <th className="p-4">COMUNICACIÓN</th>
                            <th className="p-4 text-right pr-6">ACCIONES</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-900/50 text-xs font-mono-tech text-zinc-300">
                            {debenPagarClientsList.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-12 text-center text-zinc-600 font-tech uppercase tracking-widest">
                                        NO HAY SOCIOS QUE DEBAN PAGAR EXACTAMENTE HOY
                                    </td>
                                </tr>
                            ) : (
                                debenPagarClientsList.map(c => {
                                    const diff = getDaysDiff(c.membershipEnd);
                                    const waLink = getWhatsAppLink(c, diff);
                                    const sentToday = isToday(c.lastReminderSent) || recentlySent.has(c.id);
                                    const lastReminderDays = c.lastReminderSent ? getDaysDiff(c.lastReminderSent.split('T')[0]) : null;
                                    const wasRecentlyNotified = lastReminderDays !== null && Math.abs(lastReminderDays) <= 3;

                                    return (
                                        <tr key={c.id} className="hover:bg-red-900/10 transition-colors">
                                            <td className="p-4 pl-6">
                                                <div className="flex items-center gap-3">
                                                    <div 
                                                        className="w-10 h-10 bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden rounded-full cursor-pointer hover:border-red-500 transition-colors"
                                                        onClick={(e) => c.photoUrl && handlePhotoPreview(e, c.photoUrl, `${c.firstName} ${c.lastNamePaternal}`)}
                                                    >
                                                        {c.photoUrl ? (
                                                            <img src={c.photoUrl} alt="" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <span className="text-zinc-700">👤</span>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-white uppercase leading-none">{c.firstName} {c.lastNamePaternal}</p>
                                                        <p className="text-[9px] text-zinc-500 mt-0.5">{c.phone || 'SIN TEL'}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <span className="font-bold text-red-500 text-sm">
                                                    {c.membershipEnd}
                                                </span>
                                                <span className="ml-3 text-[10px] font-black bg-red-600 text-white px-2 py-1 rounded shadow-[0_0_10px_rgba(220,38,38,0.5)] tracking-wider inline-block">
                                                    VENCIDO AYER
                                                </span>
                                            </td>
                                            <td className="p-4 text-zinc-400">
                                                {c.packageName || c.activityName || 'N/A'}
                                            </td>
                                            <td className="p-4">
                                                {waLink ? (
                                                    <div className="flex flex-col gap-1 items-start">
                                                        <a 
                                                            href={waLink} 
                                                            target="_blank" 
                                                            rel="noreferrer" 
                                                            onClick={() => handleRecordReminder(c.id)}
                                                            className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider ${sentToday ? 'text-zinc-500 hover:text-white' : 'text-emerald-500 hover:text-emerald-400'}`}
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.017-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                                                            {sentToday ? 'REENVIAR (AVISADO HOY)' : 'ENVIAR AVISO VENCIDO'}
                                                        </a>
                                                        {wasRecentlyNotified && !sentToday && (
                                                            <span className="text-[8px] text-red-500 font-bold uppercase animate-pulse">
                                                                Notificado hace {Math.abs(lastReminderDays!)} días
                                                            </span>
                                                        )}
                                                        {getClientReminderCountLast3Days(c.id) > 0 && (
                                                            <span className="text-[8px] bg-yellow-900/20 text-yellow-500 border border-yellow-500/10 px-1.5 py-0.5 rounded font-bold uppercase block mt-0.5 font-mono-tech">
                                                                {getClientReminderCountLast3Days(c.id)} Enviados (últ. 3 días)
                                                            </span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-zinc-600 text-[9px]">SIN WHATSAPP</span>
                                                )}
                                            </td>
                                            <td className="p-4 pr-6 text-right">
                                                <div className="flex justify-end gap-2">
                                                    {canUserRenew && (
                                                        <button onClick={() => setRenewingClient(c)} className="bg-red-600 hover:bg-red-500 text-white px-3 py-1 font-bold text-[10px] uppercase rounded shadow-lg shadow-red-600/20">
                                                            PAGAR / RENOVAR
                                                        </button>
                                                    )}
                                                    {/* EDICIÓN: ADMIN Y COACHES */}
                                                    {canEditClient && (
                                                        <button onClick={() => onEditClient && onEditClient(c)} className="text-zinc-400 hover:text-white border border-zinc-700 px-2 py-1 rounded hover:bg-zinc-800" title="Editar">
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
                
                <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 flex justify-end">
                     <button onClick={() => setShowDebenPagarModal(false)} className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-white font-tech uppercase text-xs border border-zinc-600 rounded">Cerrar</button>
                </div>
            </div>
        </div>
      )}

      {/* TEMPLATE EDITOR MODAL */}
      {isEditingTemplate && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_0.3s_ease-out]">
            <div className="bg-zinc-950 border-2 border-zinc-800 w-full max-w-2xl p-6 shadow-2xl rounded-lg flex flex-col max-h-[90vh] overflow-y-auto custom-scrollbar">
                <h3 className="text-xl font-tech font-bold text-white mb-4 border-b border-zinc-800 pb-2 flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span className="text-emerald-400">📱</span>
                      <span>EDITOR DE PLANTILLAS WHATSAPP</span>
                    </span>
                    <button onClick={() => setIsEditingTemplate(false)} className="text-zinc-500 hover:text-white transition-colors">✕</button>
                </h3>
                
                <div className="flex gap-1.5 mb-4 overflow-x-auto pb-2 border-b border-zinc-800 custom-scrollbar">
                    <button 
                      type="button"
                      onClick={() => setActiveTemplateTab('WARNING')} 
                      className={`px-3 py-1.5 text-xs font-bold font-tech uppercase transition-all whitespace-nowrap rounded ${activeTemplateTab === 'WARNING' ? 'bg-yellow-500 text-black shadow-md font-black' : 'text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800'}`}
                    >
                      RECORDATORIO
                    </button>
                    <button 
                      type="button"
                      onClick={() => setActiveTemplateTab('RECOVERY')} 
                      className={`px-3 py-1.5 text-xs font-bold font-tech uppercase transition-all whitespace-nowrap rounded ${activeTemplateTab === 'RECOVERY' ? 'bg-yellow-500 text-black shadow-md font-black' : 'text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800'}`}
                    >
                      VENCIDO
                    </button>
                    <button 
                      type="button"
                      onClick={() => setActiveTemplateTab('RENEWAL')} 
                      className={`px-3 py-1.5 text-xs font-bold font-tech uppercase transition-all whitespace-nowrap rounded ${activeTemplateTab === 'RENEWAL' ? 'bg-yellow-500 text-black shadow-md font-black' : 'text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800'}`}
                    >
                      RENOVACIÓN
                    </button>
                    <button 
                      type="button"
                      onClick={() => setActiveTemplateTab('WELCOME')} 
                      className={`px-3 py-1.5 text-xs font-bold font-tech uppercase transition-all whitespace-nowrap rounded ${activeTemplateTab === 'WELCOME' ? 'bg-yellow-500 text-black shadow-md font-black' : 'text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800'}`}
                    >
                      BIENVENIDA
                    </button>
                    <button 
                      type="button"
                      onClick={() => setActiveTemplateTab('PAYMENT')} 
                      className={`px-3 py-1.5 text-xs font-bold font-tech uppercase transition-all whitespace-nowrap rounded flex items-center gap-1.5 ${activeTemplateTab === 'PAYMENT' ? 'bg-emerald-500 text-black shadow-md font-black' : 'text-emerald-400 hover:text-emerald-300 bg-emerald-950/30 border border-emerald-800/40'}`}
                    >
                      <span>🧾</span>
                      <span>PAGO / CAJA (POS)</span>
                    </button>
                </div>

                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-mono-tech text-yellow-400 font-bold uppercase">
                    {activeTemplateTab === 'WARNING' && 'Mensaje de aviso previo al vencimiento'}
                    {activeTemplateTab === 'RECOVERY' && 'Mensaje de reactivación / membresía vencida'}
                    {activeTemplateTab === 'RENEWAL' && 'Mensaje de confirmación de renovación de plan'}
                    {activeTemplateTab === 'WELCOME' && 'Mensaje de bienvenida al registrar nuevo socio'}
                    {activeTemplateTab === 'PAYMENT' && 'Comprobante de pago a socio (sin renovar / abono en POS)'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      switch (activeTemplateTab) {
                        case 'WARNING': setCurrentTemplateText(DEFAULT_WA_TEMPLATE); break;
                        case 'RECOVERY': setCurrentTemplateText(DEFAULT_WA_RECOVERY_TEMPLATE); break;
                        case 'WELCOME': setCurrentTemplateText(DEFAULT_WA_WELCOME_TEMPLATE); break;
                        case 'RENEWAL': setCurrentTemplateText(DEFAULT_WA_RENEWAL_TEMPLATE); break;
                        case 'PAYMENT': setCurrentTemplateText(DEFAULT_WA_PAYMENT_TEMPLATE); break;
                      }
                    }}
                    className="text-[10px] text-zinc-400 hover:text-yellow-400 font-mono-tech underline transition-colors"
                  >
                    Restaurar predeterminada
                  </button>
                </div>

                <textarea 
                    value={currentTemplateText} 
                    onChange={(e) => setCurrentTemplateText(e.target.value)} 
                    rows={8}
                    className="w-full bg-black border-2 border-zinc-700 p-3.5 text-white font-mono-tech text-xs leading-relaxed focus:border-yellow-500 outline-none mb-3 rounded"
                    placeholder="Escribe el mensaje de WhatsApp..."
                />
                
                {/* Available Variables Explorer */}
                <div className="text-xs text-zinc-400 font-mono-tech mb-5 bg-zinc-900 border border-zinc-800 p-3.5 rounded">
                    <p className="text-[11px] font-bold text-zinc-300 uppercase mb-2 flex items-center gap-1.5">
                      <span className="text-yellow-400">⚡</span>
                      <span>Variables disponibles (clic para insertar):</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {activeTemplateTab === 'WARNING' && [
                        { tag: '{NOMBRE}', desc: 'Nombre del socio' },
                        { tag: '{DIAS}', desc: 'Días restantes' },
                        { tag: '{FECHA}', desc: 'Fecha fin de vigencia' },
                        { tag: '{PLAN}', desc: 'Nombre de disciplina o plan' }
                      ].map(v => (
                        <button
                          key={v.tag}
                          type="button"
                          onClick={() => setCurrentTemplateText(prev => prev + ` ${v.tag}`)}
                          className="bg-black hover:bg-yellow-500 hover:text-black border border-zinc-700 hover:border-yellow-500 text-yellow-400 text-[11px] px-2 py-0.5 rounded transition-all"
                          title={v.desc}
                        >
                          {v.tag}
                        </button>
                      ))}

                      {activeTemplateTab === 'RECOVERY' && [
                        { tag: '{NOMBRE}', desc: 'Nombre del socio' },
                        { tag: '{FECHA}', desc: 'Fecha en que venció' },
                        { tag: '{DIAS}', desc: 'Días de retraso' },
                        { tag: '{PLAN}', desc: 'Nombre de disciplina o plan' }
                      ].map(v => (
                        <button
                          key={v.tag}
                          type="button"
                          onClick={() => setCurrentTemplateText(prev => prev + ` ${v.tag}`)}
                          className="bg-black hover:bg-yellow-500 hover:text-black border border-zinc-700 hover:border-yellow-500 text-yellow-400 text-[11px] px-2 py-0.5 rounded transition-all"
                          title={v.desc}
                        >
                          {v.tag}
                        </button>
                      ))}

                      {activeTemplateTab === 'WELCOME' && [
                        { tag: '{NOMBRE}', desc: 'Nombre del socio' },
                        { tag: '{FECHA_INICIO}', desc: 'Fecha de inicio' },
                        { tag: '{FECHA_FIN}', desc: 'Fecha fin de vigencia' },
                        { tag: '{PAGO}', desc: 'Monto pagado' },
                        { tag: '{CONCEPTO}', desc: 'Concepto o plan' }
                      ].map(v => (
                        <button
                          key={v.tag}
                          type="button"
                          onClick={() => setCurrentTemplateText(prev => prev + ` ${v.tag}`)}
                          className="bg-black hover:bg-yellow-500 hover:text-black border border-zinc-700 hover:border-yellow-500 text-yellow-400 text-[11px] px-2 py-0.5 rounded transition-all"
                          title={v.desc}
                        >
                          {v.tag}
                        </button>
                      ))}

                      {activeTemplateTab === 'RENEWAL' && [
                        { tag: '{NOMBRE}', desc: 'Nombre del socio' },
                        { tag: '{PLAN}', desc: 'Plan renovado' },
                        { tag: '{PAGO}', desc: 'Monto pagado' },
                        { tag: '{FECHA_FIN}', desc: 'Nuevo vencimiento' }
                      ].map(v => (
                        <button
                          key={v.tag}
                          type="button"
                          onClick={() => setCurrentTemplateText(prev => prev + ` ${v.tag}`)}
                          className="bg-black hover:bg-yellow-500 hover:text-black border border-zinc-700 hover:border-yellow-500 text-yellow-400 text-[11px] px-2 py-0.5 rounded transition-all"
                          title={v.desc}
                        >
                          {v.tag}
                        </button>
                      ))}

                      {activeTemplateTab === 'PAYMENT' && [
                        { tag: '{NOMBRE}', desc: 'Nombre del socio' },
                        { tag: '{COACH}', desc: 'Solo el primer nombre del coach (sin apellidos)', highlight: true },
                        { tag: '{MONTO}', desc: 'Monto total pagado' },
                        { tag: '{CONCEPTO}', desc: 'Concepto del cobro' },
                        { tag: '{METODO}', desc: 'Método (Efectivo/Tarjeta/Transferencia)' },
                        { tag: '{FOLIO}', desc: 'Folio único de recibo' },
                        { tag: '{FECHA}', desc: 'Fecha y hora del cobro' }
                      ].map(v => (
                        <button
                          key={v.tag}
                          type="button"
                          onClick={() => setCurrentTemplateText(prev => prev + ` ${v.tag}`)}
                          className={`text-[11px] px-2 py-0.5 rounded transition-all border ${
                            v.highlight 
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-500 hover:bg-emerald-400 hover:text-black font-bold' 
                              : 'bg-black text-yellow-400 border-zinc-700 hover:bg-yellow-500 hover:text-black'
                          }`}
                          title={v.desc}
                        >
                          {v.tag}
                        </button>
                      ))}
                    </div>

                    {activeTemplateTab === 'PAYMENT' && (
                      <p className="text-[10px] text-zinc-400 mt-2.5 pt-2 border-t border-zinc-800">
                        💡 <strong className="text-emerald-400">{'{COACH}'}</strong>: Tomará de forma automática <strong className="text-white">únicamente el primer nombre</strong> del coach o usuario que registró el pago en la caja (omitiendo sus apellidos).
                      </p>
                    )}
                </div>

                <div className="flex justify-end gap-3 pt-2 border-t border-zinc-800">
                    <button 
                      type="button"
                      onClick={() => setIsEditingTemplate(false)} 
                      className="px-4 py-2 bg-zinc-800 text-zinc-400 font-bold text-xs uppercase hover:text-white transition-colors rounded"
                    >
                      CANCELAR
                    </button>
                    <button 
                      type="button"
                      onClick={handleSaveTemplate} 
                      className="px-6 py-2 bg-yellow-500 text-black font-bold font-tech text-xs uppercase hover:bg-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.4)] transition-all rounded"
                    >
                      GUARDAR PLANTILLA
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* RENEWAL MODAL */}
      {renewingClient && (
        <RenewalModal 
            client={renewingClient}
            packages={packages}
            activities={activities}
            subscriptions={subscriptions}
            packageRelations={packageRelations}
            userName={userName}
            onClose={() => setRenewingClient(null)}
            onSuccess={(amount, concept, startDate, endDate, packageId, activityId) => {
                const newSub = {
                    id: `temp-${Date.now()}`,
                    client_id: renewingClient.id,
                    package_id: packageId || null,
                    activity_id: activityId || null,
                    startDate,
                    endDate,
                    amount,
                    isActive: true
                };

                const remainingSubs = (subscriptions || []).filter(s => 
                    s.client_id === renewingClient.id &&
                    !(packageId && s.package_id === packageId) &&
                    !(activityId && s.activity_id === activityId)
                );

                const updatedClient = {
                    ...renewingClient,
                    membershipStart: startDate,
                    membershipEnd: endDate,
                    package_id: packageId !== undefined ? packageId : renewingClient.package_id,
                    activity_id: activityId !== undefined ? activityId : renewingClient.activity_id,
                    isActive: true,
                    subscriptions: [newSub, ...remainingSubs]
                };
                
                setRenewalSuccessData({
                    client: updatedClient,
                    amount: amount,
                    concept: concept
                });
                
                setRenewingClient(null);
                onRefreshData();
            }}
        />
      )}

      {/* RENEWAL SUCCESS MODAL */}
      {renewalSuccessData && (
          <RegistrationSuccessModal 
              type="RENEWAL"
              client={renewalSuccessData.client}
              paymentAmount={renewalSuccessData.amount}
              paymentConcept={renewalSuccessData.concept}
              onClose={() => setRenewalSuccessData(null)}
              onShowQr={() => { 
                  if(onShowQr) onShowQr(renewalSuccessData.client);
                  setRenewalSuccessData(null);
              }}
          />
      )}

      {viewingHistoryClient && (
          <PaymentHistoryModal 
            client={viewingHistoryClient}
            onClose={() => setViewingHistoryClient(null)}
          />
      )}

      {/* SHIFT DETAILS MODAL */}
      {showShiftModal && (
          <ShiftDetailsModal onClose={() => setShowShiftModal(false)} />
      )}

      {/* MODAL COLA WHATSAPP */}
      {showQueueModal && selectedList.length > 0 && (
          <div className="fixed inset-0 z-[120] bg-black/95 backdrop-blur-md flex items-center justify-center p-4">
              <div className="bg-zinc-950 border-2 border-yellow-500 w-full max-w-xl p-8 rounded-3xl shadow-[0_0_100px_rgba(234,179,8,0.2)] relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-40 w-40 text-yellow-500" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.017-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                  </div>

                  <button 
                    onClick={() => setShowQueueModal(false)}
                    className="absolute top-4 right-4 text-zinc-500 hover:text-white p-2"
                  >✕</button>

                  <div className="flex flex-col items-center text-center">
                      <p className="text-yellow-500 font-tech font-black uppercase tracking-[0.3em] text-xs mb-4">
                          Asistente de Envío Masivo
                      </p>

                      <div className="mb-4 w-full">
                          <label className="text-[10px] font-tech font-bold text-zinc-500 uppercase tracking-widest mb-1 block text-left px-1">Mensaje Personalizado:</label>
                          <textarea 
                            value={customBulkMessage}
                            onChange={(e) => setCustomBulkMessage(e.target.value)}
                            className="w-full h-24 bg-black border border-zinc-800 rounded-xl p-3 text-white font-mono-tech text-xs focus:border-yellow-500 outline-none resize-none"
                            placeholder="Escribe tu mensaje aquí... Usa {nombre}, {dias}, {fecha} para personalizar."
                          />
                          <p className="text-[8px] text-zinc-600 mt-1 text-left px-1">ETIQUETAS: {'{nombre}, {dias}, {fecha}'}</p>
                      </div>

                      <div className="w-1/2 bg-zinc-900 h-1 mb-6 rounded-full overflow-hidden">
                          <motion.div 
                            className="bg-yellow-500 h-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${((queueIndex + 1) / selectedList.length) * 100}%` }}
                          ></motion.div>
                      </div>

                      <div className="mb-6">
                          <div className="w-24 h-24 mx-auto rounded-full border-4 border-yellow-500 p-1.5 mb-3 bg-black relative">
                              {selectedList[queueIndex]?.photoUrl ? (
                                  <img src={selectedList[queueIndex].photoUrl} alt="" className="w-full h-full object-cover rounded-full" />
                              ) : (
                                  <div className="w-full h-full flex items-center justify-center text-2xl bg-zinc-900 rounded-full">👤</div>
                              )}
                              <div className="absolute -bottom-1 -right-1 bg-yellow-500 text-black font-black px-2 py-0.5 rounded-full text-[10px] shadow-lg">
                                  {queueIndex + 1} / {selectedList.length}
                              </div>
                          </div>
                          <h4 className="text-xl font-tech font-black text-white uppercase mb-0.5">
                              {selectedList[queueIndex]?.firstName} {selectedList[queueIndex]?.lastNamePaternal}
                          </h4>
                          <p className="text-zinc-500 font-mono-tech uppercase text-[9px] tracking-widest">
                              {selectedList[queueIndex]?.packageName || 'PAQUETE ESTÁNDAR'}
                          </p>
                      </div>

                      <div className="grid grid-cols-1 gap-4 w-full">
                          <a 
                            href={getWhatsAppLink(selectedList[queueIndex], getDaysDiff(selectedList[queueIndex].membershipEnd), false, customBulkMessage) || '#'}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => {
                                handleRecordReminder(selectedList[queueIndex].id);
                                if (queueIndex < selectedList.length - 1) {
                                    // No auto-avanzamos inmediatamente para que el usuario pueda ver el botón SIGUIENTE
                                }
                            }}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white py-4 rounded-xl font-tech font-black uppercase text-sm tracking-widest shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-3"
                          >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.017-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                              ABRIR WHATSAPP
                          </a>

                          <div className="flex gap-2">
                              {queueIndex > 0 && (
                                  <button 
                                    onClick={() => setQueueIndex(prev => prev - 1)}
                                    className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 py-3 rounded-xl font-tech uppercase text-xs transition-all"
                                  >ANTERIOR</button>
                              )}
                              
                              {queueIndex < selectedList.length - 1 ? (
                                  <button 
                                    onClick={() => setQueueIndex(prev => prev + 1)}
                                    className="flex-[2] bg-yellow-500 hover:bg-yellow-400 text-black py-3 rounded-xl font-tech font-black uppercase text-sm shadow-xl shadow-yellow-500/10 transition-all"
                                  >SIGUIENTE SOCIO</button>
                              ) : (
                                  <button 
                                    onClick={() => {
                                        setShowQueueModal(false);
                                        setSelectedClients(new Set());
                                        showToast('PROCESO DE ENVÍO FINALIZADO', 'success');
                                    }}
                                    className="flex-[2] bg-white hover:bg-zinc-200 text-black py-3 rounded-xl font-tech font-black uppercase text-sm transition-all"
                                  >FINALIZAR COLA</button>
                              )}
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* PHOTO PREVIEW POPOVER (ESTILO RED SOCIAL) */}
      <AnimatePresence>
          {previewPhoto && (
              <div 
                className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                onClick={() => setPreviewPhoto(null)}
              >
                  <motion.div 
                    initial={{ scale: 0.5, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.5, opacity: 0, y: 20 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                    className="relative bg-zinc-900 border-2 border-yellow-500 p-1.5 rounded-2xl shadow-[0_0_50px_rgba(234,179,8,0.4)] max-w-[90vw] max-h-[80vh]"
                    onClick={e => e.stopPropagation()}
                  >
                      <div className="overflow-hidden rounded-xl bg-black">
                          <img 
                            src={previewPhoto.url} 
                            alt={previewPhoto.name} 
                            className="w-full h-auto max-w-[350px] max-h-[450px] object-contain"
                          />
                      </div>
                      
                      <div className="absolute -bottom-12 left-1/2 transform -translate-x-1/2 bg-yellow-500 text-black px-5 py-1.5 rounded-full font-tech font-black text-[11px] uppercase tracking-[0.15em] whitespace-nowrap shadow-2xl border-2 border-black">
                          {previewPhoto.name}
                      </div>

                      <button 
                        onClick={() => setPreviewPhoto(null)}
                        className="absolute -top-4 -right-4 bg-red-600 text-white w-9 h-9 rounded-full flex items-center justify-center border-2 border-black shadow-xl hover:bg-red-500 transition-colors z-10"
                      >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                  </motion.div>
              </div>
          )}
      </AnimatePresence>
    </div>
  );
};

export default Dashboard;
