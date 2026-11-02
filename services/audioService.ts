// services/audioService.ts
// Opción C: Híbrido Inteligente (Nube Supabase + Caché Local Offline IndexedDB)
// Latencia <5ms con Web Audio API y resiliencia 100% offline

import { getCachedAudio, saveCachedAudio, removeCachedAudio, CachedAudioRecord } from './audioCacheService';
import { SystemConfig } from '../types';

export type AudioAlarmType = 'GRANTED' | 'WARNING' | 'DENIED';

export interface AudioStatusState {
  hasCustomGranted: boolean;
  hasCustomWarning: boolean;
  hasCustomDenied: boolean;
  volume: number;
  masterEnabled: boolean;
  grantedEnabled: boolean;
  warningEnabled: boolean;
  deniedEnabled: boolean;
}

export class AudioService {
  private audioContext: AudioContext | null = null;
  private isUnlocked: boolean = false;
  private decodedBuffers: Map<AudioAlarmType, AudioBuffer> = new Map();
  private lastSyncedUrls: Map<AudioAlarmType, string | null> = new Map();

  // Configuración de audio en memoria (con valores predeterminados)
  private volume: number = 80; // 0 a 100
  private masterEnabled: boolean = true;
  private grantedEnabled: boolean = true;
  private warningEnabled: boolean = true;
  private deniedEnabled: boolean = true;

  constructor() {
    // Intentar precargar caché local desde IndexedDB al arrancar
    if (typeof window !== 'undefined') {
      this.loadAllFromLocalCache().catch(() => {});
    }
  }

