
import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType) => {
    // CORRECCIÓN: Usar Date.now() + Math.random() asegura que si dos toasts
    // se lanzan en el mismo milisegundo, tengan IDs diferentes.
    const id = Date.now() + Math.random();
    
    setToasts((prev) => [...prev, { id, message, type }]);

    // Auto eliminar después de 4 segundos
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      
      {/* Container de Toasts */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`
              pointer-events-auto 
              w-80 p-4 border-l-4 shadow-2xl backdrop-blur-md 
              transform transition-all duration-500 animate-[slideInRight_0.3s_ease-out]
              flex items-start gap-3
              ${toast.type === 'success' ? 'bg-emerald-950/95 border-emerald-500 text-emerald-100' : ''}
              ${toast.type === 'error' ? 'bg-red-950/95 border-red-500 text-red-100' : ''}
              ${toast.type === 'warning' ? 'bg-yellow-950/95 border-yellow-500 text-yellow-100' : ''}
              ${toast.type === 'info' ? 'bg-zinc-900/95 border-blue-500 text-blue-100' : ''}
            `}
          >
            {/* Icono */}
            <div className="mt-0.5 shrink-0">
                {toast.type === 'success' && <svg className="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>}
                {toast.type === 'error' && <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                {toast.type === 'warning' && <svg className="w-5 h-5 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
                {toast.type === 'info' && <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
            </div>

            {/* Contenido */}
            <div className="flex-1">
                <p className="font-tech font-bold text-xs uppercase tracking-wider mb-1 opacity-70">
                    {toast.type === 'success' ? 'ÉXITO' : toast.type === 'error' ? 'ERROR' : 'SISTEMA'}
                </p>
                <p className="font-mono-tech text-sm leading-snug">{toast.message}</p>
            </div>

            {/* Botón Cerrar */}
            <button 
                onClick={() => removeToast(toast.id)} 
                className="opacity-50 hover:opacity-100 transition-opacity p-1 hover:bg-white/10 rounded"
                aria-label="Cerrar notificación"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        ))}
        <style>{`
          @keyframes slideInRight {
            from { opacity: 0; transform: translateX(100%); }
            to { opacity: 1; transform: translateX(0); }
          }
        `}</style>
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast debe ser usado dentro de un ToastProvider');
  }
  return context;
};
