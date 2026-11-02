
import React, { useState, useEffect, useMemo, useRef } from 'react';
import Camera from './Camera';
import ImageCropper from './ImageCropper';
import { Client, Package, Activity, UserRole, ClientSubscription } from '../types';
import { saveClient, updateClient, getClientSubscriptionsByClientId, deleteClientSubscription, saveClientFingerprint, deleteClientFingerprint } from '../services/storage';
import { useToast } from '../context/ToastContext';
import { isElectronEnvironment, checkBiometricAvailability, captureFingerprint, cancelBiometricCapture } from '../services/biometricService';
import { audioService } from '../services/audioService';

interface EditClientModalProps {
  client: Client;
  packages: Package[];
  activities: Activity[];
  onClose: () => void;
  onSuccess: (newClient?: Client) => void;
  stream: MediaStream | null;
  cameraError: string | null;
  userRole: UserRole;
  isNew?: boolean;
  onSwitchCamera?: () => void;
  packageRelations?: {package_id: string, activity_id: string}[];
  availableDevices?: MediaDeviceInfo[];
  currentDeviceId?: string;
  onDeviceSelect?: (deviceId: string) => void;
  clients?: Client[];
  canManageFingerprints?: boolean;
  canEditMembership?: boolean;
  onOpenBiometricScan?: () => void;
  onShowQr?: (client: Client) => void;
}

