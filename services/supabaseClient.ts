
import { createClient } from '@supabase/supabase-js';

// Función segura para leer variables de entorno sin crashear la app.
// Si import.meta.env no existe (común en ciertos WebViews de Android), usa el fallback.
const getEnv = (key: string, fallback: string): string => {
  try {
    // 1. Intentar Vite standard
    if (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env[key]) {
      return (import.meta as any).env[key];
    }
    // 2. Intentar process.env (Legacy/Polyfill)
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      return process.env[key];
    }
  } catch (e) {
    // Silently fail to fallback
  }
  return fallback;
};

// Usamos las claves proporcionadas como fallback para garantizar que funcione
const supabaseUrl = getEnv('VITE_SUPABASE_URL', "https://orxnstqcfwlwsfjjvzyz.supabase.co");
const supabaseAnonKey = getEnv('VITE_SUPABASE_ANON_KEY', "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9yeG5zdHFjZndsd3Nmamp2enl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0MjAwMzQsImV4cCI6MjEwODk5NjAzNH0.9dIG4AvAAKJKrSTHqmgDNcCzsArrgB6sNPKOVGp0R6E");

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lock: async (_name: string, _acquireTimeout: number, fn: () => Promise<any>) => {
      return await fn();
    }
  }
});