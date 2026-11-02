import React from 'react';
import { AccessStatus } from '../types';

interface StatusLightProps {
  status: AccessStatus;
  size?: 'sm' | 'lg';
}

const StatusLight: React.FC<StatusLightProps> = ({ status, size = 'lg' }) => {
  const getTheme = () => {
    switch (status) {
      case AccessStatus.GRANTED:
        return {
          core: 'bg-emerald-500',
          glow: 'shadow-[0_0_50px_rgba(16,185,129,0.8)]',
          ring: 'border-emerald-500',
          icon: 'text-emerald-950'
        };
      case AccessStatus.WARNING:
        return {
          core: 'bg-yellow-400',
          glow: 'shadow-[0_0_50px_rgba(250,204,21,0.8)]',
          ring: 'border-yellow-400',
          icon: 'text-yellow-950'
        };
      case AccessStatus.DENIED:
        return {
          core: 'bg-red-600',
          glow: 'shadow-[0_0_50px_rgba(220,38,38,0.9)]',
          ring: 'border-red-600',
          icon: 'text-red-950'
        };
      default:
        return {
          core: 'bg-slate-700',
          glow: 'shadow-none',
          ring: 'border-slate-700',
          icon: 'text-slate-400'
        };
    }
  };

  const theme = getTheme();
  const containerSize = size === 'lg' ? 'w-40 h-40' : 'w-16 h-16';
  const coreSize = size === 'lg' ? 'w-28 h-28' : 'w-10 h-10';

  return (
    <div className={`relative flex items-center justify-center ${containerSize}`}>
      {/* Outer Rotating Ring */}
      {status !== AccessStatus.UNKNOWN && (
        <div className={`absolute inset-0 rounded-full border-2 border-dashed ${theme.ring} opacity-40 animate-[spin_4s_linear_infinite]`}></div>
      )}
      
      {/* Inner Reverse Rotating Ring */}
      {status !== AccessStatus.UNKNOWN && (
        <div className={`absolute inset-2 rounded-full border border-dotted ${theme.ring} opacity-60 animate-[spin_3s_linear_infinite_reverse]`}></div>
      )}

      {/* Core Light */}
      <div className={`relative ${coreSize} rounded-full ${theme.core} ${theme.glow} flex items-center justify-center transition-all duration-500 z-10 border-4 border-black/20`}>
         {/* Glass reflection effect */}
         <div className="absolute top-2 left-4 w-1/3 h-1/3 bg-white/30 rounded-full blur-[2px]"></div>
         
         {status === AccessStatus.GRANTED && (
           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={4} stroke="currentColor" className={`w-1/2 h-1/2 ${theme.icon}`}>
             <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
           </svg>
         )}
         {status === AccessStatus.DENIED && (
           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={4} stroke="currentColor" className={`w-1/2 h-1/2 ${theme.icon}`}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
         )}
         {status === AccessStatus.WARNING && (
           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={4} stroke="currentColor" className={`w-1/2 h-1/2 ${theme.icon}`}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
         )}
      </div>
    </div>
  );
};

export default StatusLight;