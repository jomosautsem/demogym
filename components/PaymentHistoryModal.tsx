
import React, { useEffect, useState } from 'react';
import { Client, Payment, PaymentMethod } from '../types';
import { getPaymentsByClientId } from '../services/storage';

interface PaymentHistoryModalProps {
  client: Client;
  onClose: () => void;
}

const PaymentHistoryModal: React.FC<PaymentHistoryModalProps> = ({ client, onClose }) => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchPayments = async () => {
      try {
        const data = await getPaymentsByClientId(client.id);
        setPayments(data);
      } catch (error) {
        console.error("Error fetching client payments:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchPayments();
  }, [client.id]);

  return (
    <div 
        className="fixed inset-0 z-[100] bg-black flex items-center justify-center p-4 animate-[fadeIn_0.3s_ease-out]"
        onClick={onClose}
    >
      <div 
        className="relative w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] border-2 border-yellow-500"
        style={{ backgroundColor: '#000000' }} // FONDO NEGRO SÓLIDO
        onClick={(e) => e.stopPropagation()} 
      >
        {/* Header */}
        <div className="p-6 border-b border-white/20 flex justify-between items-start" style={{ backgroundColor: '#000000' }}>
            <div>
                <h2 className="text-2xl font-tech font-bold text-white mb-1">
                    HISTORIAL DE PAGOS
                </h2>
                <p className="text-yellow-500 font-mono-tech text-sm font-bold">
                    CLIENTE: {client.firstName} {client.lastNamePaternal}
                </p>
            </div>
            <button onClick={onClose} className="text-white hover:text-yellow-500 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-0" style={{ backgroundColor: '#000000' }}>
             <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 shadow-md" style={{ backgroundColor: '#000000' }}>
                    <tr className="text-xs font-tech text-yellow-500 uppercase tracking-wider border-b border-white">
                        <th className="p-4">FECHA</th>
                        <th className="p-4">CONCEPTO</th>
                        <th className="p-4">MÉTODO</th>
                        <th className="p-4">REGISTRADO POR</th>
                        <th className="p-4 text-right">MONTO</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-sm font-mono-tech text-white">
                    {isLoading ? (
                        <tr><td colSpan={5} className="p-8 text-center text-yellow-500 animate-pulse font-bold">CARGANDO TRANSACCIONES...</td></tr>
                    ) : payments.length === 0 ? (
                        <tr><td colSpan={5} className="p-12 text-center text-zinc-500 font-bold">NO HAY PAGOS REGISTRADOS PARA ESTE CLIENTE</td></tr>
                    ) : (
                        payments.map(p => (
                            <tr key={p.id} className="hover:bg-zinc-900 transition-colors border-b border-white/10">
                                <td className="p-4 text-zinc-300">
                                    {new Date(p.created_at).toLocaleDateString('es-MX')} 
                                    <span className="text-zinc-500 text-xs ml-2">
                                        {new Date(p.created_at).toLocaleTimeString('es-MX', {hour: '2-digit', minute:'2-digit'})}
                                    </span>
                                </td>
                                <td className="p-4 font-bold text-white">{p.concept}</td>
                                <td className="p-4">
                                    <span className={`text-[10px] uppercase px-2 py-1 font-bold border ${
                                        p.method === PaymentMethod.CASH ? 'border-emerald-500 text-emerald-500 bg-emerald-900/10' : 
                                        p.method === PaymentMethod.CARD ? 'border-yellow-500 text-yellow-500 bg-yellow-900/10' : 
                                        'border-white text-white bg-zinc-900'
                                    }`}>
                                        {p.method}
                                    </span>
                                </td>
                                <td className="p-4 text-zinc-400 text-xs">{p.created_by || 'Sistema'}</td>
                                <td className="p-4 text-right font-bold text-emerald-400 text-lg">
                                    ${Number(p.amount).toFixed(2)}
                                </td>
                            </tr>
                        ))
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
                CERRAR LISTADO
            </button>
        </div>
      </div>
    </div>
  );
};

export default PaymentHistoryModal;
