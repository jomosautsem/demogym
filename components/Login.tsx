
import React, { useState, useEffect } from 'react';
import { authenticateUser, searchClientsPublic, getSystemConfig, DEFAULT_RULES_CONTENT } from '../services/storage';
import { UserRole, Client, AccessStatus } from '../types';
import StatusLight from './StatusLight';

interface LoginProps {
  onLoginSuccess: (role: UserRole, name: string, allowedActivityIds: string[], allowedPackageIds: string[], canRenew: boolean, canManageFingerprints?: boolean, email?: string, canEditMembership?: boolean) => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [activeTab, setActiveTab] = useState<'LOGIN' | 'CHECK'>('CHECK');
  
  // Login State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Check Status State
  const [checkIdentifier, setCheckIdentifier] = useState('');
  const [checkResult, setCheckResult] = useState<Client | null>(null);
  const [checkStatus, setCheckStatus] = useState<AccessStatus>(AccessStatus.IDLE);
  const [checkMessage, setCheckMessage] = useState<string>('');
  
  // Multiple Results State (Identity Selector)
  const [multipleMatches, setMultipleMatches] = useState<Client[]>([]);
  
  // Rules State
  const [rulesText, setRulesText] = useState(DEFAULT_RULES_CONTENT);

  useEffect(() => {
      // Load Rules
      getSystemConfig().then(config => {
          if (config.rules_content) {
              setRulesText(config.rules_content);
          }
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await authenticateUser(email, password);

      if (result && result.isAuthenticated) {
        onLoginSuccess(
            result.role, 
            result.name, 
            result.allowedActivityIds || [],
            result.allowedPackageIds || [],
            result.canRenew || false,
            result.canManageFingerprints || false,
            result.email || email,
            result.canEditMembership || false
        );
      } else {
        setError('CREDENCIALES INVÁLIDAS O USUARIO DESACTIVADO.');
      }
    } catch (err: any) {
        setError(err.message || 'ERROR DE CONEXIÓN');
    } finally {
        setIsLoading(false);
    }
  };

  // Helper Logic to calculate status for a single client
  const processClientCheck = (client: Client) => {
      setCheckResult(client);
      const now = new Date();
      now.setHours(0,0,0,0);
      
      if (!client.membershipEnd) {
          setCheckStatus(AccessStatus.DENIED);
          setCheckMessage("SIN FECHA DE VENCIMIENTO");
      } else {
          const [y, m, d] = client.membershipEnd.split('-').map(Number);
          const end = new Date(y, m - 1, d);
          const days = Math.ceil((end.getTime() - now.getTime()) / 864e5);

          if (!client.isActive) {
              setCheckStatus(AccessStatus.DENIED);
              setCheckMessage("MEMBRESÍA INACTIVA / CANCELADA");
          } else if (days < 0) {
              setCheckStatus(AccessStatus.DENIED);
              setCheckMessage(`VENCIDA HACE ${Math.abs(days)} DÍAS`);
          } else if (days <= 3) {
              setCheckStatus(AccessStatus.WARNING);
              setCheckMessage(days === 0 ? "VENCE HOY" : `VENCE EN ${days} DÍAS`);
          } else {
              setCheckStatus(AccessStatus.GRANTED);
              setCheckMessage("ACCESO PERMITIDO");
          }
      }
  };

  const handleCheckStatus = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!checkIdentifier.trim()) return;
      
      setIsLoading(true);
      setCheckMessage('');
      setCheckResult(null);
      setMultipleMatches([]); // Reset matches
      setCheckStatus(AccessStatus.IDLE);

      try {
          // Use the search function that returns an array
          const clients = await searchClientsPublic(checkIdentifier);
          
          if (clients.length === 0) {
              setError("NO SE ENCONTRÓ NINGÚN SOCIO CON ESE DATO.");
          } else if (clients.length === 1) {
              // Direct Match
              processClientCheck(clients[0]);
          } else {
              // Multiple Matches found - Trigger Selector
              setMultipleMatches(clients);
          }
      } catch (err: any) {
          console.error(err);
          setError("ERROR AL CONSULTAR. INTENTE MÁS TARDE.");
      } finally {
          setIsLoading(false);
      }
  };

