import React, { useState, useEffect } from 'react';
import { getClientById } from '../services/storage';
import { Client, AccessStatus } from '../types';
import StatusLight from './StatusLight';

interface ClientPortalProps {
  clientId: string;
}

const ClientPortal: React.FC<ClientPortalProps> = ({ clientId }) => {
  const [client, setClient] = useState<Client | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AccessStatus>(AccessStatus.IDLE);
  const [daysLeft, setDaysLeft] = useState(0);

  useEffect(() => {
    const fetchClientData = async () => {
      try {
        const clientData = await getClientById(clientId);
        if (clientData) {
          setClient(clientData);
          const calculatedDays = Math.ceil((new Date(clientData.membershipEnd).getTime() - new Date(new Date().setHours(0,0,0,0)).getTime()) / 864e5);
          setDaysLeft(calculatedDays);

          if (!clientData.isActive) {
            setStatus(AccessStatus.DENIED);
          } else if (calculatedDays < 0) {
            setStatus(AccessStatus.DENIED);
          } else if (calculatedDays <= 2) {
            setStatus(AccessStatus.WARNING);
          } else {
            setStatus(AccessStatus.GRANTED);
          }
        } else {
          setError('El enlace es inválido o el cliente no fue encontrado.');
        }
      } catch (e) {
        console.error(e);
        setError('Ocurrió un error al consultar la información.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchClientData();
  }, [clientId]);

  const getStatusMessage = () => {
    if (!client) return "";
    if (!client.isActive) return "Membresía Inactiva";
    if (status === AccessStatus.GRANTED) return "Membresía Activa";
    if (status === AccessStatus.WARNING) return "Membresía por Vencer";
    if (status === AccessStatus.DENIED) return "Membresía Vencida";
    return "";
  };

  const daysText = () => {
    if (!client) return null;
    if (!client.isActive) {
      return <span className="font-bold text-white text-4xl">CONSULTAR EN RECEPCIÓN</span>;
    }
    if (daysLeft >= 1) {
        return <><span className="font-bold text-white text-7xl">{daysLeft}</span> {daysLeft === 1 ? 'Día Restante' : 'Días Restantes'}</>;
    }
    if (daysLeft === 0) {
        return <><span className="font-bold text-white text-7xl">HOY</span> es el último día</>;
    }
    return <><span className="font-bold text-white text-7xl">{Math.abs(daysLeft)}</span> {Math.abs(daysLeft) === 1 ? 'Día Vencido' : 'Días Vencidos'}</>;
  }

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center font-mono-tech text-yellow-500 animate-pulse">CARGANDO INFORMACIÓN...</div>;
  }

  if (error) {
    return <div className="min-h-screen flex items-center justify-center font-mono-tech text-red-500 text-center p-4">{error}</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 animate-[fadeIn_1s_ease-out]">
        <div className="w-full max-w-md mx-auto relative">
            <div className="absolute -inset-1 bg-gradient-to-r from-yellow-600 to-zinc-800 rounded-lg blur opacity-50"></div>
            <div className="relative bg-black border border-zinc-800 p-8 shadow-2xl shadow-yellow-500/5 text-center">
                <div className="mb-6 flex justify-center">
                    <StatusLight status={status} size="lg"/>
                </div>
                <p className="text-xl font-tech text-yellow-500 tracking-wider mb-2">{getStatusMessage()}</p>
                <h1 className="text-3xl font-tech font-black text-white truncate">{client?.firstName} {client?.lastNamePaternal}</h1>
                <div className="my-8 bg-zinc-900/50 border-y border-zinc-800 py-6">
                    <p className="text-3xl font-tech text-zinc-400">{daysText()}</p>
                </div>
                <div className="font-mono-tech text-sm text-zinc-500 space-y-2">
                    <p><span className="font-bold text-zinc-400">Vencimiento:</span> {client?.membershipEnd}</p>
                    <p><span className="font-bold text-zinc-400">Plan:</span> {client?.packageName || client?.activityName || 'No especificado'}</p>
                </div>
                <div className="mt-10 pt-6 border-t border-zinc-800">
                    <p className="text-lg font-tech font-black text-white">Kali <span className="text-yellow-500">Access</span></p>
                </div>
            </div>
        </div>
    </div>
  );
};

export default ClientPortal;
