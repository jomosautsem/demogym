import React, { useState } from 'react';
import { addExpense } from '../services/storage';
import { useToast } from '../context/ToastContext';

interface AddExpenseModalProps {
  onClose: () => void;
  onSuccess: () => void;
  userName: string;
}

const AddExpenseModal: React.FC<AddExpenseModalProps> = ({ onClose, onSuccess, userName }) => {
    const { showToast } = useToast();
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [category, setCategory] = useState<'SALARIOS' | 'SERVICIOS' | 'MANTENIMIENTO' | 'EQUIPO' | 'OTROS'>('OTROS');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return; 
        
        if (!amount || parseFloat(amount) <= 0) {
            showToast('El monto debe ser mayor a 0', 'warning');
            return;
        }

        setIsSubmitting(true);
        try {
            await addExpense({
                description,
                amount: parseFloat(amount),
                category,
                created_by: userName
            });
            showToast('GASTO REGISTRADO', 'success');
            onSuccess();
        } catch (error: any) {
            console.error(error);
            showToast('Error al registrar: ' + error.message, 'error');
            setIsSubmitting(false);
        }
    };

    const labelStyle = "block text-xs font-tech text-red-500/80 mb-2 uppercase tracking-widest";
    const inputStyle = "w-full bg-black/50 border-2 border-zinc-700 px-4 py-3 text-white focus:border-red-500 outline-none font-mono-tech";

    return (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_0.3s_ease-out]">
            <div className="bg-zinc-950 border-2 border-red-900 w-full max-w-lg p-8 shadow-[0_0_50px_rgba(220,38,38,0.2)] relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-zinc-500 hover:text-white">✕</button>
                
                <h2 className="text-2xl font-tech font-bold text-white mb-6 uppercase border-b border-zinc-800 pb-4">
                    REGISTRAR SALIDA / GASTO
                </h2>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className={labelStyle}>CATEGORÍA</label>
                        <select value={category} onChange={e => setCategory(e.target.value as any)} className={inputStyle}>
                            <option value="SALARIOS">SALARIOS</option>
                            <option value="SERVICIOS">SERVICIOS (AGUA, LUZ, INTERNET)</option>
                            <option value="MANTENIMIENTO">MANTENIMIENTO</option>
                            <option value="EQUIPO">COMPRA DE EQUIPO</option>
                            <option value="OTROS">OTROS GASTOS</option>
                        </select>
                    </div>

                    <div>
                        <label className={labelStyle}>DESCRIPCIÓN DEL GASTO</label>
                        <input 
                            value={description} 
                            onChange={e => setDescription(e.target.value)} 
                            className={inputStyle} 
                            placeholder="Ej. Compra de artículos de limpieza" 
                            required 
                        />
                    </div>

                    <div>
                        <label className={labelStyle}>MONTO RETIRADO</label>
                        <div className="relative">
                            <span className="absolute left-3 top-3 text-red-500">$</span>
                            <input 
                                type="number" 
                                value={amount} 
                                onChange={e => setAmount(e.target.value)} 
                                className={`${inputStyle} pl-8 text-red-400 font-bold border-red-500/30`} 
                                placeholder="0.00"
                                required 
                            />
                        </div>
                    </div>

                    <div className="pt-6 border-t border-zinc-800 flex gap-4">
                        <button 
                            type="button"
                            onClick={onClose}
                            className="flex-1 bg-zinc-800 text-zinc-400 font-tech font-bold uppercase py-3 border border-zinc-700 hover:text-white"
                        >
                            CANCELAR
                        </button>
                        <button 
                            type="submit" 
                            disabled={isSubmitting}
                            className="flex-1 bg-red-800 text-white font-tech font-bold uppercase tracking-widest py-3 hover:bg-red-700 active:translate-y-1 active:shadow-none transition-all shadow-[0_0_20px_rgba(220,38,38,0.4)] disabled:opacity-50"
                        >
                            {isSubmitting ? 'GUARDANDO...' : 'REGISTRAR'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddExpenseModal;