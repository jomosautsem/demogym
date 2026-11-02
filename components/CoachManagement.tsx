import React, { useState, useEffect } from 'react';
import {
  getSystemUsers,
  addSystemUser,
  updateSystemUser,
  deleteSystemUser,
  getActivities,
  getPackages,
  generateInviteTokenString,
  buildStaffInvitationLink,
  sendSupabaseStaffInvitationEmail
} from '../services/storage';
import { SystemUser, UserRole, Activity, Package } from '../types';
import { useToast } from '../context/ToastContext';
import ConfirmationModal from './ConfirmationModal';

interface ActiveInvitationState {
  userName: string;
  userEmail: string;
  userRole: UserRole;
  inviteLink: string;
  emailSent: boolean;
  emailWarning?: string;
  whatsappPhone: string;
}

const CoachManagement: React.FC = () => {
  const { showToast } = useToast();
  const [admins, setAdmins] = useState<SystemUser[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creationMode, setCreationMode] = useState<'INVITE' | 'MANUAL'>('INVITE');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.COACH);
  const [isActive, setIsActive] = useState(true);
  const [selectedActivities, setSelectedActivities] = useState<Set<string>>(new Set());
  const [selectedPackages, setSelectedPackages] = useState<Set<string>>(new Set());
  const [canRenew, setCanRenew] = useState(false);
  const [canManageFingerprints, setCanManageFingerprints] = useState(false);
  const [canEditMembership, setCanEditMembership] = useState(false);
  
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hybrid Invitation Modal State
  const [activeInvitation, setActiveInvitation] = useState<ActiveInvitationState | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isResendingEmail, setIsResendingEmail] = useState(false);

  // Confirmation Modal State for Deletion
  const [userToDelete, setUserToDelete] = useState<SystemUser | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const currentUserName = localStorage.getItem('userName');

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [usersData, activitiesData, packagesData] = await Promise.all([
          getSystemUsers(),
          getActivities(),
          getPackages()
      ]);
      setAdmins(usersData);
      setActivities(activitiesData);
      setPackages(packagesData);
    } catch (e: any) {
      showToast("Error cargando usuarios: " + (e.message || 'Error desconocido'), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setCreationMode('INVITE');
    setName('');
    setEmail('');
    setPassword('');
    setWhatsappNumber('');
    setRole(UserRole.COACH);
    setIsActive(true);
    setSelectedActivities(new Set());
    setSelectedPackages(new Set());
    setCanRenew(false);
    setCanManageFingerprints(false);
    setCanEditMembership(false);
    setError(null);
  };

  const handleEdit = (user: SystemUser) => {
    setEditingId(user.id);
    setName(user.name);
    setEmail(user.email);
    setPassword(''); // No mostrar contraseña hasheada
    setRole(user.role);
    setIsActive(user.is_active);
    setSelectedActivities(new Set(user.allowed_activity_ids || []));
    setSelectedPackages(new Set(user.allowed_package_ids || []));
    setCanRenew(user.can_renew || false);
    setCanManageFingerprints(user.can_manage_fingerprints || false);
    setCanEditMembership(user.can_edit_membership || false);
    setError(null);
  };

  const handleRequestDelete = (user: SystemUser) => {
    setUserToDelete(user);
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    setIsDeleting(true);
    try {
      await deleteSystemUser(userToDelete.id);
      showToast(`Usuario "${userToDelete.name}" eliminado correctamente`, 'info');
      setUserToDelete(null);
      fetchData();
    } catch (e: any) {
      showToast('Error al eliminar usuario: ' + (e.message || 'Error en servidor'), 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  // Generar invitación híbrida para un usuario existente en la lista
  const handleSendInvitationForUser = async (user: SystemUser) => {
    setIsSaving(true);
    try {
      const token = user.password?.startsWith('INVITE_TOKEN::')
        ? user.password
        : generateInviteTokenString();
      const inviteLink = buildStaffInvitationLink(
        { id: user.id, email: user.email, name: user.name },
        token
      );

      const emailResult = await sendSupabaseStaffInvitationEmail(
        user.email,
        user.name,
        inviteLink
      );

      setCopiedLink(false);
      setActiveInvitation({
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        inviteLink,
        emailSent: emailResult.sent,
        emailWarning: emailResult.warning,
        whatsappPhone: ''
      });

      if (emailResult.sent) {
        showToast(`Correo de invitación enviado a ${user.email} y enlace generado`, 'success');
      } else {
        showToast('Enlace directo de activación generado (listo para WhatsApp)', 'info');
      }
    } catch (err: any) {
      showToast('Error generando invitación: ' + (err.message || 'Error desconocido'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResendInvitationEmail = async () => {
    if (!activeInvitation || isResendingEmail) return;
    setIsResendingEmail(true);
    try {
      const res = await sendSupabaseStaffInvitationEmail(
        activeInvitation.userEmail,
        activeInvitation.userName,
        activeInvitation.inviteLink
      );
      setActiveInvitation({
        ...activeInvitation,
        emailSent: res.sent,
        emailWarning: res.warning
      });
      if (res.sent) {
        showToast(`Correo reenviado exitosamente a ${activeInvitation.userEmail}`, 'success');
      } else {
        showToast(res.warning || 'Usa el enlace directo por WhatsApp', 'warning');
      }
    } finally {
      setIsResendingEmail(false);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!activeInvitation) return;
    try {
      await navigator.clipboard.writeText(activeInvitation.inviteLink);
      setCopiedLink(true);
      showToast('ENLACE DE ACTIVACIÓN COPIADO AL PORTAPAPELES', 'success');
      setTimeout(() => setCopiedLink(false), 3500);
    } catch {
      showToast('No se pudo copiar automáticamente, selecciona y copia el texto.', 'warning');
    }
  };

  const getWhatsAppShareUrl = (inv: ActiveInvitationState): string => {
    const cleanDigits = inv.whatsappPhone.replace(/\D/g, '');
    const formattedPhone = cleanDigits.length === 10 ? `52${cleanDigits}` : cleanDigits;
    const message =
      `Hola *${inv.userName}* 👋\n\n` +
      `Has sido invitado a colaborar en *KALI ACCESS* con el rol de *${inv.userRole}*.\n\n` +
      `🔑 Haz clic en el siguiente enlace para activar tu cuenta y crear tu contraseña personal:\n` +
      `${inv.inviteLink}\n\n` +
      `📧 Usuario de acceso: ${inv.userEmail}`;

    const encodedMsg = encodeURIComponent(message);
    return formattedPhone
      ? `https://wa.me/${formattedPhone}?text=${encodedMsg}`
      : `https://wa.me/?text=${encodedMsg}`;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    setIsSaving(true);
    try {
      const allowed_activity_ids = Array.from(selectedActivities) as string[];
      const allowed_package_ids = Array.from(selectedPackages) as string[];

      if (editingId) {
        // Update
        const updates: Partial<SystemUser> = { 
            name, 
            email, 
            role, 
            is_active: isActive, 
            allowed_activity_ids, 
            allowed_package_ids, 
            can_renew: canRenew,
            can_manage_fingerprints: canManageFingerprints,
            can_edit_membership: canEditMembership
        };
        if (password.trim()) {
            updates.password = password;
        }
        await updateSystemUser(editingId, updates);
        
        // Update local storage if self-edited or matches active session
        const currentStoredEmail = localStorage.getItem('userEmail');
        const currentStoredName = localStorage.getItem('userName');
        const isCurrentActiveUser = 
            (currentStoredEmail && email && currentStoredEmail.toLowerCase().trim() === email.toLowerCase().trim()) ||
            (currentStoredName && name && currentStoredName.toLowerCase().trim() === name.toLowerCase().trim());

        if (name !== currentUserName && editingId && admins.find(a => a.id === editingId)?.name === currentUserName) {
            localStorage.setItem('userName', name);
        }

        if (isCurrentActiveUser) {
            localStorage.setItem('canManageFingerprints', JSON.stringify(canManageFingerprints));
            localStorage.setItem('canRenew', JSON.stringify(canRenew));
            localStorage.setItem('canEditMembership', JSON.stringify(canEditMembership));
        }

        // Emitir evento para actualización instantánea en todos los módulos abiertos
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('kali_staff_perms_changed', {
                detail: { 
                    userId: editingId, 
                    email: email.toLowerCase().trim(), 
                    permissions: { 
                        can_manage_fingerprints: canManageFingerprints, 
                        can_renew: canRenew,
                        can_edit_membership: canEditMembership
                    } 
                }
            }));
        }

        showToast('PERMISOS DE STAFF ACTUALIZADOS CORRECTAMENTE', 'success');
      } else {
        // Create new user: either Hybrid Invite mode or Manual Password mode
        if (creationMode === 'MANUAL') {
          if (!password || password.trim().length < 4) {
            showToast("Ingresa una contraseña válida o usa el modo 'Invitar Usuario'.", 'warning');
            setIsSaving(false);
            return;
          }
          await addSystemUser({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            password: password.trim(),
            role, 
            is_active: isActive,
            allowed_activity_ids,
            allowed_package_ids,
            can_renew: canRenew,
            can_manage_fingerprints: canManageFingerprints,
            can_edit_membership: canEditMembership
          });
          showToast('USUARIO CREADO CON CONTRASEÑA MANUAL', 'success');
        } else {
          // MODO INVITACIÓN HÍBRIDA (Correo Automático + Link Directo / WhatsApp)
          const inviteToken = generateInviteTokenString();
          const createdUser = await addSystemUser({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            password: inviteToken,
            role,
            is_active: isActive,
            allowed_activity_ids,
            allowed_package_ids,
            can_renew: canRenew,
            can_manage_fingerprints: canManageFingerprints,
            can_edit_membership: canEditMembership
          });

          const inviteLink = buildStaffInvitationLink(
            { id: createdUser.id, email: createdUser.email, name: createdUser.name },
            inviteToken
          );

          const emailResult = await sendSupabaseStaffInvitationEmail(
            createdUser.email,
            createdUser.name,
            inviteLink
          );

          setCopiedLink(false);
          setActiveInvitation({
            userName: createdUser.name,
            userEmail: createdUser.email,
            userRole: createdUser.role,
            inviteLink,
            emailSent: emailResult.sent,
            emailWarning: emailResult.warning,
            whatsappPhone: whatsappNumber.trim()
          });

          showToast(
            emailResult.sent
              ? '¡USUARIO REGISTRADO! CORREO ENVIADO Y LINK DE WHATSAPP LISTO'
              : '¡USUARIO REGISTRADO! LINK DIRECTO DE ACTIVACIÓN LISTO',
            'success'
          );
        }
      }
      resetForm();
      fetchData();
    } catch (err: any) {
      if (err.message && err.message.includes("Falta columna 'allowed_package_ids'")) {
          showToast("GUARDADO PARCIAL: Base de datos desactualizada. Ver detalles en consola.", 'warning');
          setError(`ATENCIÓN: ${err.message}`);
          resetForm();
          fetchData();
          return;
      }
      showToast("Error al guardar: " + (err.message || 'Error desconocido'), 'error');
    } finally {
        setIsSaving(false);
    }
  };

  const toggleActivity = (id: string) => {
      const newSet = new Set(selectedActivities);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedActivities(newSet);
  };

  const togglePackage = (id: string) => {
      const newSet = new Set(selectedPackages);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedPackages(newSet);
  };

  const labelStyle = "block text-xs font-tech text-yellow-500/80 mb-2 uppercase tracking-widest";
  const inputStyle = "w-full bg-black/50 border-2 border-zinc-700 px-4 py-3 text-white focus:border-yellow-500 outline-none font-mono-tech";
  const btnPrimary = "bg-yellow-500 text-black font-tech font-bold uppercase tracking-widest px-6 py-3 hover:bg-yellow-400 active:translate-y-1 active:shadow-none transition-all shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)] border-2 border-yellow-600 cursor-pointer";
  const btnSecondary = "bg-zinc-800 text-yellow-500 font-tech font-bold uppercase tracking-widest px-6 py-3 hover:bg-zinc-700 active:translate-y-1 active:shadow-none transition-all border-2 border-zinc-600 cursor-pointer";

  return (
    <div className="max-w-5xl mx-auto animate-[fadeIn_0.5s_ease-out]">
      <h2 className="text-3xl font-tech font-bold mb-8 text-white">GESTIÓN DE <span className="text-yellow-500">STAFF</span></h2>

      {/* FORMULARIO */}
      <div className="bg-zinc-900/50 border border-zinc-800 p-8 shadow-2xl mb-12 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-yellow-500/5 rounded-full blur-3xl"></div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 border-b border-zinc-800 pb-4">
          <h3 className="text-xl font-tech font-bold text-white">
              {editingId ? `EDITANDO: ${name.toUpperCase()}` : 'REGISTRAR NUEVO MIEMBRO'}
          </h3>

          {/* SELECTOR DE MODO AL CREAR USUARIO */}
          {!editingId && (
            <div className="inline-flex bg-black border border-zinc-700 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setCreationMode('INVITE')}
                className={`px-3.5 py-2 rounded-lg font-tech font-bold text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 ${
                  creationMode === 'INVITE'
                    ? 'bg-yellow-500 text-black shadow-[0_0_15px_rgba(234,179,8,0.3)]'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <span>✉️</span>
                <span>INVITAR (CORREO + WHATSAPP)</span>
              </button>
              <button
                type="button"
                onClick={() => setCreationMode('MANUAL')}
                className={`px-3.5 py-2 rounded-lg font-tech font-bold text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 ${
                  creationMode === 'MANUAL'
                    ? 'bg-yellow-500 text-black shadow-[0_0_15px_rgba(234,179,8,0.3)]'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <span>🔑</span>
                <span>CONTRASEÑA MANUAL</span>
              </button>
            </div>
          )}
        </div>

        {!editingId && creationMode === 'INVITE' && (
          <div className="mb-6 p-4 rounded-xl bg-yellow-950/30 border border-yellow-500/40 flex items-start gap-3">
            <span className="text-yellow-400 text-lg shrink-0">🚀</span>
            <div className="text-xs font-mono-tech text-zinc-200 leading-relaxed">
              <span className="text-yellow-300 font-bold font-tech uppercase tracking-wider block mb-0.5">
                Invitación Híbrida Activa (Sin entrar a Supabase):
              </span>
              Al registrar al miembro del staff, el sistema <strong>enviará automáticamente el correo de activación</strong> y te mostrará una tarjeta con el <strong>enlace directo para enviárselo por WhatsApp</strong>. El usuario abrirá el enlace y creará su propia contraseña.
            </div>
          </div>
        )}
        
        {error && <div className="bg-red-900/20 border border-red-500 text-red-400 p-4 mb-4 text-sm font-mono-tech">{error}</div>}

        <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
                <label className={labelStyle}>NOMBRE COMPLETO</label>
                <input value={name} onChange={e => setName(e.target.value)} className={inputStyle} placeholder="Ej. Roberto Sánchez" required />
            </div>
            <div>
                <label className={labelStyle}>CORREO ELECTRÓNICO (LOGIN)</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputStyle} placeholder="ejemplo@correo.com" required />
            </div>

            {(editingId || creationMode === 'MANUAL') ? (
              <div>
                  <label className={labelStyle}>
                    CONTRASEÑA {editingId && '(DEJAR EN BLANCO PARA MANTENER)'}
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className={inputStyle}
                    placeholder={editingId ? '********' : 'Mínimo 6 caracteres'}
                    required={!editingId && creationMode === 'MANUAL'}
                  />
              </div>
            ) : (
              <div>
                  <label className={labelStyle}>TELÉFONO WHATSAPP (OPCIONAL PARA ENVIAR LINK)</label>
                  <input
                    type="tel"
                    value={whatsappNumber}
                    onChange={e => setWhatsappNumber(e.target.value)}
                    className={inputStyle}
                    placeholder="Ej. 7771234567 (Opcional)"
                  />
              </div>
            )}

            <div>
                <label className={labelStyle}>ROL DE SISTEMA</label>
                <select value={role} onChange={e => setRole(e.target.value as UserRole)} className={inputStyle}>
                    <option value={UserRole.COACH}>COACH (ACCESO LIMITADO)</option>
                    <option value={UserRole.ADMIN}>ADMIN (ACCESO TOTAL)</option>
                    <option value={UserRole.MONITOR}>MONITOR (SOLO LECTURA/QR)</option>
                </select>
            </div>
            
            <div className="md:col-span-2 flex items-center gap-4 bg-black/30 p-4 border border-zinc-700">
                 <label className="flex items-center gap-3 cursor-pointer">
                    <div className={`w-6 h-6 border-2 flex items-center justify-center transition-all ${isActive ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-500'}`}>
                        {isActive && <span className="text-black font-bold">✓</span>}
                    </div>
                    <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="hidden" />
                    <span className={`font-tech font-bold text-sm ${isActive ? 'text-white' : 'text-zinc-500'}`}>USUARIO ACTIVO (PUEDE INICIAR SESIÓN)</span>
                </label>
            </div>

            {/* PERMISOS ESPECÍFICOS PARA MONITORES Y COACHES */}
            {role !== UserRole.ADMIN && (
                <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    
                    {/* ACTIVIDADES */}
                    <div className="bg-black/20 p-4 border border-zinc-700">
                        <h4 className="text-yellow-500 font-tech font-bold text-xs uppercase mb-3">PERMISOS: ACTIVIDADES / CLASES</h4>
                        <div className="max-h-40 overflow-y-auto space-y-2 custom-scrollbar">
                            {activities.map(act => (
                                <label key={act.id} className="flex items-center gap-2 cursor-pointer hover:bg-white/5 p-1">
                                    <input 
                                        type="checkbox" 
                                        checked={selectedActivities.has(act.id)} 
                                        onChange={() => toggleActivity(act.id)}
                                        className="accent-yellow-500"
                                    />
                                    <span className={`text-xs font-mono-tech ${selectedActivities.has(act.id) ? 'text-white' : 'text-zinc-500'}`}>{act.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* PAQUETES */}
                    <div className="bg-black/20 p-4 border border-zinc-700">
                        <h4 className="text-yellow-500 font-tech font-bold text-xs uppercase mb-3">PERMISOS: PAQUETES</h4>
                        <div className="max-h-40 overflow-y-auto space-y-2 custom-scrollbar">
                            {packages.map(pkg => (
                                <label key={pkg.id} className="flex items-center gap-2 cursor-pointer hover:bg-white/5 p-1">
                                    <input 
                                        type="checkbox" 
                                        checked={selectedPackages.has(pkg.id)} 
                                        onChange={() => togglePackage(pkg.id)}
                                        className="accent-yellow-500"
                                    />
                                    <span className={`text-xs font-mono-tech ${selectedPackages.has(pkg.id) ? 'text-white' : 'text-zinc-500'}`}>{pkg.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* PERMISO RENOVACIÓN */}
                    <div className="md:col-span-2 bg-black/20 p-4 border border-zinc-700">
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={canRenew} 
                                onChange={e => setCanRenew(e.target.checked)} 
                                className="w-5 h-5 accent-yellow-500"
                            />
                            <span className={`font-tech font-bold text-sm ${canRenew ? 'text-emerald-400' : 'text-zinc-500'}`}>
                                PERMITIR RENOVAR MEMBRESÍAS / COBRAR
                            </span>
                        </label>
                        <p className="text-[10px] text-zinc-600 mt-1 ml-8">Si está marcado, este usuario podrá registrar pagos de renovación.</p>
                    </div>

                    {/* PERMISO GESTIÓN DE HUELLAS BIOMÉTRICAS (OPCIÓN 2) */}
                    <div className="md:col-span-2 bg-black/20 p-4 border border-yellow-500/30">
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={canManageFingerprints} 
                                onChange={e => setCanManageFingerprints(e.target.checked)} 
                                className="w-5 h-5 accent-yellow-500"
                            />
                            <span className={`font-tech font-bold text-sm ${canManageFingerprints ? 'text-yellow-400' : 'text-zinc-500'}`}>
                                AUTORIZAR GESTIÓN DE HUELLAS (CAPTURAR / ACTUALIZAR / ELIMINAR)
                            </span>
                        </label>
                        <p className="text-[10px] text-zinc-400 mt-1 ml-8">
                            Si el Administrador lo marca, este miembro del staff tendrá autorización para registrar, actualizar o borrar huellas DigitalPersona en los perfiles de los socios.
                        </p>
                    </div>

                    {/* PERMISO EDITAR MEMBRESÍA Y PLAN EN PERFIL DE CLIENTES */}
                    <div className="md:col-span-2 bg-black/20 p-4 border border-cyan-500/30">
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={canEditMembership} 
                                onChange={e => setCanEditMembership(e.target.checked)} 
                                className="w-5 h-5 accent-yellow-500"
                            />
                            <span className={`font-tech font-bold text-sm ${canEditMembership ? 'text-cyan-400' : 'text-zinc-500'}`}>
                                PERMITIR EDITAR "MEMBRESÍA Y PLAN" AL EDITAR UN CLIENTE
                            </span>
                        </label>
                        <p className="text-[10px] text-zinc-400 mt-1 ml-8">
                            Si está desmarcado, el Coach podrá editar datos básicos (nombre, foto, teléfono) de los socios, pero tendrá bloqueada la sección de "MEMBRESÍA Y PLAN" (cambio de disciplina, paquete, fechas de vigencia, bajas y costos).
                        </p>
                    </div>

                </div>
            )}

            <div className="md:col-span-2 flex gap-4 justify-end mt-4">
                {editingId && <button type="button" onClick={resetForm} className={btnSecondary} disabled={isSaving}>CANCELAR EDICIÓN</button>}
                <button type="submit" disabled={isSaving} className={`${btnPrimary} disabled:opacity-50 disabled:cursor-not-allowed`}>
                    {isSaving
                      ? 'PROCESANDO...'
                      : editingId
                        ? 'GUARDAR CAMBIOS'
                        : creationMode === 'INVITE'
                          ? '✉️ REGISTRAR E INVITAR USUARIO'
                          : '🔑 CREAR USUARIO CON CONTRASEÑA'}
                </button>
            </div>
        </form>
      </div>

      {/* LISTA DE USUARIOS */}
      <div className="mb-12">
           <h3 className="text-xl font-tech font-bold text-white mb-6 border-b border-zinc-800 pb-2">LISTA DE USUARIOS ACTIVOS</h3>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {admins.map(user => {
                   const isPendingInvite = Boolean(user.password && user.password.startsWith('INVITE_TOKEN::'));
                   return (
                   <div key={user.id} className={`p-6 border border-zinc-800 flex justify-between items-center group transition-all ${user.is_active ? 'bg-zinc-900/50 hover:border-yellow-500/50' : 'bg-red-950/10 border-red-900/30 opacity-60'}`}>
                       <div className="pr-3">
                           <div className="flex items-center gap-2 flex-wrap">
                               <p className={`font-bold text-lg ${user.is_active ? 'text-white' : 'text-red-400'}`}>{user.name}</p>
                               {isPendingInvite ? (
                                   <span className="text-[9px] font-tech font-bold uppercase px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-300 border border-yellow-500/40">
                                       ⏳ INVITACIÓN PENDIENTE
                                   </span>
                               ) : (
                                   <span className="text-[9px] font-tech font-bold uppercase px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                       ✓ CONTRASEÑA ACTIVA
                                   </span>
                               )}
                           </div>
                           <p className="text-zinc-500 font-mono-tech text-xs uppercase mt-0.5">{user.role} • {user.email}</p>
                           {user.role !== UserRole.ADMIN && (
                               <div className="flex flex-wrap gap-2 mt-2">
                                   <span className="text-[9px] bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">Actividades: {user.allowed_activity_ids?.length || 0}</span>
                                   <span className="text-[9px] bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">Paquetes: {user.allowed_package_ids?.length || 0}</span>
                                   {user.can_renew && <span className="text-[9px] bg-emerald-900/30 text-emerald-400 px-2 py-0.5 rounded">Renovador</span>}
                                   {user.can_manage_fingerprints ? (
                                       <span className="text-[9px] bg-yellow-900/40 text-yellow-300 border border-yellow-700/50 px-2 py-0.5 rounded font-bold">Huella OK</span>
                                   ) : (
                                       <span className="text-[9px] bg-zinc-800 text-zinc-500 border border-zinc-700/50 px-2 py-0.5 rounded">Huella: Bloqueada</span>
                                   )}
                                   {user.can_edit_membership ? (
                                       <span className="text-[9px] bg-cyan-900/40 text-cyan-300 border border-cyan-700/50 px-2 py-0.5 rounded font-bold">Edita Planes: SÍ</span>
                                   ) : (
                                       <span className="text-[9px] bg-zinc-800 text-zinc-500 border border-zinc-700/50 px-2 py-0.5 rounded">Edita Planes: Bloqueado</span>
                                   )}
                               </div>
                           )}
                       </div>
                       <div className="flex items-center gap-2 shrink-0">
                           <button
                               onClick={() => handleSendInvitationForUser(user)}
                               disabled={isSaving}
                               className="px-2.5 py-2 border border-yellow-500/60 bg-yellow-950/50 text-yellow-300 hover:bg-yellow-400 hover:text-black font-tech font-bold text-[10px] uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer"
                               title="Enviar invitación por Correo o WhatsApp / Obtener Link de Activación"
                           >
                               <span>📩</span>
                               <span className="hidden sm:inline">INVITAR / LINK</span>
                           </button>
                           <button onClick={() => handleEdit(user)} className="text-yellow-500 hover:text-white p-2 border border-zinc-700 hover:bg-zinc-800 transition-colors cursor-pointer" title="Editar usuario">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                           </button>
                           {user.email !== 'kalicentrodeportivotemixco@gmail.com' && (
                               <button 
                                   onClick={() => handleRequestDelete(user)} 
                                   className="text-red-500 hover:text-white p-2 border border-zinc-700 hover:bg-red-900 transition-colors cursor-pointer"
                                   title="Eliminar miembro del staff"
                               >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                               </button>
                           )}
                       </div>
                   </div>
                   );
               })}
           </div>
      </div>

      {/* MODAL DE INVITACIÓN HÍBRIDA (CORREO AUTOMÁTICO + WHATSAPP / ENLACE DIRECTO) */}
      {activeInvitation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-[fadeIn_0.25s_ease-out]">
          <div className="relative w-full max-w-lg bg-zinc-950 border-2 border-yellow-500 shadow-[0_0_60px_rgba(234,179,8,0.25)] p-6 sm:p-8 rounded-2xl overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4 mb-5">
              <div>
                <span className="inline-block text-[10px] font-mono-tech uppercase font-bold tracking-widest px-2.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 mb-1.5">
                  INVITACIÓN HÍBRIDA GENERADA
                </span>
                <h3 className="text-2xl font-tech font-bold text-white uppercase">
                  INVITAR A <span className="text-yellow-400">{activeInvitation.userName}</span>
                </h3>
                <p className="text-xs font-mono-tech text-zinc-400">
                  {activeInvitation.userRole} • {activeInvitation.userEmail}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveInvitation(null)}
                className="text-zinc-400 hover:text-white p-1.5 border border-zinc-800 hover:border-zinc-600 rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* 1. ESTADO DEL CORREO AUTOMÁTICO SUPABASE */}
            <div className={`p-4 rounded-xl border mb-5 flex items-center justify-between gap-3 ${
              activeInvitation.emailSent
                ? 'bg-emerald-950/30 border-emerald-500/50 text-emerald-300'
                : 'bg-amber-950/30 border-amber-500/50 text-amber-300'
            }`}>
              <div className="flex items-start gap-3">
                <span className="text-xl shrink-0">{activeInvitation.emailSent ? '📧' : '⚡'}</span>
                <div className="text-xs font-mono-tech">
                  <p className="font-bold uppercase font-tech text-sm">
                    {activeInvitation.emailSent
                      ? '1. Correo Automático Enviado (Supabase Auth)'
                      : '1. Enlace Directo Activo'}
                  </p>
                  <p className="text-zinc-300 mt-0.5">
                    {activeInvitation.emailSent
                      ? `Se envió un correo de activación a ${activeInvitation.userEmail}.`
                      : (activeInvitation.emailWarning || 'Puedes compartir el enlace directo por WhatsApp de inmediato.')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleResendInvitationEmail}
                disabled={isResendingEmail}
                className="px-3 py-1.5 rounded-lg bg-black/60 border border-zinc-700 hover:border-yellow-400 text-yellow-300 font-tech font-bold text-[10px] uppercase shrink-0 cursor-pointer disabled:opacity-50"
              >
                {isResendingEmail ? 'ENVIANDO...' : 'REENVIAR CORREO'}
              </button>
            </div>

            {/* 2. ENLACE DIRECTO DE ACTIVACIÓN */}
            <div className="mb-5">
              <label className="block text-[11px] font-tech uppercase font-bold text-yellow-400 mb-1.5 tracking-wider">
                2. Enlace Directo de Activación (Para crear contraseña):
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={activeInvitation.inviteLink}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  className="flex-1 bg-black border border-zinc-700 px-3 py-2.5 text-xs font-mono-tech text-zinc-200 rounded-xl outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopyInviteLink}
                  className={`px-4 py-2.5 rounded-xl font-tech font-black text-xs uppercase transition-all shrink-0 cursor-pointer ${
                    copiedLink
                      ? 'bg-emerald-500 text-black'
                      : 'bg-yellow-500 hover:bg-yellow-400 text-black'
                  }`}
                >
                  {copiedLink ? '✓ COPIADO' : '📋 COPIAR LINK'}
                </button>
              </div>
            </div>

            {/* 3. ENVIAR POR WHATSAPP */}
            <div className="p-4 rounded-xl bg-zinc-900/80 border border-zinc-800 mb-6">
              <label className="block text-[11px] font-tech uppercase font-bold text-emerald-400 mb-2 tracking-wider">
                3. Enviar Invitación Directa por WhatsApp:
              </label>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="tel"
                  value={activeInvitation.whatsappPhone}
                  onChange={(e) =>
                    setActiveInvitation({ ...activeInvitation, whatsappPhone: e.target.value })
                  }
                  placeholder="Teléfono (10 dígitos) o dejar vacío..."
                  className="flex-1 bg-black border border-zinc-700 focus:border-emerald-500 px-3.5 py-2.5 text-xs font-mono-tech text-white rounded-xl outline-none"
                />
                <a
                  href={getWhatsAppShareUrl(activeInvitation)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-tech font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all shrink-0"
                >
                  <span>💬</span>
                  <span>ENVIAR POR WHATSAPP</span>
                </a>
              </div>
              <p className="text-[10px] font-mono-tech text-zinc-400 mt-2">
                Al abrir el enlace desde WhatsApp o desde su correo, a <strong>{activeInvitation.userName}</strong> le aparecerá la pantalla para definir su contraseña e ingresar directamente a Kali Access.
              </p>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setActiveInvitation(null)}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-tech font-bold text-xs uppercase tracking-wider cursor-pointer"
              >
                LISTO, CERRAR VENTANA
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMACIÓN PARA ELIMINAR MIEMBRO DEL STAFF */}
      <ConfirmationModal
        isOpen={!!userToDelete}
        title="ELIMINAR MIEMBRO DEL STAFF"
        message={
          <div className="space-y-3">
            <p className="text-zinc-200">
              ¿Estás seguro de que deseas eliminar permanentemente a este usuario del sistema?
            </p>
            {userToDelete && (
              <div className="bg-black/50 border border-zinc-800 p-3 rounded text-left space-y-1">
                <p className="text-white font-bold text-base uppercase">
                  {userToDelete.name}
                </p>
                <p className="text-zinc-400 font-mono-tech text-xs">
                  Email: <span className="text-zinc-200">{userToDelete.email}</span>
                </p>
                <p className="text-zinc-400 font-mono-tech text-xs">
                  Rol: <span className="text-yellow-400 font-bold uppercase">{userToDelete.role}</span>
                </p>
              </div>
            )}
            <p className="text-xs text-red-400 font-mono-tech">
              ⚠️ Esta acción revocará sus permisos y accesos de forma inmediata e irreversible.
            </p>
          </div>
        }
        confirmText="ELIMINAR USUARIO"
        cancelText="CANCELAR"
        type="danger"
        isProcessing={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setUserToDelete(null)}
      />

      <style>{`
          .custom-scrollbar::-webkit-scrollbar { width: 4px; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: #333; }
      `}</style>
    </div>
  );
};

export default CoachManagement;
