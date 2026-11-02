// services/audioCacheService.ts
// Almacenamiento local en IndexedDB para resiliencia 100% Offline y latencia <5ms

export interface CachedAudioRecord {
  type: 'GRANTED' | 'WARNING' | 'DENIED';
  arrayBuffer: ArrayBuffer;
  mimeType: string;
  updatedAt: number;
  url?: string;
  fileName?: string;
}

const DB_NAME = 'kali_audio_cache_db';
const DB_VERSION = 1;
const STORE_NAME = 'audios';

function isIndexedDbSupported(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openDb(): Promise<IDBDatabase | null> {
  if (!isIndexedDbSupported()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'type' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = (e) => {
        console.warn('No se pudo abrir IndexedDB para audios:', e);
        resolve(null);
      };
    } catch (err) {
      console.warn('Error al acceder a IndexedDB:', err);
      resolve(null);
    }
  });
}

export async function getCachedAudio(type: 'GRANTED' | 'WARNING' | 'DENIED'): Promise<CachedAudioRecord | null> {
  const db = await openDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(type);

      req.onsuccess = () => {
        resolve((req.result as CachedAudioRecord) || null);
      };

      req.onerror = () => {
        resolve(null);
      };
    } catch (err) {
      console.warn(`Error al leer audio en caché para ${type}:`, err);
      resolve(null);
    }
  });
}

export async function saveCachedAudio(record: CachedAudioRecord): Promise<void> {
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);

      req.onsuccess = () => resolve();
      req.onerror = () => {
        console.warn(`Error al guardar audio en caché (${record.type}):`, req.error);
        resolve(); // No romper el flujo principal
      };
    } catch (err) {
      console.warn(`Excepción al guardar audio en caché (${record.type}):`, err);
      resolve();
    }
  });
}

export async function removeCachedAudio(type: 'GRANTED' | 'WARNING' | 'DENIED'): Promise<void> {
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(type);

      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function clearAllCachedAudio(): Promise<void> {
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();

      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
