import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { activateInvitedUser } from '../services/storage';
import { UserRole } from '../types';
import { useToast } from '../context/ToastContext';

interface AcceptInvitationModalProps {
  email: string;
  defaultName?: string;
  uid?: string;
  invitationType: 'invite' | 'recovery';
  onSuccess: (
    role: UserRole,
    name: string,
    allowedActivityIds: string[],
    allowedPackageIds: string[],
    canRenew: boolean,
    canManageFingerprints: boolean,
    email: string,
    canEditMembership: boolean
  ) => void;
  onCancel: () => void;
}

export const AcceptInvitationModal: React.FC<AcceptInvitationModalProps> = ({
  email,
  defaultName = '',
  uid,
  invitationType,
  onSuccess,
  onCancel
}) => {
  const { showToast } = useToast();
  const [name, setName] = useState(defaultName);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isInvite = invitationType === 'invite';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (password.length < 6) {
      setErrorMessage('LA CONTRASEÑA DEBE TENER AL MENOS 6 CARACTERES.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('LAS CONTRASEÑAS NO COINCIDEN. POR FAVOR VERIFÍCALAS.');
      return;
    }

    setIsLoading(true);

    try {
      // 1. Si viene con sesión activa de Supabase Auth (enlace de correo), actualizar contraseña en Supabase Auth.
      // Si viene desde enlace directo (WhatsApp / Link), sincronizar en Supabase Auth sin bloquear el flujo.
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session) {
        const { error: authError } = await supabase.auth.updateUser({
          password: password,
          data: {
            full_name: name.trim() || undefined
          }
        });
        if (authError) {
          console.warn('Aviso actualizando usuario en Supabase Auth:', authError.message);
        }
      } else if (email) {
        // Sincronización silenciosa en Supabase Auth para enlaces directos
        await supabase.auth.signUp({
          email: email.toLowerCase().trim(),
          password: password,
          options: {
            data: {
              full_name: name.trim() || undefined
            }
          }
        }).catch(() => {});
      }

      // 2. Sincronizar / activar usuario en la tabla system_users con su rol y permisos asignados
      const authResult = await activateInvitedUser(
        email,
        name.trim(),
        password,
        uid
      );

      // 3. Limpiar parámetros y hash de la URL para que no vuelva a abrirse el modal al recargar
      if (typeof window !== 'undefined' && window.history) {
        window.history.replaceState(null, '', window.location.pathname);
      }

      showToast(
        isInvite
          ? '¡CUENTA ACTIVADA CON ÉXITO! BIENVENIDO A KALI ACCESS'
          : '¡CONTRASEÑA ACTUALIZADA CON ÉXITO!',
        'success'
      );

      onSuccess(
        authResult.role,
        authResult.name,
        authResult.allowedActivityIds || [],
        authResult.allowedPackageIds || [],
        authResult.canRenew || false,
        authResult.canManageFingerprints || false,
        authResult.email || email,
        authResult.canEditMembership || false
      );
    } catch (err: any) {
      console.error('Error al aceptar invitación:', err);
      setErrorMessage(err.message || 'Ocurrió un error al procesar tu solicitud.');
      showToast(`Error: ${err.message || 'Fallo de autenticación'}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-[fadeIn_0.3s_ease-out]">
      <div className="relative w-full max-w-md bg-zinc-950 border-2 border-yellow-500/80 shadow-[0_0_50px_rgba(234,179,8,0.25)] p-6 sm:p-8 rounded-2xl overflow-hidden">
        {/* Glow decorative corner */}
        <div className="absolute -top-16 -right-16 w-32 h-32 bg-yellow-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-yellow-500/10 border border-yellow-500/40 text-yellow-400 mb-3 shadow-[0_0_20px_rgba(234,179,8,0.2)]">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>

          <span className="inline-block text-[10px] font-mono-tech uppercase font-bold tracking-widest px-2.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-300 border border-yellow-500/30 mb-2">
            {isInvite ? 'INVITACIÓN SUPABASE AUTH' : 'RECUPERACIÓN DE ACCESO'}
          </span>

          <h3 className="text-2xl font-tech font-bold text-white uppercase tracking-wider">
            {isInvite ? 'ACTIVAR TU CUENTA' : 'NUEVA CONTRASEÑA'}
          </h3>
          <p className="text-xs text-zinc-400 font-mono-tech mt-1">
            {isInvite 
              ? 'Has sido invitado a colaborar en Kali Access. Por favor establece tu contraseña para comenzar.'
              : 'Introduce tu nueva contraseña para restablecer tu cuenta.'}
          </p>
        </div>

        {/* Email Badge */}
        <div className="p-3 mb-5 rounded-xl bg-zinc-900/80 border border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] shrink-0" />
            <span className="text-[11px] font-mono-tech text-zinc-300 truncate font-semibold">
              {email}
            </span>
          </div>
          <span className="text-[9px] font-tech text-emerald-400 font-bold uppercase shrink-0 px-2 py-0.5 bg-emerald-500/10 rounded">
            VERIFICADO
          </span>
        </div>

        {/* Error alert */}
        {errorMessage && (
          <div className="p-3 mb-5 rounded-xl bg-red-950/40 border border-red-500/60 text-red-300 text-xs font-mono-tech flex items-start gap-2">
            <span className="text-base shrink-0">⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-tech uppercase font-bold text-zinc-300 mb-1.5 tracking-wider">
              TU NOMBRE COMPLETO
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Carlos Mendoza"
              className="w-full bg-black/60 border border-zinc-700 focus:border-yellow-500 px-3.5 py-2.5 text-white font-mono-tech text-sm rounded-xl outline-none transition-colors"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-tech uppercase font-bold text-zinc-300 tracking-wider">
                NUEVA CONTRASEÑA
              </label>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-[10px] text-zinc-400 hover:text-yellow-400 font-mono-tech uppercase"
              >
                {showPassword ? 'OCULTAR' : 'VER'}
              </button>
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              required
              minLength={6}
              className="w-full bg-black/60 border border-zinc-700 focus:border-yellow-500 px-3.5 py-2.5 text-white font-mono-tech text-sm rounded-xl outline-none transition-colors"
            />
          </div>

          <div>
            <label className="block text-[11px] font-tech uppercase font-bold text-zinc-300 mb-1.5 tracking-wider">
              CONFIRMAR CONTRASEÑA
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repite la contraseña"
              required
              minLength={6}
              className="w-full bg-black/60 border border-zinc-700 focus:border-yellow-500 px-3.5 py-2.5 text-white font-mono-tech text-sm rounded-xl outline-none transition-colors"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 px-4 bg-yellow-500 hover:bg-yellow-400 text-black font-tech font-black text-sm uppercase rounded-xl shadow-[0_0_20px_rgba(234,179,8,0.35)] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>GUARDANDO Y ACTIVANDO...</span>
                </>
              ) : (
                <span>ESTABLECER CONTRASEÑA Y ENTRAR</span>
              )}
            </button>
          </div>

          <div className="text-center pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="text-xs text-zinc-500 hover:text-zinc-300 font-mono-tech uppercase"
            >
              CANCELAR Y VOLVER AL LOGIN
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
