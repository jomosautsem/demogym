import { ImageEmbedder, FilesetResolver } from "@mediapipe/tasks-vision";
import type { Client } from "../types";
import { supabase } from './supabaseClient';

/* 
   ===========================================================================
   INSTRUCCIONES CRÍTICAS DE BASE DE DATOS (EJECUTAR EN SUPABASE SQL EDITOR)
   ===========================================================================
   Si el reconocimiento falla constantemente, es probable que la dimensión del vector
   en la base de datos no coincida con el modelo actual.
   
   El modelo MobileNetV3 Large suele generar vectores de 1024 dimensiones.
   
   1. Verificar dimensión actual:
      Si tus vectores viejos son de 1280 o 768, NO funcionarán.
      
   2. Solución rápida (Limpiar datos antiguos para re-registrar):
      UPDATE clients SET face_embedding = NULL;

   3. Configurar tabla (Si aún no está hecha):
      create extension if not exists vector;
      alter table clients drop column if exists face_embedding;
      alter table clients add column face_embedding vector(1024); -- Ajustar a 1024
*/

// --- CONFIGURACIÓN DE BIOMETRÍA MEJORADA ---
// UMBRAL: 0.60 asegura que el parecido sea fuerte. (0.50 era muy permisivo para hermanos/parecidos)
const MATCH_THRESHOLD = 0.60; 

// MARGEN DE AMBIGÜEDAD: 
// Si la diferencia entre el mejor candidato y el segundo mejor es menor a esto,
// se considera "Confuso" y se rechaza para evitar falsos positivos.
const AMBIGUITY_THRESHOLD = 0.08;

// Singleton para el modelo de MediaPipe
let imageEmbedder: ImageEmbedder | null = null;
let isModelLoading = false;

// Inicializador del modelo biométrico
const initMediaPipe = async () => {
    if (imageEmbedder || isModelLoading) return;
    isModelLoading = true;

    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
        );
        
        imageEmbedder = await ImageEmbedder.createFromOptions(vision, {
            baseOptions: {
                // Modelo estándar MobileNetV3 Large (Suele ser 1024 dims)
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_large/float32/1/mobilenet_v3_large.tflite`,
                delegate: "CPU" 
            },
            runningMode: "IMAGE",
            quantize: false 
        });
    } catch (error) {
        console.error("❌ Error cargando MediaPipe:", error instanceof Error ? error.message : JSON.stringify(error));
    } finally {
        isModelLoading = false;
    }
};

// Inicializar silenciosamente al cargar el script
initMediaPipe();

// Helper para convertir Base64 a HTMLImageElement
const base64ToImage = (base64: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = base64;
    });
};

/**
 * GENERA EL "ADN FACIAL"
 */
export const generateFaceEmbedding = async (base64Image: string): Promise<number[] | null> => {
    // Retry init if failed previously
    if (!imageEmbedder) {
        await initMediaPipe();
        if (!imageEmbedder) {
            console.error("El modelo biométrico no pudo iniciarse.");
            return null;
        }
    }

    try {
        const imageElement = await base64ToImage(base64Image);
        
        // Extraer características matemáticas
        const result = imageEmbedder.embed(imageElement);
        
        if (result.embeddings && result.embeddings.length > 0) {
            const vector = result.embeddings[0].floatEmbedding as number[];
            return vector;
        }
        return null;
    } catch (error) {
        console.error("Error generando vector:", error instanceof Error ? error.message : JSON.stringify(error));
        return null;
    }
};

/**
 * CALCULO MATEMÁTICO DE SIMILITUD (Coseno)
 */
const cosineSimilarity = (vecA: number[], vecB: number[]): number => {
    if (vecA.length !== vecB.length) return 0;
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
};

/**
 * PROCESO DE IDENTIFICACIÓN MEJORADO
 */
export const identifyClientFromFrame = async (
  currentFrameBase64: string,
  allCandidates: Client[]
): Promise<string | null> => {
  // 1. Convertir la cara actual en números
  const frameEmbedding = await generateFaceEmbedding(currentFrameBase64);
  
  if (!frameEmbedding) {
      // console.warn("No se pudo vectorizar el rostro actual.");
      return null;
  }

  /* 
     NOTA: Desactivamos RPC Matches para confiar plenamente en la lógica local "stricter" (más estricta)
     que implementamos abajo, a menos que RPC soporte filtrado avanzado.
     Por consistencia en esta versión, usaremos la comparación local optimizada.
  */

  // 2. BUSQUEDA Y COMPARACIÓN LOCAL AVANZADA
  
  // Solo revisamos clientes activos con vectores registrados y VÁLIDOS
  const validCandidates = allCandidates.filter(c => 
      c.face_embedding && 
      Array.isArray(c.face_embedding) && 
      c.face_embedding.length === frameEmbedding.length && 
      c.isActive
  );
  
  // Calcular puntajes para TODOS los candidatos válidos
  const scoredCandidates = validCandidates.map(client => ({
      id: client.id,
      name: client.firstName, // Útil para debugging
      score: cosineSimilarity(frameEmbedding, client.face_embedding!)
  }));

  // Ordenar de mayor coincidencia a menor
  scoredCandidates.sort((a, b) => b.score - a.score);

  // --- ANÁLISIS DE RESULTADOS ---

  if (scoredCandidates.length === 0) return null;

  const bestMatch = scoredCandidates[0];
  const secondBestMatch = scoredCandidates.length > 1 ? scoredCandidates[1] : null;

  // 1. REGLA DE UMBRAL MINIMO
  if (bestMatch.score < MATCH_THRESHOLD) {
      return null;
  }

  // 2. REGLA DE AMBIGÜEDAD (ANTI-GEMELOS / ROSTROS SIMILARES)
  if (secondBestMatch) {
      const difference = bestMatch.score - secondBestMatch.score;
      
      // Si la diferencia entre el 1ro y el 2do es muy pequeña, es arriesgado decidir.
      if (difference < AMBIGUITY_THRESHOLD) {
          // console.warn(`⚠️ AMBIGÜEDAD DETECTADA.`);
          // Por seguridad estricta, retornamos NULL.
          return null; 
      }
  }

  // Si pasa todas las reglas
  return bestMatch.id;
};