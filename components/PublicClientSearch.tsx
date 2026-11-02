import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, ShieldCheck, Dumbbell } from 'lucide-react';
import { getClients, getPackages, getActivities, getClientSubscriptionsByClientId } from '../services/storage';
import { Client, AccessStatus, ClientSubscription } from '../types';
import StatusLight from './StatusLight';

interface PublicClientSearchProps {
  initialClientId?: string | null;
}

const PublicClientSearch: React.FC<PublicClientSearchProps> = ({ initialClientId }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<Client | null>(null);
  const [subscriptionsList, setSubscriptionsList] = useState<ClientSubscription[]>([]);
  const [error, setError] = useState<string | null>(null);

  const getDaysLeft = (endDate: string) => {
    const [y, m, d] = endDate.split('-').map(Number);
    const end = new Date(y, m - 1, d);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.ceil((end.getTime() - now.getTime()) / 864e5);
  };

  const loadClientProfile = useCallback(async (client: Client) => {
    const [allPkgs, allActs, subs] = await Promise.all([
      getPackages(),
      getActivities(),
      getClientSubscriptionsByClientId(client.id)
    ]);

    let enrichedSubs: ClientSubscription[] = subs
      .filter(s => s.isActive)
      .map(sub => {
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

    if (enrichedSubs.length === 0) {
      let actName = '';
      let pkgName = '';
      if (client.package_id) {
        const foundPkg = allPkgs.find(p => p.id === client.package_id);
        if (foundPkg) pkgName = foundPkg.name;
      }
      if (client.activity_id) {
        const foundAct = allActs.find(a => a.id === client.activity_id);
        if (foundAct) actName = foundAct.name;
      } else if (!client.package_id) {
        actName = 'GYM';
      }

      if (client.membershipEnd) {
        enrichedSubs.push({
          id: 'generated-pwa',
          client_id: client.id,
          package_id: client.package_id,
          activity_id: client.activity_id,
          startDate: client.membershipStart,
          endDate: client.membershipEnd,
          amount: client.cost || 0,
          isActive: client.isActive,
          packageName: pkgName || 'Membresía General',
          activityName: actName
        });
      }
    }

    enrichedSubs.sort((a, b) => {
      const daysA = getDaysLeft(a.endDate);
      const daysB = getDaysLeft(b.endDate);
      if (daysA >= 0 && daysB >= 0) return daysB - daysA;
      if (daysA >= 0 && daysB < 0) return -1;
      if (daysA < 0 && daysB >= 0) return 1;
      return daysB - daysA;
    });

    setSubscriptionsList(enrichedSubs);
    setResult(client);
  }, []);

  // Auto-load client if opened via direct portal link (?portal=ID or /portal/ID)
  useEffect(() => {
    const checkDirectPortalId = async () => {
      let targetId = initialClientId;
      if (!targetId && typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        targetId = params.get('portal');
        if (!targetId && window.location.pathname.includes('/portal/')) {
          targetId = window.location.pathname.split('/portal/')[1]?.split('/')[0] || null;
        }
      }

      if (targetId) {
        setIsSearching(true);
        try {
          const allClients = await getClients();
          const found = allClients.find(c => c.id === targetId);
          if (found) {
            await loadClientProfile(found);
          } else {
            setError('No se encontró el pase digital solicitado. Puedes buscar con tu número de teléfono.');
          }
        } catch (err) {
          console.error(err);
        } finally {
          setIsSearching(false);
        }
      }
    };
    checkDirectPortalId();
  }, [initialClientId, loadClientProfile]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanSearch = searchTerm.trim().replace(/\D+/g, '');
    if (cleanSearch.length < 10) {
      setError('EL NÚMERO DEBE TENER 10 DÍGITOS');
      return;
    }

    setIsSearching(true);
    setResult(null);
    setSubscriptionsList([]);
    setError(null);

    try {
      const allClients = await getClients();
      const client = allClients.find(c => {
        if (!c.phone) return false;
        const cleanPhone = c.phone.replace(/\D+/g, '');
        return cleanPhone === cleanSearch;
      });

      if (client) {
        await loadClientProfile(client);
      } else {
        setError('No se encontró ningún socio con ese número de teléfono. Verifica tus datos o acude a recepción.');
      }
    } catch (err) {
      console.error(err);
      setError('Error al conectar con el servidor.');
    } finally {
      setIsSearching(false);
    }
  };

  const hasActiveSub = subscriptionsList.some(sub => getDaysLeft(sub.endDate) >= 0 && sub.isActive);
  const isExpiringSoon = subscriptionsList.some(sub => {
    const days = getDaysLeft(sub.endDate);
    return days >= 0 && days <= 2 && sub.isActive;
  });
  const overallStatus =
    !result || !result.isActive
      ? AccessStatus.DENIED
      : isExpiringSoon
      ? AccessStatus.WARNING
      : hasActiveSub
      ? AccessStatus.GRANTED
      : AccessStatus.DENIED;

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-yellow-500/5 blur-[120px] rounded-full pointer-events-none"></div>

      <div className="w-full max-w-lg relative z-10">
        {!result ? (
          <div className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-zinc-950 border-2 border-zinc-800 rounded-[2.5rem] p-8 md:p-12 shadow-[0_0_80px_rgba(0,0,0,0.8)] relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-yellow-500 to-transparent"></div>

              <div className="text-center mb-10">
                <div className="w-20 h-20 bg-yellow-500 rounded-3xl flex items-center justify-center mx-auto mb-6 rotate-3 shadow-[0_10px_30px_rgba(234,179,8,0.3)]">
                  <Search className="text-black w-10 h-10" />
                </div>
                <h1 className="text-3xl font-tech font-black text-white uppercase tracking-tighter leading-none mb-4">
                  Consulta tu <span className="text-yellow-500">Vigencia</span>
                </h1>

                <div className="relative group/info">
                  <div className="absolute -inset-1 bg-yellow-500/30 blur-md rounded-2xl opacity-100 animate-pulse"></div>
                  <div className="relative bg-yellow-500 border-2 border-yellow-400 rounded-2xl p-4 shadow-[0_0_20px_rgba(234,179,8,0.4)]">
                    <p className="text-black text-[11px] md:text-xs font-tech font-black tracking-wider uppercase leading-tight text-center">
                      Ingresa tu número de teléfono a 10 dígitos, SIN ESPACIOS para consultar el estado de tu membresía
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSearch} className="space-y-6">
                <div className="relative group">
                  <div className="absolute -inset-0.5 bg-yellow-500 opacity-20 group-focus-within:opacity-40 transition-opacity blur-lg rounded-2xl"></div>
                  <input
                    type="tel"
                    maxLength={10}
                    value={searchTerm}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      setSearchTerm(val);
                    }}
                    placeholder="Ej: 7771234567"
                    className="relative w-full bg-black border-2 border-zinc-800 rounded-2xl px-6 py-5 text-center text-2xl text-white font-tech tracking-[0.2em] focus:border-yellow-500 outline-none transition-all placeholder:text-zinc-800 placeholder:tracking-normal"
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSearching || searchTerm.length < 10}
                  className="w-full bg-yellow-500 disabled:opacity-30 disabled:grayscale text-black font-tech font-black uppercase py-5 rounded-2xl text-lg shadow-[0_15px_40px_rgba(234,179,8,0.3)] hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3"
                >
                  {isSearching ? (
                    <>
                      <div className="w-5 h-5 border-3 border-black/30 border-t-black rounded-full animate-spin"></div>
                      VERIFICANDO...
                    </>
                  ) : (
                    'VERIFICAR MI MEMBRESÍA'
                  )}
                </button>
              </form>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-[10px] font-mono-tech uppercase tracking-widest text-center"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-950 border-2 border-yellow-500/40 rounded-[2rem] p-6 md:p-8 relative overflow-hidden shadow-[0_0_50px_rgba(234,179,8,0.1)]"
          >
            <div className="absolute -top-16 -right-16 w-48 h-48 bg-yellow-500/10 blur-[60px] rounded-full pointer-events-none"></div>
            <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-yellow-500/5 blur-[60px] rounded-full pointer-events-none"></div>

            <div className="absolute top-0 right-0 p-4 opacity-5">
              <ShieldCheck className="w-32 h-32 text-yellow-500" />
            </div>

            <div className="flex flex-col items-center text-center relative z-10">
              <div className="mb-3 relative">
                <div className="absolute inset-0 bg-yellow-500/20 blur-2xl rounded-full"></div>
                <div className="relative">
                  <StatusLight status={overallStatus} size="lg" />
                </div>
              </div>

              <h2 className="text-yellow-500/80 font-tech font-black uppercase text-[10px] tracking-[0.4em] mb-1">
                RESULTADO DE BÚSQUEDA:
              </h2>
              <h3 className="text-2xl md:text-3xl font-tech font-black text-white uppercase mb-6 leading-none tracking-tighter">
                {result.firstName} <br />
                <span className="text-yellow-500">
                  {result.lastNamePaternal} {result.lastNameMaternal}
                </span>
              </h3>

              {/* TARJETAS POR DISCIPLINA / PLANES */}
              <div className="w-full space-y-4 mb-6 text-left">
                <div className="flex items-center gap-2 px-1 pb-1 border-b border-zinc-900">
                  <Dumbbell className="w-4 h-4 text-zinc-500" />
                  <h4 className="text-zinc-500 font-tech font-black text-xs uppercase tracking-widest">
                    MIS PLANES Y DISCIPLINAS ({subscriptionsList.length})
                  </h4>
                </div>

                <div className="space-y-3">
                  {subscriptionsList.map((sub) => {
                    const days = getDaysLeft(sub.endDate);
                    const isExpired = days < 0;
                    const expiringSoon = days >= 0 && days <= 2;

                    return (
                      <div
                        key={sub.id}
                        className={`relative border-2 rounded-2xl p-4 overflow-hidden transition-all duration-300 ${
                          isExpired
                            ? 'bg-zinc-950/60 border-red-950/40 opacity-80'
                            : expiringSoon
                            ? 'bg-zinc-900/60 border-orange-500/30'
                            : 'bg-zinc-900/60 border-zinc-800 shadow-md'
                        }`}
                      >
                        <div className="absolute top-3 right-3 flex items-center gap-1.5">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isExpired
                                ? 'bg-red-500'
                                : expiringSoon
                                ? 'bg-orange-500 animate-pulse'
                                : 'bg-emerald-500'
                            }`}
                          ></span>
                        </div>

                        <div className="space-y-1">
                          <span
                            className={`inline-block text-[8px] font-tech font-black px-1.5 py-0.5 rounded uppercase tracking-wider leading-none ${
                              isExpired
                                ? 'bg-red-500/10 text-red-500 border border-red-500/20'
                                : expiringSoon
                                ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            }`}
                          >
                            {sub.activityName || 'Multidisciplina'}
                          </span>

                          <h5 className="text-base font-tech font-black text-white uppercase tracking-tight leading-tight">
                            {sub.packageName || 'Membresía Activa'}
                          </h5>
                        </div>

                        <div className="mt-3 pt-3 border-t border-zinc-900/80 flex items-center justify-between">
                          <div>
                            <p className="text-[7px] font-tech font-black text-zinc-500 tracking-wider uppercase">
                              VIGENCIA DEL PLAN
                            </p>
                            <p className="text-xs font-mono text-zinc-400 leading-none mt-0.5">
                              {sub.startDate} <span className="text-zinc-600 font-sans text-[10px]">al</span> {sub.endDate}
                            </p>
                          </div>

                          <div className="text-right">
                            {days >= 0 ? (
                              <div className="flex items-center gap-1">
                                <span
                                  className={`text-2xl font-tech font-black leading-none ${
                                    expiringSoon ? 'text-orange-500' : 'text-yellow-500'
                                  }`}
                                >
                                  {days}
                                </span>
                                <span className="text-[7px] font-tech font-black text-zinc-500 tracking-widest uppercase">
                                  {days === 1 ? 'DÍA' : 'DÍAS'}
                                </span>
                              </div>
                            ) : (
                              <span className="text-[8px] font-tech font-black text-red-500 bg-red-500/10 border border-red-500/20 rounded px-1.5 py-0.5 uppercase tracking-wider">
                                VENCIDO
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={() => {
                  setResult(null);
                  setSearchTerm('');
                }}
                className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-tech font-black uppercase py-4 rounded-xl transition-all shadow-[0_10px_20px_rgba(234,179,8,0.2)] active:scale-[0.98] text-sm tracking-wider"
              >
                CONSULTAR OTRO NÚMERO
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default PublicClientSearch;
