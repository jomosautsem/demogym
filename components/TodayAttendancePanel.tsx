import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Client, Package, Activity } from '../types';
import { getDetailedTodaysAttendance, DetailedAttendanceItem } from '../services/storage';

interface TodayAttendancePanelProps {
  clients: Client[];
  packages?: Package[];
  activities?: Activity[];
  onOpenBiometricScanner?: () => void;
  onOpenQrScanner?: () => void;
}

export const TodayAttendancePanel: React.FC<TodayAttendancePanelProps> = ({
  clients,
  onOpenBiometricScanner,
  onOpenQrScanner
}) => {
  const [items, setItems] = useState<DetailedAttendanceItem[]>([]);
  const [totalToday, setTotalToday] = useState(0);
  const [inGymCount, setInGymCount] = useState(0);
  const [fingerprintCount, setFingerprintCount] = useState(0);
  const [qrCount, setQrCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [methodFilter, setMethodFilter] = useState<'ALL' | 'IN_GYM' | 'HUELLA' | 'QR'>('ALL');
  const [currentTime, setCurrentTime] = useState<string>('');

  // Update clock every second
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch detailed attendances
  const loadAttendanceData = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getDetailedTodaysAttendance(clients);
      setItems(res.items);
      setTotalToday(res.totalToday);
      setInGymCount(res.inGymCount);
      setFingerprintCount(res.fingerprintCount);
      setQrCount(res.qrCount);
    } catch (err) {
      console.warn('Error cargando asistencias del día:', err);
    } finally {
      setIsLoading(false);
    }
  }, [clients]);

  useEffect(() => {
    loadAttendanceData();
    // Auto refresh every 30 seconds
    const pollInterval = setInterval(loadAttendanceData, 30000);
    return () => clearInterval(pollInterval);
  }, [loadAttendanceData]);

  // Format relative time helper
  const getRelativeTime = (isoString: string) => {
    const recordTime = new Date(isoString).getTime();
    const now = new Date().getTime();
    const diffMinutes = Math.floor((now - recordTime) / 60000);
    if (diffMinutes < 1) return 'Hace un momento';
    if (diffMinutes < 60) return `Hace ${diffMinutes} min`;
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    return `Hace ${hours}h ${mins > 0 ? `${mins}m` : ''}`;
  };

  const formatExactTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    } catch {
      return isoString;
    }
  };

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch = 
        item.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.clientPhone.includes(searchTerm) ||
        item.planName.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;

      if (methodFilter === 'IN_GYM') return item.isInGym;
      if (methodFilter === 'HUELLA') return item.method === 'HUELLA';
      if (methodFilter === 'QR') return item.method === 'QR';
      return true;
    });
  }, [items, searchTerm, methodFilter]);

  // Export to CSV
  const handleExportCSV = () => {
    if (items.length === 0) return;
    const today = new Date().toISOString().split('T')[0];
    const headers = ['Hora', 'Nombre del Socio', 'Teléfono', 'Método', 'Plan / Disciplina', 'En Sala (Ultimas 2h)'];
    const rows = items.map(i => [
      formatExactTime(i.created_at),
      `"${i.clientName.replace(/"/g, '""')}"`,
      `"${i.clientPhone}"`,
      i.method,
      `"${i.planName.replace(/"/g, '""')}"`,
      i.isInGym ? 'SI' : 'NO'
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Asistencias_KaliAccess_${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Capacity status helper
  const getCapacityStatus = () => {
    if (inGymCount < 20) return { label: 'AFORO FLUIDO', color: 'text-emerald-400', border: 'border-emerald-500/30', bg: 'bg-emerald-500/10' };
    if (inGymCount < 45) return { label: 'AFORO MODERADO', color: 'text-yellow-400', border: 'border-yellow-500/30', bg: 'bg-yellow-500/10' };
    return { label: 'AFORO CONCURRIDO', color: 'text-red-400', border: 'border-red-500/30', bg: 'bg-red-500/10' };
  };

  const cap = getCapacityStatus();

  return (
    <div className="space-y-6 pb-20 max-w-7xl mx-auto animate-[fadeIn_0.3s_ease-out]">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4 border-b border-zinc-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.8)]"></span>
            <span className="text-[10px] font-mono-tech tracking-[0.3em] text-zinc-500 uppercase">
              CONTROL DE ACCESO // MONITOREO EN TIEMPO REAL
            </span>
          </div>
          <h1 className="text-3xl lg:text-4xl font-tech font-black text-white uppercase tracking-tighter mt-1">
            ASISTENCIAS <span className="text-yellow-500">DEL DÍA</span>
          </h1>
          <p className="text-xs text-zinc-400 font-mono-tech mt-1">
            Hoy: {new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* CLOCK & ACTIONS */}
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
          {/* DIGITAL CLOCK */}
          <div className="bg-zinc-950 border border-zinc-800 px-4 py-2 rounded-xl flex items-center gap-3 shadow-inner">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-mono-tech font-black text-white text-sm tracking-widest">
              {currentTime || '--:--:--'}
            </span>
          </div>

          <button
            onClick={loadAttendanceData}
            disabled={isLoading}
            className="px-4 py-2 bg-zinc-900 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 rounded-xl font-tech font-bold text-xs uppercase flex items-center gap-2 transition-all active:scale-95"
            title="Recargar asistencias"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 text-yellow-500 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            ACTUALIZAR
          </button>

          <button
            onClick={handleExportCSV}
            disabled={items.length === 0}
            className="px-4 py-2 bg-zinc-900 border border-zinc-700 text-zinc-300 hover:text-emerald-400 hover:border-emerald-600/50 rounded-xl font-tech font-bold text-xs uppercase flex items-center gap-2 transition-all active:scale-95 disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            EXPORTAR CSV
          </button>
        </div>
      </div>

      {/* METRICS & LIVE CAPACITY ROW */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* CARD 1: CLIENTES EN SALA (AFORO EN VIVO) */}
        <div className={`p-5 rounded-2xl border ${cap.border} ${cap.bg} relative overflow-hidden flex flex-col justify-between shadow-lg`}>
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-tech font-bold uppercase tracking-widest text-zinc-400">
              CLIENTES EN SALA AHORA
            </span>
            <span className={`text-[9px] font-mono-tech font-black px-2 py-0.5 rounded-full border ${cap.border} ${cap.color}`}>
              {cap.label}
            </span>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className={`text-5xl font-mono-tech font-black tracking-tighter ${cap.color}`}>
              {inGymCount}
            </span>
            <span className="text-xs text-zinc-500 font-mono-tech uppercase">personas en últimas 2h</span>
          </div>
          <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden mt-1">
            <div 
              className={`h-full transition-all duration-500 ${inGymCount > 40 ? 'bg-red-500' : inGymCount > 20 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(100, Math.max(5, (inGymCount / 50) * 100))}%` }}
            ></div>
          </div>
        </div>

        {/* CARD 2: TOTAL DE HOY */}
        <div className="p-5 rounded-2xl border border-zinc-800 bg-zinc-950 flex flex-col justify-between shadow-lg">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-tech font-bold uppercase tracking-widest text-zinc-400">
              TOTAL DE ASISTENCIAS HOY
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <div className="my-2">
            <span className="text-5xl font-mono-tech font-black text-white tracking-tighter">
              {totalToday}
            </span>
          </div>
          <p className="text-[10px] text-zinc-500 font-mono-tech uppercase">
            Registros acumulados desde 00:00 hrs
          </p>
        </div>

        {/* CARD 3: ACCESOS POR HUELLA */}
        <div className="p-5 rounded-2xl border border-zinc-800 bg-zinc-950 flex flex-col justify-between shadow-lg">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-tech font-bold uppercase tracking-widest text-emerald-400">
              ACCESO POR HUELLA DIGITAL
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m12 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17" />
            </svg>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-5xl font-mono-tech font-black text-emerald-400 tracking-tighter">
              {fingerprintCount}
            </span>
            <span className="text-xs text-zinc-500 font-mono-tech">
              ({totalToday > 0 ? Math.round((fingerprintCount / totalToday) * 100) : 0}%)
            </span>
          </div>
          <p className="text-[10px] text-zinc-500 font-mono-tech uppercase">
            Identificación biométrica 1:N
          </p>
        </div>

        {/* CARD 4: ACCESOS POR QR */}
        <div className="p-5 rounded-2xl border border-zinc-800 bg-zinc-950 flex flex-col justify-between shadow-lg">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-tech font-bold uppercase tracking-widest text-yellow-400">
              ACCESO POR CÓDIGO QR
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
          </div>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-5xl font-mono-tech font-black text-yellow-400 tracking-tighter">
              {qrCount}
            </span>
            <span className="text-xs text-zinc-500 font-mono-tech">
              ({totalToday > 0 ? Math.round((qrCount / totalToday) * 100) : 0}%)
            </span>
          </div>
          <p className="text-[10px] text-zinc-500 font-mono-tech uppercase">
            Credencial digital / Carnet QR
          </p>
        </div>
      </div>

      {/* FILTER & SEARCH BAR */}
      <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
        
        {/* SEARCH INPUT */}
        <div className="relative w-full md:w-80">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por socio, teléfono o plan..."
            className="w-full bg-black border border-zinc-800 text-white text-xs font-mono-tech py-2.5 pl-9 pr-8 rounded-xl focus:border-yellow-500 outline-none transition-all placeholder:text-zinc-600"
          />
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>

        {/* FILTER BUTTONS */}
        <div className="flex items-center gap-1.5 w-full md:w-auto overflow-x-auto pb-1 md:pb-0 custom-scrollbar">
          <button
            onClick={() => setMethodFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg font-tech font-bold text-xs uppercase tracking-wider transition-all whitespace-nowrap ${methodFilter === 'ALL' ? 'bg-yellow-500 text-black shadow-md' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
          >
            TODOS ({items.length})
          </button>
          <button
            onClick={() => setMethodFilter('IN_GYM')}
            className={`px-3 py-1.5 rounded-lg font-tech font-bold text-xs uppercase tracking-wider transition-all whitespace-nowrap ${methodFilter === 'IN_GYM' ? 'bg-emerald-500 text-black shadow-md' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
          >
            EN SALA ({inGymCount})
          </button>
          <button
            onClick={() => setMethodFilter('HUELLA')}
            className={`px-3 py-1.5 rounded-lg font-tech font-bold text-xs uppercase tracking-wider transition-all whitespace-nowrap ${methodFilter === 'HUELLA' ? 'bg-emerald-600 text-white shadow-md' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
          >
            HUELLA ({fingerprintCount})
          </button>
          <button
            onClick={() => setMethodFilter('QR')}
            className={`px-3 py-1.5 rounded-lg font-tech font-bold text-xs uppercase tracking-wider transition-all whitespace-nowrap ${methodFilter === 'QR' ? 'bg-yellow-600 text-white shadow-md' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
          >
            QR ({qrCount})
          </button>
        </div>
      </div>

      {/* ATTENDANCE TABLE / LIST */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
        {isLoading && items.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-yellow-500 mb-3"></div>
            <p className="text-zinc-500 font-tech text-xs tracking-widest uppercase">Cargando registros de hoy...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-16 text-center px-4">
            <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 mx-auto flex items-center justify-center text-zinc-600 mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-lg font-tech font-black text-white uppercase tracking-tight">
              {searchTerm ? 'No se encontraron asistencias' : 'Aún no hay asistencias registradas hoy'}
            </h3>
            <p className="text-xs text-zinc-500 font-mono-tech mt-1 max-w-sm mx-auto">
              {searchTerm ? 'Prueba con otro término de búsqueda o limpia el filtro.' : 'Los socios que pasen su huella digital o código QR aparecerán listados aquí en tiempo real.'}
            </p>
            {!searchTerm && (
              <div className="flex justify-center gap-3 mt-4">
                {onOpenBiometricScanner && (
                  <button
                    onClick={onOpenBiometricScanner}
                    className="px-4 py-2 bg-yellow-500 text-black font-tech font-bold text-xs uppercase rounded-xl hover:bg-yellow-400 transition-all shadow-lg"
                  >
                    IR A ACCESO HUELLA
                  </button>
                )}
                {onOpenQrScanner && (
                  <button
                    onClick={onOpenQrScanner}
                    className="px-4 py-2 bg-zinc-900 border border-zinc-700 text-zinc-300 font-tech font-bold text-xs uppercase rounded-xl hover:text-white transition-all"
                  >
                    IR A ACCESO QR
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/60 text-zinc-400 font-tech text-[11px] uppercase tracking-wider">
                  <th className="py-3.5 px-4 font-bold">HORA DE INGRESO</th>
                  <th className="py-3.5 px-4 font-bold">SOCIO / CLIENTE</th>
                  <th className="py-3.5 px-4 font-bold">MÉTODO</th>
                  <th className="py-3.5 px-4 font-bold">PLAN / DISCIPLINA</th>
                  <th className="py-3.5 px-4 font-bold text-center">ESTADO EN SALA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900 font-sans text-xs">
                {filteredItems.map((item, index) => (
                  <tr key={item.id} className="hover:bg-zinc-900/40 transition-colors">
                    
                    {/* HORA */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="font-mono-tech font-bold text-white text-sm">
                        {formatExactTime(item.created_at)}
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono-tech">
                        {getRelativeTime(item.created_at)}
                      </div>
                    </td>

                    {/* SOCIO */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        {item.clientPhoto ? (
                          <img
                            src={item.clientPhoto}
                            alt={item.clientName}
                            className="w-10 h-10 rounded-full object-cover border-2 border-zinc-700 shadow"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-zinc-800 border-2 border-zinc-700 flex items-center justify-center font-tech font-black text-yellow-500 text-sm">
                            {item.clientName.substring(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="font-tech font-bold text-white text-sm uppercase tracking-wide">
                            {item.clientName}
                          </div>
                          {item.clientPhone && (
                            <div className="text-[11px] text-zinc-500 font-mono-tech">
                              📞 {item.clientPhone}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* METODO */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {item.method === 'HUELLA' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono-tech font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m12 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17" />
                          </svg>
                          HUELLA DIGITAL
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono-tech font-bold uppercase bg-yellow-500/10 text-yellow-400 border border-yellow-500/30">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                          </svg>
                          CÓDIGO QR
                        </span>
                      )}
                    </td>

                    {/* PLAN */}
                    <td className="py-3.5 px-4">
                      <span className="font-mono-tech text-xs text-zinc-300 font-semibold uppercase">
                        {item.planName}
                      </span>
                      {item.membershipEnd && (
                        <div className="text-[10px] text-zinc-500 font-mono-tech">
                          Vence: {item.membershipEnd}
                        </div>
                      )}
                    </td>

                    {/* EN SALA STATUS */}
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      {item.isInGym ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono-tech font-black uppercase bg-emerald-500 text-black shadow-md">
                          <span className="w-1.5 h-1.5 rounded-full bg-black animate-ping"></span>
                          EN SALA
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono-tech text-zinc-600 uppercase">
                          COMPLETADO (&gt;2h)
                        </span>
                      )}
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};
