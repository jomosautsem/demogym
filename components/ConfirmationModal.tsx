
import React from 'react';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isProcessing?: boolean;
  type?: 'danger' | 'warning' | 'info';
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ 
  isOpen, 
  title, 
  message, 
  confirmText = 'CONFIRMAR', 
  cancelText = 'CANCELAR', 
  onConfirm, 
  onCancel,
  isProcessing = false,
  type = 'danger'
}) => {
  if (!isOpen) return null;

  const colors = {
    danger: {
      border: 'border-red-600',
      bg: 'bg-red-950/20',
      text: 'text-red-500',
      btn: 'bg-red-600 hover:bg-red-500 border-red-500 shadow-[0_0_15px_rgba(220,38,38,0.4)]',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-red-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      )
    },
    warning: {
      border: 'border-yellow-500',
      bg: 'bg-yellow-950/20',
      text: 'text-yellow-500',
      btn: 'bg-yellow-500 hover:bg-yellow-400 text-black border-yellow-600 shadow-[0_0_15px_rgba(234,179,8,0.4)]',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-yellow-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
    info: {
      border: 'border-blue-500',
      bg: 'bg-blue-950/20',
      text: 'text-blue-500',
      btn: 'bg-blue-600 hover:bg-blue-500 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.4)]',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-blue-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    }
  };

  const theme = colors[type];

  return (
    <div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]">
      <div className={`relative w-full max-w-md bg-zinc-950 border-2 ${theme.border} p-8 shadow-2xl flex flex-col items-center text-center`}>
        {theme.icon}
        
        <h3 className={`text-2xl font-tech font-bold ${theme.text} mb-2 uppercase tracking-wide`}>
          {title}
        </h3>
        
        <div className="text-zinc-300 font-mono-tech text-sm mb-8 leading-relaxed">
          {message}
        </div>

        <div className="flex gap-4 w-full">
          <button 
            onClick={onCancel} 
            disabled={isProcessing}
            className="flex-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border border-zinc-700 py-3 font-tech font-bold uppercase text-xs tracking-widest transition-colors"
          >
            {cancelText}
          </button>
          
          <button 
            onClick={onConfirm} 
            disabled={isProcessing}
            className={`flex-1 text-white font-tech font-bold uppercase text-xs tracking-widest py-3 border transition-all ${theme.btn} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isProcessing ? 'PROCESANDO...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;
