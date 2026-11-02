
import React, { useState, useEffect } from 'react';
import { Payment, PaymentMethod, Expense, Client } from '../types';
import { getPayments, getExpenses, addExpense, deleteExpense, getClients } from '../services/storage';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type Tab = 'INCOME' | 'EXPENSES';

const FinancePanel: React.FC = () => {
    const { showToast } = useToast();
    const { config } = useTheme();
    const [activeTab, setActiveTab] = useState<Tab>('INCOME');
    const [payments, setPayments] = useState<Payment[]>([]);
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    // Inicializamos con la fecha local correcta en formato YYYY-MM-DD
    const [filterDate, setFilterDate] = useState<string>(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    });

    // Expense Form
    const [expDescription, setExpDescription] = useState('');
    const [expAmount, setExpAmount] = useState('');
    const [expCategory, setExpCategory] = useState<Expense['category']>('OTROS');
    const [isSavingExp, setIsSavingExp] = useState(false);
    const [isDownloadingClientsPdf, setIsDownloadingClientsPdf] = useState(false);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            // FIX: Parseo manual de la fecha para asegurar Zona Horaria LOCAL
            // new Date("YYYY-MM-DD") lo interpreta como UTC, causando desfase de día.
            // new Date(y, m, d) lo interpreta como Local.
            const [year, month, day] = filterDate.split('-').map(Number);
            
            const start = new Date(year, month - 1, day, 0, 0, 0, 0);
            const end = new Date(year, month - 1, day, 23, 59, 59, 999);

            const [pData, eData] = await Promise.all([
                getPayments(start.toISOString(), end.toISOString()),
                getExpenses(start.toISOString(), end.toISOString())
            ]);

            setPayments(pData);
            setExpenses(eData);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [filterDate]);

    const handleAddExpense = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSavingExp(true);
        try {
            await addExpense({
                description: expDescription,
                amount: parseFloat(expAmount),
                category: expCategory,
                created_by: localStorage.getItem('userName') || 'Admin' // CHANGE TO LOCALSTORAGE
            });
            setExpDescription('');
            setExpAmount('');
            setExpCategory('OTROS');
            showToast('GASTO REGISTRADO CORRECTAMENTE', 'success');
            fetchData();
        } catch (error) {
            showToast('Error al registrar el gasto', 'error');
        } finally {
            setIsSavingExp(false);
        }
    };

    const handleDeleteExpense = async (id: string) => {
        if(!window.confirm("¿Eliminar este registro de gasto?")) return;
        try {
            await deleteExpense(id);
            showToast('GASTO ELIMINADO', 'info');
            fetchData();
        } catch(e) { 
            showToast('No se pudo eliminar el gasto', 'error');
        }
    };

    const totalIncome = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const netBalance = totalIncome - totalExpenses;

    const generatePDF = () => {
        const doc = new jsPDF();
        
        // Brand Color for Header
        const primaryColor = config.primary_color || '#eab308';
        
        // --- HEADER ---
        doc.setFillColor(0, 0, 0); // Black Header
        doc.rect(0, 0, 210, 40, 'F');
        
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text(config.org_name || 'KALI ACCESS', 14, 20);
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('REPORTE DE CORTE DE CAJA (HISTORIAL)', 14, 28);
        doc.text(`Fecha del Reporte: ${filterDate}`, 14, 34);

        // --- SUMMARY ---
        let startY = 50;
        
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('RESUMEN FINANCIERO', 14, startY);
        
        // Summary Box
        startY += 5;
        doc.setDrawColor(200, 200, 200);
        doc.setFillColor(250, 250, 250);
        doc.rect(14, startY, 180, 25, 'FD');
        
        doc.setFontSize(10);
        
        // Ingresos
        doc.setTextColor(0, 100, 0);
        doc.text('TOTAL INGRESOS', 20, startY + 10);
        doc.setFontSize(14);
        doc.text(`$${totalIncome.toLocaleString('es-MX', {minimumFractionDigits: 2})}`, 20, startY + 20);
        
        // Egresos
        doc.setFontSize(10);
        doc.setTextColor(180, 0, 0);
        doc.text('TOTAL EGRESOS', 80, startY + 10);
        doc.setFontSize(14);
        doc.text(`$${totalExpenses.toLocaleString('es-MX', {minimumFractionDigits: 2})}`, 80, startY + 20);
        
        // Balance
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text('BALANCE NETO', 140, startY + 10);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(`$${netBalance.toLocaleString('es-MX', {minimumFractionDigits: 2})}`, 140, startY + 20);

        // --- TABLES ---
        startY += 35;
        
        // Income Table
        doc.setFontSize(12);
        doc.setTextColor(0, 0, 0);
        doc.text('DETALLE DE INGRESOS', 14, startY);
        
        autoTable(doc, {
            startY: startY + 5,
            head: [['Hora', 'Cliente', 'Concepto', 'Método', 'Cobrado Por', 'Monto']],
            body: payments.map(p => [
                new Date(p.created_at).toLocaleTimeString('es-MX', {hour: '2-digit', minute:'2-digit'}),
                p.clientName || 'N/A',
                p.concept,
                p.method,
                p.created_by || 'Sistema',
                `$${Number(p.amount).toFixed(2)}`
            ]),
            styles: { fontSize: 8 },
            headStyles: { fillColor: [234, 179, 8], textColor: [0, 0, 0] }, // Yellow Header
            theme: 'grid'
        });
        
        // Expenses Table
        const finalY = (doc as any).lastAutoTable.finalY + 15;
        doc.text('DETALLE DE EGRESOS (GASTOS)', 14, finalY);
        
        autoTable(doc, {
            startY: finalY + 5,
            head: [['Hora', 'Categoría', 'Descripción', 'Autorizado', 'Monto']],
            body: expenses.map(e => [
                new Date(e.created_at).toLocaleTimeString('es-MX', {hour: '2-digit', minute:'2-digit'}),
                e.category,
                e.description,
                e.created_by || 'Admin',
                `$${e.amount.toFixed(2)}`
            ]),
            styles: { fontSize: 8 },
            headStyles: { fillColor: [220, 38, 38], textColor: [255, 255, 255] }, // Red Header
            theme: 'grid'
        });

        // Footer
        const pageHeight = doc.internal.pageSize.height;
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        // CHANGE TO LOCALSTORAGE
        doc.text(`Generado el ${new Date().toLocaleString()} por ${localStorage.getItem('userName') || 'Sistema'}`, 14, pageHeight - 10);

        doc.save(`Reporte_Caja_${filterDate}.pdf`);
    };

    const generateClientsPDF = async () => {
        setIsDownloadingClientsPdf(true);
        showToast('GENERANDO PDF DE SOCIOS...', 'info');
        try {
            const allClients = await getClients();
            
            // Sort clients alphabetically by full name
            const sortedClients = [...allClients].sort((a, b) => {
                const nameA = `${a.firstName} ${a.lastNamePaternal} ${a.lastNameMaternal}`.trim().toLowerCase();
                const nameB = `${b.firstName} ${b.lastNamePaternal} ${b.lastNameMaternal}`.trim().toLowerCase();
                return nameA.localeCompare(nameB);
            });

            // Helper to compute days diff
            const getDaysDifference = (dateStr?: string) => {
                if (!dateStr) return -9999;
                const [y, m, d] = dateStr.split('-').map(Number);
                const end = new Date(y, m - 1, d);
                const now = new Date();
                now.setHours(0,0,0,0);
                return Math.ceil((end.getTime() - now.getTime()) / 864e5);
            };

            // Calculate Metrics
            let activeCount = 0;
            let expiringCount = 0;
            let expiredCount = 0;
            let inactiveCount = 0;

            sortedClients.forEach(c => {
                if (!c.isActive) {
                    inactiveCount++;
                } else {
                    const diff = getDaysDifference(c.membershipEnd);
                    if (diff < 0) {
                        expiredCount++;
                    } else if (diff <= 3) {
                        expiringCount++;
                        activeCount++;
                    } else {
                        activeCount++;
                    }
                }
            });

            const doc = new jsPDF('p', 'mm', 'a4');
            
            // --- HEADER ---
            doc.setFillColor(0, 0, 0); // Black Header
            doc.rect(0, 0, 210, 40, 'F');
            
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(22);
            doc.setFont('helvetica', 'bold');
            doc.text(config.org_name || 'KALI ACCESS', 14, 20);
            
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text('PADRÓN GENERAL Y ESTADO DE SOCIOS MÁS RECIENTE', 14, 28);
            doc.text(`Fecha del Reporte: ${new Date().toLocaleString('es-MX')}`, 14, 34);

            // --- SUMMARY BOX ---
            let startY = 50;
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.text('RESUMEN DE SOCIOS REGISTRADOS', 14, startY);
            
            startY += 5;
            doc.setDrawColor(200, 200, 200);
            doc.setFillColor(250, 250, 250);
            doc.rect(14, startY, 180, 25, 'FD');
            
            doc.setFontSize(9);
            
            // Total
            doc.setTextColor(30, 41, 59);
            doc.text('TOTAL REGISTRADOS', 20, startY + 10);
            doc.setFontSize(13);
            doc.setFont('helvetica', 'bold');
            doc.text(`${sortedClients.length}`, 20, startY + 20);
            
            // Activos
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(16, 185, 129); // Emerald Success Color
            doc.text('SOCIOS ACTIVOS', 65, startY + 10);
            doc.setFontSize(13);
            doc.setFont('helvetica', 'bold');
            doc.text(`${activeCount}`, 65, startY + 20);
            
            // Vencidos
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(239, 68, 68); // Red Alert Color
            doc.text('VENCIDOS (POR RENOVAR)', 110, startY + 10);
            doc.setFontSize(13);
            doc.setFont('helvetica', 'bold');
            doc.text(`${expiredCount}`, 110, startY + 20);
            
            // De Baja
            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(100, 116, 139); // Slate-500
            doc.text('SOCIOS DE BAJA', 160, startY + 10);
            doc.setFontSize(13);
            doc.setFont('helvetica', 'bold');
            doc.text(`${inactiveCount}`, 160, startY + 20);

            // --- TABLE OF CLIENTS ---
            startY += 35;
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.text('PADRÓN GENERAL DE SOCIOS', 14, startY);

            const tableRows = sortedClients.map((c, index) => {
                const diff = getDaysDifference(c.membershipEnd);
                let statusText = '';
                let daysText = '';
                
                if (!c.isActive) {
                    statusText = 'DE BAJA';
                    daysText = '--';
                } else {
                    if (diff < 0) {
                        statusText = 'VENCIDO';
                        daysText = `${Math.abs(diff)}d vencido`;
                    } else if (diff <= 3) {
                        statusText = 'POR VENCER';
                        daysText = `${diff}d restante(s)`;
                    } else {
                        statusText = 'ACTIVO';
                        daysText = `${diff}d restante(s)`;
                    }
                }

                const completeName = `${c.firstName} ${c.lastNamePaternal} ${c.lastNameMaternal}`.trim();
                const planOrActivity = c.packageName || c.activityName || 'N/A';
                const period = c.membershipStart && c.membershipEnd 
                    ? `${c.membershipStart} al ${c.membershipEnd}` 
                    : 'Sin registro';

                return [
                    (index + 1).toString(),
                    completeName.toUpperCase(),
                    c.phone || 'SIN TELÉFONO',
                    planOrActivity.toUpperCase(),
                    period,
                    statusText,
                    daysText
                ];
            });

            autoTable(doc, {
                startY: startY + 5,
                head: [['Nº', 'Nombre del Socio', 'Teléfono', 'Plan / Actividad', 'Vigencia de Membresía', 'Estado', 'Vencimiento']],
                body: tableRows,
                styles: { fontSize: 7, cellPadding: 2 },
                columnStyles: {
                    0: { cellWidth: 8 },
                    1: { cellWidth: 46 },
                    2: { cellWidth: 24 },
                    3: { cellWidth: 32 },
                    4: { cellWidth: 38 },
                    5: { cellWidth: 22, fontStyle: 'bold' },
                    6: { cellWidth: 20 }
                },
                didParseCell: (data) => {
                    if (data.column.index === 5 && data.section === 'body') {
                        const statusVal = data.cell.raw;
                        if (statusVal === 'ACTIVO') {
                            data.cell.styles.textColor = [16, 185, 129]; // Emerald
                        } else if (statusVal === 'VENCIDO') {
                            data.cell.styles.textColor = [239, 68, 68]; // Red
                        } else if (statusVal === 'POR VENCER') {
                            data.cell.styles.textColor = [245, 158, 11]; // Amber
                        } else if (statusVal === 'DE BAJA') {
                            data.cell.styles.textColor = [100, 116, 139]; // Slate
                        }
                    }
                },
                headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
                theme: 'grid'
            });

            // Footer
            const pageHeight = doc.internal.pageSize.height;
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text(`Generado el ${new Date().toLocaleString('es-MX')} por ${localStorage.getItem('userName') || 'Sistema'}`, 14, pageHeight - 10);

            const fileSafeDate = new Date().toISOString().split('T')[0];
            doc.save(`Estado_Clientes_${fileSafeDate}.pdf`);
            showToast('PDF DE CLIENTES GENERADO CORRECTAMENTE', 'success');
        } catch (error) {
            console.error('Error generating clients PDF:', error);
            showToast('Error al generar el PDF de clientes', 'error');
        } finally {
            setIsDownloadingClientsPdf(false);
        }
    };

    const labelStyle = "block text-xs font-tech text-yellow-500/80 mb-2 uppercase tracking-widest";
    const inputStyle = "w-full bg-black/50 border-2 border-zinc-700 px-4 py-2 text-yellow-100 focus:border-yellow-500 outline-none font-mono-tech";
    const tabStyle = (isActive: boolean) => `px-6 py-3 font-tech font-bold uppercase tracking-widest border-b-2 transition-all whitespace-nowrap ${isActive ? 'border-yellow-500 text-yellow-500 bg-yellow-500/10' : 'border-transparent text-zinc-500 hover:text-white'}`;

    return (
        <div className="max-w-6xl mx-auto animate-[fadeIn_0.5s_ease-out]">
            <div className="flex flex-col md:flex-row justify-between items-end mb-8 border-b border-zinc-800 pb-4 gap-4">
                <div>
                    <h2 className="text-3xl font-tech font-black text-white mb-2">HISTORIAL <span className="text-yellow-500">DE CAJA</span></h2>
                    <p className="text-zinc-500 font-mono-tech text-sm">CONSULTA Y DESCARGA DE MOVIMIENTOS POR DÍA</p>
                </div>
                <div className="flex items-end gap-3 w-full md:w-auto">
                    <div className="flex-1 md:flex-none">
                        <label className={labelStyle}>SELECCIONAR FECHA</label>
                        <input 
                            type="date" 
                            value={filterDate} 
                            onChange={(e) => setFilterDate(e.target.value)} 
                            className={inputStyle} 
                        />
                    </div>
                    <button 
                        onClick={generatePDF}
                        disabled={isLoading}
                        className="h-[46px] bg-zinc-800 hover:bg-zinc-700 text-white border-2 border-zinc-600 hover:border-white px-4 flex items-center gap-2 transition-all font-tech font-bold uppercase text-xs disabled:opacity-50"
                        title="Descargar PDF del Corte"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="hidden md:inline">CORTE CAJA PDF</span>
                    </button>
                    <button 
                        onClick={generateClientsPDF}
                        disabled={isLoading || isDownloadingClientsPdf}
                        className="h-[46px] bg-yellow-600 hover:bg-yellow-500 text-black border-2 border-yellow-500 hover:border-white px-4 flex items-center gap-2 transition-all font-tech font-bold uppercase text-xs disabled:opacity-50"
                        title="Descargar PDF de Todos los Clientes"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        <span className="hidden md:inline">ESTADO CLIENTES PDF</span>
                    </button>
                </div>
            </div>

            {/* SUMMARY CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-zinc-900/50 border border-zinc-800 p-6 flex flex-col justify-between relative overflow-hidden group">
                     <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v.01M12 12v4m0 4v.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                     </div>
                    <p className="text-zinc-500 text-xs font-tech uppercase mb-2">INGRESOS DEL DÍA</p>
                    <p className="text-4xl font-mono-tech text-emerald-400 font-bold">${totalIncome.toLocaleString('es-MX', {minimumFractionDigits: 2})}</p>
                    <p className="text-xs text-zinc-600 mt-2">{payments.length} transacciones</p>
                </div>

                <div className="bg-zinc-900/50 border border-zinc-800 p-6 flex flex-col justify-between relative overflow-hidden group">
                     <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                     </div>
                    <p className="text-zinc-500 text-xs font-tech uppercase mb-2">EGRESOS DEL DÍA</p>
                    <p className="text-4xl font-mono-tech text-red-400 font-bold">${totalExpenses.toLocaleString('es-MX', {minimumFractionDigits: 2})}</p>
                    <p className="text-xs text-zinc-600 mt-2">{expenses.length} movimientos</p>
                </div>

                <div className={`bg-zinc-900/50 border p-6 flex flex-col justify-between relative overflow-hidden ${netBalance >= 0 ? 'border-emerald-900/50 bg-emerald-900/10' : 'border-red-900/50 bg-red-900/10'}`}>
                    <p className="text-zinc-500 text-xs font-tech uppercase mb-2">UTILIDAD NETA (BALANCE)</p>
                    <p className={`text-4xl font-mono-tech font-bold ${netBalance >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>${netBalance.toLocaleString('es-MX', {minimumFractionDigits: 2})}</p>
                    <p className="text-xs text-zinc-500 mt-2 font-mono-tech">Ingresos - Egresos</p>
                </div>
            </div>

            {/* TABS */}
            <div className="flex border-b border-zinc-800 mb-6 overflow-x-auto">
                <button onClick={() => setActiveTab('INCOME')} className={tabStyle(activeTab === 'INCOME')}>INGRESOS (COBROS)</button>
                <button onClick={() => setActiveTab('EXPENSES')} className={tabStyle(activeTab === 'EXPENSES')}>EGRESOS (GASTOS)</button>
            </div>

            {/* CONTENT */}
            {activeTab === 'INCOME' && (
                <div className="bg-zinc-900/30 border border-zinc-800 overflow-hidden animate-[fadeIn_0.3s_ease-out]">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[600px]">
                            <thead>
                                <tr className="bg-zinc-900 border-b border-zinc-800 text-xs font-tech text-zinc-500 uppercase tracking-wider">
                                    <th className="p-4">HORA</th>
                                    <th className="p-4">CLIENTE</th>
                                    <th className="p-4">CONCEPTO</th>
                                    <th className="p-4">MÉTODO</th>
                                    <th className="p-4">COBRADO POR</th>
                                    <th className="p-4 text-right">MONTO</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800 text-sm font-mono-tech text-zinc-300">
                                {isLoading ? (
                                    <tr><td colSpan={6} className="p-8 text-center text-yellow-500 animate-pulse">CARGANDO DATOS...</td></tr>
                                ) : payments.length === 0 ? (
                                    <tr><td colSpan={6} className="p-8 text-center text-zinc-600">NO HAY COBROS EN ESTA FECHA</td></tr>
                                ) : (
                                    payments.map(p => (
                                        <tr key={p.id} className="hover:bg-white/5 transition-colors">
                                            <td className="p-4 text-zinc-500 whitespace-nowrap">{new Date(p.created_at).toLocaleTimeString('es-MX', {hour: '2-digit', minute:'2-digit'})}</td>
                                            <td className="p-4 font-bold text-white whitespace-nowrap">{p.clientName}</td>
                                            <td className="p-4">{p.concept}</td>
                                            <td className="p-4">
                                                <span className={`text-[10px] uppercase px-2 py-1 border ${
                                                    p.method === PaymentMethod.CASH ? 'border-green-800 text-green-500 bg-green-900/20' : 
                                                    p.method === PaymentMethod.CARD ? 'border-blue-800 text-blue-500 bg-blue-900/20' : 
                                                    'border-purple-800 text-purple-500 bg-purple-900/20'
                                                }`}>
                                                    {p.method}
                                                </span>
                                            </td>
                                            <td className="p-4 text-zinc-500 text-xs whitespace-nowrap">{p.created_by || 'Sistema'}</td>
                                            <td className="p-4 text-right font-bold text-emerald-400 whitespace-nowrap">
                                                ${Number(p.amount).toFixed(2)}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {activeTab === 'EXPENSES' && (
                <div className="animate-[fadeIn_0.3s_ease-out]">
                    {/* ADD EXPENSE FORM */}
                    <div className="bg-zinc-900 border border-zinc-800 p-6 mb-8">
                        <h3 className="text-white font-tech font-bold mb-4">REGISTRAR NUEVO GASTO</h3>
                        <form onSubmit={handleAddExpense} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                            <div className="md:col-span-1">
                                <label className={labelStyle}>CATEGORÍA</label>
                                <select value={expCategory} onChange={e => setExpCategory(e.target.value as any)} className={inputStyle}>
                                    <option value="SALARIOS">SALARIOS</option>
                                    <option value="SERVICIOS">SERVICIOS (LUZ/AGUA)</option>
                                    <option value="MANTENIMIENTO">MANTENIMIENTO</option>
                                    <option value="EQUIPO">EQUIPO</option>
                                    <option value="OTROS">OTROS</option>
                                </select>
                            </div>
                            <div className="md:col-span-2">
                                <label className={labelStyle}>DESCRIPCIÓN</label>
                                <input 
                                    value={expDescription} 
                                    onChange={e => setExpDescription(e.target.value)} 
                                    placeholder="Ej. Pago limpieza semanal" 
                                    className={inputStyle} 
                                    required 
                                />
                            </div>
                            <div className="md:col-span-1">
                                <label className={labelStyle}>MONTO</label>
                                <input 
                                    type="number" 
                                    step="0.01" 
                                    value={expAmount} 
                                    onChange={e => setExpAmount(e.target.value)} 
                                    placeholder="0.00" 
                                    className={inputStyle} 
                                    required 
                                />
                            </div>
                            <div className="md:col-span-4 flex justify-end">
                                <button type="submit" disabled={isSavingExp} className="bg-red-900 hover:bg-red-800 text-red-100 border border-red-700 px-6 py-2 font-tech font-bold uppercase tracking-widest text-sm transition-all w-full md:w-auto">
                                    {isSavingExp ? 'GUARDANDO...' : 'REGISTRAR GASTO'}
                                </button>
                            </div>
                        </form>
                    </div>

                    {/* EXPENSES TABLE */}
                    <div className="bg-zinc-900/30 border border-zinc-800 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse min-w-[600px]">
                                <thead>
                                    <tr className="bg-zinc-900 border-b border-zinc-800 text-xs font-tech text-zinc-500 uppercase tracking-wider">
                                        <th className="p-4">HORA</th>
                                        <th className="p-4">CATEGORÍA</th>
                                        <th className="p-4">DESCRIPCIÓN</th>
                                        <th className="p-4">REGISTRADO POR</th>
                                        <th className="p-4 text-right">MONTO</th>
                                        <th className="p-4 text-center">ACCIÓN</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-800 text-sm font-mono-tech text-zinc-300">
                                    {isLoading ? (
                                        <tr><td colSpan={6} className="p-8 text-center text-yellow-500 animate-pulse">CARGANDO DATOS...</td></tr>
                                    ) : expenses.length === 0 ? (
                                        <tr><td colSpan={6} className="p-8 text-center text-zinc-600">NO HAY GASTOS EN ESTA FECHA</td></tr>
                                    ) : (
                                        expenses.map(exp => (
                                            <tr key={exp.id} className="hover:bg-white/5 transition-colors">
                                                <td className="p-4 text-zinc-500 whitespace-nowrap">{new Date(exp.created_at).toLocaleTimeString('es-MX', {hour: '2-digit', minute:'2-digit'})}</td>
                                                <td className="p-4">
                                                    <span className="text-[10px] bg-zinc-800 border border-zinc-700 px-2 py-1 text-zinc-400 rounded-sm">
                                                        {exp.category}
                                                    </span>
                                                </td>
                                                <td className="p-4 font-bold text-white">{exp.description}</td>
                                                <td className="p-4 text-zinc-500 text-xs whitespace-nowrap">{exp.created_by}</td>
                                                <td className="p-4 text-right font-bold text-red-400 whitespace-nowrap">
                                                    ${Number(exp.amount).toFixed(2)}
                                                </td>
                                                <td className="p-4 text-center">
                                                    <button onClick={() => handleDeleteExpense(exp.id)} className="text-zinc-600 hover:text-red-500 transition-colors">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FinancePanel;
