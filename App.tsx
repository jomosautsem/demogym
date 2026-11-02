
import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserRole, Client, Package, Activity, DashboardMetrics, AccessStatus, SystemConfig, ClientSubscription } from './types';
import Login from './components/Login';
import LandingPage from './components/LandingPage';
import Dashboard from './components/Dashboard';
import RegistrationSuccessModal from './components/RegistrationSuccessModal';

// Lazy loading heavy components
const PointOfSale = lazy(() => import('./components/PointOfSale'));
const FinancePanel = lazy(() => import('./components/FinancePanel'));
const CoachManagement = lazy(() => import('./components/CoachManagement'));
const InventoryPanel = lazy(() => import('./components/InventoryPanel'));
const SystemConfigPanel = lazy(() => import('./components/SystemConfig'));
const ServicesPanel = lazy(() => import('./components/ServicesPanel')); 
const EditClientModal = lazy(() => import('./components/EditClientModal'));
const QrScanner = lazy(() => import('./components/QrScanner'));
const BiometricScanner = lazy(() => import('./components/BiometricScanner'));
const TodayAttendancePanel = lazy(() => import('./components/TodayAttendancePanel').then(m => ({ default: m.TodayAttendancePanel })));
const Camera = lazy(() => import('./components/Camera'));
const QrCodeModal = lazy(() => import('./components/QrCodeModal'));
const ConfirmationModal = lazy(() => import('./components/ConfirmationModal'));
const AddExpenseModal = lazy(() => import('./components/AddExpenseModal'));
const PublicClientSearch = lazy(() => import('./components/PublicClientSearch'));
import { 
  getClients, 
  getPackages, 
  getActivities, 
  getTodaysAttendance, 
  getMonthlyRevenue, 
  getDailyShiftRevenue,
  addPayment,
  logAttendance,
  getPackageActivityRelations,
  deleteClient,
  setClientActiveStatus,
  validateSessionUser,
  getSystemConfig,
  getClientSubscriptions,
  getSystemUsers
} from './services/storage';
import { useToast } from './context/ToastContext';
import { audioService } from './services/audioService';
import { AcceptInvitationModal } from './components/AcceptInvitationModal';
import { supabase } from './services/supabaseClient';

const LoadingFallback = () => (
    <div className="flex items-center justify-center h-full w-full py-20">
        <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-yellow-500 mb-4"></div>
            <p className="text-zinc-500 font-tech text-xs tracking-widest uppercase">Cargando Módulo...</p>
        </div>
    </div>
);

