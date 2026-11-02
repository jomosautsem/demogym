
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getSystemConfig } from '../services/storage';
import { supabase } from '../services/supabaseClient';
import { SystemConfig } from '../types';
import { audioService } from '../services/audioService';

interface ThemeContextType {
  config: SystemConfig;
  refreshConfig: () => Promise<void>;
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Default fallback config
const defaultConfig: SystemConfig = {
    id: 1,
    org_name: 'Kali Access',
    primary_color: '#eab308', // Yellow-500
    secondary_color: '#000000',
    logo_url: null,
    favicon_url: null,
    require_biometric_exit_pin: true,
    scanner_message_duration: 4,
    scanner_denied_extra_time: true,
    scanner_rescan_rule: 'ONCE_PER_DAY',
    scanner_allow_manual_reentry: true,
    audio_granted_url: null,
    audio_warning_url: null,
    audio_denied_url: null,
    audio_volume: 80,
    audio_enabled: true,
    audio_granted_enabled: true,
    audio_warning_enabled: true,
    audio_denied_enabled: true
};

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<SystemConfig>(defaultConfig);
  const [isLoading, setIsLoading] = useState(true);

  const refreshConfig = async () => {
      try {
          const data = await getSystemConfig();
          setConfig(data);
          applyTheme(data);
      } catch (e) {
          console.warn("Fallo al cargar tema:", e);
      } finally {
          setIsLoading(false);
      }
  };

  const applyTheme = (cfg: SystemConfig) => {
      // Sync Audio Service
      audioService.syncWithConfig(cfg).catch(() => {});
      // 1. Update Title
      document.title = `${cfg.org_name} - Sistema 3D`;

      // 2. Update Favicon
      if (cfg.favicon_url) {
          let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
          if (!link) {
              link = document.createElement('link');
              link.rel = 'icon';
              document.getElementsByTagName('head')[0].appendChild(link);
          }
          link.href = cfg.favicon_url;
      }

      // 3. Update Colors via CSS Variables / Overrides
      // We inject a style tag to override tailwind classes dynamically
      const styleId = 'dynamic-theme-styles';
      let styleTag = document.getElementById(styleId) as HTMLStyleElement;
      if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.id = styleId;
          document.head.appendChild(styleTag);
      }

      const primary = cfg.primary_color || '#eab308';
      
      // Convert hex to approximate RGB for opacity utilities if needed, 
      // but for now we brute force the main classes.
      // This CSS overrides the specific Tailwind classes used in the app for "brand" color.
      styleTag.innerHTML = `
        :root {
            --primary-color: ${primary};
        }
        
        /* Text Color Overrides */
        .text-yellow-500 { color: var(--primary-color) !important; }
        .text-yellow-400 { color: var(--primary-color) !important; }
        
        /* Border Color Overrides */
        .border-yellow-500 { border-color: var(--primary-color) !important; }
        .border-yellow-600 { border-color: var(--primary-color) !important; }
        
        /* Background Color Overrides */
        .bg-yellow-500 { background-color: var(--primary-color) !important; }
        
        /* Accents with Opacity (Using color-mix to avoid reducing text/child element opacity) */
        .bg-yellow-500\\/10 { background-color: color-mix(in srgb, var(--primary-color) 12%, transparent) !important; }
        .bg-yellow-500\\/15 { background-color: color-mix(in srgb, var(--primary-color) 18%, transparent) !important; }
        .bg-yellow-500\\/20 { background-color: color-mix(in srgb, var(--primary-color) 25%, transparent) !important; }
        .bg-yellow-900\\/10 { background-color: color-mix(in srgb, var(--primary-color) 15%, transparent) !important; }
        .bg-yellow-900\\/20 { background-color: color-mix(in srgb, var(--primary-color) 25%, transparent) !important; }
        .border-yellow-500\\/80 { border-color: color-mix(in srgb, var(--primary-color) 80%, transparent) !important; }
        .border-yellow-500\\/70 { border-color: color-mix(in srgb, var(--primary-color) 70%, transparent) !important; }
        .border-yellow-500\\/60 { border-color: color-mix(in srgb, var(--primary-color) 60%, transparent) !important; }
        .border-yellow-500\\/50 { border-color: color-mix(in srgb, var(--primary-color) 50%, transparent) !important; }
        .border-yellow-500\\/40 { border-color: color-mix(in srgb, var(--primary-color) 40%, transparent) !important; }
        .border-yellow-500\\/30 { border-color: color-mix(in srgb, var(--primary-color) 30%, transparent) !important; }
        
        /* Selection color */
        ::selection {
            background-color: var(--primary-color) !important;
            color: black !important;
        }
      `;
  };

  useEffect(() => {
      refreshConfig();

      // Escuchar eventos locales y cambios en otras pestañas/ventanas
      const handleLocalUpdate = () => {
          refreshConfig();
      };
      window.addEventListener('kali_system_config_updated', handleLocalUpdate);
      window.addEventListener('storage', handleLocalUpdate);
      window.addEventListener('focus', handleLocalUpdate);

      // Suscripción en tiempo real a Supabase para sincronizar cambios en todos los dispositivos conectados
      const channel = supabase
          .channel('system_config_realtime_sync')
          .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'system_config' },
              () => {
                  refreshConfig();
              }
          )
          .subscribe();

      // Polling ligero cada 30s como respaldo para kioscos/terminales siempre encendidas
      const pollInterval = setInterval(() => {
          refreshConfig();
      }, 30000);

      return () => {
          window.removeEventListener('kali_system_config_updated', handleLocalUpdate);
          window.removeEventListener('storage', handleLocalUpdate);
          window.removeEventListener('focus', handleLocalUpdate);
          clearInterval(pollInterval);
          supabase.removeChannel(channel);
      };
  }, []);

  return (
    <ThemeContext.Provider value={{ config, refreshConfig, isLoading }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
