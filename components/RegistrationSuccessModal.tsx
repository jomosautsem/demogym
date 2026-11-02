import React, { useState, useEffect } from 'react';
import { Client, ClientSubscription, Package, Activity } from '../types';
import { 
    getSystemConfig, 
    DEFAULT_WA_WELCOME_TEMPLATE, 
    DEFAULT_WA_RENEWAL_TEMPLATE,
    getPackages,
    getActivities,
    getClientSubscriptionsByClientId
} from '../services/storage';

interface RegistrationSuccessModalProps {
  client: Client;
  paymentAmount: number;
  paymentConcept: string;
  onClose: () => void;
  onShowQr: () => void;
  type?: 'REGISTER' | 'RENEWAL'; // Nuevo prop para distinguir el contexto
  onOpenBiometricScan?: () => void;
}

const RegistrationSuccessModal: React.FC<RegistrationSuccessModalProps> = ({ 
    client, 
    paymentAmount, 
    paymentConcept, 
    onClose, 
    onShowQr,
    type = 'REGISTER',
    onOpenBiometricScan
}) => {
  const [template, setTemplate] = useState(type === 'REGISTER' ? DEFAULT_WA_WELCOME_TEMPLATE : DEFAULT_WA_RENEWAL_TEMPLATE);
  const [isSent, setIsSent] = useState(false);
  const [subscriptionsList, setSubscriptionsList] = useState<ClientSubscription[]>([]);
  const [packagesList, setPackagesList] = useState<Package[]>([]);
  const [activitiesList, setActivitiesList] = useState<Activity[]>([]);

  useEffect(() => {
      const loadConfigAndData = async () => {
          try {
              // Cargar de manera paralela toda la información de apoyo y del cliente
              const [config, allPkgs, allActs, subs] = await Promise.all([
                  getSystemConfig(),
                  getPackages(),
                  getActivities(),
                  getClientSubscriptionsByClientId(client.id)
              ]);

              setPackagesList(allPkgs);
              setActivitiesList(allActs);

              if (type === 'REGISTER' && config.wa_template_welcome) {
                  setTemplate(config.wa_template_welcome);
              } else if (type === 'RENEWAL' && config.wa_template_renewal) {
                  setTemplate(config.wa_template_renewal);
              }

              let finalSubs: ClientSubscription[] = [];
              const clientAny = client as any;

              // Priorizar las suscripciones en memoria para registros inmediatos y prevenir demoras o asincronías
              if (clientAny.subscriptions && clientAny.subscriptions.length > 0) {
                  finalSubs = clientAny.subscriptions.map((sub: any) => {
                      let actName = sub.activity_name || sub.activityName || '';
                      let pkgName = sub.package_name || sub.packageName || '';
                      
                      if (!pkgName && sub.package_id) {
                          const foundPkg = allPkgs.find(p => p.id === sub.package_id);
                          if (foundPkg) pkgName = foundPkg.name;
                      }
                      if (!actName && sub.activity_id) {
                          const foundAct = allActs.find(a => a.id === sub.activity_id);
                          if (foundAct) actName = foundAct.name;
                      }

                      return {
                          id: sub.id || `mem-${Math.random()}`,
                          client_id: client.id,
                          package_id: sub.package_id || null,
                          activity_id: sub.activity_id || null,
                          startDate: sub.startDate || sub.start_date || '',
                          endDate: sub.endDate || sub.end_date || '',
                          amount: sub.cost !== undefined ? sub.cost : (sub.amount !== undefined ? sub.amount : 0),
                          packageName: pkgName || 'Plan Activo',
                          activityName: actName || 'General',
                          isActive: true
                      };
                  });
              } else {
                  // Mapear desde base de datos / fallback
                  finalSubs = subs.map(sub => {
                      let actName = '';
                      let pkgName = '';
                      if (sub.package_id) {
                          const foundPkg = allPkgs.find(p => p.id === sub.package_id);
                          if (foundPkg) pkgName = foundPkg.name;
                      }
                      if (sub.activity_id) {
                          const foundAct = allActs.find(a => a.id === sub.activity_id);
                          if (foundAct) actName = foundAct.name;
                      }
                      return {
                          ...sub,
                          packageName: pkgName || sub.packageName || 'Plan Personalizado',
                          activityName: actName || sub.activityName || ''
                      };
                  });
              }

              setSubscriptionsList(finalSubs);
          } catch (e) {
              console.warn("Using default template as some config/data could not load", e);
          }
      };
      loadConfigAndData();
  }, [type, client.id]);

  const handleSendWhatsApp = () => {
      if (!client.phone) return;
      setIsSent(true);

      // Limpiar teléfono (solo números)
      let cleanPhone = client.phone.replace(/\D/g, '');
      // Asumir código de país México (52) si es de 10 dígitos
      if (cleanPhone.length === 10) cleanPhone = '52' + cleanPhone;

      // Reemplazo de variables / Mensaje multidisciplinario
      let message = '';
      const totalAmount = subscriptionsList.length > 0 
          ? subscriptionsList.reduce((acc, s) => acc + (s.amount || 0), 0)
          : paymentAmount;

      if (type === 'REGISTER' && subscriptionsList.length > 1) {
          // Detallado multidisciplinario para bienvenida con agradecimiento
          const plansText = subscriptionsList.map(sub => {
              const discName = sub.activityName || 'General';
              const namePlan = sub.packageName || 'Plan Activo';
              return `🥊 *${discName.toUpperCase()}*\n📦 Plan: *${namePlan}*\n📅 Vigencia: *${sub.startDate}* al *${sub.endDate}*\n💰 Pago por Disciplina: *$${(sub.amount || 0).toFixed(2)}*`;
          }).join('\n\n━━━━━━━━━━━━━━━━━━\n\n');

          message = `Hola *${client.firstName}* 👋, ¡Muchas gracias por tu registro e inscripción en Kali Access! ❤️\n\nNos da mucho gusto darte la bienvenida y agradecer enormemente tu confianza en nosotros. 🙌🏋️‍♂️\n\n📋 *Resumen de tus Disciplinas Registradas:*\n\n${plansText}\n\n💰 *Total General Pagado:* *$${totalAmount.toFixed(2)}*\n\n¡Te deseamos el mejor de los éxitos en tu entrenamiento y que alcances todas tus metas! 💪🔥`;
      } else if (type === 'RENEWAL' && subscriptionsList.length > 1) {
          // Detallado multidisciplinario para renovación con agradecimiento
          const plansText = subscriptionsList.map(sub => {
              const discName = sub.activityName || 'General';
              const namePlan = sub.packageName || 'Plan Activo';
              return `🥊 *${discName.toUpperCase()}*\n📦 Plan: *${namePlan}*\n📅 Vigencia: *${sub.startDate}* al *${sub.endDate}*\n💰 Pago por Disciplina: *$${(sub.amount || 0).toFixed(2)}*`;
          }).join('\n\n━━━━━━━━━━━━━━━━━━\n\n');

          message = `Hola *${client.firstName}* 👋, ¡Muchas gracias por tu renovación en Kali Access! ✅\n\nQueremos agradecerte enormemente tu constancia, dedicación y preferencia para seguir entrenando con nosotros. ❤️🏋️‍♂️\n\n📋 *Resumen de tus Disciplinas Activas:*\n\n${plansText}\n\n💰 *Total Renovado:* *$${totalAmount.toFixed(2)}*\n\n¡A darle con todo en cada entrenamiento! 💪🥊`;
      } else {
          // Reemplazo normal si tiene una sola disciplina
          message = template
              .replace('{NOMBRE}', client.firstName)
              .replace('{FECHA_INICIO}', client.membershipStart)
              .replace('{FECHA_FIN}', client.membershipEnd)
              .replace('{PAGO}', paymentAmount.toFixed(2))
              .replace('{CONCEPTO}', paymentConcept)
              .replace('{PLAN}', paymentConcept);
      }

      const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank');
  };

  const isRenewal = type === 'RENEWAL';

  return (
    <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center p-4 animate-[fadeIn_0.3s_ease-out]">
        <div 
            className={`w-full max-w-md shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden border-2 rounded-[2rem] ${isRenewal ? 'border-yellow-500 shadow-yellow-500/20' : 'border-emerald-500 shadow-emerald-500/20'}`}
            style={{ backgroundColor: '#000000' }} 
        >
            {/* Header de Éxito */}
            <div className={`p-6 text-center border-b ${isRenewal ? 'bg-yellow-900/20 border-yellow-500' : 'bg-emerald-900/20 border-emerald-500'}`}>
                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${isRenewal ? 'bg-yellow-500 shadow-[0_0_20px_rgba(234,179,8,0.5)]' : 'bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.5)]'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                </div>
                <h2 className="text-2xl font-tech font-bold text-white uppercase tracking-wider">
                    {isRenewal ? '¡RENOVACIÓN EXITOSA!' : '¡REGISTRO EXITOSO!'}
                </h2>
                <p className={`${isRenewal ? 'text-yellow-400' : 'text-emerald-400'} font-mono-tech text-sm mt-1`}>
                    {isRenewal ? 'LA MEMBRESÍA HA SIDO ACTUALIZADA' : 'EL CLIENTE HA SIDO GUARDADO'}
                </p>
            </div>

            <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
                {/* Resumen */}
                <div className="bg-zinc-900/30 p-4 border border-zinc-800 rounded-xl space-y-4">
                    <div className="text-center">
                        <p className="text-white font-bold text-lg">{client.firstName} {client.lastNamePaternal} {client.lastNameMaternal}</p>
                        {subscriptionsList.length <= 1 && (
                            <p className="text-zinc-500 text-xs font-mono-tech uppercase mt-1">{paymentConcept}</p>
                        )}
                    </div>
                    
                    {subscriptionsList.length > 1 ? (
                        <div className="space-y-3 pt-2 border-t border-zinc-800">
                            <span className="text-zinc-500 block text-[9px] font-mono-tech uppercase tracking-wider text-center">PLANES Y DISCIPLINAS ADQUIRIDAS</span>
                            {subscriptionsList.map((sub, i) => (
                                <div key={sub.id || i} className="bg-black/40 border border-zinc-900 rounded-lg p-2.5 flex justify-between items-center text-xs">
                                    <div>
                                        <p className="text-white font-bold uppercase">{sub.activityName || 'Disciplina'}</p>
                                        <p className="text-zinc-500 text-[10px] uppercase truncate max-w-[180px]">{sub.packageName || 'Plan'}</p>
                                        <p className="text-zinc-600 font-mono text-[9px]">{sub.startDate} al {sub.endDate}</p>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-white font-bold font-mono">${(sub.amount || 0).toFixed(2)}</span>
                                    </div>
                                </div>
                            ))}
                            <div className="flex justify-between items-center pt-2 border-t border-zinc-800 text-sm font-mono-tech">
                                <span className="text-zinc-500 uppercase text-[10px]">TOTAL GENERAL</span>
                                <span className={`${isRenewal ? 'text-yellow-400' : 'text-emerald-400'} font-bold text-lg`}>
                                    ${subscriptionsList.reduce((acc, s) => acc + (s.amount || 0), 0).toFixed(2)}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-4 text-sm font-mono-tech border-t border-zinc-800 pt-3">
                            <div className="text-center">
                                <span className="text-zinc-500 block text-[10px] uppercase">Vence</span>
                                <span className="text-white">{client.membershipEnd}</span>
                            </div>
                            <div className="text-center border-l border-zinc-800">
                                <span className="text-zinc-500 block text-[10px] uppercase">Pagado</span>
                                <span className={`${isRenewal ? 'text-yellow-400' : 'text-emerald-400'} font-bold`}>${paymentAmount.toFixed(2)}</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Botones de Acción */}
                <div className="space-y-3">
                    {client.phone ? (
                        <button 
                            onClick={handleSendWhatsApp}
                            disabled={isSent}
                            className={`w-full text-white font-tech font-bold uppercase py-4 border flex items-center justify-center gap-3 transition-all active:scale-[0.98] rounded-xl
                                ${isRenewal 
                                    ? 'bg-yellow-600 hover:bg-yellow-500 border-yellow-400 shadow-[0_0_15px_rgba(234,179,8,0.3)] text-black' 
                                    : 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]'}
                                ${isSent ? 'opacity-50 cursor-not-allowed grayscale' : ''}    
                            `}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.017-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                            {isSent ? 'ENVIADO' : 'ENVIAR COMPROBANTE MULTI-PLAN (WA)'}
                        </button>
                    ) : (
                        <div className="bg-zinc-900 p-3 text-center text-zinc-500 text-xs font-mono-tech border border-zinc-800 rounded-xl">
                            NO SE REGISTRÓ NÚMERO DE TELÉFONO
                        </div>
                    )}

                    {onOpenBiometricScan && (
                        <button 
                            onClick={onOpenBiometricScan}
                            className="w-full bg-cyan-950/70 hover:bg-cyan-900 text-cyan-300 hover:text-white font-tech font-bold uppercase py-3.5 border border-cyan-700/80 hover:border-cyan-400 flex items-center justify-center gap-2.5 transition-all rounded-xl shadow-[0_0_15px_rgba(6,182,212,0.2)] active:scale-[0.98]"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m12 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17" />
                            </svg>
                            PROBAR EN ACCESO HUELLA
                        </button>
                    )}

                    <button 
                        onClick={onShowQr}
                        className="w-full bg-zinc-900 hover:bg-zinc-800 text-white font-tech font-bold uppercase py-4 border border-zinc-700 hover:border-white flex items-center justify-center gap-3 transition-all rounded-xl"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4h-4v-2h-4v2H4v-4H2v-4h2V8h4V4h4v2h2v4h4v2h2v4H18z" /></svg>
                        VER / COMPARTIR CÓDIGO QR
                    </button>
                </div>
            </div>

            <button 
                onClick={onClose} 
                className="w-full bg-black hover:bg-zinc-900 text-zinc-400 hover:text-white font-tech font-bold uppercase py-4 border-t border-zinc-800 transition-colors text-xs tracking-widest rounded-b-[2rem]"
            >
                FINALIZAR Y CERRAR
            </button>
        </div>
    </div>
  );
};

export default RegistrationSuccessModal;
