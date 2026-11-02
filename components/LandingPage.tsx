import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, FileText, Lock, ChevronRight, MessageSquare } from 'lucide-react';

interface LandingPageProps {
  onSelectConsult: () => void;
  onSelectRules: () => void;
  onGoToLogin: () => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onSelectConsult, onSelectRules, onGoToLogin }) => {
  const handleGoToWeb = () => {
    window.open('https://kalidojogym.joramosa.com', '_blank');
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Decorative Elements */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-yellow-500/20 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-red-500/10 rounded-full blur-[120px]"></div>
      </div>

      <motion.div 
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="text-center mb-6 md:mb-10 z-10"
      >
        <h1 className="text-3xl md:text-5xl font-tech font-black tracking-tighter uppercase mb-2 leading-none">
          KALI <span className="text-yellow-500">ACCESS</span>
        </h1>
        <div className="h-1 w-16 md:w-24 bg-yellow-500 mx-auto mb-3"></div>
        <p className="text-zinc-500 font-mono-tech text-[8px] md:text-[10px] uppercase tracking-[0.3em]">
          Plataforma de Gestión Deportiva
        </p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 w-full max-w-6xl z-10 px-4 md:px-0">
        {/* CARD A: CONSULTAR PAGO */}
        <motion.div
          whileHover={{ scale: 1.02, translateY: -5 }}
          whileTap={{ scale: 0.98 }}
          onClick={onSelectConsult}
          className="group relative bg-zinc-950 border-2 border-blue-500/40 p-4 md:p-6 rounded-3xl cursor-pointer transition-all hover:shadow-[0_20px_50px_rgba(59,130,246,0.3)] flex flex-col items-center text-center overflow-hidden h-[160px] md:h-[220px] justify-center"
        >
          {/* PERMANENT BLUE GRADIENT */}
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600/30 via-blue-900/50 to-black opacity-100 transition-all duration-500"></div>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(59,130,246,0.3),transparent_70%)] opacity-100"></div>
          
          <div className="relative z-10 w-10 h-10 md:w-14 md:h-14 bg-blue-600 text-white rounded-2xl flex items-center justify-center mb-2 md:mb-4 border border-blue-400/30 shadow-[0_0_20px_rgba(59,130,246,0.5)] group-hover:scale-110 transition-transform duration-300">
            <ShieldCheck className="w-5 h-5 md:w-7 md:h-7" />
          </div>
          <h2 className="relative z-10 text-base md:text-lg font-tech font-black uppercase tracking-tight mb-1 md:mb-2 text-white px-2">
            CONSULTAR MI <span className="text-blue-400 group-hover:text-blue-300 transition-colors">FECHA DE PAGO</span>
          </h2>
          <p className="relative z-10 text-zinc-300 text-[8px] md:text-[9px] font-mono-tech uppercase tracking-widest max-w-[180px] group-hover:text-blue-100/80 transition-colors hidden sm:block">
            Verifica tu vigencia y estatus de membresía
          </p>
          
          <div className="relative z-10 mt-2 md:mt-4 flex items-center text-blue-400 group-hover:text-white font-tech font-black text-[12px] md:text-sm uppercase tracking-widest transition-all">
            ENTRAR <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </motion.div>

        {/* CARD B: REGLAMENTO */}
        <motion.div
          whileHover={{ scale: 1.02, translateY: -5 }}
          whileTap={{ scale: 0.98 }}
          onClick={onSelectRules}
          className="group relative bg-zinc-950 border-2 border-red-500/40 p-4 md:p-6 rounded-3xl cursor-pointer transition-all hover:shadow-[0_20px_50px_rgba(239,68,68,0.3)] flex flex-col items-center text-center overflow-hidden h-[160px] md:h-[220px] justify-center"
        >
          {/* PERMANENT RED GRADIENT */}
          <div className="absolute inset-0 bg-gradient-to-br from-red-600/30 via-red-900/50 to-black opacity-100 transition-all duration-500"></div>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(239,68,68,0.3),transparent_70%)] opacity-100"></div>
          
          <div className="relative z-10 w-10 h-10 md:w-14 md:h-14 bg-red-600 text-white rounded-2xl flex items-center justify-center mb-2 md:mb-4 border border-red-400/30 shadow-[0_0_20px_rgba(239,68,68,0.5)] group-hover:scale-110 transition-transform duration-300">
            <FileText className="w-5 h-5 md:w-7 md:h-7" />
          </div>
          <h2 className="relative z-10 text-base md:text-lg font-tech font-black uppercase tracking-tight mb-1 md:mb-2 text-white px-2">
            REGLAMENTO <span className="text-red-400 group-hover:text-red-300 transition-colors">DEL GYM</span>
          </h2>
          <p className="relative z-10 text-zinc-300 text-[8px] md:text-[9px] font-mono-tech uppercase tracking-widest max-w-[180px] group-hover:text-red-100/80 transition-colors hidden sm:block">
            Normas de convivencia y seguridad
          </p>
          
          <div className="relative z-10 mt-2 md:mt-4 flex items-center text-red-400 group-hover:text-white font-tech font-black text-[12px] md:text-sm uppercase tracking-widest transition-all">
            OBLIGATORIO LEER <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </motion.div>

        {/* NEW CARD C: COMENTARIOS (YELLOW) */}
        <motion.div
          whileHover={{ scale: 1.02, translateY: -5 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleGoToWeb}
          className="group relative bg-zinc-950 border-2 border-yellow-500/40 p-4 md:p-6 rounded-3xl cursor-pointer transition-all hover:shadow-[0_20px_50px_rgba(234,179,8,0.3)] flex flex-col items-center text-center overflow-hidden h-[160px] md:h-[220px] justify-center"
        >
          {/* PERMANENT YELLOW GRADIENT */}
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-600/30 via-yellow-900/50 to-black opacity-100 transition-all duration-500"></div>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(234,179,8,0.3),transparent_70%)] opacity-100"></div>
          
          <div className="relative z-10 w-10 h-10 md:w-14 md:h-14 bg-yellow-500 text-black rounded-2xl flex items-center justify-center mb-2 md:mb-4 border border-yellow-400/30 shadow-[0_0_20px_rgba(234,179,8,0.5)] group-hover:scale-110 transition-transform duration-300">
            <MessageSquare className="w-5 h-5 md:w-7 md:h-7" />
          </div>
          <h2 className="relative z-10 text-base md:text-lg font-tech font-black uppercase tracking-tight mb-1 md:mb-2 text-white px-2">
            DEJAR <span className="text-yellow-500 group-hover:text-white transition-colors">COMENTARIO</span>
          </h2>
          <p className="relative z-10 text-zinc-300 text-[8px] md:text-[9px] font-mono-tech uppercase tracking-widest max-w-[180px] group-hover:text-yellow-100/80 transition-colors hidden sm:block">
            Tu opinión es muy importante para nosotros
          </p>
          
          <div className="relative z-10 mt-2 md:mt-4 flex items-center text-yellow-500 group-hover:text-white font-tech font-black text-[12px] md:text-sm uppercase tracking-widest transition-all">
            IR A PÁGINA WEB <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </motion.div>
      </div>

      {/* HIDDEN STAFF LOGIN ACCESS */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.8 }}
        whileHover={{ opacity: 1, scale: 1.1 }}
        onClick={onGoToLogin}
        className="absolute bottom-4 right-4 p-4 text-yellow-500/60 hover:text-yellow-500 transition-all flex items-center gap-2 group z-50"
        title="Acceso Staff"
      >
        <span className="text-[10px] font-mono-tech font-bold uppercase opacity-0 group-hover:opacity-100 transition-opacity bg-black/80 px-2 py-1 rounded border border-yellow-500/20">Staff Login</span>
        <Lock className="w-6 h-6 md:w-5 md:h-5 drop-shadow-[0_0_8px_rgba(234,179,8,0.4)]" />
      </motion.button>
      
      <p className="absolute bottom-6 left-6 text-zinc-800 text-[10px] font-mono-tech font-bold uppercase tracking-[0.2em]">
        v2.5.0 // SECURE SYSTEM
      </p>
    </div>
  );
};

export default LandingPage;