const EditClientModal: React.FC<EditClientModalProps> = ({ 
  client, packages, activities, onClose, onSuccess, stream, cameraError, userRole, isNew = false, onSwitchCamera, packageRelations,
  availableDevices = [], currentDeviceId, onDeviceSelect, clients = [], canManageFingerprints = false, canEditMembership = false, onOpenBiometricScan, onShowQr
}) => {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const getTodayLocal = () => {
      const d = new Date();
      const year = d.getFullYear();
      const month = (d.getMonth() + 1).toString().padStart(2, '0');
      const day = d.getDate().toString().padStart(2, '0');
      return `${year}-${month}-${day}`;
  };

  const [formData, setFormData] = useState({
      firstName: client.firstName || '',
      lastNamePaternal: client.lastNamePaternal || '',
      lastNameMaternal: client.lastNameMaternal || '',
      email: client.email || '',
      phone: client.phone || '',
      membershipStart: client.membershipStart || getTodayLocal(),
      membershipEnd: client.membershipEnd || '',
      package_id: client.package_id || null,
      activity_id: client.activity_id || null,
      cost: client.cost || 0,
      isActive: isNew ? true : client.isActive,
      credentialExpiresAt: client.credentialExpiresAt || ''
  });

  const [addEnrollmentFee, setAddEnrollmentFee] = useState(false);
  const ENROLLMENT_AMOUNT = 200;

  const [selectedSubscriptions, setSelectedSubscriptions] = useState<any[]>([]);

  const [existingSubscriptions, setExistingSubscriptions] = useState<ClientSubscription[]>([]);
  const [hasSubscriptionChanges, setHasSubscriptionChanges] = useState(false);
  const [subPendingDeleteId, setSubPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
      if (!isNew && client?.id) {
          const loadExisting = async () => {
              try {
                  const subs = await getClientSubscriptionsByClientId(client.id);
                  // Solo cargar las membresías activas
                  setExistingSubscriptions(subs.filter(s => s.isActive));
              } catch (err) {
                  console.error("Error loading existing subscriptions:", err);
              }
          };
          loadExisting();
      }
  }, [isNew, client?.id]);

  const isMembershipEditAuthorized = isNew || userRole === UserRole.ADMIN || Boolean(canEditMembership);

  const handleDeleteExistingSubscription = async (sub: ClientSubscription, activityName: string) => {
      if (!isMembershipEditAuthorized) {
          showToast('No tienes permisos para dar de baja membresías. Solicita autorización al Administrador.', 'warning');
          return;
      }
      try {
          setIsLoading(true);
          await deleteClientSubscription(sub.id, sub);
          setExistingSubscriptions(prev => prev.filter(s => s.id !== sub.id));
          setHasSubscriptionChanges(true);
          showToast(`DISCIPLINA DE ${activityName} DADA DE BAJA CORRECTAMENTE`, 'success');
      } catch (err: any) {
          showToast(`Error al dar de baja la membresía: ${err.message}`, 'error');
      } finally {
          setIsLoading(false);
      }
  };

  const handleClose = () => {
      if (hasSubscriptionChanges) {
          onSuccess();
      } else {
          onClose();
      }
  };

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [targetPhotoField, setTargetPhotoField] = useState<'PROFILE' | 'CREDENTIAL' | null>(null);
  const [tempPhoto, setTempPhoto] = useState<string | null>(null);
  const [showCropper, setShowCropper] = useState(false);
  
  const [newPhotoBase64, setNewPhotoBase64] = useState<string | undefined>(undefined);
  const [newCredentialBase64, setNewCredentialBase64] = useState<string | undefined>(undefined);

  // Biometric state (DigitalPersona U.are.U 4500)
  const [fingerprintTemplate, setFingerprintTemplate] = useState<string | null>(client.fingerprint_template || null);
  const [isCapturingFingerprint, setIsCapturingFingerprint] = useState(false);
  const [fingerprintStatusText, setFingerprintStatusText] = useState<string>('');
  const [showDeleteFingerprintConfirm, setShowDeleteFingerprintConfirm] = useState(false);
  const [readerInfo, setReaderInfo] = useState<string | null>(null);

  // Modal para confirmar y guardar huella leída
  const [pendingFingerprintTemplate, setPendingFingerprintTemplate] = useState<string | null>(null);
  const [showConfirmFingerprintModal, setShowConfirmFingerprintModal] = useState(false);
  const [isSavingFingerprint, setIsSavingFingerprint] = useState(false);

  // Autorización Granular de Huellas (Opción 2)
  const isBiometricAuthorized = userRole === UserRole.ADMIN || Boolean(canManageFingerprints);

  const requestFingerprintCapture = () => {
    if (isBiometricAuthorized) {
      handleStartFingerprintCapture();
    }
  };

  const requestFingerprintDelete = () => {
    if (isBiometricAuthorized) {
      setShowDeleteFingerprintConfirm(true);
    }
  };

  useEffect(() => {
    if (isElectronEnvironment()) {
      checkBiometricAvailability().then(res => {
        if (res.available && res.readers && res.readers.length > 0) {
          setReaderInfo(res.readers[0].name);
        }
      }).catch(() => {});
    }
  }, []);

  const handleStartFingerprintCapture = async () => {
    setIsCapturingFingerprint(true);
    setFingerprintStatusText('Verificando disponibilidad de lector...');

    try {
      const avail = await checkBiometricAvailability();
      if (!avail.available) {
        setIsCapturingFingerprint(false);
        showToast(avail.message || 'Lector DigitalPersona no disponible.', 'warning');
        return;
      }

      setFingerprintStatusText('Coloque su dedo firmemente en el lector DigitalPersona...');
      const res = await captureFingerprint(15);

      if (res.success && res.template) {
        setPendingFingerprintTemplate(res.template);
        setShowConfirmFingerprintModal(true);
        try { audioService.playSuccess(); } catch {}
      } else {
        const errorMsg = res.message || 'No se pudo capturar la huella';
        showToast(`Aviso: ${errorMsg}`, 'warning');
      }
    } catch (err: any) {
      showToast(`Error de captura: ${err?.message || err}`, 'error');
    } finally {
      setIsCapturingFingerprint(false);
      setFingerprintStatusText('');
    }
  };

  const handleConfirmAndSaveFingerprint = async () => {
    if (!pendingFingerprintTemplate) return;
    setIsSavingFingerprint(true);

    try {
      setFingerprintTemplate(pendingFingerprintTemplate);
      
      if (!isNew && client.id) {
        const saved = await saveClientFingerprint(client.id, pendingFingerprintTemplate);
        if (saved) {
          showToast('HUELLA GUARDADA EXITOSAMENTE. REDIRIGIENDO A ACCESO HUELLA...', 'success');
          setHasSubscriptionChanges(true);
        } else {
          showToast('Huella vinculada. Abriendo terminal biométrica...', 'info');
        }
      } else {
        showToast('HUELLA ASIGNADA. Se guardará al registrar el socio.', 'success');
      }

      setShowConfirmFingerprintModal(false);
      setPendingFingerprintTemplate(null);

      // Si es un socio existente y está disponible onOpenBiometricScan, cerramos el modal y abrimos de inmediato ACCESO HUELLA
      if (!isNew && onOpenBiometricScan) {
        onSuccess();
        onOpenBiometricScan();
      }
    } catch (err: any) {
      showToast(`Error al guardar huella: ${err?.message || err}`, 'error');
    } finally {
      setIsSavingFingerprint(false);
    }
  };

  const handleCancelPendingFingerprint = () => {
    setShowConfirmFingerprintModal(false);
    setPendingFingerprintTemplate(null);
    showToast('Captura de huella descartada', 'info');
  };

  const handleCancelFingerprintCapture = async () => {
    await cancelBiometricCapture();
    setIsCapturingFingerprint(false);
    setFingerprintStatusText('');
    showToast('Captura biométrica cancelada', 'info');
  };

  const handleDeleteFingerprint = async () => {
    if (!isNew && client.id) {
      setIsLoading(true);
      try {
        const ok = await deleteClientFingerprint(client.id);
        if (ok) {
          setFingerprintTemplate(null);
          setShowDeleteFingerprintConfirm(false);
          setHasSubscriptionChanges(true);
          showToast('HUELLA ELIMINADA CORRECTAMENTE', 'success');
        } else {
          showToast('Error al eliminar la huella de la base de datos', 'error');
        }
      } catch (e: any) {
        showToast(`Error: ${e?.message || e}`, 'error');
      } finally {
        setIsLoading(false);
      }
    } else {
      setFingerprintTemplate(null);
      setShowDeleteFingerprintConfirm(false);
      showToast('Huella removida', 'info');
    }
  };

  const [isLoading, setIsLoading] = useState(false);

  const handleAddSubscription = () => {
      if (!formData.activity_id) {
          showToast('Selecciona una actividad primero', 'warning');
          return;
      }

      const act = activities.find(a => a.id === formData.activity_id);
      if (!act) return;

      const pkg = packages.find(p => p.id === formData.package_id);
      
      const isAlreadyAdded = selectedSubscriptions.some(s => s.activity_id === formData.activity_id);
      if (isAlreadyAdded) {
          showToast(`Ya has agregado la disciplina: ${act.name}`, 'warning');
          return;
      }

      let selectedItemCost = 0;
      if (formData.package_id) {
          if (pkg) selectedItemCost = pkg.cost;
      } else {
          selectedItemCost = act.cost;
      }

      const item = {
          activity_id: formData.activity_id,
          activity_name: act.name,
          package_id: formData.package_id || null,
          package_name: pkg ? pkg.name : 'CLASE SUELTA / VISITA (Sin Plan)',
          startDate: formData.membershipStart,
          endDate: formData.membershipEnd || formData.membershipStart,
          cost: selectedItemCost
      };

      const newList = [...selectedSubscriptions, item];
      setSelectedSubscriptions(newList);
      showToast('PLAN / DISCIPLINA AGREGADO A LA LISTA', 'success');

      // Clear current form selection
      setFormData(prev => ({
          ...prev,
          activity_id: null,
          package_id: null,
          membershipEnd: ''
      }));
  };

  const handleDeleteSubscription = (activityId: string) => {
      const newList = selectedSubscriptions.filter(s => s.activity_id !== activityId);
      setSelectedSubscriptions(newList);
      showToast('DISCIPLINA REMOVIDA DE LA LISTA', 'info');
  };

  useEffect(() => {
      if (isNew) {
          const subSum = selectedSubscriptions.reduce((sum, s) => sum + s.cost, 0);
          let currentInputCost = 0;
          if (formData.activity_id) {
              if (formData.package_id) {
                  const p = packages.find(pkg => pkg.id === formData.package_id);
                  if (p) currentInputCost = p.cost;
              } else {
                  const a = activities.find(act => act.id === formData.activity_id);
                  if (a) currentInputCost = a.cost;
              }
          }
          const finalCost = subSum + currentInputCost + (addEnrollmentFee ? ENROLLMENT_AMOUNT : 0);
          setFormData(prev => {
              if (prev.cost !== finalCost) {
                  return { ...prev, cost: finalCost };
              }
              return prev;
          });
      }
  }, [selectedSubscriptions, formData.activity_id, formData.package_id, addEnrollmentFee, isNew, packages, activities]);

  const downloadImage = async (src: string, defaultName: string) => {
    try {
      if (src.startsWith('data:')) {
        const link = document.createElement('a');
        link.href = src;
        const mime = src.split(';')[0].split(':')[1];
        const ext = mime ? mime.split('/')[1] : 'png';
        link.download = `${defaultName}.${ext}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('IMAGEN DESCARGADA', 'success');
      } else {
        const res = await fetch(src);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const filename = src.split('/').pop() || `${defaultName}.jpg`;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showToast('IMAGEN DESCARGADA', 'success');
      }
    } catch (err) {
      console.warn("Error downloading image directly:", err);
      window.open(src, '_blank');
      showToast('IMAGEN ABIERTA EN NUEVA PESTAÑA PARA DESCARGAR', 'info');
    }
  };

  const availablePackages = useMemo(() => {
      if (!formData.activity_id) return [];
      if (!packageRelations || packageRelations.length === 0) return packages;

      const validPackageIds = packageRelations
          .filter(r => r.activity_id === formData.activity_id)
          .map(r => r.package_id);
      
      return packages.filter(p => validPackageIds.includes(p.id));
  }, [formData.activity_id, packages, packageRelations]);

  const requiresCredential = useMemo(() => {
      const pkg = packages.find(p => p.id === formData.package_id);
      if (pkg?.requires_credential) return true;

      return selectedSubscriptions.some(sub => {
          const p = packages.find(pkgItem => pkgItem.id === sub.package_id);
          return p?.requires_credential || false;
      });
  }, [formData.package_id, selectedSubscriptions, packages]);

  const calculateTotalCost = (baseCost: number, includeEnrollment: boolean) => {
      return baseCost + (includeEnrollment ? ENROLLMENT_AMOUNT : 0);
  };

  const handleActivityChange = (actId: string) => {
      const act = activities.find(a => a.id === actId);
      if (act) {
          setFormData(prev => ({
              ...prev,
              activity_id: actId,
              package_id: null, 
              cost: calculateTotalCost(act.cost, addEnrollmentFee),
              membershipEnd: prev.membershipStart
          }));
      } else {
          setFormData(prev => ({
              ...prev,
              activity_id: null,
              package_id: null,
              cost: calculateTotalCost(0, addEnrollmentFee),
              membershipEnd: ''
          }));
      }
  };

  const handlePackageChange = (pkgId: string) => {
      if (!pkgId) {
          const act = activities.find(a => a.id === formData.activity_id);
          const baseCost = act ? act.cost : 0;
          setFormData(prev => ({
              ...prev,
              package_id: null,
              cost: calculateTotalCost(baseCost, addEnrollmentFee),
              membershipEnd: prev.membershipStart
          }));
          return;
      }

      const pkg = packages.find(p => p.id === pkgId);
      if (pkg) {
          const [sYear, sMonth, sDay] = formData.membershipStart.split('-').map(Number);
          const startDate = new Date(sYear, sMonth - 1, sDay);
          
          const endDate = new Date(startDate);
          endDate.setDate(startDate.getDate() + pkg.duration_days);
          
          const eYear = endDate.getFullYear();
          const eMonth = (endDate.getMonth() + 1).toString().padStart(2, '0');
          const eDay = endDate.getDate().toString().padStart(2, '0');
          
          setFormData(prev => ({
              ...prev,
              package_id: pkgId,
              cost: calculateTotalCost(pkg.cost, addEnrollmentFee),
              membershipEnd: `${eYear}-${eMonth}-${eDay}`
          }));
      }
  };

  const handleEnrollmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const isChecked = e.target.checked;
      setAddEnrollmentFee(isChecked);
      
      let baseCost = 0;
      if (formData.package_id) {
          const p = packages.find(pkg => pkg.id === formData.package_id);
          if (p) baseCost = p.cost;
      } else if (formData.activity_id) {
          const a = activities.find(act => act.id === formData.activity_id);
          if (a) baseCost = a.cost;
      }

      setFormData(prev => ({
          ...prev,
          cost: calculateTotalCost(baseCost, isChecked)
      }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const reader = new FileReader();
          reader.onload = (ev) => {
              if (ev.target?.result) {
                  setTempPhoto(ev.target.result as string);
                  setShowCropper(true);
              }
          };
          reader.readAsDataURL(e.target.files[0]);
      }
  };

  const triggerFileUpload = (field: 'PROFILE' | 'CREDENTIAL') => {
      setTargetPhotoField(field);
      fileInputRef.current?.click();
  };

  const handleCapture = (base64: string) => {
      setTempPhoto(base64);
      setIsCameraActive(false);
      setShowCropper(true);
  };

  const handleCropConfirm = (croppedBase64: string) => {
      if (targetPhotoField === 'PROFILE') {
          setNewPhotoBase64(croppedBase64);
      } else {
          setNewCredentialBase64(croppedBase64);
      }
      setShowCropper(false);
      setTempPhoto(null);
      setTargetPhotoField(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (isLoading) return;

      if (!formData.firstName || !formData.lastNamePaternal) {
          showToast('Nombre y Apellido son obligatorios', 'warning');
          return;
      }

      if (isNew) {
          if (selectedSubscriptions.length === 0 && !formData.activity_id) {
              showToast('Debes agregar al menos una Disciplina o Plan a la lista', 'warning');
              return;
          }
      } else {
          if (!formData.activity_id && !formData.package_id) {
              showToast('Debes seleccionar una Actividad', 'warning');
              return;
          }
      }

      // Validar nombre duplicado solo para nuevos registros
      if (isNew) {
          const isDuplicate = clients.some(c => 
              c.firstName.toLowerCase().trim() === formData.firstName.toLowerCase().trim() && 
              c.lastNamePaternal.toLowerCase().trim() === formData.lastNamePaternal.toLowerCase().trim()
          );

          if (isDuplicate) {
              showToast('ERROR: Ya existe un socio registrado con este nombre y apellido.', 'error');
              return;
          }
      }

      setIsLoading(true);
      try {
          if (isNew) {
              let finalSubscriptions = [...selectedSubscriptions];
              if (finalSubscriptions.length === 0 && formData.activity_id) {
                  const act = activities.find(a => a.id === formData.activity_id);
                  const pkg = packages.find(p => p.id === formData.package_id);
                  finalSubscriptions.push({
                      activity_id: formData.activity_id,
                      activity_name: act?.name || 'Disciplina',
                      package_id: formData.package_id || null,
                      package_name: pkg ? pkg.name : 'CLASE SUELTA / VISITA (Sin Plan)',
                      startDate: formData.membershipStart,
                      endDate: formData.membershipEnd || formData.membershipStart,
                      cost: formData.cost - (addEnrollmentFee ? ENROLLMENT_AMOUNT : 0)
                  });
              }

              const newClient = await saveClient({
                  ...formData,
                  subscriptions: finalSubscriptions,
                  photoBase64: newPhotoBase64 || undefined,
                  credentialBase64: newCredentialBase64 || undefined,
                  fingerprint_template: fingerprintTemplate || undefined
              });
              showToast('CLIENTE REGISTRADO CORRECTAMENTE', 'success');
              onSuccess(newClient);
          } else {
              const safeFormData = isMembershipEditAuthorized ? formData : {
                  ...formData,
                  package_id: client.package_id || null,
                  activity_id: client.activity_id || null,
                  membershipStart: client.membershipStart || formData.membershipStart,
                  membershipEnd: client.membershipEnd || '',
                  cost: client.cost || 0
              };

              await updateClient({
                  ...client,
                  ...safeFormData,
                  newPhotoBase64: newPhotoBase64 || undefined,
                  newCredentialBase64: newCredentialBase64 || undefined,
                  fingerprint_template: fingerprintTemplate
              });
              showToast('DATOS ACTUALIZADOS', 'success');
              onSuccess();
          }
      } catch (error: any) {
          console.error(error);
          showToast('Error: ' + error.message, 'error');
      } finally {
          setIsLoading(false);
      }
  };

  const openCamera = (field: 'PROFILE' | 'CREDENTIAL') => {
      setTargetPhotoField(field);
      setIsCameraActive(true);
  };

  const labelStyle = "block text-xs font-tech text-yellow-500/80 mb-1 uppercase tracking-widest";
  const inputStyle = "w-full bg-black/50 border-2 border-zinc-700 px-4 py-2 text-white focus:border-yellow-500 outline-none font-mono-tech text-sm disabled:opacity-50 disabled:cursor-not-allowed";
  const btnPrimary = "bg-yellow-500 text-black font-tech font-bold uppercase tracking-widest px-6 py-3 hover:bg-yellow-400 active:translate-y-1 active:shadow-none transition-all shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)] border-2 border-yellow-600 w-full disabled:opacity-50 disabled:cursor-not-allowed";

  if (isCameraActive) {
      return (
          <div className="fixed inset-0 z-[200] bg-black">
              <Camera 
                  stream={stream} 
                  error={cameraError} 
                  mode="capture" 
                  onCapture={handleCapture}
                  isActive={isCameraActive}
                  onSwitchCamera={onSwitchCamera}
              />
              {availableDevices.length > 0 && onDeviceSelect && (
                 <div className="absolute top-4 left-4 z-50">
                     <select 
                        value={currentDeviceId || ''} 
                        onChange={(e) => onDeviceSelect(e.target.value)}
                        className="bg-black/80 text-yellow-500 border border-yellow-500 font-tech text-xs p-2 rounded outline-none max-w-[200px]"
                     >
                         <option value="">AUTOMÁTICO / SWITCH</option>
                         {availableDevices.map(device => (
                             <option key={device.deviceId} value={device.deviceId}>
                                 {device.label || `Cámara ${device.deviceId.slice(0,5)}...`}
                             </option>
                         ))}
                     </select>
                 </div>
              )}
              <button 
                  onClick={() => setIsCameraActive(false)}
                  className="absolute top-4 right-4 text-white bg-black/50 p-2 rounded-full z-50"
              >
                  ✕
              </button>
          </div>
      );
  }

  if (showCropper && tempPhoto) {
      return (
          <ImageCropper 
              imageSrc={tempPhoto}
              onConfirm={handleCropConfirm}
              onCancel={() => { setShowCropper(false); setIsCameraActive(true); }}
          />
      );
  }

  return (
    <div className={`fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 ${!isNew ? 'animate-[fadeIn_0.3s_ease-out]' : ''}`}>
        <div 
            className="w-full max-w-4xl bg-zinc-950 border-2 border-zinc-800 shadow-2xl flex flex-col md:flex-row overflow-hidden max-h-[95vh]"
            onClick={(e) => e.stopPropagation()} 
        >
            <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*" 
                onChange={handleFileChange} 
            />

            <div className="w-full md:w-1/3 bg-black border-r border-zinc-800 p-6 flex flex-col items-center gap-6 overflow-y-auto">
                <div className="text-center">
                    <p className="text-zinc-500 font-tech uppercase text-xs mb-2">FOTO DE PERFIL</p>
                    <div 
                        onClick={() => openCamera('PROFILE')}
                        className="w-40 h-40 bg-zinc-900 border-2 border-dashed border-zinc-700 hover:border-yellow-500 cursor-pointer flex items-center justify-center overflow-hidden relative group transition-colors"
                    >
                        {(newPhotoBase64 || client.photoUrl) ? (
                            <img src={newPhotoBase64 || client.photoUrl!} className="w-full h-full object-cover" />
                        ) : (
                            <div className="text-zinc-600 text-center">
                                <span className="text-4xl block mb-2">📷</span>
                                <span className="text-[10px] font-tech uppercase">TOMAR FOTO</span>
                            </div>
                        )}
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <span className="text-white text-xs font-bold">CAMBIAR</span>
                        </div>
                    </div>
                    <div className="mt-2 flex flex-col items-center gap-2">
                        <button type="button" onClick={() => triggerFileUpload('PROFILE')} className="text-[10px] text-zinc-500 hover:text-white underline uppercase">Subir desde archivo</button>
                        
                        {(newPhotoBase64 || client.photoUrl) && (
                            <button 
                                type="button" 
                                onClick={() => downloadImage(newPhotoBase64 || client.photoUrl!, `perfil_${formData.firstName}_${formData.lastNamePaternal}`)} 
                                className="mt-2 flex items-center gap-1.5 bg-yellow-500 text-black font-tech font-bold uppercase text-[10px] px-3 py-1.5 hover:bg-yellow-400 active:scale-95 transition-all outline-none"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                DESCARGAR FOTO
                            </button>
                        )}
                    </div>
                </div>

                {/* SECCIÓN BIOMETRÍA DIGITALPERSONA U.ARE.U 4500 */}
                <div className="w-full bg-zinc-950 border border-zinc-800 p-4 rounded-xl flex flex-col items-center gap-3 relative shadow-inner">
                    <div className="flex items-center justify-between w-full border-b border-zinc-900 pb-2">
                        <div className="flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m12 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17" />
                            </svg>
                            <span className="text-[11px] font-tech font-bold text-white uppercase tracking-wider">HUELLA BIOMÉTRICA</span>
                        </div>
                        {readerInfo && (
                            <span className="text-[9px] font-mono-tech text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-1.5 py-0.5 rounded">
                                USB OK
                            </span>
                        )}
                    </div>

                    {/* Sensor Graphic & Status */}
                    <div className="flex flex-col items-center py-2 w-full">
                        <div className={`w-20 h-24 rounded-2xl flex flex-col items-center justify-center border-2 transition-all relative overflow-hidden ${
                            isCapturingFingerprint 
                                ? 'bg-yellow-500/10 border-yellow-500 shadow-[0_0_25px_rgba(234,179,8,0.4)] animate-pulse' 
                                : fingerprintTemplate 
                                    ? 'bg-emerald-950/20 border-emerald-500/80 shadow-[0_0_15px_rgba(16,185,129,0.2)]' 
                                    : 'bg-zinc-900/60 border-zinc-800'
                        }`}>
                            {isCapturingFingerprint && (
                                <div className="absolute inset-x-0 h-1 bg-yellow-400 animate-bounce top-2"></div>
                            )}
                            
                            <svg xmlns="http://www.w3.org/2000/svg" className={`h-10 w-10 transition-colors ${
                                isCapturingFingerprint 
                                    ? 'text-yellow-400' 
                                    : fingerprintTemplate 
                                        ? 'text-emerald-400' 
                                        : 'text-zinc-600'
                            }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m12 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17" />
                            </svg>

                            <span className="text-[8px] font-mono-tech mt-1 uppercase tracking-tighter text-zinc-400">
                                {isCapturingFingerprint ? 'LEYENDO...' : fingerprintTemplate ? 'REGISTRADA' : 'SIN HUELLA'}
                            </span>
                        </div>

                        {/* Status message */}
                        {isCapturingFingerprint ? (
                            <p className="text-[10px] text-yellow-400 text-center font-tech mt-2 animate-pulse font-bold">
                                {fingerprintStatusText}
                            </p>
                        ) : fingerprintTemplate ? (
                            <div className="flex items-center gap-1.5 mt-2 text-emerald-400 text-[10px] font-tech font-bold uppercase">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                                DIGITALPERSONA ACTIVA
                            </div>
                        ) : (
                            <p className="text-[10px] text-zinc-500 text-center font-tech mt-2 uppercase">
                                Coloque el dedo sobre el sensor óptico
                            </p>
                        )}
                    </div>

                    {/* Authorization indicator for non-admin staff */}
                    {!isBiometricAuthorized ? (
                        <div className="w-full bg-zinc-900 border border-zinc-800 p-2.5 rounded text-left">
                            <p className="text-[9px] font-tech font-bold text-zinc-400 uppercase leading-tight flex items-center gap-1.5">
                                <span>🔒</span> GESTIÓN DESACTIVADA
                            </p>
                            <p className="text-[8px] text-zinc-500 font-mono-tech mt-1 leading-tight">
                                Tu perfil de Coach no tiene autorización activa del Administrador para capturar o eliminar huellas.
                            </p>
                        </div>
                    ) : userRole !== UserRole.ADMIN ? (
                        <div className="w-full bg-emerald-950/30 border border-emerald-600/30 px-2 py-1 rounded flex items-center justify-between text-left">
                            <span className="text-[9px] font-tech text-emerald-400 uppercase font-bold flex items-center gap-1">
                                <span>✓</span> GESTIÓN AUTORIZADA
                            </span>
                            <span className="text-[8px] font-mono-tech text-emerald-500/80">STAFF OK</span>
                        </div>
                    ) : null}

                    {/* Actions */}
                    {isCapturingFingerprint ? (
                        <button
                            type="button"
                            onClick={handleCancelFingerprintCapture}
                            className="w-full bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white border border-red-800 text-[10px] font-tech font-bold uppercase py-2 rounded transition-all active:scale-95"
                        >
                            CANCELAR CAPTURA
                        </button>
                    ) : showDeleteFingerprintConfirm ? (
                        <div className="w-full bg-red-950/40 border border-red-800 p-2.5 rounded-lg flex flex-col gap-2">
                            <p className="text-[10px] text-red-300 font-tech uppercase text-center font-bold">
                                ¿ELIMINAR HUELLA DEL SOCIO?
                            </p>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={handleDeleteFingerprint}
                                    className="flex-1 bg-red-600 hover:bg-red-700 text-white text-[9px] font-tech font-bold uppercase py-1.5 rounded transition-all cursor-pointer"
                                >
                                    SÍ, ELIMINAR
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowDeleteFingerprintConfirm(false)}
                                    className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[9px] font-tech font-bold uppercase py-1.5 rounded transition-all cursor-pointer"
                                >
                                    NO
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="w-full flex flex-col gap-1.5">
                            <button
                                type="button"
                                disabled={!isBiometricAuthorized}
                                onClick={requestFingerprintCapture}
                                className={`w-full font-tech font-bold uppercase text-[10px] py-2.5 rounded flex items-center justify-center gap-1.5 transition-all shadow-md ${
                                    !isBiometricAuthorized
                                        ? 'bg-zinc-900 text-zinc-600 border border-zinc-800 cursor-not-allowed opacity-40'
                                        : fingerprintTemplate
                                            ? 'bg-zinc-800 hover:bg-zinc-700 text-yellow-400 border border-zinc-700 active:scale-95 cursor-pointer'
                                            : 'bg-yellow-500 hover:bg-yellow-400 text-black border border-yellow-600 active:scale-95 cursor-pointer'
                                }`}
                                title={!isBiometricAuthorized ? "Gestión de huellas desactivada por el Administrador" : undefined}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                                </svg>
                                {fingerprintTemplate ? 'ACTUALIZAR HUELLA' : 'REGISTRAR HUELLA'}
                            </button>

                            {fingerprintTemplate && (
                                <button
                                    type="button"
                                    disabled={!isBiometricAuthorized}
                                    onClick={requestFingerprintDelete}
                                    className={`w-full text-[9px] font-tech font-bold uppercase py-1.5 rounded transition-all flex items-center justify-center gap-1 border ${
                                        !isBiometricAuthorized
                                            ? 'bg-zinc-900 text-zinc-600 border-zinc-800 cursor-not-allowed opacity-40'
                                            : 'bg-zinc-900 hover:bg-red-950/40 text-zinc-400 hover:text-red-400 border-zinc-800 hover:border-red-900 active:scale-95 cursor-pointer'
                                    }`}
                                    title={!isBiometricAuthorized ? "Gestión de huellas desactivada por el Administrador" : undefined}
                                >
                                    ELIMINAR HUELLA
                                </button>
                            )}
                        </div>
                    )}

                    {!isElectronEnvironment() && (
                        <p className="text-[8px] text-zinc-500 font-mono-tech text-center mt-1">
                            * Captura física mediante USB activa en la app de escritorio Windows.
                        </p>
                    )}
                </div>
            </div>

            <div className="flex-1 p-6 overflow-y-auto bg-zinc-950/50">
                <div className="flex flex-wrap justify-between items-center gap-3 mb-6 border-b border-zinc-800 pb-4">
                    <h2 className="text-2xl font-tech font-bold text-white">
                        {isNew ? 'NUEVO REGISTRO' : `EDITANDO: ${client.firstName.toUpperCase()}`}
                    </h2>
                    <div className="flex items-center gap-3">
                        {!isNew && onShowQr && (
                            <button
                                type="button"
                                onClick={() => onShowQr(client)}
                                className="bg-yellow-500/15 hover:bg-yellow-500 text-yellow-400 hover:text-black border border-yellow-500/60 font-tech font-bold uppercase text-xs px-3.5 py-1.5 rounded-lg flex items-center gap-2 transition-all cursor-pointer active:scale-95 shadow-sm"
                                title="Abrir Pase QR Digital del Socio"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                                </svg>
                                <span>PASE QR</span>
                            </button>
                        )}
                        <button type="button" onClick={handleClose} className="text-zinc-500 hover:text-white text-lg px-1">✕</button>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className={labelStyle}>NOMBRE(S)</label>
                            <input value={formData.firstName} onChange={e => setFormData({...formData, firstName: e.target.value})} className={inputStyle} required />
                        </div>
                        <div>
                            <label className={labelStyle}>APELLIDO PATERNO</label>
                            <input value={formData.lastNamePaternal} onChange={e => setFormData({...formData, lastNamePaternal: e.target.value})} className={inputStyle} required />
                        </div>
                        <div>
                            <label className={labelStyle}>APELLIDO MATERNO</label>
                            <input value={formData.lastNameMaternal} onChange={e => setFormData({...formData, lastNameMaternal: e.target.value})} className={inputStyle} />
                        </div>
                        <div>
                            <label className={labelStyle}>TELÉFONO (WHATSAPP)</label>
                            <input type="tel" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className={inputStyle} placeholder="10 Dígitos" />
                        </div>
                    </div>

                    <div className="border-t border-zinc-800 pt-4">
                        {!isNew && (
                            <div className="mb-6 bg-zinc-900/20 border border-zinc-800 rounded-lg p-4">
                                <p className="text-yellow-500 font-tech text-sm mb-4 uppercase tracking-widest font-bold">
                                    Membresías / Disciplinas Activas
                                </p>
                                {existingSubscriptions.length === 0 ? (
                                    <div className="text-zinc-500 text-xs uppercase tracking-wider font-tech text-center py-4">
                                        No tiene disciplinas activas registradas.
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {existingSubscriptions.map(sub => {
                                            const act = activities.find(a => a.id === sub.activity_id);
                                            const pkg = packages.find(p => p.id === sub.package_id);
                                            const isExpired = new Date(sub.endDate).getTime() < new Date().setHours(0,0,0,0);
                                            return (
                                                <div key={sub.id} className="flex items-center justify-between bg-zinc-950 border border-zinc-800/80 p-3 rounded hover:border-yellow-500/20 transition-all">
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-tech text-xs font-bold text-white uppercase tracking-wider">
                                                                {act?.name || 'Disciplina Desconocida'}
                                                            </p>
                                                            <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold ${isExpired ? 'bg-red-950 text-red-400 border border-red-900' : 'bg-emerald-950 text-emerald-400 border border-emerald-900'}`}>
                                                                {isExpired ? 'VENCIDA' : 'ACTIVA'}
                                                            </span>
                                                        </div>
                                                        <p className="text-[10px] text-yellow-500 uppercase font-mono-tech mt-0.5">
                                                            Plan: {pkg?.name || 'Clase Suelta / Visita'}
                                                        </p>
                                                        <p className="text-[10px] text-zinc-500 uppercase font-mono-tech">
                                                            Vigencia: {sub.startDate} al {sub.endDate}
                                                        </p>
                                                    </div>
                                                    <div className="flex items-center gap-4">
                                                        <span className="font-mono-tech font-bold text-xs text-emerald-400">${sub.amount}</span>
                                                        {!isMembershipEditAuthorized ? (
                                                            <button
                                                                type="button"
                                                                disabled
                                                                className="bg-zinc-900 text-zinc-600 border border-zinc-800 font-tech text-[9px] font-bold uppercase px-2.5 py-1.5 rounded cursor-not-allowed opacity-50 flex items-center gap-1"
                                                                title="No tienes permiso para dar de baja membresías"
                                                            >
                                                                🔒 BLOQUEADO
                                                            </button>
                                                        ) : subPendingDeleteId === sub.id ? (
                                                            <div className="flex items-center gap-1.5">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setSubPendingDeleteId(null);
                                                                        handleDeleteExistingSubscription(sub, act?.name || 'Disciplina');
                                                                    }}
                                                                    className="bg-red-600 hover:bg-red-700 text-white font-tech text-[9px] font-bold uppercase px-2.5 py-1.5 rounded transition-all active:scale-95 cursor-pointer"
                                                                >
                                                                    CONFIRMAR
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setSubPendingDeleteId(null)}
                                                                    className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-tech text-[9px] font-bold uppercase px-2 py-1.5 rounded border border-zinc-700 transition-all active:scale-95 cursor-pointer"
                                                                >
                                                                    NO
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => setSubPendingDeleteId(sub.id)}
                                                                className="bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white border border-red-900 hover:border-red-600 font-tech text-[10px] font-bold uppercase px-3 py-1.5 rounded transition-all active:scale-95 cursor-pointer"
                                                                title="Dar de baja esta disciplina"
                                                            >
                                                                DAR DE BAJA
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                            <p className="text-yellow-500 font-tech text-sm uppercase tracking-widest font-bold">
                                {isNew ? 'PLANES Y DISCIPLINAS POR REGISTRAR' : 'MEMBRESÍA Y PLAN'}
                            </p>
                            {!isMembershipEditAuthorized && (
                                <span className="text-[10px] font-tech font-bold uppercase px-2.5 py-1 rounded bg-red-950/60 text-red-400 border border-red-800/80 flex items-center gap-1.5">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                    </svg>
                                    EDICIÓN BLOQUEADA POR EL ADMINISTRADOR
                                </span>
                            )}
                        </div>
                        
                        {/* INPUT SELECTION SECTION */}
                        <div className={`bg-zinc-900/40 border border-zinc-800/80 p-4 rounded-lg mb-4 space-y-4 ${!isMembershipEditAuthorized ? 'opacity-65 select-none' : ''}`}>
                            <div className="flex items-center justify-between">
                                <p className="text-zinc-400 text-[10px] font-tech uppercase tracking-wider font-bold">
                                    {isNew ? 'Selecciona una Disciplina y su Plan para agregarlo:' : 'Información del Plan:'}
                                </p>
                                {!isMembershipEditAuthorized && (
                                    <span className="text-[9px] font-mono-tech text-zinc-500">
                                        * Solo lectura para tu perfil
                                    </span>
                                )}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className={labelStyle}>1. DISCIPLINA / ACTIVIDAD</label>
                                    <select 
                                        value={formData.activity_id || ''} 
                                        onChange={e => handleActivityChange(e.target.value)} 
                                        className={inputStyle}
                                        disabled={!isMembershipEditAuthorized}
                                    >
                                        <option value="">-- SELECCIONAR --</option>
                                        {activities.map(a => (
                                            <option key={a.id} value={a.id}>{a.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className={labelStyle}>2. PLAN / PAQUETE</label>
                                    <select 
                                        value={formData.package_id || ''} 
                                        onChange={e => handlePackageChange(e.target.value)} 
                                        className={inputStyle}
                                        disabled={!formData.activity_id || !isMembershipEditAuthorized} 
                                    >
                                        <option value="">CLASE SUELTA / VISITA (Sin Plan)</option>
                                        {availablePackages.map(p => (
                                            <option key={p.id} value={p.id}>{p.name} - ${p.cost}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className={labelStyle}>FECHA INICIO</label>
                                    <input 
                                        type="date" 
                                        value={formData.membershipStart} 
                                        onChange={e => setFormData({...formData, membershipStart: e.target.value})} 
                                        className={inputStyle} 
                                        disabled={!isMembershipEditAuthorized}
                                    />
                                </div>
                                <div>
                                    <label className={labelStyle}>FECHA VENCIMIENTO</label>
                                    <input 
                                        type="date" 
                                        value={formData.membershipEnd} 
                                        onChange={e => setFormData({...formData, membershipEnd: e.target.value})} 
                                        className={inputStyle} 
                                        disabled={!isMembershipEditAuthorized}
                                    />
                                </div>
                            </div>

                            {isNew && (
                                <button
                                    type="button"
                                    onClick={handleAddSubscription}
                                    disabled={!formData.activity_id}
                                    className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-tech font-bold uppercase py-2.5 rounded text-xs flex items-center justify-center gap-2 transition-all active:scale-[98%] disabled:opacity-40 disabled:cursor-not-allowed shadow-md font-bold"
                                >
                                    <span>➕</span> AGREGAR DISCIPLINA Y PLAN A LA LISTA
                                </button>
                            )}
                        </div>

                        {/* LIST OF SELECTED SUBSCRIPTIONS */}
                        {isNew && (
                            <div className="mb-6">
                                <p className="text-zinc-500 font-tech text-[10px] uppercase tracking-wider font-bold mb-2">
                                    LISTA DE DISCIPLINAS A REGISTRAR:
                                </p>
                                {selectedSubscriptions.length === 0 ? (
                                    <div className="border border-dashed border-zinc-800 rounded p-4 text-center bg-black/10">
                                        <span className="text-zinc-500 font-tech text-xs uppercase tracking-wider">NINGUNA DISCIPLINA AGREGADA AÚN. SE ASOCIARÁ LA QUE TENGAS SELECCIONADA EN LOS SELECTORES DE ARRIBA AL REGISTRAR SOCIO.</span>
                                    </div>
                                ) : (
                                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                        {selectedSubscriptions.map((sub, idx) => (
                                            <div key={idx} className="flex items-center justify-between bg-zinc-900 border border-zinc-800 p-3 rounded hover:border-yellow-500/30 transition-all">
                                                <div>
                                                    <p className="font-tech text-xs font-bold text-white uppercase tracking-wider">{sub.activity_name}</p>
                                                    <p className="text-[10px] text-yellow-500 uppercase font-mono-tech font-medium">{sub.package_name}</p>
                                                    <p className="text-[10px] text-zinc-500 uppercase font-mono-tech mt-0.5">Vigencia: {sub.startDate} al {sub.endDate}</p>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <span className="font-mono-tech font-bold text-xs text-emerald-400">${sub.cost}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteSubscription(sub.activity_id)}
                                                        className="text-red-500 hover:text-red-400 font-tech text-xs font-bold uppercase p-1.5"
                                                        title="Eliminar"
                                                    >
                                                        ELIMINAR
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {(requiresCredential || formData.credentialExpiresAt || newCredentialBase64 || client.credentialUrl) && (
                            <div className="mb-6 border-2 border-yellow-500 rounded-lg p-4 bg-zinc-900/50 animate-[fadeIn_0.5s]">
                                <div className="flex justify-between items-center mb-4">
                                    <p className="text-yellow-500 font-tech font-bold uppercase tracking-widest text-sm flex items-center gap-2">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                                        </svg>
                                        EVIDENCIA / CREDENCIAL {requiresCredential && '(REQUERIDO)'}
                                    </p>
                                    <span className="text-[10px] text-yellow-500/60 font-mono-tech">
                                        {newCredentialBase64 ? 'IMAGEN NUEVA LISTA' : (client.credentialUrl ? 'IMAGEN REGISTRADA' : 'PENDIENTE')}
                                    </span>
                                </div>

                                <div className="flex flex-col md:flex-row gap-6">
                                    <div className="w-full md:w-1/2 aspect-video bg-black border-2 border-dashed border-zinc-700 flex items-center justify-center relative overflow-hidden group">
                                        {(newCredentialBase64 || client.credentialUrl) ? (
                                            <>
                                                <img src={newCredentialBase64 || client.credentialUrl!} className="w-full h-full object-contain" />
                                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity gap-4">
                                                     <p className="text-white font-bold text-xs">CLICK EN BOTONES PARA CAMBIAR</p>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-zinc-600 flex flex-col items-center">
                                                <span className="text-4xl mb-2">🆔</span>
                                                <span className="text-[10px] font-tech uppercase">SIN IMAGEN</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex-1 flex flex-col gap-3 justify-center">
                                        <div className="grid grid-cols-2 gap-3">
                                            <button type="button" onClick={() => openCamera('CREDENTIAL')} className="bg-yellow-500 text-black font-tech font-bold uppercase py-4 rounded text-xs hover:bg-yellow-400 flex flex-col items-center gap-2 shadow-lg transition-all active:scale-95">
                                                <span className="text-xl">📷</span>
                                                TOMAR FOTO
                                            </button>
                                            <button type="button" onClick={() => triggerFileUpload('CREDENTIAL')} className="bg-blue-600 text-white font-tech font-bold uppercase py-4 rounded text-xs hover:bg-blue-500 flex flex-col items-center gap-2 shadow-lg transition-all active:scale-95">
                                                <span className="text-xl">📂</span>
                                                SUBIR ARCHIVO
                                            </button>
                                        </div>

                                        {(newCredentialBase64 || client.credentialUrl) && (
                                            <button 
                                                type="button" 
                                                onClick={() => downloadImage(newCredentialBase64 || client.credentialUrl!, `credencial_${formData.firstName}_${formData.lastNamePaternal}`)} 
                                                className="w-full bg-emerald-600 text-white font-tech font-bold uppercase py-2.5 rounded text-xs hover:bg-emerald-500 flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 mt-1"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                                </svg>
                                                DESCARGAR EVIDENCIA / CREDENCIAL
                                            </button>
                                        )}

                                        <div className="mt-2">
                                            <label className={labelStyle}>VENCIMIENTO DEL DOCUMENTO</label>
                                            <input 
                                                type="date" 
                                                value={formData.credentialExpiresAt} 
                                                onChange={e => setFormData({...formData, credentialExpiresAt: e.target.value})} 
                                                className={`${inputStyle} border-yellow-500/30 focus:border-yellow-500`}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className={`grid grid-cols-1 gap-4 pt-2 ${!isMembershipEditAuthorized ? 'opacity-65 select-none' : ''}`}>
                             <div>
                                <label className={labelStyle}>COSTO TOTAL A COBRAR (Suma de todo)</label>
                                <input 
                                    type="number" 
                                    value={formData.cost} 
                                    onChange={e => setFormData({...formData, cost: parseFloat(e.target.value) || 0})} 
                                    className={`${inputStyle} text-emerald-400 font-bold border-emerald-500/30 text-lg`} 
                                    disabled={!isMembershipEditAuthorized}
                                />
                            </div>
                        </div>

                        <div className={`mt-4 bg-zinc-900 p-3 border border-zinc-700 flex items-center justify-between ${!isMembershipEditAuthorized ? 'opacity-50 select-none' : ''}`}>
                            <label className={`flex items-center gap-3 select-none ${isMembershipEditAuthorized ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                                <input 
                                    type="checkbox" 
                                    checked={addEnrollmentFee} 
                                    onChange={handleEnrollmentChange}
                                    disabled={!isMembershipEditAuthorized}
                                    className="w-5 h-5 accent-yellow-500 bg-zinc-800 border-zinc-600 disabled:cursor-not-allowed"
                                />
                                <span className={`font-tech text-xs font-bold uppercase tracking-wider ${addEnrollmentFee ? 'text-yellow-500' : 'text-zinc-500'}`}>
                                    COBRAR INSCRIPCIÓN (+ ${ENROLLMENT_AMOUNT})
                                </span>
                            </label>
                            {addEnrollmentFee && (
                                <span className="text-[10px] text-zinc-400 font-mono-tech hidden sm:block">
                                    SE SUMA AL COSTO FINAL
                                </span>
                            )}
                        </div>
                    </div>

                    <div className="pt-6 flex gap-4">
                         <button type="button" onClick={handleClose} className="flex-1 bg-zinc-800 text-white font-tech font-bold uppercase py-3 border border-zinc-600 hover:bg-zinc-700 text-xs" disabled={isLoading}>
                            CANCELAR
                         </button>
                         <button type="submit" className={btnPrimary} disabled={isLoading}>
                            {isLoading ? 'GUARDANDO...' : (isNew ? 'REGISTRAR SOCIO' : 'GUARDAR CAMBIOS')}
                         </button>
                    </div>
                </form>
            </div>
        </div>

        {/* MODAL CONFIRMAR Y GUARDAR HUELLA BIOMÉTRICA */}
        {showConfirmFingerprintModal && (
          <div className="fixed inset-0 z-[250] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]">
            <div 
              className="bg-zinc-950 border-2 border-emerald-500 w-full max-w-md p-6 rounded-2xl shadow-[0_0_60px_rgba(16,185,129,0.3)] relative flex flex-col items-center text-center"
              onClick={e => e.stopPropagation()}
            >
              {/* Header Icon */}
              <div className="w-20 h-20 rounded-2xl bg-emerald-950/40 border-2 border-emerald-500/80 flex items-center justify-center mb-4 shadow-[0_0_25px_rgba(16,185,129,0.4)] relative">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m12 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17" />
                </svg>
                <div className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-emerald-500 text-black flex items-center justify-center text-xs font-black shadow-lg">
                  ✓
                </div>
              </div>

              {/* Title & Client Name */}
              <p className="text-[10px] font-mono-tech text-emerald-400 font-bold uppercase tracking-widest mb-1">
                LECTURA BIOMÉTRICA EXITOSA
              </p>
              <h3 className="text-xl font-tech font-black text-white uppercase tracking-tight mb-1">
                {fingerprintTemplate ? '¿CONFIRMAR ACTUALIZACIÓN DE HUELLA?' : '¿CONFIRMAR REGISTRO DE HUELLA?'}
              </h3>
              
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 my-3 w-full flex items-center justify-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 overflow-hidden flex items-center justify-center shrink-0">
                  {(newPhotoBase64 || client.photoUrl) ? (
                    <img src={newPhotoBase64 || client.photoUrl!} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs">👤</span>
                  )}
                </div>
                <div className="text-left">
                  <p className="text-xs font-tech font-bold text-white uppercase leading-none">
                    {formData.firstName || client.firstName || 'SOCIO'} {formData.lastNamePaternal || client.lastNamePaternal || ''}
                  </p>
                  <p className="text-[9px] font-mono-tech text-zinc-400 mt-0.5">
                    Sensor DigitalPersona U.are.U 4500
                  </p>
                </div>
              </div>

              <p className="text-xs font-mono-tech text-zinc-300 leading-relaxed mb-6">
                {fingerprintTemplate 
                  ? 'Se ha escaneado una nueva muestra biométrica en el sensor. Al confirmar, se reemplazará la huella anterior y quedará guardada de inmediato.' 
                  : 'Se ha capturado correctamente la huella dactilar. Al confirmar, quedará guardada y vinculada al socio para el acceso.'}
              </p>

              {/* Action Buttons */}
              <div className="flex gap-3 w-full">
                <button
                  type="button"
                  onClick={handleCancelPendingFingerprint}
                  disabled={isSavingFingerprint}
                  className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-700 py-3 rounded-xl font-tech font-bold uppercase text-xs transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  CANCELAR
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAndSaveFingerprint}
                  disabled={isSavingFingerprint}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400 py-3 rounded-xl font-tech font-black uppercase text-xs transition-all active:scale-95 shadow-[0_0_20px_rgba(16,185,129,0.4)] flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {isSavingFingerprint ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      GUARDANDO...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      CONFIRMAR Y GUARDAR
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

    </div>
  );
};

export default EditClientModal;
