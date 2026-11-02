import React, { useState, useMemo } from 'react';
import { Client, Package, Activity, PaymentMethod, ClientSubscription } from '../types';
import { renewClientSubscription } from '../services/storage';
import { useToast } from '../context/ToastContext';

interface RenewalModalProps {
  client: Client;
  packages: Package[];
  activities: Activity[];
  subscriptions?: ClientSubscription[];
  packageRelations?: {package_id: string, activity_id: string}[];
  userName: string;
  onClose: () => void;
  onSuccess: (amount: number, concept: string, startDate: string, endDate: string, packageId?: string | null, activityId?: string | null) => void;
}

interface TabState {
  selectedPkgId: string;
  selectedActId: string;
  startDate: string;
  endDate: string;
  cost: number;
  paymentMethod: PaymentMethod;
}

const RenewalModal: React.FC<RenewalModalProps> = ({ 
    client: initialClient, 
    packages, 
    activities, 
    subscriptions = [], 
    packageRelations = [], 
    userName, 
    onClose, 
    onSuccess 
}) => {
    const { showToast } = useToast();
    const client = (initialClient as any).originClient || initialClient;

    // 1. Calcular sugerencias de renovación basadas estrictamente en las suscripciones activas (o última renovada si todas están vencidas)
    const suggestions = useMemo(() => {
        const list: {
            type: 'PACKAGE' | 'ACTIVITY';
            id: string;
            name: string;
            details?: string;
            cost: number;
            duration_days: number;
            endDate?: string;
        }[] = [];

        const allClientSubs = (subscriptions || []).filter(sub => sub.client_id === client.id);
        
        // 1. FILTRAR ESTRICTAMENTE SUSCRIPCIONES ACTIVAS (NO DADAS DE BAJA)
        const activeSubs = allClientSubs.filter(sub => sub.isActive);

        // Si el cliente no tiene ninguna suscripción activa (ej. todas vencidas o dadas de baja),
        // tomamos como sugerencia únicamente la más reciente
        const targetSubs = activeSubs.length > 0 
            ? activeSubs 
            : (allClientSubs.length > 0 
                ? [[...allClientSubs].sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''))[0]] 
                : []);

        targetSubs.forEach(sub => {
            if (sub.package_id) {
                const pkg = packages.find(p => p.id === sub.package_id);
                if (pkg) {
                    list.push({
                        type: 'PACKAGE',
                        id: sub.package_id,
                        name: `PLAN: ${pkg.name}`,
                        details: sub.isActive ? 'Plan / Paquete contratado actualmente' : 'Último plan registrado',
                        cost: pkg.cost,
                        duration_days: pkg.duration_days,
                        endDate: sub.endDate
                    });
                    // NO duplicamos las clases sueltas incluidas en el paquete.
                    // Si contrató el plan integral, solo se ofrece el paquete principal para mantener limpio el panel.
                }
            } else if (sub.activity_id) {
                // Solo si fue contratada directamente como disciplina/clase suelta sin paquete
                const act = activities.find(a => a.id === sub.activity_id);
                if (act) {
                    list.push({
                        type: 'ACTIVITY',
                        id: sub.activity_id,
                        name: `CLASE: ${act.name}`,
                        details: sub.isActive ? 'Disciplina contratada por separado' : 'Última disciplina registrada',
                        cost: act.cost || 350,
                        duration_days: 30,
                        endDate: sub.endDate
                    });
                }
            }
        });

        // 2. Si no hubo ninguna suscripción encontrada en la tabla de suscripciones,
        // usar el package_id o activity_id directo del perfil del cliente
        if (list.length === 0) {
            if (client.package_id) {
                const pkg = packages.find(p => p.id === client.package_id);
                if (pkg) {
                    list.push({
                        type: 'PACKAGE',
                        id: client.package_id,
                        name: `PLAN: ${pkg.name}`,
                        details: 'Plan / Paquete de su perfil',
                        cost: pkg.cost,
                        duration_days: pkg.duration_days,
                        endDate: client.membershipEnd || undefined
                    });
                }
            } else if (client.activity_id) {
                const act = activities.find(a => a.id === client.activity_id);
                if (act) {
                    list.push({
                        type: 'ACTIVITY',
                        id: client.activity_id,
                        name: `CLASE: ${act.name}`,
                        details: 'Disciplina de su perfil',
                        cost: act.cost || 350,
                        duration_days: 30,
                        endDate: client.membershipEnd || undefined
                    });
                }
            }
        }

        // 3. Desduplicar por (type + id) y ordenar por endDate descendente
        const uniqueMap = new Map<string, typeof list[0]>();
        list.forEach(item => {
            const key = `${item.type}_${item.id}`;
            const existing = uniqueMap.get(key);
            if (!existing) {
                uniqueMap.set(key, item);
            } else {
                if (item.endDate && (!existing.endDate || new Date(item.endDate).getTime() > new Date(existing.endDate).getTime())) {
                    uniqueMap.set(key, item);
                }
            }
        });

        return Array.from(uniqueMap.values()).sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''));
    }, [client, packages, activities, subscriptions]);

    // Opción seleccionada: 0, 1... o 'MANUAL'
    const [selectedSugIndex, setSelectedSugIndex] = useState<number | 'MANUAL'>(() => {
        return suggestions.length > 0 ? 0 : 'MANUAL';
    });

    // 2. Extraer lista de disciplinas registradas/activas del cliente para generar las tabs correspondientes
    const clientDisciplines = useMemo(() => {
        const activeDisciplines = new Set<string>();
        
        // 1. Desde suscripciones ACTIVAS de este cliente
        const clientSubs = (subscriptions || []).filter(sub => sub.client_id === client.id && sub.isActive);
        
        clientSubs.forEach(sub => {
            if (sub.package_id) {
                const relActivityIds = packageRelations
                    .filter(r => r.package_id === sub.package_id)
                    .map(r => r.activity_id);
                
                relActivityIds.forEach(actId => {
                    const actObj = activities.find(a => a.id === actId);
                    if (actObj) {
                        activeDisciplines.add(actObj.name.trim());
                    }
                });
            }
            if (sub.activity_id) {
                const actObj = activities.find(a => a.id === sub.activity_id);
                if (actObj) {
                    activeDisciplines.add(actObj.name.trim());
                }
            }
        });

        // 2. Si no hay suscripciones activas en clientSubs, tomar del perfil del cliente
        if (activeDisciplines.size === 0) {
            if (client.package_id) {
                const relActivityIds = packageRelations
                    .filter(r => r.package_id === client.package_id)
                    .map(r => r.activity_id);
                
                relActivityIds.forEach(actId => {
                    const actObj = activities.find(a => a.id === actId);
                    if (actObj) {
                        activeDisciplines.add(actObj.name.trim());
                    }
                });
            }
            if (client.activity_id) {
                const actObj = activities.find(a => a.id === client.activity_id);
                if (actObj) {
                    activeDisciplines.add(actObj.name.trim());
                }
            }
        }

        return Array.from(activeDisciplines);
    }, [client, packages, activities, subscriptions, packageRelations]);

    // Obtener exactamente dos disciplinas para las dos pestañas de "PLAN / PAQUETE ESPECÍFICO"
    const selectedDisciplines = useMemo(() => {
        const list: { id?: string; name: string }[] = [];
        
        // 1. Añadir de las registradas en el cliente
        clientDisciplines.forEach(name => {
            const actObj = activities.find(a => a.name.trim().toLowerCase() === name.trim().toLowerCase());
            list.push({
                id: actObj?.id,
                name: name
            });
        });

        // 2. Si hay menos de 2, completar con actividades del gimnasio
        if (list.length < 2) {
            activities.forEach(act => {
                const alreadyAdded = list.some(item => item.name.trim().toLowerCase() === act.name.trim().toLowerCase());
                if (!alreadyAdded) {
                    list.push({
                        id: act.id,
                        name: act.name
                    });
                }
            });
        }

        return list.slice(0, 2);
    }, [clientDisciplines, activities]);

    // Definir pestañas dinámicas del formulario manual (exactamente dos botones "PLAN / PAQUETE ESPECÍFICO")
    const modalTabs = useMemo(() => {
        const tabsList: {
            id: string;
            label: string;
            type: 'PACKAGE' | 'ACTIVITY';
            disciplineName: string | undefined;
        }[] = selectedDisciplines.map((discipline, idx) => ({
            id: `pkg_tab_${idx}`,
            label: discipline.name ? `PLAN: ${discipline.name.toUpperCase()}` : 'PLAN / PAQUETE ESPECÍFICO',
            type: 'PACKAGE' as const,
            disciplineName: discipline.name
        }));
        
        if (tabsList.length === 0) {
            tabsList.push({
                id: 'pkg_tab_default',
                label: 'PLAN / PAQUETE ESPECÍFICO',
                type: 'PACKAGE' as const,
                disciplineName: undefined
            });
        }
        
        return tabsList;
    }, [selectedDisciplines]);

    // Función auxiliar para obtener el estado inicial por pestaña (siempre trabaja con PACKAGE de la disciplina)
    const getInitialStateForTab = (tabType: 'PACKAGE' | 'ACTIVITY', disciplineName?: string): TabState => {
        const today = new Date().toISOString().split('T')[0];
        
        let targetStartDate = today;
        let defaultPkgId = '';
        let defaultCost = 0;
        let defaultActId = '';
        
        const clientSubs = (subscriptions || []).filter(sub => sub.client_id === client.id && sub.isActive);

        let filteredPkgs = packages;
        let actIds: string[] = [];
        if (disciplineName) {
            actIds = activities
                .filter(a => a.name.trim().toLowerCase() === disciplineName.trim().toLowerCase())
                .map(a => a.id);
            const validPkgIds = packageRelations
                .filter(r => actIds.includes(r.activity_id))
                .map(r => r.package_id);
            filteredPkgs = packages.filter(p => validPkgIds.includes(p.id));
            if (filteredPkgs.length === 0) filteredPkgs = packages;
        }

        // Buscar suscripción activa o última suscripción directa del cliente para esta disciplina/actividad
        let matchedSub = clientSubs.find(sub => sub.activity_id && actIds.includes(sub.activity_id));
        if (!matchedSub) {
            matchedSub = clientSubs.find(sub => {
                if (sub.package_id) {
                    return packageRelations.some(r => r.package_id === sub.package_id && actIds.includes(r.activity_id));
                }
                return false;
            });
        }

        let matchedPkgId = '';
        if (matchedSub) {
            if (matchedSub.package_id) {
                matchedPkgId = matchedSub.package_id;
            }
            // Si la membresía actual vence en el futuro, la fecha de inicio de la renovación hereda ese vencimiento
            if (matchedSub.endDate && new Date(matchedSub.endDate).getTime() >= new Date(today).getTime()) {
                targetStartDate = matchedSub.endDate;
            }
        } else if (disciplineName) {
            // Sino, buscar en datos de perfil heredados del cliente
            if (client.package_id) {
                const pkg = packages.find(p => p.id === client.package_id);
                const isPkgRelToAct = packageRelations.some(r => r.package_id === client.package_id && actIds.includes(r.activity_id));
                if (pkg && isPkgRelToAct) {
                    matchedPkgId = client.package_id;
                    if (client.membershipEnd && new Date(client.membershipEnd).getTime() >= new Date(today).getTime()) {
                        targetStartDate = client.membershipEnd;
                    }
                }
            } else if (client.activity_id && actIds.includes(client.activity_id)) {
                if (client.membershipEnd && new Date(client.membershipEnd).getTime() >= new Date(today).getTime()) {
                    targetStartDate = client.membershipEnd;
                }
            }
        }

        // Determinar el paquete pre seleccionado
        let selectedPkg = filteredPkgs.find(p => p.id === matchedPkgId);
        if (!selectedPkg && matchedPkgId) {
            selectedPkg = packages.find(p => p.id === matchedPkgId);
        }
        if (!selectedPkg) {
            selectedPkg = filteredPkgs.find(p => p.id === client.package_id);
        }
        if (!selectedPkg) {
            // Evitar preseleccionar un ticket/clase suelta de 1 día si podemos sugerir un plan mensual de 30 o más días de esa disciplina
            const monthlyPkg = filteredPkgs.find(p => p.duration_days >= 30);
            selectedPkg = monthlyPkg || (filteredPkgs.length > 0 ? filteredPkgs[0] : null);
        }

        defaultPkgId = selectedPkg ? selectedPkg.id : '';
        defaultCost = selectedPkg ? selectedPkg.cost : 0;
        
        const days = selectedPkg ? selectedPkg.duration_days : 30;
        const d = new Date(targetStartDate);
        d.setDate(d.getDate() + days);
        const end = d.toISOString().split('T')[0];
        
        // Encontrar la disciplina por defecto para inicializar selectedActId
        if (disciplineName) {
            const act = activities.find(a => a.name.trim().toLowerCase() === disciplineName.trim().toLowerCase());
            if (act) defaultActId = act.id;
        }
        if (!defaultActId && activities.length > 0) {
            defaultActId = activities[0].id;
        }

        return {
            selectedPkgId: defaultPkgId,
            selectedActId: defaultActId,
            startDate: targetStartDate,
            endDate: end,
            cost: defaultCost,
            paymentMethod: PaymentMethod.CASH
        };
    };

    // Estado del Tab Activo
    const [activeTabId, setActiveTabId] = useState<string>(() => {
        return modalTabs[0].id;
    });

    // Estado agrupado para persistir los valores cargados en cada pestaña
    const [tabsState, setTabsState] = useState<Record<string, TabState>>(() => {
        const initialState: Record<string, TabState> = {};
        modalTabs.forEach(tab => {
            initialState[tab.id] = getInitialStateForTab(tab.type, tab.disciplineName);
        });

        if (suggestions.length > 0 && modalTabs[0]) {
            const sug = suggestions[0];
            const targetTabId = modalTabs[0].id;
            const today = new Date().toISOString().split('T')[0];
            let targetStartDate = today;
            if (sug.endDate && new Date(sug.endDate).getTime() >= new Date(today).getTime()) {
                targetStartDate = sug.endDate;
            }

            const d = new Date(targetStartDate);
            d.setDate(d.getDate() + (sug.type === 'PACKAGE' ? sug.duration_days : 30));
            const end = d.toISOString().split('T')[0];

            initialState[targetTabId] = {
                ...initialState[targetTabId],
                selectedPkgId: sug.type === 'PACKAGE' ? sug.id : '',
                selectedActId: sug.type === 'ACTIVITY' ? sug.id : (initialState[targetTabId]?.selectedActId || ''),
                cost: sug.cost,
                startDate: targetStartDate,
                endDate: end,
                paymentMethod: PaymentMethod.CASH
            };
        }

        return initialState;
    });

    // Obtener los datos y valores activos de la pestaña seleccionada
    const currentTab = useMemo(() => {
        return modalTabs.find(t => t.id === activeTabId) || modalTabs[0];
    }, [modalTabs, activeTabId]);

    const currentValues = useMemo(() => {
        return tabsState[activeTabId] || getInitialStateForTab(currentTab.type, currentTab.disciplineName);
    }, [tabsState, activeTabId, currentTab]);

    // Filtrar paquetes según la disciplina de la pestaña seleccionada (Mostrando todos pero ordenando los correspondientes arriba)
    const displayedPackages = useMemo(() => {
        if (currentTab.disciplineName) {
            const actIds = activities
                .filter(a => a.name.trim().toLowerCase() === currentTab.disciplineName!.trim().toLowerCase())
                .map(a => a.id);
            const validPkgIds = packageRelations
                .filter(r => actIds.includes(r.activity_id))
                .map(r => r.package_id);
            
            const related = packages.filter(p => validPkgIds.includes(p.id));
            const unrelated = packages.filter(p => !validPkgIds.includes(p.id));
            
            return [...related, ...unrelated];
        }
        return packages;
    }, [packages, activities, packageRelations, currentTab]);

    // Filtrar disciplinas según la pestaña seleccionada si aplica para disciplina individual
    const displayedActivities = useMemo(() => {
        if (currentTab.disciplineName) {
            const targetAct = activities.find(a => a.name.trim().toLowerCase() === currentTab.disciplineName!.trim().toLowerCase());
            if (targetAct) {
                const otherActs = activities.filter(a => a.id !== targetAct.id);
                return [targetAct, ...otherActs];
            }
        }
        return activities;
    }, [activities, currentTab]);

    // Manejar cambios en campos específicos de la pestaña activa
    const handlePackageChange = (id: string) => {
        if (!id) {
            const d = new Date(currentValues.startDate);
            d.setDate(d.getDate() + 1);
            const end = d.toISOString().split('T')[0];
            
            let baseCost = 350;
            let firstActId = currentValues.selectedActId;
            if (currentTab.disciplineName) {
                const act = activities.find(a => a.name.trim().toLowerCase() === currentTab.disciplineName!.trim().toLowerCase());
                if (act) {
                    baseCost = act.cost || 350;
                    firstActId = act.id;
                }
            }
            if (!firstActId && activities.length > 0) {
                firstActId = activities[0].id;
            }
            
            setTabsState(prev => ({
                ...prev,
                [activeTabId]: {
                    ...(prev[activeTabId] || getInitialStateForTab('PACKAGE', currentTab.disciplineName)),
                    selectedPkgId: '',
                    selectedActId: firstActId,
                    cost: baseCost,
                    endDate: end
                }
            }));
            return;
        }

        const pkg = packages.find(p => p.id === id);
        if (pkg) {
            const d = new Date(currentValues.startDate);
            d.setDate(d.getDate() + pkg.duration_days);
            const end = d.toISOString().split('T')[0];

            // Encontrar la actividad relacionada para este paquete y sincronizarla
            const relActs = packageRelations
                .filter(r => r.package_id === pkg.id)
                .map(r => r.activity_id);
            
            let targetActId = '';
            if (currentTab.disciplineName) {
                const tabAct = activities.find(a => a.name.trim().toLowerCase() === currentTab.disciplineName!.trim().toLowerCase());
                if (tabAct && relActs.includes(tabAct.id)) {
                    targetActId = tabAct.id;
                }
            }
            if (!targetActId && relActs.length > 0) {
                targetActId = relActs[0];
            }
            if (!targetActId && activities.length > 0) {
                targetActId = activities[0].id;
            }

            setTabsState(prev => ({
                ...prev,
                [activeTabId]: {
                    ...(prev[activeTabId] || getInitialStateForTab('PACKAGE', currentTab.disciplineName)),
                    selectedPkgId: id,
                    selectedActId: targetActId,
                    cost: pkg.cost,
                    endDate: end
                }
            }));
        }
    };

    const handleActivityChange = (id: string) => {
        const act = activities.find(a => a.id === id);
        const d = new Date(currentValues.startDate);
        d.setDate(d.getDate() + 30);
        const end = d.toISOString().split('T')[0];
        setTabsState(prev => ({
            ...prev,
            [activeTabId]: {
                ...(prev[activeTabId] || getInitialStateForTab('ACTIVITY', currentTab.disciplineName)),
                selectedActId: id,
                cost: act ? (act.cost || 350) : 350,
                endDate: end
            }
        }));
    };

    const handleStartDateChange = (newDate: string) => {
        let days = 30;
        if (currentValues.selectedPkgId) {
            const pkg = packages.find(p => p.id === currentValues.selectedPkgId);
            if (pkg) days = pkg.duration_days;
        } else {
            days = 1; // clase suelta/visita
        }
        const d = new Date(newDate);
        d.setDate(d.getDate() + days);
        const end = d.toISOString().split('T')[0];
        
        setTabsState(prev => ({
            ...prev,
            [activeTabId]: {
                ...(prev[activeTabId] || getInitialStateForTab(currentTab.type, currentTab.disciplineName)),
                startDate: newDate,
                endDate: end
            }
        }));
    };

    const handleEndDateChange = (newDate: string) => {
        setTabsState(prev => ({
            ...prev,
            [activeTabId]: {
                ...(prev[activeTabId] || getInitialStateForTab(currentTab.type, currentTab.disciplineName)),
                endDate: newDate
            }
        }));
    };

    const handleCostChange = (newCost: number) => {
        setTabsState(prev => ({
            ...prev,
            [activeTabId]: {
                ...(prev[activeTabId] || getInitialStateForTab(currentTab.type, currentTab.disciplineName)),
                cost: newCost
            }
        }));
    };

    const handlePaymentMethodChange = (method: PaymentMethod) => {
        setTabsState(prev => ({
            ...prev,
            [activeTabId]: {
                ...(prev[activeTabId] || getInitialStateForTab(currentTab.type, currentTab.disciplineName)),
                paymentMethod: method
            }
        }));
    };

    // Sincronizar campos principales de la sugerencia rápida si es seleccionada
    const handleSugChange = (idx: number | 'MANUAL') => {
        setSelectedSugIndex(idx);
        if (idx !== 'MANUAL') {
            const sug = suggestions[idx];
            
            // Buscar si alguna de nuestras pestañas coincide de verdad con la disciplina de la sugerencia (usando ids)
            let tabIdToSync = activeTabId;
            const matchedTab = modalTabs.find(t => {
                if (!t.disciplineName) return false;
                const disciplineLower = t.disciplineName.trim().toLowerCase();
                
                if (sug.type === 'PACKAGE') {
                    const actIds = activities
                        .filter(a => a.name.trim().toLowerCase() === disciplineLower)
                        .map(a => a.id);
                    return packageRelations.some(r => r.package_id === sug.id && actIds.includes(r.activity_id));
                } else {
                    const act = activities.find(a => a.id === sug.id);
                    return act ? act.name.trim().toLowerCase() === disciplineLower : false;
                }
            });
            
            if (matchedTab) {
                tabIdToSync = matchedTab.id;
            } else {
                const firstPkgTab = modalTabs.find(t => t.type === 'PACKAGE');
                if (firstPkgTab) tabIdToSync = firstPkgTab.id;
            }
            
            setActiveTabId(tabIdToSync);
            
            // Sincronizar el estado de la pestaña con los datos de esta sugerencia
            // Para la fecha de inicio, si la sugerencia tiene un endDate que está en el futuro, hereda esa fecha
            const today = new Date().toISOString().split('T')[0];
            let targetStartDate = today;
            if (sug.endDate && new Date(sug.endDate).getTime() >= new Date(today).getTime()) {
                targetStartDate = sug.endDate;
            }

            const d = new Date(targetStartDate);
            d.setDate(d.getDate() + (sug.type === 'PACKAGE' ? sug.duration_days : 30));
            const end = d.toISOString().split('T')[0];

            setTabsState(prev => ({
                ...prev,
                [tabIdToSync]: {
                    ...getInitialStateForTab('PACKAGE', modalTabs.find(t => t.id === tabIdToSync)?.disciplineName),
                    selectedPkgId: sug.type === 'PACKAGE' ? sug.id : '',
                    selectedActId: sug.type === 'ACTIVITY' ? sug.id : '',
                    cost: sug.cost,
                    startDate: targetStartDate,
                    endDate: end,
                    paymentMethod: PaymentMethod.CASH
                }
            }));
        }
    };

    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;

        setIsSubmitting(true);
        try {
            const pkgId = currentValues.selectedPkgId || null;
            let actId = null;

            if (pkgId) {
                const relActs = packageRelations
                    .filter(r => r.package_id === pkgId)
                    .map(r => r.activity_id);
                
                if (relActs.length > 0) {
                    const tabAct = currentTab.disciplineName 
                        ? activities.find(a => a.name.trim().toLowerCase() === currentTab.disciplineName!.trim().toLowerCase())
                        : null;
                    if (tabAct && relActs.includes(tabAct.id)) {
                        actId = tabAct.id;
                    } else {
                        actId = relActs[0];
                    }
                }
            }

            if (!actId) {
                actId = currentValues.selectedActId || null;
            }

            if (!actId && currentTab.disciplineName) {
                const act = activities.find(a => a.name.trim().toLowerCase() === currentTab.disciplineName!.trim().toLowerCase());
                if (act) {
                    actId = act.id;
                }
            }

            await renewClientSubscription(
                client.id,
                actId,
                pkgId,
                currentValues.startDate,
                currentValues.endDate,
                currentValues.cost,
                currentValues.paymentMethod,
                userName
            );
            
            showToast('RENOVACIÓN Y PAGO PROCESADO', 'success');
            
            // Obtener nombre del concepto para el PDF/Recibo
            let conceptName = '';
            if (pkgId) {
                conceptName = packages.find(p => p.id === pkgId)?.name || 'Plan';
            } else if (actId) {
                conceptName = `CLASE: ${activities.find(a => a.id === actId)?.name || 'Disciplina'}`;
            } else {
                conceptName = 'Clase Suelta / Visita';
            }
            
            onSuccess(currentValues.cost, conceptName, currentValues.startDate, currentValues.endDate, pkgId, actId);
            
        } catch (error: any) {
            console.error(error);
            showToast('Error al renovar: ' + error.message, 'error');
            setIsSubmitting(false);
        }
    };

    const labelStyle = "block text-xs font-tech text-yellow-500/80 mb-2 uppercase tracking-widest";
    const inputStyle = "w-full bg-black/50 border-2 border-zinc-700 px-4 py-3 text-white focus:border-yellow-500 outline-none font-mono-tech";

    return (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_0.3s_ease-out]">
            <div className="bg-zinc-950 border-2 border-yellow-500 w-full max-w-lg p-8 shadow-[0_0_50px_rgba(234,179,8,0.2)] relative max-h-[90vh] overflow-y-auto w-full">
                <button onClick={onClose} className="absolute top-4 right-4 text-zinc-500 hover:text-white">✕</button>
                
                <h2 className="text-2xl font-tech font-bold text-white mb-1 uppercase">RENOVAR MEMBRESÍA</h2>
                <p className="text-zinc-500 font-mono-tech text-xs mb-6 uppercase">CLIENTE: <span className="text-white font-bold">{client.firstName} {client.lastNamePaternal}</span></p>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* SELECCIÓN DE DISCIPLINA / PLAN A RENOVAR (Sugerencias Rápidas) */}
                    {suggestions.length > 0 && (
                        <div className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-lg">
                            <label className="block text-xs text-yellow-500 mb-3 font-tech font-bold uppercase tracking-wider">
                                ¿Qué disciplina o plan deseas renovar?
                            </label>
                            
                            <div className="space-y-2">
                                {suggestions.map((sug, idx) => {
                                    const isSelected = selectedSugIndex === idx;
                                    return (
                                        <button
                                            key={`${sug.type}_${sug.id}`}
                                            type="button"
                                            onClick={() => handleSugChange(idx)}
                                            className={`w-full text-left p-3 border font-mono-tech select-none transition-all duration-205 flex flex-col justify-between ${
                                                isSelected 
                                                    ? 'border-yellow-500 bg-yellow-500/10 text-white' 
                                                    : 'border-zinc-800 bg-black/35 text-zinc-400 hover:border-zinc-700 hover:text-white'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between w-full">
                                                <span className="font-tech font-bold uppercase tracking-wider text-xs flex items-center gap-2">
                                                    <span className={`inline-block w-3 h-3 rounded-full border-2 ${isSelected ? 'border-yellow-500 bg-yellow-500' : 'border-zinc-600 bg-transparent'}`} />
                                                    {sug.name}
                                                </span>
                                                <span className="text-emerald-400 font-bold font-mono text-sm">${sug.cost}</span>
                                            </div>
                                            {sug.endDate && (
                                                <span className="text-[9px] text-zinc-500 mt-1 uppercase block">
                                                    Última vigencia: <strong className="text-zinc-300">{sug.endDate}</strong>
                                                </span>
                                            )}
                                            {sug.details && (
                                                <span className="text-[8px] text-zinc-500 italic mt-0.5 block">{sug.details}</span>
                                            )}
                                        </button>
                                    );
                                })}

                                <button
                                    type="button"
                                    onClick={() => handleSugChange('MANUAL')}
                                    className={`w-full text-left p-3 border font-mono-tech select-none transition-all duration-205 flex items-center gap-2 uppercase text-xs font-bold ${
                                        selectedSugIndex === 'MANUAL'
                                            ? 'border-yellow-500 bg-yellow-500/10 text-white' 
                                            : 'border-zinc-800 bg-black/35 text-zinc-400 hover:border-zinc-700 hover:text-white'
                                    }`}
                                >
                                    <span className={`inline-block w-3 h-3 rounded-full border-2 ${selectedSugIndex === 'MANUAL' ? 'border-yellow-500 bg-yellow-500' : 'border-zinc-600 bg-transparent'}`} />
                                    OTRO PLAN O CLASE EN PARTICULAR...
                                </button>
                            </div>
                        </div>
                    )}

                    {selectedSugIndex === 'MANUAL' ? (
                        <div className="space-y-6">
                            {/* Selector de Tipo de Suscripción / Disciplinas Múltiples */}
                            <div className="flex flex-wrap gap-2 p-1 bg-zinc-900 border border-zinc-800 rounded-lg">
                                {modalTabs.map(tab => {
                                    const tabStateVal = tabsState[tab.id];
                                    let displayLabel = tab.label;
                                    if (tabStateVal?.selectedPkgId) {
                                        const pkg = packages.find(p => p.id === tabStateVal.selectedPkgId);
                                        if (pkg) {
                                            displayLabel = `PLAN: ${pkg.name.toUpperCase()}`;
                                        }
                                    } else if (tabStateVal?.selectedActId) {
                                        const act = activities.find(a => a.id === tabStateVal.selectedActId);
                                        if (act) {
                                            displayLabel = `CLASE: ${act.name.toUpperCase()}`;
                                        }
                                    }
                                    return (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            onClick={() => setActiveTabId(tab.id)}
                                            className={`flex-1 min-w-[140px] py-3 px-3 text-[10px] font-tech font-bold uppercase tracking-wider rounded-md transition-all text-center leading-normal ${
                                                activeTabId === tab.id
                                                    ? 'bg-yellow-500 text-black shadow-md'
                                                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/10'
                                            }`}
                                        >
                                            {displayLabel}
                                        </button>
                                    );
                                })}
                            </div>

                            {currentTab.type === 'PACKAGE' && (
                                <div className="space-y-4">
                                    <div>
                                        <label className={labelStyle}>
                                            {currentTab.disciplineName 
                                                ? `SELECCIONAR PLAN / PAQUETE (${currentTab.disciplineName})`
                                                : 'SELECCIONAR PLAN / PAQUETE MULTI-ACTIVIDAD'
                                            }
                                        </label>
                                        <select 
                                            value={currentValues.selectedPkgId || ''} 
                                            onChange={e => handlePackageChange(e.target.value)} 
                                            className={inputStyle}
                                        >
                                            <option value="">CLASE SUELTA / VISITA (Sin Plan)</option>
                                            {displayedPackages.map(p => (
                                                <option key={p.id} value={p.id}>{p.name} - ${p.cost}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {!currentValues.selectedPkgId && (
                                        <div>
                                            <label className={labelStyle}>SELECCIONAR DISCIPLINA / ACTIVIDAD</label>
                                            <select 
                                                value={currentValues.selectedActId || ''} 
                                                onChange={e => handleActivityChange(e.target.value)} 
                                                className={inputStyle}
                                            >
                                                {displayedActivities.map(a => (
                                                    <option key={a.id} value={a.id}>{a.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-lg font-mono-tech text-xs tracking-wider text-zinc-400 space-y-2">
                            <span className="block text-zinc-500 font-bold mb-1 uppercase text-[10px]">Detalle de renovación seleccionada:</span>
                            <div className="flex justify-between py-1 border-b border-zinc-800/40">
                                <span className="uppercase text-zinc-500 text-[10px]">TIPO:</span>
                                <span className="font-bold text-yellow-500">{currentValues.selectedPkgId ? 'PLAN COMPLETO' : 'CLASE INDIVIDUAL / VISITA'}</span>
                            </div>
                            <div className="flex justify-between py-1">
                                <span className="uppercase text-zinc-500 text-[10px]">CONCEPTO / NOMBRE:</span>
                                <span className="font-bold text-white uppercase">
                                    {currentValues.selectedPkgId 
                                        ? (packages.find(p => p.id === currentValues.selectedPkgId)?.name || 'Plan')
                                        : (activities.find(a => a.id === currentValues.selectedActId)?.name || 'Clase Suelta')
                                    }
                                </span>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className={labelStyle}>INICIO VIGENCIA</label>
                            <input 
                                type="date" 
                                value={currentValues.startDate} 
                                onChange={e => handleStartDateChange(e.target.value)} 
                                className={inputStyle} 
                            />
                        </div>
                        <div>
                            <label className={labelStyle}>FIN VIGENCIA</label>
                            <input 
                                type="date" 
                                value={currentValues.endDate} 
                                onChange={e => handleEndDateChange(e.target.value)} 
                                className={inputStyle} 
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                         <div>
                            <label className={labelStyle}>MONTO A COBRAR</label>
                            <div className="relative">
                                <span className="absolute left-3 top-3 text-emerald-500">$</span>
                                <input 
                                    type="number" 
                                    value={currentValues.cost} 
                                    onChange={e => handleCostChange(parseFloat(e.target.value) || 0)} 
                                    className={`${inputStyle} pl-8 text-emerald-400 font-bold border-emerald-500/30`} 
                                />
                            </div>
                        </div>
                        <div>
                            <label className={labelStyle}>MÉTODO DE PAGO</label>
                            <select 
                                value={currentValues.paymentMethod} 
                                onChange={e => handlePaymentMethodChange(e.target.value as PaymentMethod)} 
                                className={inputStyle}
                            >
                                <option value={PaymentMethod.CASH}>EFECTIVO</option>
                                <option value={PaymentMethod.CARD}>TARJETA</option>
                                <option value={PaymentMethod.TRANSFER}>TRANSFERENCIA</option>
                            </select>
                        </div>
                    </div>

                    <div className="pt-6 border-t border-zinc-800">
                        <button 
                            type="submit" 
                            disabled={isSubmitting}
                            className="w-full bg-yellow-500 text-black font-tech font-bold uppercase tracking-widest px-6 py-4 hover:bg-yellow-400 active:translate-y-1 active:shadow-none transition-all shadow-[0_0_20px_rgba(234,179,8,0.4)] disabled:opacity-50"
                        >
                            {isSubmitting ? 'PROCESANDO PAGO...' : `CONFIRMAR RENOVACIÓN ($${currentValues.cost})`}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default RenewalModal;