  const handleSelectIdentity = (client: Client) => {
      setMultipleMatches([]); // Clear selector
      processClientCheck(client); // Show result for selected
  };

  const closeCheckResult = () => {
      setCheckResult(null);
      setCheckIdentifier('');
      setMultipleMatches([]);
      setError('');
  };

  // Manejador de foco para móviles (Auto-Scroll)
  const handleInputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    // Esperamos 300ms para que el teclado suba en móviles y luego scrolleamos
    setTimeout(() => {
        e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  };

  // PARSER PARA EL EFECTO MARCATEXTOS (::text::)
  const renderRules = (text: string) => {
      return text.split('\n').map((line, i) => {
          if (!line.trim()) return <br key={i} />;
          
          const parts = line.split('::');
          return (
              <p key={i} className="mb-2">
                  {parts.map((part, j) => {
                      // Los índices impares (1, 3, 5...) son los que estaban entre :: ::
                      if (j % 2 === 1) {
                          return <span key={j} className="bg-yellow-500 text-black font-bold px-1 mx-0.5">{part}</span>;
                      }
                      return <span key={j}>{part}</span>;
                  })}
              </p>
          );
      });
  };

  const scrollToRules = () => {
      document.getElementById('reglamento')?.scrollIntoView({ behavior: 'smooth' });
  };

  const inputStyle = "w-full bg-black/50 border-2 border-zinc-700 rounded-none px-4 py-3 text-yellow-100 focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500 outline-none transition-all font-mono-tech placeholder-zinc-600";
  const labelStyle = "block text-xs font-tech text-yellow-500/80 mb-2 uppercase tracking-widest";
  const btnPrimary = "bg-yellow-500 text-black font-tech font-bold uppercase tracking-widest px-6 py-3 hover:bg-yellow-400 active:translate-y-1 active:shadow-none transition-all shadow-[4px_4px_0px_0px_rgba(255,255,255,0.1)] border-2 border-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed w-full";

  return (
    <div className="min-h-screen flex flex-col-reverse md:flex-row bg-black animate-[fadeIn_0.5s_ease-out] pb-8 md:pb-0">
        
        {/* LEFT PANEL: REGLAMENTO (HAZARD STYLE) */}
        <div id="reglamento" className="w-full md:w-1/2 bg-zinc-950 border-t-4 md:border-t-0 md:border-r-4 border-yellow-500 relative overflow-hidden flex flex-col pb-8 md:pb-0">
            
            {/* Fondo Rayado Industrial */}
            <div 
                className="absolute inset-0 opacity-5 pointer-events-none"
                style={{ 
                    backgroundImage: 'repeating-linear-gradient(45deg, #eab308 0, #eab308 10px, transparent 10px, transparent 20px)' 
                }}
            ></div>

            <div className="p-8 md:p-12 relative z-10 flex-1 overflow-y-auto custom-scrollbar">
                <div className="border-4 border-dashed border-yellow-600/30 p-6 md:p-10 h-full bg-black/40 backdrop-blur-sm">
                    <h2 className="text-3xl md:text-5xl font-black font-tech text-red-600 mb-8 uppercase tracking-tighter leading-none" style={{ textShadow: '0 0 10px rgba(220,38,38,0.5)' }}>
                        ⚠️ REGLAMENTO<br/>
                        <span className="text-white">INTERNO</span>
                        <span className="block text-sm md:text-lg text-yellow-500 font-mono-tech mt-2 tracking-widest border-t border-yellow-500/50 pt-2">
                            ZONA DE ENTRENAMIENTO
                        </span>
                    </h2>

                    <div className="font-mono-tech text-zinc-300 text-sm md:text-base leading-loose">
                        {renderRules(rulesText)}
                    </div>

                    <div className="mt-8 pt-6 border-t-2 border-red-900/50 flex items-center gap-4">
                        <div className="w-12 h-12 border-2 border-red-600 flex items-center justify-center rounded-full bg-red-900/20 animate-pulse">
                            <span className="text-2xl">!</span>
                        </div>
                        <p className="text-[10px] md:text-xs text-red-500 font-tech uppercase tracking-widest">
                            EL ACCESO A ESTAS INSTALACIONES IMPLICA LA ACEPTACIÓN TOTAL DE ESTAS NORMAS.
                        </p>
                    </div>
                </div>
            </div>
        </div>

        {/* RIGHT PANEL: LOGIN */}
        {/* Adjusted alignment: md:pl-40 (increased from 24) to move more to the right */}
        <div className="w-full md:w-1/2 flex flex-col items-center justify-center md:items-start md:justify-start md:pt-16 md:pl-40 p-6 bg-black relative pb-16 md:pb-6">
            
            {/* Subtle Grid Background */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(20,20,20,1)_1px,transparent_1px),linear-gradient(90deg,rgba(20,20,20,1)_1px,transparent_1px)] bg-[size:40px_40px] opacity-20 pointer-events-none"></div>

            <div className="w-full max-w-md relative z-10">
                <div className="text-center mb-8">
                    <h1 className="text-4xl md:text-5xl font-tech font-black tracking-tighter text-white mb-2">
                        KALI <span className="text-yellow-500">ACCESS</span>
                    </h1>
                    <p className="text-zinc-500 font-mono-tech text-xs tracking-[0.3em] uppercase">Sistema de Control Biométrico</p>
                </div>

                <div className="bg-zinc-900/30 border border-zinc-800 p-8 shadow-2xl backdrop-blur-sm relative group">
                    {/* Glowing Border Effect on Hover */}
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-yellow-600 to-zinc-800 opacity-0 group-hover:opacity-30 transition duration-500 blur"></div>
                    
                    <div className="relative">
                        {/* TABS */}
                        <div className="flex border-b border-zinc-700 mb-8 gap-2">
                            <button 
                                onClick={() => { setActiveTab('LOGIN'); setError(''); }} 
                                className={`flex-1 py-3 text-xs font-bold font-tech uppercase tracking-widest transition-all ${activeTab === 'LOGIN' ? 'text-yellow-500 border-b-2 border-yellow-500 bg-yellow-900/10' : 'text-zinc-500 hover:text-white border-b-2 border-transparent'}`}
                            >
                                STAFF LOGIN
                            </button>
                            <button 
                                onClick={() => { setActiveTab('CHECK'); setError(''); }} 
                                className={`flex-1 py-3 text-xs font-bold font-tech uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                                    activeTab === 'CHECK' 
                                        ? 'bg-emerald-500 text-black border-b-2 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.5)]' 
                                        : 'text-emerald-500 hover:bg-emerald-500 hover:text-black hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] border-b-2 border-transparent'
                                }`}
                            >
                                CONSULTAR VIGENCIA
                            </button>
                        </div>

                        {/* LOGIN FORM */}
                        {activeTab === 'LOGIN' && (
                            <form onSubmit={handleSubmit} className="space-y-6 animate-[fadeIn_0.3s]">
                                <div>
                                <label htmlFor="email" className={labelStyle}>Correo Electrónico</label>
                                <input
                                    id="email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    onFocus={handleInputFocus}
                                    className={inputStyle}
                                    placeholder="usuario@dominio.com"
                                    required
                                />
                                </div>
                                <div>
                                <label htmlFor="password" className={labelStyle}>Contraseña</label>
                                <input
                                    id="password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    onFocus={handleInputFocus}
                                    className={inputStyle}
                                    placeholder="••••••••••••"
                                    required
                                />
                                </div>

                                {error && (
                                <div className="text-center bg-red-900/40 border border-red-800 text-red-400 font-mono-tech text-xs p-3">
                                    {error}
                                </div>
                                )}

                                <div className="pt-4">
                                <button type="submit" disabled={isLoading} className={btnPrimary}>
                                    {isLoading ? 'VERIFICANDO...' : 'INGRESAR AL SISTEMA'}
                                </button>
                                </div>
                            </form>
                        )}

                        {/* PUBLIC CHECK FORM */}
                        {activeTab === 'CHECK' && !checkResult && multipleMatches.length === 0 && (
                            <form onSubmit={handleCheckStatus} className="space-y-6 animate-[fadeIn_0.3s]">
                                <div className="text-center mb-4">
                                    <p className="text-zinc-400 text-xs font-mono-tech leading-relaxed">
                                        Ingresa tu número de teléfono a 10 dígitos, sin espacios para verificar el estado de tu membresía.
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-xs font-tech text-emerald-500/80 mb-2 uppercase tracking-widest">ID O TELÉFONO</label>
                                    <input
                                        type="text"
                                        value={checkIdentifier}
                                        onChange={(e) => setCheckIdentifier(e.target.value)}
                                        onFocus={handleInputFocus}
                                        className={`${inputStyle} focus:border-emerald-500 focus:ring-emerald-500/50 text-emerald-100 placeholder-zinc-600`}
                                        placeholder="Ej. 7771234567"
                                        required
                                    />
                                </div>

                                {error && (
                                    <div className="text-center bg-red-900/40 border border-red-800 text-red-400 font-mono-tech text-xs p-3">
                                        {error}
                                    </div>
                                )}

                                <div className="pt-4">
                                    <button type="submit" disabled={isLoading} className="bg-emerald-600 text-white font-tech font-bold uppercase tracking-widest px-6 py-3 hover:bg-emerald-500 active:translate-y-1 active:shadow-none transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] border-2 border-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed w-full flex justify-center items-center gap-2">
                                        {isLoading ? 'CONSULTANDO...' : 'VERIFICAR AHORA'}
                                    </button>
                                </div>
                            </form>
                        )}

                        {/* MOBILE ANCHOR LINK */}
                        <div className="md:hidden mt-6 border-t border-zinc-800 pt-4">
                            <button 
                                type="button"
                                onClick={scrollToRules}
                                className="w-full flex items-center justify-center gap-2 text-yellow-500 font-tech font-bold text-xs uppercase tracking-widest hover:text-yellow-400 transition-colors animate-pulse"
                            >
                                <span className="text-lg">⚠️</span>
                                <span>LEER REGLAMENTO INTERNO</span>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
                
                <p className="text-center text-[10px] text-zinc-600 mt-8 font-mono-tech pb-4">
                    © {new Date().getFullYear()} KALI ACCESS SYSTEM v2.0
                </p>
            </div>
        </div>

        {/* IDENTITY SELECTOR OVERLAY */}
        {activeTab === 'CHECK' && multipleMatches.length > 0 && (
            <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 animate-[fadeIn_0.3s_ease-out]">
                <h2 className="text-3xl font-tech font-black text-white mb-2 uppercase tracking-tight text-center">
                    ¿QUIÉN ERES?
                </h2>
                <p className="text-zinc-400 font-mono-tech text-sm mb-8 text-center">
                    Se encontraron {multipleMatches.length} socios con ese número.
                </p>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-2xl w-full max-h-[60vh] overflow-y-auto p-2">
                    {multipleMatches.map((client) => (
                        <button
                            key={client.id}
                            onClick={() => handleSelectIdentity(client)}
                            className="bg-zinc-900 border-2 border-zinc-700 hover:border-yellow-500 hover:shadow-[0_0_20px_rgba(234,179,8,0.3)] transition-all p-4 flex flex-col items-center gap-3 rounded-md group"
                        >
                            <div className="w-20 h-20 rounded-full border-2 border-zinc-600 group-hover:border-yellow-500 overflow-hidden bg-black">
                                {client.photoUrl ? (
                                    <img src={client.photoUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-2xl">👤</div>
                                )}
                            </div>
                            <div className="text-center">
                                <p className="font-bold text-white text-sm uppercase group-hover:text-yellow-500 truncate w-full max-w-[120px]">
                                    {client.firstName}
                                </p>
                                <p className="text-xs text-zinc-500 uppercase">
                                    {client.lastNamePaternal}
                                </p>
                            </div>
                        </button>
                    ))}
                </div>

                <button 
                    onClick={() => { setMultipleMatches([]); setCheckIdentifier(''); }} 
                    className="mt-8 text-zinc-500 hover:text-white border-b border-zinc-700 hover:border-white pb-1 transition-all text-xs font-bold uppercase tracking-widest"
                >
                    VOLVER A BUSCAR
                </button>
            </div>
        )}

        {/* CHECK RESULT OVERLAY (FOCUS MODE - DIMMING & BLUR) */}
        {activeTab === 'CHECK' && checkResult && (
            <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4 animate-[fadeIn_0.3s_ease-out]">
                <div className={`relative w-full max-w-md bg-zinc-950 p-8 border-2 shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col items-center
                    ${checkStatus === AccessStatus.GRANTED ? 'border-emerald-500 shadow-emerald-500/20' : 
                      checkStatus === AccessStatus.WARNING ? 'border-yellow-500 shadow-yellow-500/20' : 
                      'border-red-500 shadow-red-500/20'}`}
                >
                    <button onClick={closeCheckResult} className="absolute top-4 right-4 text-zinc-500 hover:text-white p-2">✕</button>

                    <div className="mb-6 scale-125">
                        <StatusLight status={checkStatus} size="lg"/>
                    </div>
                    
                    <h2 className="text-3xl font-tech font-black text-white mb-2 uppercase tracking-tight text-center leading-none">
                        {checkResult.firstName} {checkResult.lastNamePaternal}
                    </h2>
                    
                    <p className={`text-2xl font-bold font-mono-tech mb-8 text-center tracking-wider
                        ${checkStatus === AccessStatus.GRANTED ? 'text-emerald-400 drop-shadow-[0_0_10px_rgba(52,211,153,0.5)]' : 
                          checkStatus === AccessStatus.WARNING ? 'text-yellow-400 drop-shadow-[0_0_10px_rgba(250,204,21,0.5)]' : 
                          'text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.5)]'}`}
                    >
                        {checkMessage}
                    </p>

                    <div className="w-full bg-zinc-900/50 border border-zinc-800 p-6 mb-8 text-center rounded-sm">
                        <p className="text-[10px] text-zinc-500 uppercase font-tech mb-1 tracking-widest">PLAN ACTUAL</p>
                        <p className="text-white font-bold text-lg mb-4">{checkResult.packageName || checkResult.activityName || 'N/A'}</p>
                        
                        <p className="text-[10px] text-zinc-500 uppercase font-tech mb-1 tracking-widest">VIGENCIA</p>
                        <p className="text-white font-bold text-2xl font-mono-tech">{checkResult.membershipEnd}</p>
                    </div>

                    <button 
                        onClick={closeCheckResult} 
                        className={`w-full py-4 font-tech font-bold uppercase tracking-widest text-sm transition-all border shadow-lg
                        ${checkStatus === AccessStatus.GRANTED ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400' :
                          checkStatus === AccessStatus.WARNING ? 'bg-yellow-500 hover:bg-yellow-400 text-black border-yellow-600' :
                          'bg-red-600 hover:bg-red-500 text-white border-red-400'}`}
                    >
                        FINALIZAR CONSULTA
                    </button>
                </div>
            </div>
        )}

        {/* DEVELOPER FOOTER */}
        <footer className="fixed bottom-0 left-0 right-0 bg-yellow-500 text-black py-1.5 text-center font-mono-tech text-[10px] font-bold uppercase tracking-widest z-50">
            Desarrollado por joramosaDevs © 2026 Todos los derechos reservados.
        </footer>

        <style>{`
            .custom-scrollbar::-webkit-scrollbar {
                width: 6px;
            }
            .custom-scrollbar::-webkit-scrollbar-track {
                background: #18181b; 
            }
            .custom-scrollbar::-webkit-scrollbar-thumb {
                background: #eab308; 
                border-radius: 3px;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                background: #ca8a04; 
            }
            @keyframes zoomIn {
                from { opacity: 0; transform: scale(0.9); }
                to { opacity: 1; transform: scale(1); }
            }
        `}</style>
    </div>
  );
};

export default Login;
