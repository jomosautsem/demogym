
import React, { useEffect, useState } from 'react';
import { Payment, PaymentMethod, Expense } from '../types';
import { getPayments, getExpenses } from '../services/storage';

interface ShiftDetailsModalProps {
  onClose: () => void;
}

type TransactionItem = 
  | ({ type: 'PAYMENT' } & Payment)
  | ({ type: 'EXPENSE' } & Expense);

const ShiftDetailsModal: React.FC<ShiftDetailsModalProps> = ({ onClose }) => {
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [netTotal, setNetTotal] = useState(0);
  const [incomeTotal, setIncomeTotal] = useState(0);
  const [expenseTotal, setExpenseTotal] = useState(0);

  useEffect(() => {
    const fetchShiftData = async () => {
      try {
        const now = new Date();
        // Definir rango de 07:00 AM a 09:00 PM (21:00)
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0, 0);

        // Obtener Pagos y Gastos en paralelo usando el rango específico
        const [paymentsData, expensesData] = await Promise.all([
            getPayments(start.toISOString(), end.toISOString()),
            getExpenses(start.toISOString(), end.toISOString())
        ]);
        
        // Unificar y ordenar cronológicamente (más reciente primero)
        const combined: TransactionItem[] = [
            ...paymentsData.map(p => ({ ...p, type: 'PAYMENT' } as const)),
            ...expensesData.map(e => ({ ...e, type: 'EXPENSE' } as const))
        ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        setTransactions(combined);
        
        const inc = paymentsData.reduce((acc, curr) => acc + Number(curr.amount), 0);
        const exp = expensesData.reduce((acc, curr) => acc + Number(curr.amount), 0);
        
        setIncomeTotal(inc);
        setExpenseTotal(exp);
        setNetTotal(inc - exp);

      } catch (error) {
        console.error("Error cargando detalles del corte:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchShiftData();
  }, []);

  return (
    <div 
        className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_0.3s_ease-out]"
        onClick={onClose}
    >
      <div 
        className="relative w-full max-w-5xl shadow-[0_0_50px_rgba(234,179,8,0.15)] flex flex-col max-h-[90vh] border-2 border-yellow-500"
        style={{ backgroundColor: '#000000' }}
        onClick={(e) => e.stopPropagation()} 
      >
        {/* Header */}
        <div className="p-6 border-b border-white/20 flex justify-between items-start" style={{ backgroundColor: '#000000' }}>
            <div>
                <h2 className="text-2xl font-tech font-bold text-white mb-1">
                    CORTE DE CAJA DETALLADO
                </h2>
                <p className="text-yellow-500 font-mono-tech text-sm font-bold">
                    PERIODO: HOY ({new Date().toLocaleDateString('es-MX')}) [07:00 - 21:00]
                </p>
                <div className="flex gap-4 mt-2 text-xs font-mono-tech">
                    <span className="text-emerald-500">INGRESOS: ${incomeTotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                    <span className="text-zinc-500">|</span>
                    <span className="text-red-500">EGRESOS: ${expenseTotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
                </div>
            </div>
            <div className="text-right">
                <p className="text-xs text-zinc-500 font-mono-tech uppercase">TOTAL EN CAJA (NETO)</p>
                <p className={`text-3xl font-bold font-mono-tech ${netTotal >= 0 ? 'text-white' : 'text-red-500'}`}>
                    ${netTotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                </p>
            </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-0" style={{ backgroundColor: '#000000' }}>
             <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 shadow-md" style={{ backgroundColor: '#000000' }}>
                    <tr className="text-xs font-tech text-zinc-500 uppercase tracking-wider border-b border-white">
                        <th className="p-4">HORA</th>
                        <th className="p-4">CLIENTE / TIPO</th>
                        <th className="p-4">DESCRIPCIÓN / CONCEPTO</th>
                        <th className="p-4">MÉTODO / CATEGORÍA</th>
                        <th className="p-4">REGISTRADO POR</th>
                        <th className="p-4 text-right">MONTO</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-sm font-mono-tech text-white">
                    {isLoading ? (
                        <tr><td colSpan={6} className="p-8 text-center text-yellow-500 animate-pulse font-bold">CARGANDO MOVIMIENTOS...</td></tr>
                    ) : transactions.length === 0 ? (
                        <tr><td colSpan={6} className="p-12 text-center text-zinc-500 font-bold">NO HAY MOVIMIENTOS EN ESTE HORARIO</td></tr>
                    ) : (
                        transactions.map((item) => {
                            if (item.type === 'PAYMENT') {
                                const p = item as Payment;
                                const isEnrollment = p.concept.toLowerCase().includes('inscripción');
                                const total = Number(p.amount);
                                const enrollmentAmt = isEnrollment ? (total >= 200 ? 200 : 0) : 0; 
                                const planAmt = total - enrollmentAmt;

                                return (
                                    <tr key={`p-${p.id}`} className="hover:bg-zinc-900 transition-colors border-b border-white/10">
                                        <td className="p-4 text-zinc-300">
                                            {new Date(p.created_at).toLocaleTimeString('es-MX', {hour: '2-digit', minute:'2-digit'})}
                                        </td>
                                        <td className="p-4 font-bold text-white">{p.clientName || 'Cliente Eliminado'}</td>
                                        <td className="p-4 text-zinc-300">
                                            {p.concept}
                                            {isEnrollment && (
                                                <span className="block text-[9px] text-yellow-500 uppercase mt-1 tracking-wider">
                                                    * Incluye Inscripción
                                                </span>
                                            )}
                                        </td>
                                        <td className="p-4">
                                            <span className={`text-[10px] uppercase px-2 py-1 font-bold border ${
                                                p.method === PaymentMethod.CASH ? 'border-emerald-500 text-emerald-500 bg-emerald-900/10' : 
                                                p.method === PaymentMethod.CARD ? 'border-blue-500 text-blue-500 bg-blue-900/10' : 
                                                'border-white text-white bg-zinc-900'
                                            }`}>
                                                {p.method}
                                            </span>
                                        </td>
                                        <td className="p-4 text-zinc-500 text-xs">{p.created_by || 'Sistema'}</td>
                                        <td className="p-4 text-right">
                                            <div className="flex flex-col items-end">
                                                <span className="font-bold text-emerald-400 text-lg">+${total.toFixed(2)}</span>
                                                {isEnrollment && enrollmentAmt > 0 && (
                                                    <div className="text-[10px] font-mono-tech mt-1 flex gap-2 opacity-80">
                                                        <span className="text-zinc-400">PLAN: ${planAmt.toFixed(2)}</span>
                                                        <span className="text-zinc-600">|</span>
                                                        <span className="text-yellow-500">INSC: ${enrollmentAmt.toFixed(2)}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            } else {
                                // GASTO
                                const e = item as Expense;
                                const total = Number(e.amount);
                                return (
                                    <tr key={`e-${e.id}`} className="bg-red-950/10 hover:bg-red-950/20 transition-colors border-b border-white/10">
                                        <td className="p-4 text-red-200/70">
                                            {new Date(e.created_at).toLocaleTimeString('es-MX', {hour: '2-digit', minute:'2-digit'})}
                                        </td>
                                        <td className="p-4 font-bold text-red-400 uppercase">GASTO OPERATIVO</td>
                                        <td className="p-4 text-red-200">
                                            {e.description}
                                        </td>
                                        <td className="p-4">
                                            <span className="text-[10px] uppercase px-2 py-1 font-bold border border-red-500 text-red-500 bg-red-900/20">
                                                {e.category}
                                            </span>
                                        </td>
                                        <td className="p-4 text-red-300/50 text-xs">{e.created_by || 'Admin'}</td>
                                        <td className="p-4 text-right">
                                            <span className="font-bold text-red-500 text-lg">-${total.toFixed(2)}</span>
                                        </td>
                                    </tr>
                                )
                            }
                        })
                    )}
                </tbody>
            </table>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/20 flex justify-end" style={{ backgroundColor: '#000000' }}>
            <button 
                onClick={onClose} 
                className="bg-yellow-500 text-black font-tech font-bold uppercase tracking-widest px-6 py-3 hover:bg-yellow-400 border border-yellow-600 text-xs shadow-[0_0_15px_rgba(234,179,8,0.4)]"
            >
                CERRAR CORTE
            </button>
        </div>
      </div>
    </div>
  );
};

export default ShiftDetailsModal;