  // Inicializar o desbloquear el AudioContext tras el primer clic/interacción
  public init() {
    if (this.isUnlocked || typeof window === 'undefined') {
      return;
    }

    try {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      // Reproducir buffer silencioso para desbloquear el navegador
      const buffer = this.audioContext.createBuffer(1, 1, 22050);
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);
      source.start(0);

      this.isUnlocked = true;
      console.log('AudioContext inicializado y desbloqueado.');

      // Si teníamos buffers pendientes por decodificar sin AudioContext, reintentar
      this.loadAllFromLocalCache().catch(() => {});
    } catch (error) {
      console.error('Error al desbloquear AudioContext:', error);
    }
  }

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioContext) {
      try {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch (e) {
        console.warn('AudioContext no soportado:', e);
        return null;
      }
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
    return this.audioContext;
  }

  private getGainValue(): number {
    const vol = Math.max(0, Math.min(100, this.volume));
    return (vol / 100) * 0.85; // Escala óptima para evitar distorsión
  }

  // Cargar de IndexedDB a memoria para acceso ultra-rápido offline
  public async loadAllFromLocalCache(): Promise<void> {
    const types: AudioAlarmType[] = ['GRANTED', 'WARNING', 'DENIED'];
    for (const type of types) {
      try {
        const cached = await getCachedAudio(type);
        if (cached && cached.arrayBuffer) {
          const ctx = this.ensureAudioContext();
          if (ctx) {
            // Decodificar una copia del ArrayBuffer (decodeAudioData puede desconectar el buffer original)
            const bufferCopy = cached.arrayBuffer.slice(0);
            ctx.decodeAudioData(
              bufferCopy,
              (decoded) => {
                this.decodedBuffers.set(type, decoded);
                this.lastSyncedUrls.set(type, cached.url || null);
              },
              (err) => {
                console.warn(`No se pudo decodificar audio en caché para ${type}:`, err);
              }
            );
          }
        }
      } catch (err) {
        console.warn(`Error al precargar caché local para ${type}:`, err);
      }
    }
  }

  // Sincronizar con SystemConfig (Nube + Caché)
  public async syncWithConfig(config: Partial<SystemConfig>): Promise<void> {
    if (config.audio_volume !== undefined && config.audio_volume !== null) {
      this.volume = Math.max(0, Math.min(100, Number(config.audio_volume)));
    }
    if (config.audio_enabled !== undefined) {
      this.masterEnabled = Boolean(config.audio_enabled);
    }
    if (config.audio_granted_enabled !== undefined) {
      this.grantedEnabled = Boolean(config.audio_granted_enabled);
    }
    if (config.audio_warning_enabled !== undefined) {
      this.warningEnabled = Boolean(config.audio_warning_enabled);
    }
    if (config.audio_denied_enabled !== undefined) {
      this.deniedEnabled = Boolean(config.audio_denied_enabled);
    }

    // Sincronizar URLs de la nube para cada estado
    const mapping: Array<{ type: AudioAlarmType; url?: string | null }> = [
      { type: 'GRANTED', url: config.audio_granted_url },
      { type: 'WARNING', url: config.audio_warning_url },
      { type: 'DENIED', url: config.audio_denied_url },
    ];

    for (const item of mapping) {
      await this.syncSingleAudioType(item.type, item.url);
    }
  }

  private async syncSingleAudioType(type: AudioAlarmType, remoteUrl?: string | null): Promise<void> {
    // Si la URL es nula o vacía, verificar si no hay custom audio
    if (!remoteUrl) {
      const cached = await getCachedAudio(type);
      if (!cached) {
        this.decodedBuffers.delete(type);
        this.lastSyncedUrls.delete(type);
      }
      return;
    }

    // Si ya lo tenemos cargado y coincide con la URL
    if (this.decodedBuffers.has(type) && this.lastSyncedUrls.get(type) === remoteUrl) {
      return;
    }

    // Primero revisar si ya existe en la caché local IndexedDB
    try {
      const cached = await getCachedAudio(type);
      if (cached && cached.url === remoteUrl && cached.arrayBuffer) {
        const ctx = this.ensureAudioContext();
        if (ctx) {
          const bufferCopy = cached.arrayBuffer.slice(0);
          ctx.decodeAudioData(
            bufferCopy,
            (decoded) => {
              this.decodedBuffers.set(type, decoded);
              this.lastSyncedUrls.set(type, remoteUrl);
            },
            () => {}
          );
          return;
        }
      }

      // Si no está en caché o la URL cambió en la nube, descargar y guardar en caché local
      if (navigator.onLine) {
        const res = await fetch(remoteUrl);
        if (res.ok) {
          const arrayBuffer = await res.arrayBuffer();
          const mimeType = res.headers.get('content-type') || 'audio/mpeg';

          // Guardar en IndexedDB para disponibilidad offline permanente
          await saveCachedAudio({
            type,
            arrayBuffer,
            mimeType,
            updatedAt: Date.now(),
            url: remoteUrl,
          });

          const ctx = this.ensureAudioContext();
          if (ctx) {
            ctx.decodeAudioData(
              arrayBuffer.slice(0),
              (decoded) => {
                this.decodedBuffers.set(type, decoded);
                this.lastSyncedUrls.set(type, remoteUrl);
              },
              (e) => console.warn(`Error decodificando audio remoto ${type}:`, e)
            );
          }
        }
      }
    } catch (err) {
      console.warn(`No se pudo sincronizar audio remoto para ${type} (posible modo offline):`, err);
    }
  }

  // Carga inmediata de un archivo subido por el usuario en la PC (latencia 0)
  public async loadAndCacheFile(
    type: AudioAlarmType,
    file: File | Blob,
    fileName?: string
  ): Promise<{ dataUrl: string; arrayBuffer: ArrayBuffer }> {
    const arrayBuffer = await file.arrayBuffer();
    const mimeType = file.type || 'audio/mpeg';

    // 1. Guardar de inmediato en IndexedDB
    await saveCachedAudio({
      type,
      arrayBuffer,
      mimeType,
      updatedAt: Date.now(),
      fileName: fileName || (file as File).name || `${type.toLowerCase()}.mp3`,
    });

    // 2. Decodificar en memoria de inmediato para que suene ya mismo
    const ctx = this.ensureAudioContext();
    if (ctx) {
      const bufferCopy = arrayBuffer.slice(0);
      try {
        const decoded = await ctx.decodeAudioData(bufferCopy);
        this.decodedBuffers.set(type, decoded);
        this.lastSyncedUrls.delete(type); // Local prevalece
      } catch (e) {
        console.warn(`Error decodificando archivo subido para ${type}:`, e);
      }
    }

    // 3. Convertir a DataURL para subida en segundo plano a Supabase
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    return { dataUrl, arrayBuffer };
  }

  // Restablecer al pitido sintético de fábrica
  public async resetToDefault(type: AudioAlarmType): Promise<void> {
    await removeCachedAudio(type);
    this.decodedBuffers.delete(type);
    this.lastSyncedUrls.delete(type);
  }

  public hasCustomAudio(type: AudioAlarmType): boolean {
    return this.decodedBuffers.has(type);
  }

  public getAudioStatus(): AudioStatusState {
    return {
      hasCustomGranted: this.decodedBuffers.has('GRANTED'),
      hasCustomWarning: this.decodedBuffers.has('WARNING'),
      hasCustomDenied: this.decodedBuffers.has('DENIED'),
      volume: this.volume,
      masterEnabled: this.masterEnabled,
      grantedEnabled: this.grantedEnabled,
      warningEnabled: this.warningEnabled,
      deniedEnabled: this.deniedEnabled,
    };
  }

  public setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(100, volume));
  }

  public setMasterEnabled(enabled: boolean) {
    this.masterEnabled = enabled;
  }

  // Reproducción por Web Audio API con buffer en memoria (latencia <5ms)
  private playCustomBuffer(type: AudioAlarmType): boolean {
    const buffer = this.decodedBuffers.get(type);
    if (!buffer) return false;

    const ctx = this.ensureAudioContext();
    if (!ctx) return false;

    try {
      const source = ctx.createBufferSource();
      const gainNode = ctx.createGain();

      source.buffer = buffer;
      gainNode.gain.setValueAtTime(this.getGainValue(), ctx.currentTime);

      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      source.start(0);
      return true;
    } catch (err) {
      console.warn(`Fallo al reproducir buffer de ${type}:`, err);
      return false;
    }
  }

  // Tono sintético de respaldo (Fallback si no hay archivo de audio personalizado)
  private playTone(frequency: number, duration: number, type: OscillatorType = 'sine', onEnded?: () => void) {
    const ctx = this.ensureAudioContext();
    if (!ctx) return;

    try {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

      const targetGain = this.getGainValue() * 0.6;
      gainNode.gain.setValueAtTime(targetGain, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

      oscillator.start();
      oscillator.stop(ctx.currentTime + duration);
      if (onEnded) {
        oscillator.onended = onEnded;
      }
    } catch (err) {
      console.warn('Error al reproducir tono sintético:', err);
    }
  }

  // ==========================================
  // DISPARADORES DE EVENTO DE ESCANEO
  // ==========================================

  public playSuccess() {
    if (!this.masterEnabled || !this.grantedEnabled) return;

    // 1. Probar si existe audio personalizado en memoria (Híbrido)
    if (this.playCustomBuffer('GRANTED')) {
      return;
    }

    // 2. Fallback: Pitido sintético original agradable (523Hz -> 783Hz)
    this.playTone(523, 0.1, 'sine', () => {
      setTimeout(() => this.playTone(783, 0.15, 'sine'), 80);
    });
  }

  public playWarning() {
    if (!this.masterEnabled || !this.warningEnabled) return;

    // 1. Probar audio personalizado
    if (this.playCustomBuffer('WARNING')) {
      return;
    }

    // 2. Fallback: Pitido sintético de advertencia (659Hz triángulo)
    this.playTone(659, 0.3, 'triangle');
  }

  public playAlarm() {
    if (!this.masterEnabled || !this.deniedEnabled) return;

    // 1. Probar audio personalizado
    if (this.playCustomBuffer('DENIED')) {
      return;
    }

    // 2. Fallback: Doble pitido agudo cuadrado (900Hz)
    this.playTone(900, 0.15, 'square', () => {
      setTimeout(() => this.playTone(900, 0.15, 'square'), 100);
    });
  }

  // Función de vista previa para probar en la pantalla de configuración
  public async playPreview(type: AudioAlarmType, customDataUrlOrBlob?: string | Blob) {
    const ctx = this.ensureAudioContext();
    if (!ctx) return;

    // Si pasaron un archivo temporal recién seleccionado antes de guardar
    if (customDataUrlOrBlob) {
      try {
        let arrayBuffer: ArrayBuffer;
        if (typeof customDataUrlOrBlob === 'string') {
          const res = await fetch(customDataUrlOrBlob);
          arrayBuffer = await res.arrayBuffer();
        } else {
          arrayBuffer = await customDataUrlOrBlob.arrayBuffer();
        }

        const decoded = await ctx.decodeAudioData(arrayBuffer);
        const source = ctx.createBufferSource();
        const gainNode = ctx.createGain();
        source.buffer = decoded;
        gainNode.gain.setValueAtTime(this.getGainValue(), ctx.currentTime);
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        source.start(0);
        return;
      } catch (err) {
        console.warn('Error en preview temporal:', err);
      }
    }

    // Si ya está cargado en memoria o es tono por defecto
    if (type === 'GRANTED') {
      this.playSuccess();
    } else if (type === 'WARNING') {
      this.playWarning();
    } else if (type === 'DENIED') {
      this.playAlarm();
    }
  }
}

// Exportar instancia singleton
export const audioService = new AudioService();
