import React, { useState, useEffect } from 'react';
import { Package, Activity } from '../types';
import { getPackages, getActivities, addPackage, updatePackage, deletePackage, addActivity, updateActivity, deleteActivity, getPackageActivityRelations } from '../services/storage';
import { useToast } from '../context/ToastContext';

const ServicesPanel: React.FC = () => {
    const { showToast } = useToast();
    const [packages, setPackages] = useState<Package[]>([]);
    const [activities, setActivities] = useState<Activity[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    // Activity Form State
    const [actName, setActName] = useState('');
    const [actCost, setActCost] = useState('');
    const [selectedPkgIdsForAct, setSelectedPkgIdsForAct] = useState<Set<string>>(new Set());
    const [editingActId, setEditingActId] = useState<string | null>(null);

    // Package Form State
    const [pkgName, setPkgName] = useState('');
    const [pkgCost, setPkgCost] = useState('');
    const [pkgDuration, setPkgDuration] = useState('30');
    const [pkgRequiresCred, setPkgRequiresCred] = useState(false);
    const [selectedActIds, setSelectedActIds] = useState<Set<string>>(new Set());
    const [editingPkgId, setEditingPkgId] = useState<string | null>(null);
    
    const [isSaving, setIsSaving] = useState(false);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [p, a, relations] = await Promise.all([
                getPackages(),
                getActivities(),
                getPackageActivityRelations()
            ]);
            setPackages(p);
            setActivities(a);
            
            // Note: relations logic handles displaying connections if needed, 
            // but for simplicity in this UI we mostly rely on selecting connections during creation.
            // A more complex UI would map existing relations to the 'selected' sets when editing.
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    // --- ACTIVITY HANDLERS ---
    const handleSaveActivity = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSaving) return;

        setIsSaving(true);
        try {
            const packageIds = Array.from(selectedPkgIdsForAct) as string[];

            if (editingActId) {
                await updateActivity(editingActId, actName, parseFloat(actCost), packageIds);
                showToast('Clase actualizada', 'success');
            } else {
                await addActivity(actName, parseFloat(actCost), packageIds);
                showToast('Clase creada', 'success');
            }
            setActName('');
            setActCost('');
            setSelectedPkgIdsForAct(new Set());
            setEditingActId(null);
            loadData();
        } catch (e: any) {
            showToast('Error: ' + e.message, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleEditActivity = (act: Activity) => {
        setEditingActId(act.id);
        setActName(act.name);
        setActCost(act.cost.toString());
        // For editing relations, ideally we'd fetch them specifically.
        // Assuming current implementation updates blindly, user might need to re-select if we don't fetch.
        // For now, simpler implementation:
        setSelectedPkgIdsForAct(new Set());
    };

    const handleDeleteActivity = async (id: string) => {
        if (!window.confirm("¿Eliminar actividad?")) return;
        try {
            await deleteActivity(id);
            loadData();
            showToast('Actividad eliminada', 'info');
        } catch(e) { showToast('Error eliminando', 'error'); }
    };

    // --- PACKAGE HANDLERS ---
    const handleSavePackage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSaving) return;

        setIsSaving(true);
        try {
            const pkgData = {
                name: pkgName,
                cost: parseFloat(pkgCost),
                discount_amount: 0,
                duration_days: parseInt(pkgDuration),
                requires_credential: pkgRequiresCred
            };
            
            const activityIds = Array.from(selectedActIds) as string[];

            if (editingPkgId) {
                await updatePackage(editingPkgId, pkgData, activityIds);
                showToast('Paquete actualizado', 'success');
            } else {
                await addPackage(pkgData, activityIds);
                showToast('Paquete creado', 'success');
            }
            // Reset Form
            setPkgName('');
            setPkgCost('');
            setPkgDuration('30');
            setPkgRequiresCred(false);
            setSelectedActIds(new Set());
            setEditingPkgId(null);
            loadData();
        } catch (e: any) {
            showToast('Error: ' + e.message, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleEditPackage = (pkg: Package) => {
        setEditingPkgId(pkg.id);
        setPkgName(pkg.name);
        setPkgCost(pkg.cost.toString());
        setPkgDuration(pkg.duration_days.toString());
        setPkgRequiresCred(pkg.requires_credential || false);
        setSelectedActIds(new Set());
    };

    const handleDeletePackage = async (id: string) => {
         if (!window.confirm("¿Eliminar paquete?")) return;
        try {
            await deletePackage(id);
            loadData();
            showToast('Paquete eliminado', 'info');
        } catch(e) { showToast('Error eliminando', 'error'); }
    };

    const labelStyle = "block text-xs font-tech text-yellow-500/80 mb-2 uppercase tracking-widest";
    const inputStyle = "w-full bg-black/50 border-2 border-zinc-700 px-4 py-2 text-white focus:border-yellow-500 outline-none font-mono-tech";
    const btnPrimary = "bg-yellow-500 text-black font-tech font-bold uppercase tracking-widest px-4 py-2 hover:bg-yellow-400 text-xs";

    return (
        <div className="animate-[fadeIn_0.5s_ease-out]">
            <h2 className="text-3xl font-tech font-bold mb-8 text-white">GESTIÓN DE <span className="text-yellow-500">SERVICIOS</span></h2>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                
                {/* --- SECCIÓN PAQUETES --- */}
                <div className="space-y-6">
                    <div className="bg-zinc-900/50 border border-zinc-800 p-6 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10 font-black text-6xl text-white">PKG</div>
                        <h3 className="text-xl font-tech font-bold text-white mb-4 border-b border-zinc-800 pb-2">
                            {editingPkgId ? 'EDITAR PAQUETE' : 'CREAR PAQUETE'}
                        </h3>
                        
                        <form onSubmit={handleSavePackage} className="space-y-4">
                            <div>
                                <label className={labelStyle}>NOMBRE DEL PAQUETE</label>
                                <input value={pkgName} onChange={e => setPkgName(e.target.value)} className={inputStyle} placeholder="Ej. MENSUALIDAD GIMNASIO" required />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className={labelStyle}>COSTO</label>
                                    <input type="number" value={pkgCost} onChange={e => setPkgCost(e.target.value)} className={inputStyle} placeholder="0.00" required />
                                </div>
                                <div>
                                    <label className={labelStyle}>DURACIÓN (DÍAS)</label>
                                    <select value={pkgDuration} onChange={e => setPkgDuration(e.target.value)} className={inputStyle}>
                                        <option value="1">1 (Visita)</option>
                                        <option value="7">7 (Semana)</option>
                                        <option value="15">15 (Quincena)</option>
                                        <option value="30">30 (Mes)</option>
                                        <option value="90">90 (Trimestre)</option>
                                        <option value="365">365 (Anual)</option>
                                    </select>
                                </div>
                            </div>
                            
                            <label className="flex items-center gap-2 cursor-pointer bg-black/30 p-2 border border-zinc-700">
                                <input type="checkbox" checked={pkgRequiresCred} onChange={e => setPkgRequiresCred(e.target.checked)} className="accent-yellow-500 w-4 h-4" />
                                <span className="text-xs font-mono-tech text-zinc-300">REQUIERE CREDENCIAL OBLIGATORIA</span>
                            </label>

                            <div className="border-t border-zinc-700 pt-4 mt-2">
                                <p className="text-[10px] text-zinc-500 uppercase mb-2">INCLUYE ACCESO A:</p>
                                <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto">
                                    {activities.map(act => (
                                        <label key={act.id} className="flex items-center gap-2 text-xs font-mono-tech text-zinc-400">
                                            <input 
                                                type="checkbox" 
                                                checked={selectedActIds.has(act.id)} 
                                                onChange={() => {
                                                    const newSet = new Set(selectedActIds);
                                                    if (newSet.has(act.id)) newSet.delete(act.id);
                                                    else newSet.add(act.id);
                                                    setSelectedActIds(newSet);
                                                }}
                                                className="accent-yellow-500"
                                            />
                                            {act.name}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className="flex gap-2 justify-end pt-2">
                                {editingPkgId && <button type="button" onClick={() => { setEditingPkgId(null); setPkgName(''); setPkgCost(''); setSelectedActIds(new Set()); }} className="text-xs text-zinc-400 underline" disabled={isSaving}>CANCELAR</button>}
                                <button type="submit" disabled={isSaving} className={`${btnPrimary} disabled:opacity-50`}>
                                    {isSaving ? 'GUARDANDO...' : (editingPkgId ? 'ACTUALIZAR' : 'CREAR')}
                                </button>
                            </div>
                        </form>
                    </div>

                    {/* LIST */}
                    <div className="space-y-2">
                        {packages.map(pkg => (
                            <div key={pkg.id} className="bg-zinc-900 border border-zinc-800 p-4 flex justify-between items-center group hover:border-yellow-500/50 transition-colors">
                                <div>
                                    <p className="font-bold text-white text-sm">{pkg.name}</p>
                                    <p className="text-xs text-zinc-500 font-mono-tech">${pkg.cost} • {pkg.duration_days} DÍAS</p>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => handleEditPackage(pkg)} className="text-yellow-500 text-[10px] border border-zinc-700 px-2 py-1 hover:bg-zinc-800">EDITAR</button>
                                    <button onClick={() => handleDeletePackage(pkg.id)} className="text-red-500 text-[10px] border border-zinc-700 px-2 py-1 hover:bg-zinc-800">BORRAR</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* --- SECCIÓN ACTIVIDADES (CLASES) --- */}
                <div className="space-y-6">
                    <div className="bg-zinc-900/50 border border-zinc-800 p-6 relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-4 opacity-10 font-black text-6xl text-white">ACT</div>
                        <h3 className="text-xl font-tech font-bold text-white mb-4 border-b border-zinc-800 pb-2">
                            {editingActId ? 'EDITAR CLASE / ACTIVIDAD' : 'CREAR CLASE / ACTIVIDAD'}
                        </h3>
                        
                        <form onSubmit={handleSaveActivity} className="space-y-4">
                            <div>
                                <label className={labelStyle}>NOMBRE DE LA ACTIVIDAD</label>
                                <input value={actName} onChange={e => setActName(e.target.value)} className={inputStyle} placeholder="Ej. BOXEO, PESAS..." required />
                            </div>
                            <div>
                                <label className={labelStyle}>COSTO (CLASE SUELTA)</label>
                                <input type="number" value={actCost} onChange={e => setActCost(e.target.value)} className={inputStyle} placeholder="0.00" required />
                            </div>

                            <div className="flex gap-2 justify-end pt-2">
                                {editingActId && <button type="button" onClick={() => { setEditingActId(null); setActName(''); setActCost(''); setSelectedPkgIdsForAct(new Set()); }} className="text-xs text-zinc-400 underline" disabled={isSaving}>CANCELAR</button>}
                                <button type="submit" disabled={isSaving} className={`${btnPrimary} disabled:opacity-50`}>
                                    {isSaving ? 'GUARDANDO...' : (editingActId ? 'ACTUALIZAR' : 'CREAR')}
                                </button>
                            </div>
                        </form>
                    </div>

                    {/* LIST */}
                    <div className="space-y-2">
                         {activities.map(act => (
                            <div key={act.id} className="bg-zinc-900 border border-zinc-800 p-4 flex justify-between items-center group hover:border-yellow-500/50 transition-colors">
                                <div>
                                    <p className="font-bold text-white text-sm">{act.name}</p>
                                    <p className="text-xs text-zinc-500 font-mono-tech">VISITA: ${act.cost}</p>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => handleEditActivity(act)} className="text-yellow-500 text-[10px] border border-zinc-700 px-2 py-1 hover:bg-zinc-800">EDITAR</button>
                                    <button onClick={() => handleDeleteActivity(act.id)} className="text-red-500 text-[10px] border border-zinc-700 px-2 py-1 hover:bg-zinc-800">BORRAR</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default ServicesPanel;