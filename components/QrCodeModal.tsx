import React, { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import type { Client } from '../types';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { useToast } from '../context/ToastContext';

interface QrCodeModalProps {
  client: Client;
  onClose: () => void;
}

const QrCodeModal: React.FC<QrCodeModalProps> = ({ client, onClose }) => {
  const { showToast } = useToast();
  const qrRef = useRef<HTMLDivElement>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  // --- LÓGICA DE URL PÚBLICA CON SOPORTE DIRECTO A PORTAL ---
  const getPortalUrl = () => {
    const env = (import.meta as any).env;
    if (env && env.VITE_PUBLIC_URL) {
      return `${env.VITE_PUBLIC_URL}/?portal=${client.id}`;
    }
    const currentOrigin = window.location.origin;
    if (currentOrigin.includes('localhost') || currentOrigin.includes('127.0.0.1')) {
      return `https://kaliaccess.joramosa.com/?portal=${client.id}`;
    }
    return `${currentOrigin}/?portal=${client.id}`;
  };

  const portalUrl = getPortalUrl();
  const fullName = `${client.firstName} ${client.lastNamePaternal} ${client.lastNameMaternal || ''}`.trim();

  // --- GENERADOR DE CREDENCIAL / PASE DIGITAL VIP EN CANVAS ---
  const generatePassCanvas = async (): Promise<HTMLCanvasElement | null> => {
    if (!qrRef.current) return null;
    const qrCanvas = qrRef.current.querySelector('canvas');
    if (!qrCanvas) return null;

    const cardCanvas = document.createElement('canvas');
    const width = 600;
    const height = 820;
    cardCanvas.width = width;
    cardCanvas.height = height;
    const ctx = cardCanvas.getContext('2d');
    if (!ctx) return qrCanvas;

    // 1. Fondo Negro Cyber
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, width, height);

    // 2. Marco Dorado Exterior
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 8;
    ctx.strokeRect(16, 16, width - 32, height - 32);

    // 3. Línea decorativa interna
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 2;
    ctx.strokeRect(28, 28, width - 56, height - 56);

    // 4. Encabezado Kali Access
    ctx.fillStyle = '#eab308';
    ctx.fillRect(16, 16, width - 32, 95);

    ctx.fillStyle = '#000000';
    ctx.font = '900 38px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('KALI ACCESS', width / 2, 68);

    ctx.font = 'bold 14px monospace';
    ctx.fillText('PASE DIGITAL DE ACCESO BIOMÉTRICO / QR', width / 2, 94);

    // 5. Nombre del Socio
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 32px sans-serif';
    ctx.fillText(client.firstName.toUpperCase(), width / 2, 175);

    ctx.fillStyle = '#eab308';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(`${client.lastNamePaternal} ${client.lastNameMaternal || ''}`.trim().toUpperCase(), width / 2, 212);

    // 6. Vigencia / Teléfono
    ctx.fillStyle = '#a1a1aa';
    ctx.font = '16px monospace';
    const metaText = client.membershipEnd
      ? `VIGENCIA: ${client.membershipEnd}  •  TEL: ${client.phone || 'S/N'}`
      : `SOCIO REGISTRADO  •  TEL: ${client.phone || 'S/N'}`;
    ctx.fillText(metaText, width / 2, 248);

    // 7. Contenedor Blanco del QR
    const qrBoxSize = 380;
    const qrBoxX = (width - qrBoxSize) / 2;
    const qrBoxY = 280;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize);

    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 4;
    ctx.strokeRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize);

    // 8. Dibujar el QR dentro del contenedor blanco
    const qrPadding = 25;
    ctx.drawImage(
      qrCanvas,
      qrBoxX + qrPadding,
      qrBoxY + qrPadding,
      qrBoxSize - qrPadding * 2,
      qrBoxSize - qrPadding * 2
    );

    // 9. Pie de Credencial
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('● PRESENTA ESTE CÓDIGO EN RECEPCIÓN ●', width / 2, 710);

    ctx.fillStyle = '#71717a';
    ctx.font = '13px monospace';
    ctx.fillText(`ID: ${client.id.slice(0, 18)}`, width / 2, 745);
    ctx.fillText('MEMBRESÍA PERSONAL E INTRANSFERIBLE', width / 2, 770);

    return cardCanvas;
  };

  // --- 1. DESCARGAR PASE VIP PNG ---
  const handleDownload = async () => {
    const passCanvas = await generatePassCanvas();
    if (!passCanvas) return;

    const pngUrl = passCanvas
      .toDataURL('image/png')
      .replace('image/png', 'image/octet-stream');
    const downloadLink = document.createElement('a');
    downloadLink.href = pngUrl;
    downloadLink.download = `Pase_QR_${client.firstName}_${client.lastNamePaternal}.png`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    showToast('PASE DIGITAL QR DESCARGADO', 'success');
  };

  // --- 2. COPIAR IMAGEN AL PORTAPAPELES Y ABRIR WHATSAPP (1 CLIC PARA PC) ---
  const handleCopyAndOpenWhatsApp = async () => {
    setIsCopying(true);
    try {
      const passCanvas = await generatePassCanvas();
      let copiedImage = false;

      if (passCanvas && navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        const blob = await new Promise<Blob | null>((resolve) => passCanvas.toBlob(resolve, 'image/png'));
        if (blob) {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({ 'image/png': blob })
            ]);
            copiedImage = true;
          } catch (clipErr) {
            console.warn('No se pudo copiar imagen al portapapeles:', clipErr);
          }
        }
      }

      if (client.phone) {
        let cleanPhone = client.phone.replace(/\D/g, '');
        if (cleanPhone.length === 10) cleanPhone = `52${cleanPhone}`;

        const waText =
          `¡Hola *${client.firstName}*! 👋🏋️‍♂️\n\n` +
          `Aquí tienes tu *Pase Digital QR de Acceso* a *Kali Access*.\n\n` +
          `📲 *Consulta tu vigencia en vivo aquí:*\n${portalUrl}\n\n` +
          `💡 _Guarda tu imagen QR en tu celular y muéstrala en recepción al ingresar._`;

        window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(waText)}`, '_blank');

        if (copiedImage) {
          showToast('¡PASE QR COPIADO! Presiona PEGAR (Ctrl+V) en el chat de WhatsApp', 'success');
        } else {
          showToast('Abriendo WhatsApp con el enlace del Pase QR', 'info');
        }
      } else {
        if (copiedImage) {
          showToast('¡IMAGEN DEL PASE QR COPIADA AL PORTAPAPELES! (Ctrl+V para pegar)', 'success');
        } else {
          await navigator.clipboard.writeText(portalUrl);
          showToast('Enlace del QR copiado al portapapeles', 'info');
        }
      }
    } catch (err) {
      console.warn('Error en copiar y enviar:', err);
      showToast('No se pudo copiar automáticamente, usa el botón Descargar', 'warning');
    } finally {
      setIsCopying(false);
    }
  };

  // --- 3. ENVIAR SOLO ENLACE POR WHATSAPP ---
  const handleSendWhatsAppLink = () => {
    if (!client.phone) {
      showToast('Este socio no tiene número de teléfono registrado', 'warning');
      return;
    }
    let cleanPhone = client.phone.replace(/\D/g, '');
    if (cleanPhone.length === 10) cleanPhone = `52${cleanPhone}`;

    const waText =
      `¡Hola *${client.firstName}*! 👋\n\n` +
      `Te compartimos el acceso directo a tu *Credencial Digital QR* y consulta de vigencia en *Kali Access*:\n\n` +
      `🔗 ${portalUrl}\n\n` +
      `¡Te esperamos para entrenar con todo! 💪🔥`;

    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(waText)}`, '_blank');
  };

  // --- 4. COMPARTIR NATIVO (MÓVIL / CAPACITOR / WEB SHARE) ---
  const handleShare = async () => {
    setIsSharing(true);
    try {
      const passCanvas = await generatePassCanvas();
      if (!passCanvas) return;

      const title = `Pase QR Kali Access - ${client.firstName}`;
      const text = `Hola ${client.firstName}, aquí tienes tu Pase QR de acceso y el enlace a tu portal:\n\n🔗 ${portalUrl}`;

      if (Capacitor.isNativePlatform()) {
        const base64Data = passCanvas.toDataURL('image/png');
        const base64Content = base64Data.split(',')[1];
        const fileName = `pase_qr_${client.id}_${Date.now()}.png`;

        const savedFile = await Filesystem.writeFile({
          path: fileName,
          data: base64Content,
          directory: Directory.Cache
        });

        await Share.share({
          title,
          text,
          url: savedFile.uri,
          dialogTitle: 'Compartir Pase QR'
        });
      } else {
        passCanvas.toBlob(async (blob) => {
          if (!blob) return;
          const file = new File([blob], `Pase_QR_${client.firstName}.png`, { type: 'image/png' });

          if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ title, text, files: [file] });
          } else if (navigator.share) {
            await navigator.share({ title, text, url: portalUrl });
          } else {
            await handleCopyAndOpenWhatsApp();
          }
        }, 'image/png');
      }
    } catch (error: any) {
      if (error?.message !== 'Share canceled') {
        console.warn('Error al compartir:', error);
      }
    } finally {
      setTimeout(() => setIsSharing(false), 400);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[250] bg-black/95 backdrop-blur-md flex items-center justify-center p-4 animate-[fadeIn_0.25s_ease-out] overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-zinc-950 border-2 border-yellow-500 rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(234,179,8,0.2)] my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* TOP HEADER VIP */}
        <div className="bg-yellow-500 text-black px-6 py-4 flex items-center justify-between">
          <div className="text-left">
            <h3 className="font-tech font-black text-lg tracking-wider uppercase leading-none">
              PASE DIGITAL QR
            </h3>
            <p className="font-mono-tech text-[10px] font-bold uppercase tracking-widest opacity-80 mt-0.5">
              CREDENCIAL DE ACCESO KALI
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-black/15 hover:bg-black text-black hover:text-yellow-500 flex items-center justify-center transition-colors font-bold"
          >
            ✕
          </button>
        </div>

        <div className="p-6 text-center">
          {/* INFO DEL SOCIO CON FOTO */}
          <div className="flex items-center gap-3.5 bg-zinc-900/90 border border-zinc-800 p-3 rounded-xl mb-5 text-left">
            <div className="w-14 h-14 rounded-xl bg-black border-2 border-yellow-500/60 overflow-hidden shrink-0 flex items-center justify-center">
              {client.photoUrl ? (
                <img src={client.photoUrl} alt={fullName} className="w-full h-full object-cover" />
              ) : (
                <span className="font-tech font-black text-xl text-yellow-500">
                  {client.firstName.charAt(0)}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-tech font-black text-white uppercase truncate">
                {fullName}
              </h2>
              <p className="text-xs font-mono-tech text-yellow-500 truncate">
                Tel: {client.phone || 'Sin teléfono'}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-[9px] font-tech font-bold px-2 py-0.5 rounded uppercase ${client.isActive ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-red-950 text-red-400 border border-red-800'}`}>
                  {client.isActive ? 'SOCIO ACTIVO' : 'INACTIVO'}
                </span>
                {client.membershipEnd && (
                  <span className="text-[10px] font-mono-tech text-zinc-400">
                    Vence: {client.membershipEnd}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* QR CODE EN MARCO DE ALTO CONTRASTE */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl py-5 px-4 mb-5 flex flex-col items-center">
            <div
              className="bg-white p-3.5 rounded-xl border-4 border-yellow-500 shadow-[0_0_25px_rgba(255,255,255,0.15)] inline-block"
              ref={qrRef}
            >
              <QRCodeCanvas
                value={portalUrl}
                size={210}
                bgColor={'#ffffff'}
                fgColor={'#000000'}
                level={'H'}
                includeMargin={true}
              />
            </div>
            <p className="text-[10px] font-mono-tech text-emerald-400 uppercase tracking-widest mt-3 font-bold">
              ● ESCANEA EN RECEPCIÓN PARA REGISTRAR ASISTENCIA ●
            </p>
          </div>

          {/* BOTONES DE ENVÍO DIRECTO AL CLIENTE */}
          <div className="space-y-2.5">
            {/* OPCIÓN 1: COPIAR IMAGEN + ABRIR WHATSAPP (IDEAL PC / RECEPCIÓN) */}
            <button
              onClick={handleCopyAndOpenWhatsApp}
              disabled={isCopying}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-tech font-bold uppercase tracking-wider py-3.5 px-4 rounded-xl border border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.35)] transition-all active:scale-[0.98] flex items-center justify-center gap-2.5 text-xs cursor-pointer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.017-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
              </svg>
              <span>
                {isCopying ? 'PREPARANDO PASE...' : 'COPIAR CREDENCIAL QR Y ABRIR WHATSAPP'}
              </span>
            </button>
            <p className="text-[10px] font-mono-tech text-zinc-400">
              💡 Copia la imagen del Pase QR lista para pegar con <strong className="text-yellow-400">Ctrl + V</strong> en el WhatsApp del cliente.
            </p>

            {/* OPCIÓN 2: ACCIONES SECUNDARIAS */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              <button
                onClick={handleSendWhatsAppLink}
                className="bg-zinc-900 hover:bg-zinc-800 text-emerald-400 font-tech font-bold uppercase py-3 px-2 rounded-xl border border-zinc-700 hover:border-emerald-500 text-[10px] transition-all flex flex-col items-center justify-center gap-1 cursor-pointer"
                title="Enviar enlace directo por WhatsApp"
              >
                <span className="text-sm">🔗</span>
                <span>LINK WA</span>
              </button>

              <button
                onClick={handleDownload}
                className="bg-yellow-500 hover:bg-yellow-400 text-black font-tech font-bold uppercase py-3 px-2 rounded-xl border border-yellow-600 text-[10px] transition-all flex flex-col items-center justify-center gap-1 shadow-md cursor-pointer"
                title="Descargar imagen PNG del Pase QR"
              >
                <span className="text-sm">⬇️</span>
                <span>DESCARGAR</span>
              </button>

              <button
                onClick={handleShare}
                disabled={isSharing}
                className="bg-zinc-900 hover:bg-zinc-800 text-cyan-400 font-tech font-bold uppercase py-3 px-2 rounded-xl border border-zinc-700 hover:border-cyan-500 text-[10px] transition-all flex flex-col items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                title="Compartir mediante menú del dispositivo"
              >
                <span className="text-sm">📤</span>
                <span>{isSharing ? '...' : 'COMPARTIR'}</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="w-full bg-black hover:bg-zinc-900 text-zinc-400 hover:text-white font-tech font-bold uppercase py-3 rounded-xl border border-zinc-800 text-xs tracking-widest transition-colors mt-2 cursor-pointer"
            >
              CERRAR VENTANA
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QrCodeModal;