const App: React.FC = () => {
  const { showToast } = useToast();
  
  // Auth State
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!localStorage.getItem('userRole'));
  const [userRole, setUserRole] = useState<UserRole>(() => (localStorage.getItem('userRole') as UserRole) || UserRole.COACH);
  const [userName, setUserName] = useState(() => localStorage.getItem('userName') || '');
  
  // View State (When not authenticated)
  const [publicView, setPublicView] = useState<'LANDING' | 'LOGIN' | 'CLIENT_QUERY' | 'RULES'>(() => {
    if (typeof window !== 'undefined' && (window.location.search.includes('portal=') || window.location.pathname.includes('/portal/'))) {
      return 'CLIENT_QUERY';
    }
    return 'LANDING';
  });
  // Permissions State
  const [allowedActivityIds, setAllowedActivityIds] = useState<string[]>(() => {
      const stored = localStorage.getItem('allowedActivityIds');
      return stored ? JSON.parse(stored) : [];
  });
  const [allowedPackageIds, setAllowedPackageIds] = useState<string[]>(() => {
      const stored = localStorage.getItem('allowedPackageIds');
      return stored ? JSON.parse(stored) : [];
  });
  const [canRenew, setCanRenew] = useState(() => {
      const stored = localStorage.getItem('canRenew');
      return stored ? JSON.parse(stored) : false;
  });
  const [canManageFingerprints, setCanManageFingerprints] = useState(() => {
      const stored = localStorage.getItem('canManageFingerprints');
      return stored ? JSON.parse(stored) : false;
  });
  const [canEditMembership, setCanEditMembership] = useState(() => {
      const storedRole = localStorage.getItem('userRole');
      if (storedRole === UserRole.ADMIN) return true;
      const stored = localStorage.getItem('canEditMembership');
      return stored ? JSON.parse(stored) : false;
  });

  // App State
  const [activeTab, setActiveTab] = useState<'DASHBOARD' | 'REGISTER' | 'POS' | 'SCAN' | 'FINANCE' | 'ADMIN' | 'INVENTORY' | 'CONFIG' | 'CLIENTS' | 'SERVICES' | 'ATTENDANCE'>('DASHBOARD');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [scanMode, setScanMode] = useState<'MENU' | 'QR' | 'BIOMETRIC'>('BIOMETRIC');

  // Supabase Auth & Hybrid Direct Invitation State
  const [invitationSession, setInvitationSession] = useState<{
    email: string;
    name?: string;
    uid?: string;
    type: 'invite' | 'recovery';
  } | null>(null);

  // Check if secondary kiosk window (Electron or web pop-up)
  useEffect(() => {
    if (typeof window !== 'undefined' && (window.location.hash === '#kiosk-biometric' || window.location.search.includes('kiosk=biometric'))) {
      setIsAuthenticated(true);
      setActiveTab('SCAN');
      setScanMode('BIOMETRIC');
    }
  }, []);

  // Check Supabase Auth invitation / recovery hash OR direct WhatsApp/URL invitation (?staff_invite=1)
  useEffect(() => {
    let isMounted = true;
    const detectInvite = async () => {
      if (typeof window === 'undefined') return;

      const checkAndSet = async () => {
        const hash = window.location.hash || '';
        const search = window.location.search || '';

        let type: string | null = null;
        let emailParam: string | null = null;
        let nameParam: string | null = null;
        let uidParam: string | null = null;
        let isStaffInviteParam = false;

        if (search) {
          const searchParams = new URLSearchParams(search);
          type = searchParams.get('type');
          emailParam = searchParams.get('email');
          nameParam = searchParams.get('name');
          uidParam = searchParams.get('uid');
          isStaffInviteParam = searchParams.get('staff_invite') === '1';
        }

        if (hash.startsWith('#')) {
          const hashParams = new URLSearchParams(hash.substring(1));
          type = hashParams.get('type') || type;
          emailParam = hashParams.get('email') || emailParam;
          nameParam = hashParams.get('name') || nameParam;
          uidParam = hashParams.get('uid') || uidParam;
        }

        if (
          isStaffInviteParam ||
          type === 'invite' ||
          type === 'recovery' ||
          type === 'signup' ||
          type === 'magiclink' ||
          (hash.includes('access_token=') && (hash.includes('type=') || isStaffInviteParam))
        ) {
          let session = (await supabase.auth.getSession()).data.session;
          if (!session && hash.includes('access_token=')) {
            await new Promise(r => setTimeout(r, 350));
            session = (await supabase.auth.getSession()).data.session;
          }
          const email = session?.user?.email || emailParam || '';
          const userMetaName = session?.user?.user_metadata?.full_name || nameParam || '';
          if (isMounted && email) {
            setInvitationSession({
              email: email,
              name: userMetaName,
              uid: uidParam || undefined,
              type: type === 'recovery' ? 'recovery' : 'invite'
            });
          }
        }
      };

      checkAndSet();

      const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
        const currentHash = window.location.hash || '';
        const currentSearch = window.location.search || '';
        const isInvite =
          currentSearch.includes('staff_invite=1') ||
          currentHash.includes('type=invite') ||
          currentHash.includes('type=signup') ||
          currentHash.includes('type=magiclink');
        const isRecovery = event === 'PASSWORD_RECOVERY' || currentHash.includes('type=recovery');

        if ((isInvite || isRecovery) && session?.user?.email) {
          const searchParams = new URLSearchParams(currentSearch);
          if (isMounted) {
            setInvitationSession({
              email: session.user.email,
              name: session.user.user_metadata?.full_name || searchParams.get('name') || '',
              uid: searchParams.get('uid') || undefined,
              type: isRecovery ? 'recovery' : 'invite'
            });
          }
        }
      });

      return () => {
        authListener?.subscription?.unsubscribe();
      };
    };

    const cleanupPromise = detectInvite();
    return () => {
      isMounted = false;
      cleanupPromise.then(unsub => unsub && unsub());
    };
  }, []);

  
  // Data State
  const [clients, setClients] = useState<Client[]>([]);
  const [subscriptions, setSubscriptions] = useState<ClientSubscription[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [pkgRelations, setPkgRelations] = useState<{package_id: string, activity_id: string}[]>([]); 

  const [metrics, setMetrics] = useState<DashboardMetrics>({
    activeClientsCount: 0,
    todaysAttendanceCount: 0,
    expiringSoonCount: 0,
    monthlyRevenue: 0,
    dailyRevenue: 0
  });
  const [isLoading, setIsLoading] = useState(false);
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);

  // Modals & Camera State
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user'); 
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [showQrModalClient, setShowQrModalClient] = useState<Client | null>(null);
  
  // Confirmation Modal State
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Registration Success
  const [registeredClient, setRegisteredClient] = useState<Client | null>(null);

  // Expense Modal State
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);

  // Initialize Camera
  const initCamera = useCallback(async () => {
    try {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }

      // Definir constraints: Si hay un ID seleccionado explícitamente, usarlo. Si no, usar facingMode.
      const constraints = {
        video: selectedDeviceId 
            ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(newStream);
      setCameraError(null);

      // Enumerar dispositivos una vez que tenemos permisos
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter(device => device.kind === 'videoinput');
      setVideoDevices(videoInputs);

    } catch (err) {
      console.warn("Camera init failed:", err);
      setCameraError('ACCESO A CÁMARA DENEGADO O NO DISPONIBLE');
    }
  }, [facingMode, selectedDeviceId]);

  // Toggle Camera Function
  const toggleCamera = () => {
      setSelectedDeviceId('');
      setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  const handleDeviceSelect = (deviceId: string) => {
      setSelectedDeviceId(deviceId);
  };

  const refreshUserPermissions = useCallback(async () => {
    try {
      const storedRole = localStorage.getItem('userRole');
      if (storedRole === UserRole.ADMIN) {
        setCanManageFingerprints(true);
        setCanRenew(true);
        setCanEditMembership(true);
        return;
      }
      const users = await getSystemUsers();
      const currentEmail = localStorage.getItem('userEmail')?.toLowerCase().trim();
      const currentName = localStorage.getItem('userName')?.toLowerCase().trim();

      const userMatch = users.find(u => 
        (currentEmail && u.email && u.email.toLowerCase().trim() === currentEmail) ||
        (currentName && u.name && u.name.toLowerCase().trim() === currentName)
      );

      if (userMatch) {
        const isAdm = userMatch.role === UserRole.ADMIN;
        const canBio = isAdm ? true : Boolean(userMatch.can_manage_fingerprints);
        const canRen = isAdm ? true : Boolean(userMatch.can_renew);
        const canEditMem = isAdm ? true : Boolean(userMatch.can_edit_membership);
        
        setCanManageFingerprints(canBio);
        setCanRenew(canRen);
        setCanEditMembership(canEditMem);
        if (userMatch.allowed_activity_ids) setAllowedActivityIds(userMatch.allowed_activity_ids);
        if (userMatch.allowed_package_ids) setAllowedPackageIds(userMatch.allowed_package_ids);

        localStorage.setItem('canManageFingerprints', JSON.stringify(canBio));
        localStorage.setItem('canRenew', JSON.stringify(canRen));
        localStorage.setItem('canEditMembership', JSON.stringify(canEditMem));
      }
    } catch (err) {
      console.warn("Aviso sincronizando permisos de usuario:", err);
    }
  }, []);

  // Escuchar cambios de permisos en tiempo real desde CoachManagement u otras pestañas
  useEffect(() => {
    const handlePermsUpdate = () => {
      refreshUserPermissions();
    };
    window.addEventListener('kali_staff_perms_changed', handlePermsUpdate);
    window.addEventListener('storage', handlePermsUpdate);
    return () => {
      window.removeEventListener('kali_staff_perms_changed', handlePermsUpdate);
      window.removeEventListener('storage', handlePermsUpdate);
    };
  }, [refreshUserPermissions]);

  // CHECK SESSION VALIDITY ON MOUNT
  useEffect(() => {
      const loadPublicData = async () => {
          const config = await getSystemConfig();
          setSystemConfig(config);
      };
      loadPublicData();

      window.addEventListener('kali_system_config_updated', loadPublicData);
      window.addEventListener('storage', loadPublicData);

      const verifySession = async () => {
          if (isAuthenticated) {
              const email = localStorage.getItem('userEmail'); 
              if (email) {
                  const isValid = await validateSessionUser(email);
                  if (!isValid) {
                      handleLogout();
                      showToast('Sesión expirada o usuario desactivado', 'warning');
                      return;
                  }
              }
              await refreshUserPermissions();
              const unlockAudio = () => {
                audioService.init();
                window.removeEventListener('click', unlockAudio);
              };
              window.addEventListener('click', unlockAudio);
          }
      };
      verifySession();

      return () => {
          window.removeEventListener('kali_system_config_updated', loadPublicData);
          window.removeEventListener('storage', loadPublicData);
      };
  }, [isAuthenticated, refreshUserPermissions]);

  // Liberar cámara cuando no se está registrando o editando un socio (evita bloquear el lector QR)
  const needsCaptureCamera = isAuthenticated && (activeTab === 'REGISTER' || editingClient !== null);

  useEffect(() => {
    if (needsCaptureCamera) {
      initCamera();
    } else if (stream) {
      stream.getTracks().forEach(t => t.stop());
      setStream(null);
    }
    return () => {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, [needsCaptureCamera, initCamera]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Sincronizar permisos del usuario en cada refresco de datos
      refreshUserPermissions();

      const [clientsData, packagesData, activitiesData, attendanceData, monthlyRev, dailyRev, relationsData, subsData] = await Promise.all([
        getClients(),
        getPackages(),
        getActivities(),
        getTodaysAttendance(),
        getMonthlyRevenue(),
        getDailyShiftRevenue(),
        getPackageActivityRelations(),
        getClientSubscriptions()
      ]);

      setClients(clientsData);
      setSubscriptions(subsData);
      setPackages(packagesData);
      setActivities(activitiesData);
      setPkgRelations(relationsData);
      
      const getDaysDifference = (dateStr?: string | null) => {
        if (!dateStr) return -9999;
        const [y, m, d] = dateStr.split('-').map(Number);
        const end = new Date(y, m - 1, d);
        const now = new Date();
        now.setHours(0,0,0,0);
        return Math.ceil((end.getTime() - now.getTime()) / 864e5);
      };

      // Gather sub list (both explicit and legacy/fallback ones)
      const subList = [...subsData];
      clientsData.forEach(c => {
        const hasExplicit = subsData.some(s => s.client_id === c.id);
        if (!hasExplicit && (c.package_id || c.activity_id || c.membershipEnd)) {
          subList.push({
            id: `legacy-${c.id}`,
            client_id: c.id,
            package_id: c.package_id,
            activity_id: c.activity_id,
            startDate: c.membershipStart || '',
            endDate: c.membershipEnd || '',
            amount: c.cost || 0,
            isActive: c.isActive
          });
        }
      });

      const expiringSoon = subList.filter(s => {
        if (!s.isActive || !s.endDate) return false;
        const days = getDaysDifference(s.endDate);
        return days >= 0 && days <= 3;
      }).length;

      setMetrics({
        activeClientsCount: clientsData.filter(c => c.isActive).length,
        todaysAttendanceCount: new Set(attendanceData.map(a => a.client_id)).size,
        expiringSoonCount: expiringSoon,
        monthlyRevenue: monthlyRev,
        dailyRevenue: dailyRev
      });

    } catch (error: any) {
      console.warn("Aviso cargando datos del sistema:", error);
      const errorMessage = error?.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
      showToast(`Aviso de conexión: ${errorMessage}`, 'warning');
    } finally {
      setIsLoading(false);
    }
  }, [showToast, refreshUserPermissions]);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated, loadData]);

  const handleLoginSuccess = (
    role: UserRole, 
    name: string, 
    activities: string[], 
    packages: string[], 
    canRenewVal: boolean, 
    canManageFingerprintsVal: boolean = false,
    emailVal?: string,
    canEditMembershipVal: boolean = false
  ) => {
    setUserRole(role);
    setUserName(name);
    setAllowedActivityIds(activities);
    setAllowedPackageIds(packages);
    const effectiveBio = role === UserRole.ADMIN ? true : canManageFingerprintsVal;
    const effectiveRenew = role === UserRole.ADMIN ? true : canRenewVal;
    const effectiveEditMem = role === UserRole.ADMIN ? true : canEditMembershipVal;
    setCanRenew(effectiveRenew);
    setCanManageFingerprints(effectiveBio);
    setCanEditMembership(effectiveEditMem);
    
    localStorage.setItem('userRole', role);
    localStorage.setItem('userName', name);
    if (emailVal) {
      localStorage.setItem('userEmail', emailVal);
    }
    localStorage.setItem('allowedActivityIds', JSON.stringify(activities));
    localStorage.setItem('allowedPackageIds', JSON.stringify(packages));
    localStorage.setItem('canRenew', JSON.stringify(effectiveRenew));
    localStorage.setItem('canManageFingerprints', JSON.stringify(effectiveBio));
    localStorage.setItem('canEditMembership', JSON.stringify(effectiveEditMem));
    
    setIsAuthenticated(true);
    const unlockAudio = () => {
        audioService.init();
        window.removeEventListener('click', unlockAudio);
    };
    window.addEventListener('click', unlockAudio);
  };

  const handleLogout = () => {
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        setStream(null);
    }
    localStorage.clear();
    sessionStorage.clear(); 
    
    setUserName('');
    setUserRole(UserRole.COACH);
    setAllowedActivityIds([]);
    setAllowedPackageIds([]);
    setCanRenew(false);
    setCanManageFingerprints(false);
    setCanEditMembership(false);
    setIsAuthenticated(false);
  };

  const handleRegisterSuccess = async (newClient?: Client) => {
    await loadData();
    if (newClient) {
        const clientAny = newClient as any;
        const subs = clientAny.subscriptions || [];

        if (subs.length > 0) {
            let totalSubsCost = 0;
            for (const sub of subs) {
                totalSubsCost += sub.cost || 0;
                const conceptPrefix = sub.package_id ? 'PLAN' : 'CLASE';
                const conceptName = sub.package_name || sub.activity_name || 'Servicio';
                try {
                    await addPayment({
                        client_id: newClient.id,
                        amount: sub.cost,
                        method: 'EFECTIVO' as any,
                        concept: `${conceptPrefix}: ${conceptName} (${sub.startDate} AL ${sub.endDate})`,
                        created_by: userName
                    });
                } catch (e) {
                    console.error("Error creating subscription payment record", e);
                }
            }

            const diff = (newClient.cost || 0) - totalSubsCost;
            if (diff > 0) {
                try {
                    await addPayment({
                        client_id: newClient.id,
                        amount: diff,
                        method: 'EFECTIVO' as any,
                        concept: `INSCRIPCIÓN: Pago de inscripción / cuota de admisión`,
                        created_by: userName
                    });
                } catch (e) {
                    console.error("Error creating enrollment payment record", e);
                }
            }
        } else if (newClient.cost && newClient.cost > 0) {
            const pkgName = packages.find(p => p.id === newClient.package_id)?.name;
            const actName = activities.find(a => a.id === newClient.activity_id)?.name;
            const conceptDetail = pkgName || actName || 'Registro';

            try {
                await addPayment({
                    client_id: newClient.id,
                    amount: newClient.cost,
                    method: 'EFECTIVO' as any,
                    concept: `INSCRIPCIÓN/MENSUALIDAD: ${conceptDetail}`,
                    created_by: userName
                });
            } catch (e) {
                console.error("Error creating initial payment record", e);
            }
        }
        setRegisteredClient(newClient);
    }
    setActiveTab('DASHBOARD');
  };

  const handleScanSuccess = async (scannedValue: string) => {
     const client = clients.find(c => c.id === scannedValue || scannedValue.includes(c.id));
     if (client) {
         // Get hybrid list of subscriptions (both stored explicit-subs and legacy ones)
         const clientSubs = subscriptions.filter(s => s.client_id === client.id);
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

         const todayStr = new Date().toISOString().split('T')[0];
         const activeSubs = clientSubs.filter(s => s.isActive && s.endDate && s.endDate >= todayStr);

         if (activeSubs.length > 0) {
             try {
                 const res = await logAttendance(client.id);
                 const activeNames = activeSubs.map(s => {
                     if (s.package_id) return packages.find(p => p.id === s.package_id)?.name || 'Plan';
                     if (s.activity_id) return activities.find(a => a.id === s.activity_id)?.name || 'Disciplina';
                     return 'Suscripción';
                 }).join(', ');

                 audioService.playSuccess();
                 if (res?.isReentry) {
                     showToast(`¡HOLA DE NUEVO, ${client.firstName.toUpperCase()}! • ${res.visitCountToday}da VISITA HOY (1ra: ${res.firstCheckInTime || ''})`, 'success');
                 } else {
                     showToast(`ACCESO AUTORIZADO: ${client.firstName.toUpperCase()} - ACTIVOS: [${activeNames}]`, 'success');
                 }
                 loadData(); 
             } catch (e: any) {
                 audioService.playWarning();
                 if (e?.reason === 'DAILY_LIMIT') {
                     showToast(`YA REGISTRÓ ASISTENCIA HOY A LAS ${e.firstCheckInTime || ''} (${e.elapsedText || ''})`, 'warning');
                 } else if (e?.reason === 'WINDOW_2H' || e?.reason === 'WINDOW_4H') {
                     showToast(`YA ESCANEADO HOY A LAS ${e.lastCheckInTime || ''} (VENTANA DE ${e.windowHours || 2} HRS)`, 'warning');
                 } else {
                     showToast(e?.message === "Ya registrado recientemente" ? 'YA REGISTRADO HACE MENOS DE 5 MIN' : 'YA REGISTRÓ ASISTENCIA HOY', 'warning');
                 }
             }
         } else {
             audioService.playAlarm();
             const expiredNames = clientSubs.map(s => {
                 let name = 'Membresía';
                 if (s.package_id) name = packages.find(p => p.id === s.package_id)?.name || 'Plan';
                 else if (s.activity_id) name = activities.find(a => a.id === s.activity_id)?.name || 'Disciplina';
                 return `${name} (venció el ${s.endDate})`;
             }).join(', ');

             showToast(`ACCESO RECHAZADO: ${client.firstName.toUpperCase()} (SIN MEMBRESÍAS VIGENTES: ${expiredNames || 'DE BAJA'})`, 'error');
         }
     } else {
         audioService.playAlarm();
         showToast('CLIENTE NO ENCONTRADO', 'error');
     }
  };

  const handleDeleteClient = (client: Client) => {
      setClientToDelete(client);
  };

  const executeDeleteClient = async () => {
      if (!clientToDelete) return;
      setIsDeleting(true);
      try {
          await deleteClient(clientToDelete);
          showToast('CLIENTE ELIMINADO', 'success');
          await loadData();
      } catch (error: any) {
          console.error(error);
          showToast('Error al eliminar: ' + error.message, 'error');
      } finally {
          setIsDeleting(false);
          setClientToDelete(null);
      }
  };

  const handleToggleStatus = async (client: Client) => {
      const newStatus = !client.isActive;
      try {
          await setClientActiveStatus(client.id, newStatus);
          showToast(`CLIENTE ${newStatus ? 'ACTIVADO' : 'DESACTIVADO'}`, 'info');
          loadData();
      } catch (error: any) {
          console.error(error);
          showToast('Error al cambiar estado', 'error');
      }
  };

  if (invitationSession) {
    return (
      <AcceptInvitationModal 
        email={invitationSession.email}
        defaultName={invitationSession.name}
        uid={invitationSession.uid}
        invitationType={invitationSession.type}
        onSuccess={(role, name, acts, pkgs, canRen, canBio, emailVal, canEditMem) => {
          setInvitationSession(null);
          handleLoginSuccess(role, name, acts, pkgs, canRen, canBio, emailVal, canEditMem);
        }}
        onCancel={() => {
          setInvitationSession(null);
          if (typeof window !== 'undefined' && window.history) {
            window.history.replaceState(null, '', window.location.pathname);
          }
        }}
      />
    );
  }

  if (!isAuthenticated) {
    return (
        <Suspense fallback={<LoadingFallback />}>
            {publicView === 'LANDING' && (
                <LandingPage 
                    onSelectConsult={() => setPublicView('CLIENT_QUERY')}
                    onSelectRules={() => setPublicView('RULES')}
                    onGoToLogin={() => setPublicView('LOGIN')}
                />
            )}
            {publicView === 'LOGIN' && (
                <div className="relative min-h-screen">
                    <button 
                        onClick={() => setPublicView('LANDING')}
                        className="absolute top-6 left-6 z-50 bg-zinc-900 text-white px-4 py-2 rounded-full font-tech text-xs border border-zinc-800 hover:border-yellow-500 transition-all flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        VOLVER
                    </button>
                    <Login onLoginSuccess={handleLoginSuccess} />
                </div>
            )}
            {publicView === 'CLIENT_QUERY' && (
                <div className="relative min-h-screen bg-black">
                    <button 
                        onClick={() => setPublicView('LANDING')}
                        className="absolute top-4 left-4 md:top-6 md:left-6 z-50 bg-zinc-900 text-white px-5 py-3 rounded-xl font-tech text-xs border-2 border-zinc-700 hover:border-yellow-500 hover:text-yellow-500 transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(0,0,0,0.5)] group"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-hover:-translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        <span className="font-black tracking-widest">VOLVER AL INICIO</span>
                    </button>
                    <PublicClientSearch />
                </div>
            )}
            {publicView === 'RULES' && (
                <div className="fixed inset-0 z-[100] bg-black/98 backdrop-blur-2xl flex items-center justify-center p-4">
                    <motion.div 
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="bg-zinc-900 border-4 border-yellow-500 w-full max-w-2xl max-h-[90vh] rounded-none overflow-hidden flex flex-col shadow-[0_0_80px_rgba(234,179,8,0.3)] relative"
                    >
                        {/* RADIANT AMBIENT LIGHTING */}
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[80%] h-32 bg-yellow-500/20 blur-[100px] pointer-events-none"></div>
                        
                        <div className="bg-black text-yellow-400 px-6 py-4 flex items-center justify-between border-b-4 border-yellow-500 z-20 shadow-lg">
                            <span className="text-[11px] font-black tracking-[0.4em] flex items-center gap-3">
                                <motion.div 
                                    animate={{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }}
                                    transition={{ duration: 0.8, repeat: Infinity }}
                                    className="w-3 h-3 bg-red-600 rounded-full shadow-[0_0_15px_rgba(220,38,38,0.8)]"
                                />
                                KALI-ACCESS // PROTOCOLO DE SEGURIDAD INTERNA
                            </span>
                            <button 
                                onClick={() => setPublicView('LANDING')} 
                                className="bg-yellow-500 text-black p-2 hover:bg-white hover:scale-110 transition-all duration-300 shadow-lg"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <div className="p-6 md:p-10 flex-1 overflow-y-auto custom-scrollbar bg-[radial-gradient(circle_at_center,_rgba(39,39,42,1)_0%,_rgba(9,9,11,1)_100%)] z-10">
                            <div className="flex flex-col items-center mb-8 md:mb-12">
                                <div className="relative mb-4 md:mb-6">
                                    <div className="absolute inset-0 bg-yellow-500 blur-2xl opacity-20"></div>
                                    <div className="relative w-16 h-16 md:w-20 md:h-20 bg-zinc-900 border-2 border-yellow-500 flex items-center justify-center rotate-45 shadow-[inset_0_0_20px_rgba(234,179,8,0.2)]">
                                        <div className="-rotate-45">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 md:h-10 md:w-10 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                        </div>
                                    </div>
                                </div>
                                <h3 className="text-3xl md:text-5xl font-tech font-black text-white uppercase tracking-tighter text-center leading-[0.85]">
                                    <span className="text-red-600 drop-shadow-[0_0_10px_rgba(220,38,38,0.5)]">REGLAMENTO</span>
                                    <br />
                                    <span className="text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">GENERAL</span>
                                </h3>
                                <div className="mt-4 flex items-center gap-4">
                                    <div className="h-1 w-12 bg-yellow-500"></div>
                                    <p className="text-yellow-500 font-tech uppercase text-xs tracking-[0.6em] font-black">
                                       KALI DEPORTIVO
                                    </p>
                                    <div className="h-1 w-12 bg-yellow-500"></div>
                                </div>
                            </div>

                            <div className="space-y-10 font-mono text-[14px] relative max-w-xl mx-auto pb-10">
                                {systemConfig?.rules_content ? (
                                    <div className="rules-content space-y-10">
                                        {systemConfig.rules_content.split('\n').map((line, i) => {
                                            if (!line.trim()) return null;
                                            const parts = line.split('::');
                                            
                                            // Detect if it's a title line
                                            const isTitle = line.includes('⚠️') || !/^\d+\./.test(line.trim());

                                            return (
                                                <motion.div 
                                                    key={i} 
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: i * 0.08 }}
                                                    className={`relative ${isTitle ? 'mt-8 mb-4' : ''}`}
                                                >
                                                    <div className={`text-white font-bold uppercase leading-relaxed tracking-wide ${isTitle ? 'text-xl text-yellow-400 border-b-2 border-yellow-500/20 pb-4 shadow-[0_4px_10px_rgba(234,179,8,0.1)]' : 'text-base'}`}>
                                                        {parts.map((part, j) => 
                                                            j % 2 === 1 ? (
                                                                <span key={j} className="bg-yellow-500 text-black px-2 py-1 mx-0.5 inline-block font-black leading-none shadow-[6px_6px_0px_rgba(234,179,8,0.4)] border border-yellow-600 scale-105">
                                                                    {part}
                                                                </span>
                                                            ) : part
                                                        )}
                                                    </div>
                                                </motion.div>
                                            );
                                        })}
                                        
                                        {/* END OF RULES WARNINGS */}
                                        <motion.div 
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            transition={{ delay: 1 }}
                                            className="pt-10 flex flex-col items-center border-t border-zinc-800 gap-4 text-center"
                                        >
                                            <motion.div 
                                                animate={{ opacity: [0.4, 1, 0.4] }}
                                                transition={{ duration: 2, repeat: Infinity }}
                                                className="text-[12px] text-red-500 font-bold tracking-[0.4em] uppercase"
                                            >
                                                EL INCUMPLIMIENTO ANULA EL ACCESO AL RECINTO
                                            </motion.div>
                                            <div className="text-[10px] text-zinc-500 font-mono tracking-widest uppercase mt-2">
                                                USA EL BOTÓN SUPERIOR PARA VOLVER AL INICIO
                                            </div>
                                        </motion.div>
                                    </div>
                                ) : (
                                    <div className="text-center py-20 opacity-30 text-yellow-500 font-tech uppercase animate-pulse border-2 border-dashed border-yellow-500/20">
                                        [ PROTOCOLO NO CARGADO - CONTACTE SOPORTE ]
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </Suspense>
    );
  }

  const isKioskBiometric = activeTab === 'SCAN' && scanMode === 'BIOMETRIC';

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col font-sans selection:bg-yellow-500 selection:text-black overflow-hidden">
      
      {/* DESKTOP SIDEBAR - COMPACT VERSION */}
      {!isKioskBiometric && (
        <aside className="hidden lg:flex fixed top-0 left-0 h-full w-64 bg-zinc-950 border-r border-zinc-800 flex-col z-50">
            <div className="p-5 border-b border-zinc-900">
                <h1 className="text-2xl font-tech font-black text-white tracking-tighter">KALI <span className="text-yellow-500">ACCESS</span></h1>
                <p className="text-[10px] text-zinc-500 font-mono-tech mt-1 tracking-widest">{userRole} :: {userName}</p>
            </div>
            
            <nav className="flex-1 p-2 space-y-1 overflow-y-auto custom-scrollbar">
                <button onClick={() => setActiveTab('DASHBOARD')} className={`w-full text-left px-3 py-2 font-tech font-bold uppercase tracking-widest text-xs transition-all border-l-2 ${activeTab === 'DASHBOARD' ? 'border-yellow-400 text-yellow-300 font-extrabold bg-yellow-500/20' : 'border-transparent text-zinc-400 hover:text-white hover:bg-zinc-900'}`}>DASHBOARD</button>
                <button onClick={() => setActiveTab('ATTENDANCE')} className={`w-full text-left px-3 py-2 font-tech font-bold uppercase tracking-widest text-xs transition-all border-l-2 ${activeTab === 'ATTENDANCE' ? 'border-yellow-400 text-yellow-300 font-extrabold bg-yellow-500/20' : 'border-transparent text-zinc-400 hover:text-white hover:bg-zinc-900'}`}>ASISTENCIAS HOY</button>
                
                {(userRole === UserRole.ADMIN || userRole === UserRole.COACH) && (
                    <>
                        <button onClick={() => setActiveTab('CLIENTS')} className={`w-full text-left px-3 py-2 font-tech font-bold uppercase tracking-widest text-xs transition-all border-l-2 ${activeTab === 'CLIENTS' ? 'border-yellow-400 text-yellow-300 font-extrabold bg-yellow-500/20' : 'border-transparent text-zinc-400 hover:text-white hover:bg-zinc-900'}`}>BASE DE DATOS</button>
                        <button onClick={() => setActiveTab('REGISTER')} className={`w-full text-left px-3 py-2 font-tech font-bold uppercase tracking-widest text-xs transition-all border-l-2 ${activeTab === 'REGISTER' ? 'border-yellow-400 text-yellow-300 font-extrabold bg-yellow-500/20' : 'border-transparent text-zinc-400 hover:text-white hover:bg-zinc-900'}`}>REGISTRO</button>
                        <button onClick={() => setActiveTab('POS')} className={`w-full text-left px-3 py-2 font-tech font-bold uppercase tracking-widest text-xs transition-all border-l-2 ${activeTab === 'POS' ? 'border-yellow-400 text-yellow-300 font-extrabold bg-yellow-500/20' : 'border-transparent text-zinc-400 hover:text-white hover:bg-zinc-900'}`}>VENTA (POS)</button>
                        <button onClick={() => { setActiveTab('SCAN'); setScanMode('BIOMETRIC'); }} className={`w-full text-left px-3 py-2 font-tech font-bold uppercase tracking-widest text-xs transition-all border-l-2 ${activeTab === 'SCAN' && scanMode === 'BIOMETRIC' ? 'border-yellow-400 text-yellow-300 font-extrabold bg-yellow-500/20' : 'border-transparent text-zinc-400 hover:text-white hover:bg-zinc-900'}`}>ACCESO HUELLA</button>
                        <button onClick={() => { setActiveTab('SCAN'); setScanMode('QR'); }} className={`w-full text-left px-3 py-2 font-tech font-bold uppercase tracking-widest text-xs transition-all border-l-2 ${activeTab === 'SCAN' && scanMode === 'QR' ? 'border-yellow-400 text-yellow-300 font-extrabold bg-yellow-500/20' : 'border-transparent text-zinc-400 hover:text-white hover:bg-zinc-900'}`}>ACCESO QR</button>
                    </>
                )}

                {userRole === UserRole.ADMIN && (
                    <>
                        <div className="my-2 border-t border-zinc-800"></div>
                        <p className="px-3 text-[10px] text-zinc-500 font-tech uppercase mb-1">ADMINISTRACIÓN</p>
                        <button onClick={() => setActiveTab('SERVICES')} className={`w-full text-left px-3 py-2 font-tech font-bold uppercase tracking-widest text-xs transition-all border-l-2 ${activeTab === 'SERVICES' ? 'border-yellow-400 text-yellow-300 font-extrabold bg-yellow-500/20' : 'border-transparent text-zinc-400 hover:text-white hover:bg-zinc-900'}`}>PLANES Y CLASES</button>
                        <button onClick={() => setActiveTab('FINANCE')} className={`w-full text-left px-3 py-2 font-tech font-bold uppercase tracking-widest text-xs transition-all border-l-2 ${activeTab === 'FINANCE' ? 'border-yellow-400 text-yellow-300 font-extrabold bg-yellow-500/20' : 'border-transparent text-zinc-400 hover:text-white hover:bg-zinc-900'}`}>FINANZAS</button>
                        <button onClick={() => setActiveTab('INVENTORY')} className={`w-full text-left px-3 py-2 font-tech font-bold uppercase tracking-widest text-xs transition-all border-l-2 ${activeTab === 'INVENTORY' ? 'border-yellow-400 text-yellow-300 font-extrabold bg-yellow-500/20' : 'border-transparent text-zinc-400 hover:text-white hover:bg-zinc-900'}`}>INVENTARIO</button>
                        <button onClick={() => setActiveTab('ADMIN')} className={`w-full text-left px-3 py-2 font-tech font-bold uppercase tracking-widest text-xs transition-all border-l-2 ${activeTab === 'ADMIN' ? 'border-yellow-400 text-yellow-300 font-extrabold bg-yellow-500/20' : 'border-transparent text-zinc-400 hover:text-white hover:bg-zinc-900'}`}>STAFF / USUARIOS</button>
                        <button onClick={() => setActiveTab('CONFIG')} className={`w-full text-left px-3 py-2 font-tech font-bold uppercase tracking-widest text-xs transition-all border-l-2 ${activeTab === 'CONFIG' ? 'border-yellow-400 text-yellow-300 font-extrabold bg-yellow-500/20' : 'border-transparent text-zinc-400 hover:text-white hover:bg-zinc-900'}`}>SISTEMA</button>
                    </>
                )}
            </nav>
            
            <div className="p-2 border-t border-zinc-900">
                <button onClick={handleLogout} className="w-full bg-zinc-900 hover:bg-red-900/20 text-zinc-400 hover:text-red-400 border border-zinc-800 hover:border-red-900 py-3 font-tech font-bold uppercase text-xs transition-all">
                    CERRAR SESIÓN
                </button>
            </div>
        </aside>
      )}

      {/* MOBILE HEADER */}
      {!isKioskBiometric && (
        <header className="lg:hidden h-16 bg-black/90 backdrop-blur-md border-b border-zinc-800 flex items-center justify-between px-4 fixed top-0 left-0 right-0 z-40">
             <h1 className="text-xl font-tech font-black text-white">KALI <span className="text-yellow-500">ACCESS</span></h1>
             <button onClick={handleLogout} className="text-zinc-500 hover:text-white">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
             </button>
        </header>
      )}

      {/* MAIN CONTENT */}
      <main className={isKioskBiometric ? "w-screen h-screen overflow-hidden bg-black p-0 m-0 fixed inset-0 z-50" : "flex-1 lg:ml-64 p-4 lg:p-8 pt-20 lg:pt-8 pb-24 lg:pb-8 overflow-y-auto h-screen bg-image-grid"}>
          <Suspense fallback={<LoadingFallback />}>

          {activeTab === 'DASHBOARD' && (
              <Dashboard 
                  metrics={metrics}
                  clients={clients}
                  subscriptions={subscriptions}
                  expiredClients={clients.filter(c => {
                    if(!c.isActive || !c.membershipEnd) return false;
                    const [y, m, d] = c.membershipEnd.split('-').map(Number);
                    const end = new Date(y, m - 1, d);
                    const now = new Date();
                    now.setHours(0,0,0,0);
                    return end < now;
                  })}
                  packages={packages}
                  activities={activities}
                  userName={userName}
                  userRole={userRole}
                  allowedActivityIds={allowedActivityIds}
                  allowedPackageIds={allowedPackageIds}
                  isLoading={isLoading}
                  onRefreshData={loadData}
                  onShowQr={(c) => setShowQrModalClient(c)}
                  onEditClient={(c) => setEditingClient(c)}
                  canRenew={canRenew}
                  onSwitchCamera={toggleCamera} 
                  viewMode="DASHBOARD"
                  onAddExpense={() => setIsExpenseModalOpen(true)}
                  packageRelations={pkgRelations}
                  onOpenAttendancePanel={() => setActiveTab('ATTENDANCE')}
                  canManageFingerprints={canManageFingerprints}
              />
          )}

          {activeTab === 'CLIENTS' && (
              <Dashboard 
                  metrics={metrics}
                  clients={clients}
                  subscriptions={subscriptions}
                  expiredClients={[]}
                  packages={packages}
                  activities={activities}
                  userName={userName}
                  userRole={userRole}
                  allowedActivityIds={allowedActivityIds}
                  allowedPackageIds={allowedPackageIds}
                  isLoading={isLoading}
                  onRefreshData={loadData}
                  onShowQr={(c) => setShowQrModalClient(c)}
                  onEditClient={(c) => setEditingClient(c)}
                  onDeleteClient={handleDeleteClient}
                  onToggleStatus={handleToggleStatus}
                  canRenew={canRenew}
                  onSwitchCamera={toggleCamera} 
                  viewMode="CLIENTS_DB"
                  packageRelations={pkgRelations}
                  canManageFingerprints={canManageFingerprints}
              />
          )}

          {activeTab === 'REGISTER' && (
              <div className="h-full flex items-center justify-center">
                  <EditClientModal 
                      client={{ id: '', firstName: '', lastNamePaternal: '', lastNameMaternal: '', email: '', phone: '', photoUrl: null, isActive: true, membershipStart: '', membershipEnd: '', activity_id: null, cost: 0, package_id: null }}
                      isNew={true}
                      packages={packages}
                      activities={activities}
                      onClose={() => setActiveTab('DASHBOARD')}
                      onSuccess={handleRegisterSuccess}
                      stream={stream}
                      cameraError={cameraError}
                      userRole={userRole}
                      onSwitchCamera={toggleCamera}
                      packageRelations={pkgRelations}
                      availableDevices={videoDevices}
                      currentDeviceId={selectedDeviceId}
                      onDeviceSelect={handleDeviceSelect}
                      clients={clients}
                      canManageFingerprints={canManageFingerprints}
                      canEditMembership={canEditMembership}
                      onOpenBiometricScan={() => {
                        setActiveTab('SCAN');
                        setScanMode('BIOMETRIC');
                      }}
                  />
              </div>
          )}

          {activeTab === 'POS' && <PointOfSale userName={userName} onPaymentSuccess={loadData} />}

          {activeTab === 'SCAN' && (
              <div className="h-full flex flex-col items-center justify-center">
                  <div className="w-full h-full relative">
                      {scanMode === 'BIOMETRIC' ? (
                          <BiometricScanner 
                              clients={clients}
                              subscriptions={subscriptions}
                              packages={packages}
                              activities={activities}
                              onAttendanceLogged={loadData}
                              onSwitchToQr={() => setScanMode('QR')}
                              onExitToDashboard={() => setActiveTab('DASHBOARD')}
                              requireBiometricExitPin={systemConfig?.require_biometric_exit_pin ?? true}
                          />
                      ) : (
                          <div className="h-full flex flex-col items-center justify-center relative">
                              <QrScanner 
                                  isActive={true} 
                                  clients={clients}
                                  subscriptions={subscriptions}
                                  packages={packages}
                                  activities={activities}
                                  onAttendanceLogged={loadData}
                                  onSwitchToBiometric={() => setScanMode('BIOMETRIC')}
                                  onExitToDashboard={() => setActiveTab('DASHBOARD')}
                              />
                          </div>
                      )}
                  </div>
              </div>
          )}

          {activeTab === 'ATTENDANCE' && (
              <TodayAttendancePanel 
                  clients={clients}
                  packages={packages}
                  activities={activities}
                  onOpenBiometricScanner={() => { setActiveTab('SCAN'); setScanMode('BIOMETRIC'); }}
                  onOpenQrScanner={() => { setActiveTab('SCAN'); setScanMode('QR'); }}
              />
          )}

          {activeTab === 'SERVICES' && <ServicesPanel />}
          {activeTab === 'FINANCE' && <FinancePanel />}
          {activeTab === 'INVENTORY' && <InventoryPanel />}
          {activeTab === 'ADMIN' && <CoachManagement />}
          {activeTab === 'CONFIG' && <SystemConfigPanel />}
          </Suspense>
      </main>

      {/* MOBILE NAV BOTTOM */}
      {!isKioskBiometric && (
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-black border-t border-zinc-800 z-50 flex justify-around items-center px-2 safe-area-pb backdrop-blur-lg bg-black/90">
            <button onClick={() => { setActiveTab('DASHBOARD'); setIsMobileMenuOpen(false); }} className={`flex flex-col items-center p-2 ${activeTab === 'DASHBOARD' ? 'text-yellow-500' : 'text-zinc-500'}`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                <span className="text-[9px] font-tech font-bold mt-1">DASHBOARD</span>
            </button>

          
          {(userRole === UserRole.ADMIN || userRole === UserRole.COACH) && (
              <button onClick={() => { setActiveTab('REGISTER'); setIsMobileMenuOpen(false); }} className={`flex flex-col items-center p-2 ${activeTab === 'REGISTER' ? 'text-yellow-500' : 'text-zinc-500'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
                  <span className="text-[9px] font-tech font-bold mt-1">REGISTRO</span>
              </button>
          )}
          
          {(userRole === UserRole.ADMIN || userRole === UserRole.COACH) && (
              <button onClick={() => { setActiveTab('POS'); setIsMobileMenuOpen(false); }} className={`flex flex-col items-center p-2 ${activeTab === 'POS' ? 'text-yellow-500' : 'text-zinc-500'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                  <span className="text-[9px] font-tech font-bold mt-1">VENTA</span>
              </button>
          )}

          {(userRole === UserRole.ADMIN || userRole === UserRole.COACH) && (
              <button onClick={() => { setActiveTab('SCAN'); setScanMode('QR'); setIsMobileMenuOpen(false); }} className={`flex flex-col items-center p-2 ${activeTab === 'SCAN' ? 'text-yellow-500' : 'text-zinc-500'}`}>
                  <div className={`p-1 rounded-full border-2 ${activeTab === 'SCAN' ? 'border-yellow-500 bg-yellow-500/10' : 'border-zinc-700'}`}>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  </div>
                  <span className="text-[9px] font-tech font-bold mt-1">QR</span>
              </button>
          )}

          {userRole === UserRole.ADMIN && (
              <button onClick={() => { setActiveTab('FINANCE'); setIsMobileMenuOpen(false); }} className={`flex flex-col items-center p-2 ${activeTab === 'FINANCE' ? 'text-yellow-500' : 'text-zinc-500'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v.01M12 12v4m0 4v.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                  <span className="text-[9px] font-tech font-bold mt-1">CAJA</span>
              </button>
          )}
          
          {userRole === UserRole.ADMIN && (
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className={`flex flex-col items-center p-2 ${isMobileMenuOpen ? 'text-white' : 'text-zinc-500'}`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" /></svg>
                <span className="text-[9px] font-tech font-bold mt-1">MÁS</span>
            </button>
          )}
      </nav>
      )}

      {/* MOBILE EXTRA MENU */}
      {!isKioskBiometric && isMobileMenuOpen && userRole === UserRole.ADMIN && (
          <div className="lg:hidden fixed bottom-16 left-0 right-0 bg-zinc-900 border-t border-zinc-800 p-4 grid grid-cols-2 gap-4 z-50 animate-[slideUp_0.2s_ease-out]">
              <button onClick={() => { setActiveTab('CLIENTS'); setIsMobileMenuOpen(false); }} className="bg-black border border-yellow-500/50 p-4 text-center rounded col-span-2">
                  <span className="block text-yellow-500 font-bold font-tech uppercase text-lg">BASE DE DATOS (SOCIOS)</span>
              </button>
              <button onClick={() => { setActiveTab('SERVICES'); setIsMobileMenuOpen(false); }} className="bg-black border border-zinc-700 p-4 text-center rounded">
                  <span className="block text-white font-bold font-tech uppercase">PLANES/CLASES</span>
              </button>
              <button onClick={() => { setActiveTab('INVENTORY'); setIsMobileMenuOpen(false); }} className="bg-black border border-zinc-700 p-4 text-center rounded">
                  <span className="block text-white font-bold font-tech uppercase">INVENTARIO</span>
              </button>
              <button onClick={() => { setActiveTab('ADMIN'); setIsMobileMenuOpen(false); }} className="bg-black border border-zinc-700 p-4 text-center rounded">
                  <span className="block text-white font-bold font-tech uppercase">STAFF</span>
              </button>
              <button onClick={() => { setActiveTab('CONFIG'); setIsMobileMenuOpen(false); }} className="bg-black border border-zinc-700 p-4 text-center rounded col-span-2">
                  <span className="block text-zinc-400 font-bold font-tech uppercase">CONFIGURACIÓN SISTEMA</span>
              </button>
          </div>
      )}

      {/* GLOBAL MODALS */}
      <Suspense fallback={null}>
      {editingClient && (
          <EditClientModal 
              client={editingClient}
              packages={packages}
              activities={activities}
              onClose={() => setEditingClient(null)}
              onSuccess={async () => { setEditingClient(null); await loadData(); }}
              stream={stream}
              cameraError={cameraError}
              userRole={userRole}
              onSwitchCamera={toggleCamera}
              packageRelations={pkgRelations} 
              availableDevices={videoDevices} 
              currentDeviceId={selectedDeviceId} 
              onDeviceSelect={handleDeviceSelect} 
              clients={clients}
              canManageFingerprints={canManageFingerprints}
              canEditMembership={canEditMembership}
              onShowQr={(c) => setShowQrModalClient(c)}
              onOpenBiometricScan={() => {
                setEditingClient(null);
                setActiveTab('SCAN');
                setScanMode('BIOMETRIC');
              }}
          />
      )}

      {showQrModalClient && (
          <QrCodeModal client={showQrModalClient} onClose={() => setShowQrModalClient(null)} />
      )}

      {registeredClient && (
          <RegistrationSuccessModal 
              client={registeredClient}
              paymentAmount={registeredClient.cost || 0}
              paymentConcept={
                  packages.find(p => p.id === registeredClient.package_id)?.name || 
                  activities.find(a => a.id === registeredClient.activity_id)?.name || 
                  "INSCRIPCIÓN"
              }
              onClose={() => setRegisteredClient(null)}
              onShowQr={() => { 
                  const c = registeredClient; 
                  setRegisteredClient(null); 
                  setShowQrModalClient(c); 
              }}
              onOpenBiometricScan={() => {
                  setRegisteredClient(null);
                  setActiveTab('SCAN');
                  setScanMode('BIOMETRIC');
              }}
          />
      )}

      {/* ADD EXPENSE MODAL */}
      {isExpenseModalOpen && (
          <AddExpenseModal 
              userName={userName}
              onClose={() => setIsExpenseModalOpen(false)}
              onSuccess={() => {
                  setIsExpenseModalOpen(false);
                  loadData(); // Refresh metrics
              }}
          />
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {clientToDelete && (
          <ConfirmationModal 
              isOpen={!!clientToDelete}
              title="¿ELIMINAR SOCIO?"
              message={
                  <span>
                      Estás a punto de eliminar a <span className="text-white font-bold">{clientToDelete.firstName} {clientToDelete.lastNamePaternal}</span> permanentemente. 
                      <br/><br/>
                      Esta acción borrará su historial de pagos, asistencias y datos biométricos.
                  </span>
              }
              confirmText="SÍ, ELIMINAR"
              cancelText="CANCELAR"
              onConfirm={executeDeleteClient}
              onCancel={() => setClientToDelete(null)}
              isProcessing={isDeleting}
              type="danger"
          />
      )}
      </Suspense>

      <style>{`
        .bg-image-grid {
            background-image: 
            linear-gradient(rgba(234,179,8,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(234,179,8,0.02) 1px, transparent 1px);
            background-size: 30px 30px;
        }
        @keyframes slideUp {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #333;
          border-radius: 2px;
        }
      `}</style>
    </div>
  );
};

export default App;
